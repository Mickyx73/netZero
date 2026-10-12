import express from "express";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger, requestLogger } from "./logger.js";

// NetZero Hub API Gateway
// Realises the single external "Aggregator" port shown on the Hub side of
// Part C Figure C.2 (ParticipantArchitecture): citizens and client apps see
// one entry point, while each concern is actually served by an independently
// deployable, independently data-owning microservice behind it.
//
// Jobs:
//   1. Reverse-proxy /api/<resource> to the right backing service.
//   2. Provide one genuine aggregation endpoint (GET /api/citizen/:userId/dashboard)
//      that fans out to several services and composes a single response --
//      exactly the kind of thing a raw reverse proxy cannot do on its own,
//      and the reason the Aggregator is modelled as a real component in C.1.2
//      rather than just a load balancer.
//   3. Demo support: serve the browser demo console (public/index.html), a
//      platform health check, and a read-only feed of the process-event log
//      so the live demo can show events arriving from every service.

const app = express();
app.use(cors());
app.use(requestLogger);

const PORT = process.env.PORT || 3000;

const SERVICES = {
  reservation: process.env.RESERVATION_URL || "http://localhost:3001",
  billing: process.env.BILLING_URL || "http://localhost:3002",
  footprint: process.env.FOOTPRINT_URL || "http://localhost:3003",
  offset: process.env.OFFSET_URL || "http://localhost:3004",
  journey: process.env.JOURNEY_URL || "http://localhost:3005",
};

app.get("/health", (_req, res) => res.json({ status: "ok", service: "api-gateway", routes: SERVICES }));

// GET /api/health -> health of every backing service, for the demo console.
app.get("/api/health", async (_req, res) => {
  const entries = await Promise.all(
    Object.entries(SERVICES).map(async ([name, url]) => {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
        return [name, r.ok ? "up" : "down"] as const;
      } catch {
        return [name, "down"] as const;
      }
    })
  );
  res.json({ gateway: "up", ...Object.fromEntries(entries) });
});

// GET /api/broker -> queue depth and consumer count per RabbitMQ queue, via
// the broker's management API. Lets the demo console show a message waiting
// in a durable queue while its consumer service is stopped.
const RABBITMQ_MGMT_URL = process.env.RABBITMQ_MGMT_URL || "http://localhost:15672";
const RABBITMQ_AUTH = "Basic " + Buffer.from(process.env.RABBITMQ_MGMT_USER || "guest:guest").toString("base64");

app.get("/api/broker", async (_req, res) => {
  try {
    const r = await fetch(`${RABBITMQ_MGMT_URL}/api/queues`, {
      headers: { Authorization: RABBITMQ_AUTH },
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return res.json({ broker: "down", queues: [] });
    const queues = ((await r.json()) as any[]).map((q) => ({
      name: q.name,
      messages: q.messages ?? 0,
      consumers: q.consumers ?? 0,
    }));
    res.json({ broker: "up", queues });
  } catch {
    res.json({ broker: "down", queues: [] });
  }
});

// GET /api/process-events?since=<ISO>&limit=<n>
// Read-only tail of every service's process-event log (the same JSONL files
// the Part F exporter reads; mounted read-only into this container). Only
// the last TAIL_BYTES of each file are read, so polling stays cheap even
// after a large simulation run.
const LOG_DIR = process.env.LOG_DIR || "../logs";
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
        /* skip a line that is mid-write */
      }
    }
  }
  events.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  res.json(events.slice(-limit));
});

async function safeFetchJson(url: string): Promise<any> {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      logger.warn("aggregator fan-out call returned non-OK status", { url, status: r.status });
      return null;
    }
    return await r.json();
  } catch (err) {
    logger.warn("aggregator fan-out call failed", { url, error: (err as Error).message });
    return null;
  }
}

// GET /api/citizen/:userId/dashboard
// Fans out to footprint-service, offset-service and ev-reservation-service
// in parallel, then, for any EV session that has ended, cross-references
// ev-billing-service for the settlement/receipt. Composes all of it into one
// citizen-facing view -- the unified experience the Project Description asks
// for ("the platform should deliver a unified, intuitive, and consistent
// user experience" despite the diversity of underlying providers).
app.get("/api/citizen/:userId/dashboard", async (req, res) => {
  const { userId } = req.params;

  const [footprint, offsets, reservations] = await Promise.all([
    safeFetchJson(`${SERVICES.footprint}/footprint/${userId}`),
    safeFetchJson(`${SERVICES.offset}/offsets?userId=${userId}`),
    safeFetchJson(`${SERVICES.reservation}/reservations?userId=${userId}`),
  ]);

  const evActivity = await Promise.all(
    (reservations || []).map(async (r: any) => {
      const billing = r.status === "session_ended" ? await safeFetchJson(`${SERVICES.billing}/billing/${r.id}`) : null;
      return { reservation: r, billing };
    })
  );

  res.json({
    userId,
    footprint: footprint ?? null,
    offsets: offsets ?? [],
    evActivity,
  });
});

// --- Reverse proxies: everything else passes straight through --------------
// Note: Express already strips the app.use() mount prefix from req.url before
// the proxy middleware sees it (so "/api/reservations/123" arrives here as
// "/123", and the base collection route arrives as "/"). pathRewrite must
// therefore *add back* the resource segment rather than strip it.
const proxyOpts = { changeOrigin: true } as const;
const mount = (base: string, target: string, resource: string) =>
  app.use(base, createProxyMiddleware({ target, pathRewrite: (path) => `/${resource}${path}`, ...proxyOpts }));

mount("/api/reservations", SERVICES.reservation, "reservations");
mount("/api/billing", SERVICES.billing, "billing");
mount("/api/footprint", SERVICES.footprint, "footprint");
mount("/api/offsets", SERVICES.offset, "offsets");
mount("/api/journeys", SERVICES.journey, "journeys");

// Browser demo console (also deployable on its own as a static site -- see docs/DEMO.md).
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

app.listen(PORT, () => logger.info(`api-gateway listening on ${PORT}`, { port: PORT }));
