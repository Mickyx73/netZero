import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { logger, requestLogger } from "./logger.js";
import { logEvent } from "./processLog.js";

const PROCESS = "Environmental Services"; // Part B Process 6 / Part C §C.3.2 composition

// Carbon Footprint Calculation Service
// Realises: Part A Service 5.1 (Individual Carbon Footprint Calculator)
// Realises: Part C Service Contract 6 / Figure C.14-C.15 (single synchronous
//           round trip -- calculateFootprint() returns a FootprintReport
//           directly; Part B's BPMN Process 6 treats this as an internal
//           sub-process with no failure path once a survey is submitted).

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLogger);

const PORT = process.env.PORT || 3003;
const CITIZEN = "Citizen"; // BPMN lane names are used as the event resource
const ASSESSMENT = "Assessment Service";

// Simplified, published-factor-style constants (kept transparent/adjustable
// rather than a black box, per the QoS "Calculation Accuracy" style factors
// used throughout Part A).
const GRID_EMISSION_FACTOR_KG_PER_KWH = 0.7; // AU national grid average, illustrative
const TRANSPORT_EMISSION_FACTOR_KG_PER_KM = 0.17; // average passenger car
const DIET_FACTOR_KG_PER_YEAR: Record<number, number> = { 1: 500, 2: 1000, 3: 1500, 4: 2000, 5: 2600 };
const PEER_AVERAGE_CO2_KG_YEAR = 14500; // illustrative national average baseline

app.get("/health", (_req, res) => res.json({ status: "ok", service: "footprint-service" }));

function calculate(energyKwhMonth: number, transportKmWeek: number, dietScore: number) {
  const energyCo2 = energyKwhMonth * 12 * GRID_EMISSION_FACTOR_KG_PER_KWH;
  const transportCo2 = transportKmWeek * 52 * TRANSPORT_EMISSION_FACTOR_KG_PER_KM;
  const dietCo2 = DIET_FACTOR_KG_PER_YEAR[dietScore] ?? DIET_FACTOR_KG_PER_YEAR[3];
  const total = Math.round(energyCo2 + transportCo2 + dietCo2);
  const diffPct = Math.round(((total - PEER_AVERAGE_CO2_KG_YEAR) / PEER_AVERAGE_CO2_KG_YEAR) * 100);
  const percentile =
    diffPct > 5 ? `${diffPct}% above the national average` : diffPct < -5 ? `${Math.abs(diffPct)}% below the national average` : `about average`;
  return { total, peerAverage: PEER_AVERAGE_CO2_KG_YEAR, percentile };
}

// POST /footprint -> calculateFootprint(userId, energyKwhMonth, transportKmWeek, dietScore)
app.post("/footprint", (req, res) => {
  const { userId, energyKwhMonth, transportKmWeek, dietScore } = req.body ?? {};
  const isNonNegative = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!userId || !isNonNegative(energyKwhMonth) || !isNonNegative(transportKmWeek)) {
    return res.status(400).json({ error: "userId, and non-negative numbers energyKwhMonth, transportKmWeek are required" });
  }
  if (!Number.isInteger(dietScore) || dietScore < 1 || dietScore > 5) {
    return res.status(400).json({ error: "dietScore must be an integer between 1 and 5" });
  }

  // BPMN 6.1: a fresh case id is minted per assessment. A citizen who later
  // calls POST /offsets with this caseId links the purchase back to this
  // exact assessment, giving Process 6 a single correlated case across both
  // services (see PART-E.md §E.2.3/§E.2.4).
  const caseId = randomUUID();

  logEvent({
    process: PROCESS,
    caseId,
    activity: "Initiate assessment",
    lifecycle: "complete",
    resource: CITIZEN,
    bpmnRef: "6.1",
    data: { userId, energyKwhMonth, transportKmWeek, dietScore },
  });

  const { total, peerAverage, percentile } = calculate(energyKwhMonth, transportKmWeek, dietScore);

  logEvent({
    process: PROCESS,
    caseId,
    activity: "Calculate footprint",
    lifecycle: "complete",
    resource: ASSESSMENT,
    bpmnRef: "6.2",
    data: { totalCo2KgYear: total, peerAverageCo2KgYear: peerAverage },
  });

  db.prepare(
    `INSERT INTO footprints (user_id, case_id, energy_kwh_month, transport_km_week, diet_score, total_co2_kg_year, peer_average_co2_kg_year, percentile_vs_peers, net_offset_applied_kg, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       case_id=excluded.case_id,
       energy_kwh_month=excluded.energy_kwh_month, transport_km_week=excluded.transport_km_week,
       diet_score=excluded.diet_score, total_co2_kg_year=excluded.total_co2_kg_year,
       peer_average_co2_kg_year=excluded.peer_average_co2_kg_year, percentile_vs_peers=excluded.percentile_vs_peers,
       net_offset_applied_kg=0, updated_at=datetime('now')`
  ).run(userId, caseId, energyKwhMonth, transportKmWeek, dietScore, total, peerAverage, percentile);

  logEvent({
    process: PROCESS,
    caseId,
    activity: "Present footprint report and peer comparison",
    lifecycle: "complete",
    resource: ASSESSMENT,
    bpmnRef: "6.3",
    data: { totalCo2KgYear: total, comparisonToPeers: percentile },
  });

  res.status(201).json({
    userId,
    caseId,
    totalCo2KgYear: total,
    peerAverageCo2KgYear: peerAverage,
    comparisonToPeers: percentile,
  });
});

app.get("/footprint/:userId", (req, res) => {
  const row = db.prepare(`SELECT * FROM footprints WHERE user_id = ?`).get(req.params.userId);
  if (!row) return res.status(404).json({ error: "no footprint report on file for this user" });
  res.json(row);
});

// PATCH /footprint/:userId/apply-offset -> called by offset-service once a
// purchase is certified (BPMN 6.13: "the citizen's dashboard score is
// updated to reflect the offset"). The state change AND its log entry live
// here, on the service that actually owns the footprint record, rather than
// being logged speculatively by the caller.
app.patch("/footprint/:userId/apply-offset", (req, res) => {
  const { caseId, amountCo2Kg, certificateId } = req.body ?? {};
  if (typeof amountCo2Kg !== "number" || !Number.isFinite(amountCo2Kg) || amountCo2Kg <= 0) {
    return res.status(400).json({ error: "amountCo2Kg must be a positive number" });
  }
  const row: any = db.prepare(`SELECT * FROM footprints WHERE user_id = ?`).get(req.params.userId);
  if (!row) {
    logger.warn("apply-offset called for unknown user", { userId: req.params.userId });
    return res.status(404).json({ error: "no footprint report on file for this user" });
  }

  const newTotal = row.net_offset_applied_kg + amountCo2Kg;
  db.prepare(`UPDATE footprints SET net_offset_applied_kg = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
    newTotal,
    req.params.userId
  );

  // Note: if the citizen has recalculated their footprint since this offset's
  // originating assessment, row.case_id will point at the *newer* case, not
  // the one the offset actually belongs to. We log against the caseId the
  // offset itself carries (the original assessment) so the process log stays
  // correct even in that edge case -- a deliberate, documented simplification
  // rather than a silent inaccuracy (see PART-E.md).
  logEvent({
    process: PROCESS,
    caseId: caseId ?? row.case_id,
    activity: "Update net emissions score and database",
    lifecycle: "complete",
    resource: ASSESSMENT,
    bpmnRef: "6.13",
    data: { userId: req.params.userId, amountCo2Kg, certificateId, netOffsetAppliedKg: newTotal },
  });

  res.json({ userId: req.params.userId, netOffsetAppliedKg: newTotal });
});

// POST /footprint/:userId/decline-offset {caseId}
// Gateway 6.4 "Purchase offset now?" = NO -> end event "Footprint Baseline
// Recorded". Logging this branch explicitly (rather than letting the case
// silently stop after 6.3) lets process mining tell "declined" apart from
// "still deciding", and gives the mined model its real exclusive choice.
app.post("/footprint/:userId/decline-offset", (req, res) => {
  const row: any = db.prepare(`SELECT * FROM footprints WHERE user_id = ?`).get(req.params.userId);
  if (!row) return res.status(404).json({ error: "no footprint report on file for this user" });
  const caseId = req.body?.caseId ?? row.case_id;

  logEvent({
    process: PROCESS,
    caseId,
    activity: "Record footprint baseline",
    lifecycle: "complete",
    resource: ASSESSMENT,
    bpmnRef: "6.4 (No)",
    data: { userId: req.params.userId, baselineCo2KgYear: row.total_co2_kg_year, offsetDecision: "no" },
  });

  res.json({ userId: req.params.userId, caseId, outcome: "baselineRecorded", baselineCo2KgYear: row.total_co2_kg_year });
});

app.listen(PORT, () => logger.info(`footprint-service listening on ${PORT}`, { port: PORT }));
