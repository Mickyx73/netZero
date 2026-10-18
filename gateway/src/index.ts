import express from "express";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";
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
//   3. Serve the NetZero Hub citizen app (public/). Operator tooling (health,
//      broker, event feed, service controls) lives in ops-console on :4000,
//      so nothing behind the scenes is reachable from the citizen port.

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
mount("/api/stations", SERVICES.reservation, "stations");
mount("/api/billing", SERVICES.billing, "billing");
mount("/api/footprint", SERVICES.footprint, "footprint");
mount("/api/offsets", SERVICES.offset, "offsets");
mount("/api/journeys", SERVICES.journey, "journeys");

// The NetZero Hub citizen app (also deployable on its own as a static site -- see docs/DEMO.md).
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

app.listen(PORT, () => logger.info(`api-gateway listening on ${PORT}`, { port: PORT }));
