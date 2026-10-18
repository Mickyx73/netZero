import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { db, OCCUPYING_STATUSES } from "./db.js";
import { publishEvent } from "./eventBus.js";
import { logger, requestLogger } from "./logger.js";
import { logEvent } from "./processLog.js";
import { authorise } from "./paymentGateway.js";

const PROCESS = "EV Charging Session"; // Part B Process 4

// EV Charging Reservation Service
// Realises: Part A Service 3.2 (Charging Bay Reservation)
// Realises: Part C Service Contract 3 / Figure C.8-C.9 (synchronous, alt fragment
//           on bay availability), and is the "driver" side of the Figure C.20
//           EV Charging Session composition (this service's session-ended
//           event is what ev-billing-service reacts to).
//
// It owns the "RSVP management" lane of BPMN Process 4: reservation (4.1-4.4),
// arrival/authentication (4.5), pre-authorisation with its retry loop
// (4.6/4.7/4.7a) and the charging session itself (4.8). The "Billing" lane
// (4.9-4.12) is ev-billing-service.
//
// Process-mining case id == reservation id, minted at 4.1 so every attempt
// (accepted or rejected) is exactly one case.

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLogger);

const PORT = process.env.PORT || 3001;
const TARIFF_PER_KWH = Number(process.env.TARIFF_PER_KWH || 0.45); // AUD, must match ev-billing-service
const ESTIMATED_SESSION_KWH = Number(process.env.ESTIMATED_SESSION_KWH || 60); // hold covers a typical full session

// ChargeNet's station catalogue (Part A Service 3.1, "EV Charging Station
// Locator & Status"). Static reference data owned by this service; live
// status is derived from this service's own reservations (see GET /stations).
const STATIONS = [
  { id: "CN-WOL-01", name: "Crown Street Mall car park", suburb: "Wollongong", lat: -34.4251, lng: 150.8931, plugs: ["CCS2", "Type 2"], kw: 50 },
  { id: "CN-WOL-02", name: "UOW Innovation Campus", suburb: "North Wollongong", lat: -34.4045, lng: 150.8798, plugs: ["CCS2", "CHAdeMO"], kw: 75 },
  { id: "CN-WOL-03", name: "Wollongong Station", suburb: "Wollongong", lat: -34.4271, lng: 150.8838, plugs: ["Type 2"], kw: 22 },
  { id: "CN-WOL-04", name: "North Beach Pavilion", suburb: "North Wollongong", lat: -34.4155, lng: 150.9010, plugs: ["CCS2", "Type 2"], kw: 50 },
  { id: "CN-WOL-05", name: "Fairy Meadow shops", suburb: "Fairy Meadow", lat: -34.3940, lng: 150.8925, plugs: ["CCS2"], kw: 120 },
  { id: "CN-WOL-06", name: "Figtree Grove", suburb: "Figtree", lat: -34.4353, lng: 150.8604, plugs: ["Type 2", "CHAdeMO"], kw: 22 },
  { id: "CN-WOL-07", name: "Shellharbour Square", suburb: "Blackbutt", lat: -34.5655, lng: 150.8406, plugs: ["CCS2", "Type 2"], kw: 150 },
  { id: "CN-WOL-08", name: "Thirroul Village", suburb: "Thirroul", lat: -34.3175, lng: 150.9206, plugs: ["CCS2"], kw: 50 },
];
const STATION_IDS = STATIONS.map((s) => s.id);

const RSVP = "RSVP Management"; // BPMN lane names are used as the event resource
const DRIVER = "EV Owner";

app.get("/health", (_req, res) => res.json({ status: "ok", service: "ev-reservation-service" }));

function toIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Overlap test + insert run inside one SQLite IMMEDIATE transaction, so two
// requests for overlapping slots can never both succeed (QoS, Part A Service
// 3.2: "Double Booking Rate = 0%"). better-sqlite3 is synchronous, so the
// transaction also cannot interleave with another request in this process.
const tryBook = db.transaction(
  (id: string, stationId: string, userId: string, slotStart: string, slotEnd: string, code: string) => {
    const placeholders = OCCUPYING_STATUSES.map(() => "?").join(",");
    const conflict = db
      .prepare(
        `SELECT id, slot_start, slot_end FROM reservations
         WHERE station_id = ? AND status IN (${placeholders})
           AND slot_start < ? AND slot_end > ?   -- standard interval-overlap test
         LIMIT 1`
      )
      .get(stationId, ...OCCUPYING_STATUSES, slotEnd, slotStart);
    if (conflict) return { booked: false as const, conflict };
    db.prepare(
      `INSERT INTO reservations (id, station_id, user_id, slot_start, slot_end, status, confirmation_code)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?)`
    ).run(id, stationId, userId, slotStart, slotEnd, code);
    return { booked: true as const };
  }
);

// Stations with no occupying booking overlapping [slotStart, slotEnd) -- the
// genuinely bookable alternatives offered when a slot is taken.
function freeStationsFor(slotStart: string, slotEnd: string): string[] {
  const placeholders = OCCUPYING_STATUSES.map(() => "?").join(",");
  const busy = new Set(
    (db.prepare(
      `SELECT DISTINCT station_id FROM reservations
       WHERE status IN (${placeholders}) AND slot_start < ? AND slot_end > ?`
    ).all(...OCCUPYING_STATUSES, slotEnd, slotStart) as { station_id: string }[]).map((r) => r.station_id)
  );
  return STATION_IDS.filter((id) => !busy.has(id));
}

// GET /stations -> catalogue + live status (Part A Service 3.1).
// Status comes from this service's own data: a session charging right now,
// a booking covering the current time, or free.
app.get("/stations", (_req, res) => {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT station_id, status FROM reservations
       WHERE (status = 'charging') OR (status IN ('confirmed','preauth_declined') AND slot_start <= ? AND slot_end > ?)`
    )
    .all(now, now) as { station_id: string; status: string }[];
  res.json(
    STATIONS.map((st) => {
      const here = rows.filter((r) => r.station_id === st.id);
      const status = here.some((r) => r.status === "charging") ? "charging" : here.length ? "reserved" : "available";
      return { ...st, status, tariffPerKwh: TARIFF_PER_KWH };
    })
  );
});

// GET /stations/:id/availability?from=<ISO>&to=<ISO>
// Booked intervals at one station within a window, so a client can grey out
// taken slots before the driver even asks (no user ids are exposed).
app.get("/stations/:id/availability", (req, res) => {
  const from = toIso(req.query.from) ?? new Date().toISOString();
  const to = toIso(req.query.to) ?? new Date(Date.parse(from) + 86400000).toISOString();
  const placeholders = OCCUPYING_STATUSES.map(() => "?").join(",");
  const booked = db
    .prepare(
      `SELECT slot_start AS start, slot_end AS end FROM reservations
       WHERE station_id = ? AND status IN (${placeholders}) AND slot_start < ? AND slot_end > ?
       ORDER BY slot_start`
    )
    .all(req.params.id, ...OCCUPYING_STATUSES, to, from);
  res.json({ stationId: req.params.id, from, to, booked });
});

// POST /reservations -> reserveBay(stationId, slotStart, slotEnd, userId)
app.post("/reservations", (req, res) => {
  const { stationId, userId } = req.body ?? {};
  const slotStart = toIso(req.body?.slotStart);
  const slotEnd = toIso(req.body?.slotEnd);
  if (!stationId || !userId || !slotStart || !slotEnd) {
    logger.warn("reservation request rejected: missing/invalid fields", { requestId: req.requestId, body: req.body });
    return res.status(400).json({ error: "stationId, userId and valid ISO-8601 slotStart, slotEnd are required" });
  }
  if (slotEnd <= slotStart) {
    return res.status(400).json({ error: "slotEnd must be after slotStart" });
  }

  const id = uuidv4(); // case id for this attempt, whatever the outcome
  logEvent({
    process: PROCESS,
    caseId: id,
    activity: "Request bay reservation",
    lifecycle: "complete",
    resource: DRIVER,
    bpmnRef: "4.1",
    data: { stationId, userId, slotStart, slotEnd },
  });

  const confirmationCode = id.slice(0, 8).toUpperCase();
  const result = tryBook.immediate(id, stationId, userId, slotStart, slotEnd, confirmationCode);

  logEvent({
    process: PROCESS,
    caseId: id,
    activity: "Check bay availability",
    lifecycle: "complete",
    resource: RSVP,
    bpmnRef: "4.2",
    data: { bayAvailable: result.booked },
  });

  if (!result.booked) {
    // Gateway 4.3 = NO -> "Suggest alternate charging bays/time" -> end "RSVP not possible".
    // This is the alt fragment's else-branch in Figure C.9: a business outcome, not an error.
    const alternateStations = freeStationsFor(slotStart, slotEnd).filter((s) => s !== stationId).slice(0, 3);
    logEvent({
      process: PROCESS,
      caseId: id,
      activity: "Suggest alternate charging bays/time",
      lifecycle: "complete",
      resource: RSVP,
      bpmnRef: "4.3 (No)",
      data: { stationId, slotStart, alternateStations },
    });
    return res.status(409).json({
      outcome: "bayUnavailable",
      caseId: id,
      message: `Bay at ${stationId} is already reserved for an overlapping slot.`,
      alternateStations,
    });
  }

  logEvent({
    process: PROCESS,
    caseId: id,
    activity: "Lock time slot and generate confirmation",
    lifecycle: "complete",
    resource: RSVP,
    bpmnRef: "4.4",
    data: { stationId, userId, slotStart, slotEnd, confirmationCode },
  });

  return res.status(201).json({
    outcome: "reservationConfirmed",
    reservationId: id,
    caseId: id,
    confirmationCode,
    stationId,
    slotStart,
    slotEnd,
    status: "confirmed",
  });
});

app.get("/reservations/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM reservations WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "reservation not found" });
  res.json(row);
});

// GET /reservations?userId=... -> used by the gateway's aggregate dashboard.
app.get("/reservations", (req, res) => {
  const { userId } = req.query;
  const rows = userId
    ? db.prepare(`SELECT * FROM reservations WHERE user_id = ? ORDER BY created_at DESC`).all(userId as string)
    : db.prepare(`SELECT * FROM reservations ORDER BY created_at DESC LIMIT 50`).all();
  res.json(rows);
});

function loadOr404(id: string, res: express.Response): any | null {
  const row = db.prepare(`SELECT * FROM reservations WHERE id = ?`).get(id);
  if (!row) res.status(404).json({ error: "reservation not found" });
  return row ?? null;
}

function setStatus(id: string, status: string, extra: Record<string, unknown> = {}) {
  const cols = Object.keys(extra).map((k) => `${k} = @${k}`);
  db.prepare(
    `UPDATE reservations SET status = @status, ${[...cols, "updated_at = datetime('now')"].join(", ")} WHERE id = @id`
  ).run({ id, status, ...extra });
}

// POST /reservations/:id/start {paymentToken}
// Driver arrives and plugs in. First call: authenticate (4.5) then
// pre-authorise (4.6). A declined hold follows gateway 4.7 = NO ->
// "Alert driver; request again for pre-authorisation" (4.7a) and the driver
// retries by calling this endpoint again (loop back to 4.6), possibly with
// another card. Approval starts the charging session (4.8).
app.post("/reservations/:id/start", async (req, res) => {
  const { paymentToken } = req.body ?? {};
  if (typeof paymentToken !== "string" || !paymentToken) {
    return res.status(400).json({ error: "paymentToken is required" });
  }
  const row = loadOr404(req.params.id, res);
  if (!row) return;
  if (row.status !== "confirmed" && row.status !== "preauth_declined") {
    return res.status(409).json({ error: `cannot start a session from status '${row.status}'` });
  }

  if (row.status === "confirmed") {
    logEvent({
      process: PROCESS,
      caseId: row.id,
      activity: "Authenticate vehicle/driver at charging bay",
      lifecycle: "complete",
      resource: RSVP,
      bpmnRef: "4.5/4.5a",
      data: { stationId: row.station_id },
    });
  }

  const attempt = row.preauth_attempts + 1;
  const holdAmount = Number((ESTIMATED_SESSION_KWH * TARIFF_PER_KWH).toFixed(2));
  db.prepare(`UPDATE reservations SET preauth_attempts = ? WHERE id = ?`).run(attempt, row.id);

  logEvent({
    process: PROCESS,
    caseId: row.id,
    activity: "Pre-authorise estimated session cost",
    lifecycle: "start",
    resource: RSVP,
    bpmnRef: "4.6",
    data: { attempt, holdAmount },
  });
  const auth = await authorise(paymentToken, holdAmount, attempt);
  logEvent({
    process: PROCESS,
    caseId: row.id,
    activity: "Pre-authorise estimated session cost",
    lifecycle: "complete",
    resource: RSVP,
    bpmnRef: "4.6/4.6a",
    data: { attempt, holdAmount, approved: auth.approved },
  });

  if (!auth.approved) {
    setStatus(row.id, "preauth_declined");
    logEvent({
      process: PROCESS,
      caseId: row.id,
      activity: "Alert driver and request pre-authorisation again",
      lifecycle: "complete",
      resource: RSVP,
      bpmnRef: "4.7 (No)/4.7a",
      data: { attempt, reason: auth.reason },
    });
    return res.status(402).json({
      outcome: "preAuthDeclined",
      reservationId: row.id,
      attempt,
      message: "Pre-authorisation declined. Retry with the same or another card.",
    });
  }

  const startedAt = new Date().toISOString();
  setStatus(row.id, "charging", { hold_id: auth.authCode, hold_amount: holdAmount, session_started_at: startedAt });
  logEvent({
    process: PROCESS,
    caseId: row.id,
    activity: "Conduct charging session",
    lifecycle: "start",
    resource: RSVP,
    bpmnRef: "4.8",
    data: { holdId: auth.authCode, holdAmount },
  });

  res.json({ outcome: "chargingStarted", reservationId: row.id, holdId: auth.authCode, holdAmount, status: "charging" });
});

// POST /reservations/:id/complete {kWhConsumed}
// Driver unplugs; session ends. This is the synchronous/asynchronous seam in
// Figure C.20: the reservation side of the composition ends here, and billing
// picks up asynchronously via the ev.session.ended event, not a direct call.
// Only a session that is actually charging can end -- so a duplicate call
// cannot publish a second ev.session.ended and bill the driver twice.
app.post("/reservations/:id/complete", async (req, res) => {
  const { kWhConsumed } = req.body ?? {};
  if (typeof kWhConsumed !== "number" || !Number.isFinite(kWhConsumed) || kWhConsumed < 0) {
    return res.status(400).json({ error: "kWhConsumed must be a non-negative number" });
  }
  const row = loadOr404(req.params.id, res);
  if (!row) return;
  if (row.status !== "charging") {
    return res.status(409).json({ error: `cannot end a session from status '${row.status}'` });
  }

  const endedAt = new Date().toISOString();
  const sessionSeconds = Math.round((Date.parse(endedAt) - Date.parse(row.session_started_at)) / 1000);
  setStatus(row.id, "session_ended", { kwh_consumed: kWhConsumed });

  logEvent({
    process: PROCESS,
    caseId: row.id,
    activity: "Conduct charging session",
    lifecycle: "complete",
    resource: RSVP,
    bpmnRef: "4.8/4.8a",
    data: { kWhConsumed, sessionSeconds },
  });

  await publishEvent("ev.session.ended", {
    sessionId: row.id, // == case id, so billing's events land on the same case
    userId: row.user_id,
    stationId: row.station_id,
    kWhConsumed,
    sessionSeconds,
    holdId: row.hold_id,
    holdAmount: row.hold_amount,
    endedAt,
  });

  res.json({ outcome: "sessionEnded", reservationId: row.id, kWhConsumed, status: "session_ended" });
});

// POST /reservations/:id/cancel
// The driver cancels a confirmed booking before arriving, which frees the
// bay. Part B has no cancellation path either, so like the no-show it is
// logged without a bpmnRef and surfaces in Part F's conformance checking.
app.post("/reservations/:id/cancel", (req, res) => {
  const row = loadOr404(req.params.id, res);
  if (!row) return;
  if (row.status !== "confirmed") {
    return res.status(409).json({ error: `cannot cancel a reservation in status '${row.status}'` });
  }
  setStatus(row.id, "cancelled");
  logEvent({
    process: PROCESS,
    caseId: row.id,
    activity: "Reservation cancelled by driver",
    lifecycle: "complete",
    resource: DRIVER,
    data: { stationId: row.station_id, slotStart: row.slot_start, modelled: false },
  });
  res.json({ outcome: "reservationCancelled", reservationId: row.id, status: "cancelled" });
});

// POST /reservations/:id/no-show
// In production a scheduler fires this when the arrival grace period lapses
// (the "Await vehicle arrival" timer in Process 4). Part B's model has no
// path for a driver who never arrives -- that gap is exactly what Part F's
// conformance checking surfaces -- so it is logged without a bpmnRef.
app.post("/reservations/:id/no-show", (req, res) => {
  const row = loadOr404(req.params.id, res);
  if (!row) return;
  if (row.status !== "confirmed") {
    return res.status(409).json({ error: `cannot expire a reservation in status '${row.status}'` });
  }
  setStatus(row.id, "expired");
  logEvent({
    process: PROCESS,
    caseId: row.id,
    activity: "Reservation expired (driver no-show)",
    lifecycle: "complete",
    resource: RSVP,
    data: { stationId: row.station_id, slotStart: row.slot_start, modelled: false },
  });
  res.json({ outcome: "reservationExpired", reservationId: row.id, status: "expired" });
});

// POST /reservations/:id/abandon
// The driver gives up after one or more declined pre-authorisations. Like
// the no-show, this is real behaviour that Part B's retry loop (4.7a) does
// not model, so it carries no bpmnRef.
app.post("/reservations/:id/abandon", (req, res) => {
  const row = loadOr404(req.params.id, res);
  if (!row) return;
  if (row.status !== "preauth_declined") {
    return res.status(409).json({ error: `cannot abandon a reservation in status '${row.status}'` });
  }
  setStatus(row.id, "abandoned");
  logEvent({
    process: PROCESS,
    caseId: row.id,
    activity: "Driver abandons charging session",
    lifecycle: "complete",
    resource: DRIVER,
    data: { preauthAttempts: row.preauth_attempts, modelled: false },
  });
  res.json({ outcome: "sessionAbandoned", reservationId: row.id, status: "abandoned" });
});

app.listen(PORT, () => logger.info(`ev-reservation-service listening on ${PORT}`, { port: PORT }));
