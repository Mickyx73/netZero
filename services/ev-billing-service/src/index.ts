import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db.js";
import { publishEvent, subscribeEvent } from "./eventBus.js";
import { logger, requestLogger } from "./logger.js";
import { logEvent } from "./processLog.js";
import { capture } from "./paymentGateway.js";

const PROCESS = "EV Charging Session"; // Part B Process 4 -- same process/case id space as ev-reservation-service

// EV Billing Service
// Realises: Part A Service 3.3 (Automated EV Billing & Payment)
// Realises: Part C Service Contract 4 / Figure C.10-C.11 (asynchronous:
//           settleSession() has no synchronous return value the way
//           reserveBay() does -- the outcome is only known once the payment
//           gateway responds, so it is delivered as an event instead of an
//           HTTP response).
//
// Owns the "Billing" lane of BPMN Process 4 (4.9-4.12). The card was already
// pre-authorised by ev-reservation-service (4.6), so settlement captures
// against that hold (4.11/4.11a) and releases the unused remainder.

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLogger);

const PORT = process.env.PORT || 3002;
const TARIFF_PER_KWH = Number(process.env.TARIFF_PER_KWH || 0.45); // AUD
const BILLING = "Billing"; // BPMN lane name

app.get("/health", (_req, res) => res.json({ status: "ok", service: "ev-billing-service" }));

app.get("/billing/:sessionId", (req, res) => {
  const row = db.prepare(`SELECT * FROM bills WHERE session_id = ?`).get(req.params.sessionId);
  if (!row) return res.status(404).json({ error: "no bill for this session (yet) — settlement is asynchronous" });
  res.json(row);
});

app.get("/billing", (req, res) => {
  const { userId } = req.query;
  const rows = userId
    ? db.prepare(`SELECT * FROM bills WHERE user_id = ? ORDER BY created_at DESC`).all(userId as string)
    : db.prepare(`SELECT * FROM bills ORDER BY created_at DESC LIMIT 50`).all();
  res.json(rows);
});

interface SessionEnded {
  sessionId: string;
  userId: string;
  stationId: string;
  kWhConsumed: number;
  sessionSeconds?: number;
  holdId: string;
  holdAmount: number;
}

async function settle(evt: SessionEnded) {
  const { sessionId, userId, stationId, kWhConsumed, sessionSeconds, holdId, holdAmount } = evt;

  // Idempotent consumer: RabbitMQ delivers at-least-once, so a redelivered
  // ev.session.ended must not create a second charge or a second receipt.
  const claimed = db
    .prepare(
      `INSERT INTO bills (session_id, user_id, station_id, kwh, session_seconds, tariff_per_kwh, cost, hold_id, hold_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'settling')
       ON CONFLICT(session_id) DO NOTHING`
    )
    .run(sessionId, userId, stationId, kWhConsumed, sessionSeconds ?? null, TARIFF_PER_KWH, holdId, holdAmount);
  if (claimed.changes === 0) {
    logger.warn("duplicate ev.session.ended ignored", { sessionId });
    return;
  }

  logEvent({
    process: PROCESS,
    caseId: sessionId,
    activity: "Retrieve final kWh and total duration",
    lifecycle: "complete",
    resource: BILLING,
    bpmnRef: "4.9",
    data: { kWhConsumed, sessionSeconds },
  });

  const cost = Number((kWhConsumed * TARIFF_PER_KWH).toFixed(2));
  logEvent({
    process: PROCESS,
    caseId: sessionId,
    activity: "Calculate final cost from current tariff",
    lifecycle: "complete",
    resource: BILLING,
    bpmnRef: "4.10",
    data: { kWhConsumed, tariffPerKwh: TARIFF_PER_KWH, cost },
  });

  logEvent({
    process: PROCESS,
    caseId: sessionId,
    activity: "Capture funds and settle transaction",
    lifecycle: "start",
    resource: BILLING,
    bpmnRef: "4.11",
    data: { cost, holdId, holdAmount },
  });
  const result = await capture(holdId, holdAmount, cost);
  logEvent({
    process: PROCESS,
    caseId: sessionId,
    activity: "Capture funds and settle transaction",
    lifecycle: "complete",
    resource: BILLING,
    bpmnRef: "4.11/4.11a",
    data: { captured: result.captured, released: result.released, transactionId: result.transactionId },
  });

  const receiptId = uuidv4();
  db.prepare(
    `UPDATE bills SET cost = ?, released_amount = ?, transaction_id = ?, receipt_id = ?, status = 'settled',
       updated_at = datetime('now') WHERE session_id = ?`
  ).run(cost, result.released, result.transactionId, receiptId, sessionId);

  logEvent({
    process: PROCESS,
    caseId: sessionId,
    activity: "Issue digital receipt",
    lifecycle: "complete",
    resource: BILLING,
    bpmnRef: "4.12",
    data: { receiptId, cost },
  });

  await publishEvent("ev.billing.settled", { sessionId, userId, cost, receiptId, releasedAmount: result.released });
  logger.info("session settled", { sessionId, cost, receiptId });
}

await subscribeEvent("ev.session.ended", "ev-billing-service.session-ended", async (payload: SessionEnded) => {
  logger.info("received ev.session.ended", { sessionId: payload.sessionId });
  await settle(payload);
});

app.listen(PORT, () => logger.info(`ev-billing-service listening on ${PORT}`, { port: PORT }));
