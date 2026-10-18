import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger, requestLogger } from "./logger.js";

// NetZero Hub operator console (port 4000).
//
// Kept apart from the citizen-facing gateway on purpose: citizens only ever
// reach port 3000. This service is for the people running the platform and
// for the live demo:
//   - GET  /api/health                  health of the gateway and every microservice
//   - GET  /api/broker                  RabbitMQ queue depth and consumer count
//   - GET  /api/process-events          tail of the services' process-event logs
//   - GET  /api/services                container state of each compose service
//   - POST /api/services/:name/stop     stop one microservice (or the broker)
//   - POST /api/services/:name/start    start it again
//   - /           the console page (live architecture, process map, event feed, controls)
//   - /stage/     presenter view: citizen app beside the live console
//
// The stop/start controls talk to the Docker Engine through its socket, which
// is root-equivalent access to the host, so they are fenced in: the port is
// published on 127.0.0.1 only (docker-compose.yml), only the SERVICES marked
// controllable can be touched, only "stop" and "start" exist, and every
// control request must carry an X-Ops-Console header. Browsers won't send a
// custom header cross-site without a CORS preflight, which this service never
// approves, so another website can't drive the controls.

const app = express();
app.use(requestLogger);
const PORT = process.env.PORT || 4000;

const HEALTH_URLS: Record<string, string> = {
  gateway: process.env.GATEWAY_URL || "http://localhost:3000",
  reservation: process.env.RESERVATION_URL || "http://localhost:3001",
  billing: process.env.BILLING_URL || "http://localhost:3002",
  footprint: process.env.FOOTPRINT_URL || "http://localhost:3003",
  offset: process.env.OFFSET_URL || "http://localhost:3004",
  journey: process.env.JOURNEY_URL || "http://localhost:3005",
};
const RABBITMQ_MGMT_URL = process.env.RABBITMQ_MGMT_URL || "http://localhost:15672";
const RABBITMQ_AUTH = "Basic " + Buffer.from(process.env.RABBITMQ_MGMT_USER || "guest:guest").toString("base64");
const LOG_DIR = process.env.LOG_DIR || "../logs";
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

const SERVICES = [
  { service: "api-gateway", label: "API gateway", role: "Entry point for the citizen app (:3000)", controllable: false },
  { service: "ev-reservation-service", label: "EV reservation", role: "Bookings, arrival, pre-authorisation (:3001)", controllable: true },
  { service: "ev-billing-service", label: "EV billing", role: "Asynchronous settlement and receipts (:3002)", controllable: true },
  { service: "footprint-service", label: "Footprint", role: "Carbon footprint calculator (:3003)", controllable: true },
  { service: "offset-service", label: "Offset", role: "Offset purchase and certificates (:3004)", controllable: true },
  { service: "journey-planner-service", label: "Journey planner", role: "Low-carbon trip planning (:3005)", controllable: true },
  { service: "rabbitmq", label: "RabbitMQ", role: "Message broker for the asynchronous flows", controllable: true },
];

app.get("/health", (_req, res) => res.json({ status: "ok", service: "ops-console" }));

// ------------------------------------------------------------------ health, broker, events
app.get("/api/health", async (_req, res) => {
  const entries = await Promise.all(
    Object.entries(HEALTH_URLS).map(async ([name, url]) => {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
        return [name, r.ok ? "up" : "down"] as const;
      } catch {
        return [name, "down"] as const;
      }
    })
  );
  res.json(Object.fromEntries(entries));
});

app.get("/api/broker", async (_req, res) => {
  try {
    const r = await fetch(`${RABBITMQ_MGMT_URL}/api/queues`, { headers: { Authorization: RABBITMQ_AUTH }, signal: AbortSignal.timeout(1500) });
    if (!r.ok) return res.json({ broker: "down", queues: [] });
    const queues = ((await r.json()) as any[]).map((q) => ({ name: q.name, messages: q.messages ?? 0, consumers: q.consumers ?? 0 }));
    res.json({ broker: "up", queues });
  } catch {
    res.json({ broker: "down", queues: [] });
  }
});

// Only the last TAIL_BYTES of each log are read, so polling stays cheap after a large simulation.
const TAIL_BYTES = 256 * 1024;
function tailLines(file: string): string[] {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // first line may be partial
    return lines.filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}
app.get("/api/process-events", (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : "";
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  if (!fs.existsSync(LOG_DIR)) return res.json([]);
  const events: any[] = [];
  for (const f of fs.readdirSync(LOG_DIR).filter((n) => n.endsWith(".jsonl"))) {
    for (const line of tailLines(path.join(LOG_DIR, f))) {
      try {
        const e = JSON.parse(line);
        if (!since || e.timestamp > since) events.push(e);
      } catch {
        /* a line mid-write */
      }
    }
  }
  events.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  res.json(events.slice(-limit));
});

// ------------------------------------------------------------------ Docker controls
function docker(method: string, apiPath: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: DOCKER_SOCKET, path: apiPath, method, headers: { "Content-Type": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let body: any = data;
        try { body = data ? JSON.parse(data) : null; } catch { /* plain text */ }
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("docker request timed out")));
    req.end();
  });
}

// The compose project this console belongs to, read from its own container's labels.
let projectName: string | null = null;
async function project(): Promise<string | null> {
  if (projectName) return projectName;
  const r = await docker("GET", `/containers/${os.hostname()}/json`);
  projectName = r.status === 200 ? r.body?.Config?.Labels?.["com.docker.compose.project"] ?? null : null;
  return projectName;
}
async function containerFor(service: string) {
  const p = await project();
  if (!p) return null;
  const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${p}`, `com.docker.compose.service=${service}`] }));
  const r = await docker("GET", `/containers/json?all=1&filters=${filters}`);
  return r.status === 200 && Array.isArray(r.body) && r.body.length ? r.body[0] : null;
}

app.get("/api/services", async (_req, res) => {
  if (!fs.existsSync(DOCKER_SOCKET)) {
    return res.json({ available: false, reason: "The Docker socket isn't mounted, so services can't be controlled from here.", services: [] });
  }
  try {
    const services = await Promise.all(
      SERVICES.map(async (s) => {
        const c = await containerFor(s.service);
        return { ...s, state: c ? c.State : "missing", status: c ? c.Status : "not created" };
      })
    );
    res.json({ available: true, project: projectName, services });
  } catch (err) {
    logger.warn("docker query failed", { error: (err as Error).message });
    res.json({ available: false, reason: "Docker didn't respond.", services: [] });
  }
});

app.post("/api/services/:name/:action", async (req, res) => {
  if (req.get("X-Ops-Console") !== "1") return res.status(403).json({ error: "missing X-Ops-Console header" });
  const { name, action } = req.params;
  const svc = SERVICES.find((s) => s.service === name);
  if (!svc || !svc.controllable) return res.status(403).json({ error: `${name} can't be controlled from the console` });
  if (action !== "stop" && action !== "start") return res.status(400).json({ error: "action must be stop or start" });
  try {
    const c = await containerFor(name);
    if (!c) return res.status(404).json({ error: `no container for ${name}` });
    const r = await docker("POST", `/containers/${c.Id}/${action}${action === "stop" ? "?t=5" : ""}`);
    if (r.status !== 204 && r.status !== 304) return res.status(502).json({ error: `docker answered ${r.status}`, detail: r.body });
    logger.info(`service ${action}`, { service: name });
    res.json({ service: name, action, ok: true });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

app.listen(PORT, () => logger.info(`ops-console listening on ${PORT}`, { port: PORT }));
