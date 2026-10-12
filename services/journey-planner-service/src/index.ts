import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { estimateDistanceKm, fetchTimetable, fetchEmissionFactors, type Mode } from "./providers.js";
import { logger, requestLogger } from "./logger.js";
import { logEvent } from "./processLog.js";

const PROCESS = "Carbon-Optimized Journey Planner"; // Part B Process 3

// Carbon-Optimized Journey Planner Service
// Realises: Part A Service 2.1 (Carbon-Optimized Journey Planner)
// Realises: Part B Process 3 and Part C Service Contract 2 / Figure C.6-C.7.
//
// Architecturally distinct from the other four Part E services: it is a
// stateless *aggregator/orchestrator* microservice. It owns no data of its
// own; each request scatters two calls to independent data sources in
// parallel (BPMN parallel gateway 3.2/3.7), computes and annotates candidate
// routes (3.8/3.9), prepares one option per qualifying mode behind an
// inclusive gateway (3.10/3.11), then ranks (3.12) and returns a single
// synchronous response (3.13).

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLogger);

const PORT = process.env.PORT || 3005;
const BIKE_SPEED_KMH = 15;
const BIKE_SHARE_MAX_KM = 15; // bike share is only offered for shorter trips
const DRIVE_SPEED_KMH = 32; // urban effective speed, for the baseline only

const CITIZEN = "Citizen"; // BPMN lane names are used as the event resource
const ROUTING = "Routing Engine";
const ANALYTICS = "Sustainability Analytics";

// The three branches of inclusive gateway 3.10 in Part B Process 3.
const PREPARE_ACTIVITY: Record<Mode, string> = {
  bus: "Prepare bus options",
  train: "Prepare train options",
  bike: "Prepare bike share options",
};
const ALL_MODES: Mode[] = ["train", "bus", "bike"];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get("/health", (_req, res) => res.json({ status: "ok", service: "journey-planner-service" }));

// POST /journeys/plan -> planJourney(origin, destination, departureTime?, maxDurationMins?, modes?)
app.post("/journeys/plan", async (req, res) => {
  const { origin, destination, departureTime, maxDurationMins, modes } = req.body ?? {};
  if (typeof origin !== "string" || typeof destination !== "string" || !origin.trim() || !destination.trim()) {
    return res.status(400).json({ error: "origin and destination are required" });
  }
  if (maxDurationMins != null && (typeof maxDurationMins !== "number" || maxDurationMins <= 0)) {
    return res.status(400).json({ error: "maxDurationMins must be a positive number" });
  }
  const preferredModes: Mode[] = Array.isArray(modes) ? ALL_MODES.filter((m) => modes.includes(m)) : ALL_MODES;
  if (preferredModes.length === 0) {
    return res.status(400).json({ error: `modes must include at least one of ${ALL_MODES.join(", ")}` });
  }

  // Every request is its own case: this contract has no persistent state
  // (Part C §C.2.2), so the case id exists only for the lifetime of the log.
  const caseId = randomUUID();
  const log = (activity: string, resource: string, bpmnRef: string, lifecycle: "start" | "complete" = "complete", data?: Record<string, unknown>) =>
    logEvent({ process: PROCESS, caseId, activity, lifecycle, resource, bpmnRef, data });

  log("Submit trip request", CITIZEN, "3.1", "complete", { origin, destination, departureTime, maxDurationMins, modes: preferredModes });

  const distanceKm = estimateDistanceKm(origin, destination);

  // --- Scatter: both calls issued concurrently (BPMN parallel split 3.2) ---
  // Gateways are not activities, so they are not logged; the overlapping
  // start/complete intervals below are what reveal the parallelism.
  const timetableP = (async () => {
    log("Retrieve scheduled services and real-time data", ROUTING, "3.3", "start");
    const r = await fetchTimetable(origin, destination, distanceKm);
    log("Retrieve scheduled services and real-time data", ROUTING, "3.3/3.5", "complete", { transitModes: r.map((o) => o.mode) });
    return r;
  })();
  const factorsP = (async () => {
    log("Retrieve per-mode emission factors", ANALYTICS, "3.4", "start");
    const r = await fetchEmissionFactors();
    log("Retrieve per-mode emission factors", ANALYTICS, "3.4/3.6", "complete");
    return r;
  })();
  const [transitOptions, emissionFactors] = await Promise.all([timetableP, factorsP]);
  // --- Gather: execution only reaches here once both have resolved (join 3.7) ---

  type Candidate = { mode: Mode; durationMins: number; co2Kg?: number };
  const candidates: Candidate[] = transitOptions.map((o) => ({ mode: o.mode, durationMins: o.durationMins }));
  if (distanceKm <= BIKE_SHARE_MAX_KM) {
    candidates.push({ mode: "bike", durationMins: Math.round((distanceKm / BIKE_SPEED_KMH) * 60) });
  }
  log("Calculate candidate routes across all modes", ROUTING, "3.8", "complete", { distanceKm, candidateModes: candidates.map((c) => c.mode) });

  for (const c of candidates) c.co2Kg = Number((distanceKm * emissionFactors[c.mode]).toFixed(2));
  log("Append CO2-e estimate to each route", ANALYTICS, "3.9", "complete");

  // Inclusive gateway 3.10: every mode meeting the traveller's constraints
  // is activated -- one, some or all. If the constraints eliminate every
  // option, the fastest one is kept so the invariant "at least one mode
  // always qualifies" (Part B 3.10 / Part C §C.2.2) still holds.
  let qualifying = candidates.filter(
    (c) => preferredModes.includes(c.mode) && (maxDurationMins == null || c.durationMins <= maxDurationMins)
  );
  const constraintRelaxed = qualifying.length === 0;
  if (constraintRelaxed) qualifying = [[...candidates].sort((a, b) => a.durationMins - b.durationMins)[0]];

  // Each activated branch runs concurrently; join 3.11 waits for exactly those.
  await Promise.all(
    qualifying.map(async (c) => {
      log(PREPARE_ACTIVITY[c.mode], ROUTING, "3.10", "start");
      await sleep(80 + Math.random() * 220);
      log(PREPARE_ACTIVITY[c.mode], ROUTING, "3.11", "complete", { durationMins: c.durationMins, co2Kg: c.co2Kg });
    })
  );

  const ranked = [...qualifying].sort((a, b) => (a.co2Kg ?? 0) - (b.co2Kg ?? 0));
  log("Rank options by CO2 ascending", ROUTING, "3.12", "complete", { bestMode: ranked[0].mode, optionCount: ranked.length, constraintRelaxed });

  const driveBaselineCo2Kg = Number((distanceKm * emissionFactors.drive).toFixed(2));
  log("Present ranked journey plan", ROUTING, "3.13", "complete");

  res.json({
    caseId,
    origin,
    destination,
    departureTime: departureTime ?? new Date().toISOString(),
    distanceKm,
    constraintRelaxed,
    driveBaseline: { durationMins: Math.round((distanceKm / DRIVE_SPEED_KMH) * 60), co2Kg: driveBaselineCo2Kg },
    options: ranked.map((c) => ({ ...c, co2SavedVsDrivingKg: Number((driveBaselineCo2Kg - (c.co2Kg ?? 0)).toFixed(2)) })),
  });
});

app.listen(PORT, () => logger.info(`journey-planner-service listening on ${PORT}`, { port: PORT }));
