import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db.js";
import { publishEvent, subscribeEvent } from "./eventBus.js";
import { logger, requestLogger } from "./logger.js";
import { logEvent } from "./processLog.js";
import { authorise } from "./paymentGateway.js";

const PROCESS = "Environmental Services"; // Part B Process 6 / Part C §C.3.2 composition
const FOOTPRINT_URL = process.env.FOOTPRINT_URL || "http://localhost:3003";

// Carbon Offset Purchase Service
// Realises: Part A Service 5.2 (Carbon Offset Purchasing)
// Realises: Part C Service Contract 7 / Figure C.16-C.17 (asynchronous:
//           purchaseOffset() is called synchronously by the citizen, but the
//           registry retirement + certificate issuance -- and therefore the
//           real outcome -- arrives later via OffsetNotificationInterface).
// Also composed with footprint-service in Part C §C.3.2 "Environmental
// Services": a citizen calls this after answering YES at BPMN gateway 6.4.
//
// BPMN coverage: 6.5 (select amount), 6.6/6.7 inclusive split/join over
// project types, 6.8/6.8a payment with the 6.9 retry loop, 6.10/6.11 registry
// retirement, 6.12 certificate. 6.13 is logged by footprint-service, which
// owns the citizen's score.

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLogger);

const PORT = process.env.PORT || 3004;
const PRICE_PER_KG_CO2 = 0.03; // AUD, illustrative
const MAX_RETRIES = 3; // payment retries after the first attempt (BPMN 6.9 loop)

const CITIZEN = "Citizen"; // BPMN lane names are used as the event resource
const MARKETPLACE = "Offset Marketplace";
const REGISTRY = "Verified Carbon Registry";

// The three branches of inclusive gateway 6.6 in Part B Process 6.
const PROJECT_ACTIVITIES: Record<string, string> = {
  reforestation: "Reserve reforestation credits",
  renewable: "Reserve renewable energy credits",
  "waste-recycling": "Reserve waste recycling credits",
};

// Fulfilment stage, so the citizen's app can show progress while the
// asynchronous purchase moves through Process 6.
function setStage(offsetId: string, stage: string) {
  db.prepare(`UPDATE offsets SET stage = ?, updated_at = datetime('now') WHERE id = ?`).run(stage, offsetId);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "offset-service" }));

// POST /offsets -> purchaseOffset(userId, amountCo2Kg, projectTypes, paymentToken, caseId?)
// Returns 202 immediately: the request is accepted, but fulfilment is async.
// `caseId`, if supplied, is the caseId returned by a prior POST /footprint
// call -- passing it composes this purchase into the SAME process-mining case
// as that assessment (Part C §C.3.2's Environmental Services composition).
// Omitting it purchases an offset standalone, with its own case id.
app.post("/offsets", async (req, res) => {
  const { userId, amountCo2Kg, projectTypes, paymentToken, caseId: suppliedCaseId } = req.body ?? {};
  const validAmount = typeof amountCo2Kg === "number" && Number.isFinite(amountCo2Kg) && amountCo2Kg > 0;
  const validTypes =
    Array.isArray(projectTypes) &&
    projectTypes.length > 0 &&
    projectTypes.every((t: unknown) => typeof t === "string" && t in PROJECT_ACTIVITIES);
  if (!userId || !validAmount || !validTypes || typeof paymentToken !== "string" || !paymentToken) {
    return res.status(400).json({
      error: "userId, positive amountCo2Kg, paymentToken and projectTypes[] are required",
      allowedProjectTypes: Object.keys(PROJECT_ACTIVITIES),
    });
  }
  const types: string[] = [...new Set<string>(projectTypes)];

  const id = uuidv4();
  const caseId = suppliedCaseId || id;
  const priceAud = Number((amountCo2Kg * PRICE_PER_KG_CO2).toFixed(2));

  // Reaching this endpoint means the citizen answered YES at gateway 6.4;
  // the decision itself is a gateway, so it is recorded as data, not as an activity.
  logEvent({
    process: PROCESS,
    caseId,
    activity: "Select amount of CO2 to offset",
    lifecycle: "complete",
    resource: CITIZEN,
    bpmnRef: "6.5",
    data: { userId, amountCo2Kg, projectTypes: types, priceAud, offsetDecision: "yes", composedWithFootprintCase: Boolean(suppliedCaseId) },
  });

  db.prepare(
    `INSERT INTO offsets (id, case_id, user_id, amount_co2_kg, project_types, price_aud, payment_token, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(id, caseId, userId, amountCo2Kg, JSON.stringify(types), priceAud, paymentToken);

  await publishEvent("offset.requested", { offsetId: id });

  res.status(202).json({ offsetId: id, caseId, priceAud, status: "pending", message: "Offset request accepted; certification is asynchronous." });
});

app.get("/offsets/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM offsets WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "offset request not found" });
  res.json(redact(row));
});

app.get("/offsets", (req, res) => {
  const { userId } = req.query;
  const rows = userId
    ? db.prepare(`SELECT * FROM offsets WHERE user_id = ? ORDER BY created_at DESC`).all(userId as string)
    : db.prepare(`SELECT * FROM offsets ORDER BY created_at DESC LIMIT 50`).all();
  res.json(rows.map(redact));
});

// Payment tokens are never returned by the API.
function redact(row: any) {
  const { payment_token: _omit, ...rest } = row;
  return rest;
}

async function notifyFootprintService(userId: string, caseId: string, amountCo2Kg: number, certificateId: string) {
  try {
    const r = await fetch(`${FOOTPRINT_URL}/footprint/${encodeURIComponent(userId)}/apply-offset`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, amountCo2Kg, certificateId }),
    });
    if (!r.ok) logger.warn("footprint-service declined apply-offset", { userId, status: r.status });
  } catch (err) {
    // Best-effort: the offset is still certified even if this side-effect
    // fails (e.g. footprint-service is down). Not retried further here.
    logger.warn("could not reach footprint-service for apply-offset", { userId, error: (err as Error).message });
  }
}

// 6.6 -> 6.7: every selected project type is reserved concurrently, and the
// join waits for exactly the branches that were activated.
async function reserveCredits(caseId: string, offsetId: string, types: string[], amountCo2Kg: number) {
  const perType = Number((amountCo2Kg / types.length).toFixed(2));
  await Promise.all(
    types.map(async (type) => {
      const activity = PROJECT_ACTIVITIES[type];
      logEvent({ process: PROCESS, caseId, activity, lifecycle: "start", resource: MARKETPLACE, bpmnRef: "6.6", data: { offsetId, amountCo2Kg: perType } });
      await sleep(jitter(200, 700));
      logEvent({ process: PROCESS, caseId, activity, lifecycle: "complete", resource: MARKETPLACE, bpmnRef: "6.7", data: { offsetId, amountCo2Kg: perType } });
    })
  );
}

// 6.8/6.8a with the 6.9 retry loop. Returns true once payment clears.
async function takePayment(row: any): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    logEvent({
      process: PROCESS,
      caseId: row.case_id,
      activity: "Process payment for offset units",
      lifecycle: "start",
      resource: MARKETPLACE,
      bpmnRef: "6.8",
      data: { offsetId: row.id, attempt, priceAud: row.price_aud },
    });
    const result = await authorise(row.payment_token, row.price_aud, attempt);
    logEvent({
      process: PROCESS,
      caseId: row.case_id,
      activity: "Process payment for offset units",
      lifecycle: "complete",
      resource: MARKETPLACE,
      bpmnRef: "6.8/6.8a",
      data: { offsetId: row.id, attempt, approved: result.approved },
    });
    db.prepare(`UPDATE offsets SET retry_count = ?, updated_at = datetime('now') WHERE id = ?`).run(attempt - 1, row.id);
    if (result.approved) return true;

    if (attempt <= MAX_RETRIES) {
      // Gateway 6.9 = NO -> "Notify citizen of payment failure" -> Retry.
      logEvent({
        process: PROCESS,
        caseId: row.case_id,
        activity: "Notify citizen of payment failure",
        lifecycle: "complete",
        resource: MARKETPLACE,
        bpmnRef: "6.9 (No)",
        data: { offsetId: row.id, attempt, reason: result.reason },
      });
      logger.warn("offset payment declined, retry scheduled", { offsetId: row.id, attempt });
      await sleep(1000 * attempt); // back-off before the citizen's card is retried
    }
  }
  return false;
}

async function fulfil(offsetId: string) {
  // Idempotent consumer: only a 'pending' request is claimed, so a
  // redelivered offset.requested message cannot charge the citizen twice.
  const claimed = db.prepare(`UPDATE offsets SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND status = 'pending'`).run(offsetId);
  if (claimed.changes === 0) {
    logger.warn("offset.requested ignored: not pending", { offsetId });
    return;
  }
  const row: any = db.prepare(`SELECT * FROM offsets WHERE id = ?`).get(offsetId);
  const caseId = row.case_id;
  const types: string[] = JSON.parse(row.project_types);

  setStage(offsetId, "reserving");
  await reserveCredits(caseId, offsetId, types, row.amount_co2_kg);

  setStage(offsetId, "paying");
  if (!(await takePayment(row))) {
    // Part B loops on 6.9 indefinitely; in practice the purchase is cancelled
    // after MAX_RETRIES. Logged without a bpmnRef: a deviation from the model
    // that Part F's conformance checking is expected to find.
    db.prepare(`UPDATE offsets SET status = 'payment_failed', stage = 'payment_failed', updated_at = datetime('now') WHERE id = ?`).run(offsetId);
    logEvent({
      process: PROCESS,
      caseId,
      activity: "Offset purchase cancelled (payment failed)",
      lifecycle: "complete",
      resource: MARKETPLACE,
      data: { offsetId, attempts: MAX_RETRIES + 1, modelled: false },
    });
    await publishEvent("offset.failed", { offsetId, caseId, userId: row.user_id, reason: "payment declined after max retries" });
    logger.error("offset payment failed after max retries", { offsetId });
    return;
  }

  // 6.10 -> 6.11: the registry cancels the purchased units' serial numbers.
  setStage(offsetId, "retiring");
  logEvent({ process: PROCESS, caseId, activity: "Retire credits under citizen name", lifecycle: "start", resource: REGISTRY, bpmnRef: "6.10", data: { offsetId } });
  await sleep(jitter(800, 1600)); // Verified Carbon Registry round trip
  const serials = `VCS-${Math.floor(Math.random() * 900000 + 100000)}..${Math.floor(Math.random() * 900000 + 100000)}`;
  logEvent({ process: PROCESS, caseId, activity: "Retire credits under citizen name", lifecycle: "complete", resource: REGISTRY, bpmnRef: "6.11", data: { offsetId, retiredSerials: serials } });

  const certificateId = uuidv4();
  db.prepare(
    `UPDATE offsets SET status = 'certified', stage = 'certified', certificate_id = ?, retired_serials = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(certificateId, serials, offsetId);

  logEvent({
    process: PROCESS,
    caseId,
    activity: "Mint and issue offset certificate",
    lifecycle: "complete",
    resource: MARKETPLACE,
    bpmnRef: "6.12",
    data: { offsetId, certificateId },
  });

  await publishEvent("offset.certified", { offsetId, caseId, userId: row.user_id, certificateId, retiredSerials: serials });
  logger.info("offset certified", { offsetId, certificateId });

  // BPMN 6.13 -- the state change and its log entry happen inside
  // footprint-service itself (see its /apply-offset endpoint), since that's
  // the service that actually owns the citizen's net-emissions score.
  await notifyFootprintService(row.user_id, caseId, row.amount_co2_kg, certificateId);
}

await subscribeEvent("offset.requested", "offset-service.requested", async (payload) => {
  logger.info("received offset.requested", { offsetId: payload.offsetId });
  // Fulfilment runs in the background so the broker message is acked
  // promptly; the 'pending' -> 'processing' claim above keeps it exactly-once.
  fulfil(payload.offsetId).catch((err) => logger.error("offset fulfilment crashed", { offsetId: payload.offsetId, error: (err as Error).message }));
});

app.listen(PORT, () => logger.info(`offset-service listening on ${PORT}`, { port: PORT }));
