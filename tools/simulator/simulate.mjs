#!/usr/bin/env node
// NetZero Hub -- Part F process simulator.
//
// Executes the three Part B business processes realised in Part E by driving
// the REAL microservices through the API gateway (no shortcuts, no direct
// log writing): every event in the resulting log is produced by the services
// themselves, exactly as in the live demo. The simulator only plays the
// human/physical actors -- citizens, EV drivers, card issuers -- and makes
// their decisions stochastically, so the event log contains realistic
// variation: rejections, retries, declines, no-shows and abandonments.
//
//   Process 3  Carbon-Optimized Journey Planner   (journey-planner-service)
//   Process 4  EV Charging Session                (ev-reservation-service + ev-billing-service)
//   Process 6  Environmental Services             (footprint-service + offset-service)
//
// Cases arrive as a Poisson process per business process and run
// concurrently. Human/physical waiting times (driver travelling to the bay,
// charging, a citizen reading a report) are compressed: ONE WALL-CLOCK
// SECOND STANDS FOR ONE SIMULATED MINUTE. Export with TIME_SCALE=60 to see
// business-scale durations in Disco/Apromore (see tools/log-exporter).
//
// Usage (stack must be running):
//   node tools/simulator/simulate.mjs
//   BASE=http://localhost:3000 CASES=150 SEED=42 node tools/simulator/simulate.mjs
//   docker compose run --rm simulator
//
// Env:
//   BASE         gateway URL                         (default http://localhost:3000)
//   CASES        cases per process                   (default 120)
//   PROCESSES    comma list of journey,ev,environment (default all three)
//   SEED         PRNG seed for reproducible decisions (default: time-based)
//   ARRIVAL_MS   mean inter-arrival time per process (default 400)

const BASE = process.env.BASE || "http://localhost:3000";
const CASES = Number(process.env.CASES || 120);
const PROCESSES = (process.env.PROCESSES || "journey,ev,environment").split(",").map((s) => s.trim());
const SEED = Number(process.env.SEED || Date.now() % 2147483647);
const ARRIVAL_MS = Number(process.env.ARRIVAL_MS || 400);
const MIN = 1000; // one simulated minute, in wall-clock ms

// --- Seeded randomness (mulberry32) so a run can be reproduced exactly ------
let state = SEED >>> 0;
function rand() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const uniform = (a, b) => a + rand() * (b - a);
const intIn = (a, b) => Math.floor(uniform(a, b + 1));
const chance = (p) => rand() < p;
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const expo = (mean) => -Math.log(1 - rand()) * mean;
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = SEED.toString(36);

// --- HTTP helpers -----------------------------------------------------------
async function call(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* empty body */
  }
  return { status: r.status, body: json };
}
async function pollUntil(path, done, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await call("GET", path);
    if (r.status === 200 && done(r.body)) return r.body;
    await sleep(250);
  }
  throw new Error(`timed out waiting on ${path}`);
}

const outcomes = { journey: {}, ev: {}, environment: {} };
const tally = (proc, key) => (outcomes[proc][key] = (outcomes[proc][key] || 0) + 1);

// --- Process 3: Carbon-Optimized Journey Planner ----------------------------
const PLACES = [
  "Wollongong", "Sydney CBD", "Thirroul", "Shellharbour", "Kiama", "Dapto", "Corrimal",
  "Bulli", "Figtree", "Unanderra", "Port Kembla", "Albion Park", "Helensburgh", "UOW Innovation Campus",
];
async function journeyCase() {
  const origin = pick(PLACES);
  let destination = pick(PLACES);
  while (destination === origin) destination = pick(PLACES);
  const body = { origin, destination, departureTime: new Date(Date.now() + intIn(10, 600) * 60000).toISOString() };
  if (chance(0.45)) body.maxDurationMins = intIn(20, 75); // a traveller with a time budget
  if (chance(0.2)) body.modes = ["train", "bus"]; // a traveller who won't cycle
  const r = await call("POST", "/api/journeys/plan", body);
  if (r.status !== 200) throw new Error(`journey plan failed: ${r.status}`);
  tally("journey", `${r.body.options.length} option(s)${r.body.constraintRelaxed ? " (constraint relaxed)" : ""}`);
}

// --- Process 4: EV Charging Session -----------------------------------------
// A small station pool and a peak-weighted slot grid make genuine booking
// conflicts (gateway 4.3 = NO) arise naturally instead of being scripted.
const STATIONS = ["CN-WOL-01", "CN-WOL-02", "CN-WOL-03", "CN-WOL-04", "CN-WOL-05", "CN-WOL-06", "CN-WOL-07", "CN-WOL-08"];
const BASE_DAY = Date.UTC(2027, 0, 1) + (SEED % 3000) * 86400000; // a fresh calendar per run/seed
const SLOT_WEIGHTS = [[7, 2], [8, 5], [9, 4], [10, 2], [12, 3], [13, 2], [16, 3], [17, 6], [18, 5], [19, 2]];

function randomSlot() {
  const day = intIn(0, 4);
  const hour = weighted(SLOT_WEIGHTS);
  const half = chance(0.5) ? 30 : 0;
  const start = BASE_DAY + day * 86400000 + (hour * 60 + half) * 60000;
  const lengthMins = chance(0.3) ? 60 : 30; // some bookings span two slots -> overlap checks matter
  return { slotStart: new Date(start).toISOString(), slotEnd: new Date(start + lengthMins * 60000).toISOString() };
}

async function evCase(userId, stationId = pick(STATIONS), isRetry = false) {
  const slot = randomSlot();
  const r = await call("POST", "/api/reservations", { stationId, userId, ...slot });

  if (r.status === 409) {
    tally("ev", "rejected - bay unavailable");
    // About half of rejected drivers immediately try a suggested alternate
    // station; that new request is (correctly) a separate case.
    if (!isRetry && chance(0.5)) {
      await sleep(uniform(0.5, 2) * MIN);
      return evCase(userId, pick(r.body.alternateStations), true);
    }
    return;
  }
  if (r.status !== 201) throw new Error(`reservation failed: ${r.status} ${JSON.stringify(r.body)}`);
  const id = r.body.reservationId;

  // Driver travels to the bay ("Await vehicle arrival" timer, 10-60 min).
  await sleep(uniform(10, 60) * MIN);
  if (chance(0.07)) {
    await call("POST", `/api/reservations/${id}/no-show`);
    tally("ev", "no-show (expired)");
    return;
  }

  const token = weighted([["tok_ok", 82], ["tok_decline_1", 10], ["tok_decline_2", 4], ["tok_decline_all", 4]]);
  for (let attempt = 1; ; attempt++) {
    const s = await call("POST", `/api/reservations/${id}/start`, { paymentToken: token });
    if (s.status === 200) break;
    if (s.status !== 402) throw new Error(`start failed: ${s.status}`);
    // Alerted at 4.7a: most drivers retry; persistent declines lead to giving up.
    if (attempt >= 3 || (attempt >= 2 && chance(0.3))) {
      await sleep(uniform(1, 3) * MIN);
      await call("POST", `/api/reservations/${id}/abandon`);
      tally("ev", "abandoned after pre-auth decline");
      return;
    }
    await sleep(uniform(0.5, 2.5) * MIN);
  }

  // Charging session: 20-60 simulated minutes, energy roughly proportional.
  const chargeMins = uniform(20, 60);
  await sleep(chargeMins * MIN);
  const kWh = Number((chargeMins * uniform(0.35, 0.9)).toFixed(1));
  const c = await call("POST", `/api/reservations/${id}/complete`, { kWhConsumed: kWh });
  if (c.status !== 200) throw new Error(`complete failed: ${c.status}`);
  await pollUntil(`/api/billing/${id}`, (b) => b.status === "settled");
  tally("ev", "charged and billed");
}

// --- Process 6: Carbon Footprint Calculation & Offset Purchase --------------
async function environmentCase(userId) {
  const survey = {
    userId,
    energyKwhMonth: intIn(120, 900),
    transportKmWeek: intIn(0, 450),
    dietScore: weighted([[1, 1], [2, 2], [3, 4], [4, 3], [5, 2]]),
  };
  const f = await call("POST", "/api/footprint", survey);
  if (f.status !== 201) throw new Error(`footprint failed: ${f.status}`);
  const { caseId, totalCo2KgYear } = f.body;

  await sleep(uniform(1, 6) * MIN); // citizen reads the report and peer comparison

  // Gateway 6.4: people well above average are more inclined to offset.
  const pYes = totalCo2KgYear > 10000 ? 0.75 : 0.5;
  if (!chance(pYes)) {
    await call("POST", `/api/footprint/${encodeURIComponent(userId)}/decline-offset`, { caseId });
    tally("environment", "baseline only (declined offset)");
    return;
  }

  await sleep(uniform(1, 4) * MIN); // choosing amount and projects
  const amountCo2Kg = Math.round(totalCo2KgYear * weighted([[0.1, 2], [0.25, 3], [0.5, 3], [1, 2]]));
  const projectTypes = ["reforestation", "renewable", "waste-recycling"].filter((_, i) => chance([0.7, 0.5, 0.3][i]));
  if (projectTypes.length === 0) projectTypes.push("reforestation");
  const paymentToken = weighted([["tok_ok", 84], ["tok_decline_1", 8], ["tok_decline_2", 4], ["tok_decline_all", 4]]);

  const o = await call("POST", "/api/offsets", { userId, amountCo2Kg, projectTypes, paymentToken, caseId });
  if (o.status !== 202) throw new Error(`offset failed: ${o.status} ${JSON.stringify(o.body)}`);
  const final = await pollUntil(`/api/offsets/${o.body.offsetId}`, (b) => b.status === "certified" || b.status === "payment_failed", 60000);
  if (final.status === "certified") {
    // The score update (6.13) is the last step; wait for it so the case is complete before export.
    await pollUntil(`/api/footprint/${encodeURIComponent(userId)}`, (b) => b.net_offset_applied_kg > 0, 15000).catch(() => {});
  }
  tally("environment", final.status === "certified" ? `offset certified (${projectTypes.length} project type(s))` : "offset cancelled (payment failed)");
}

// --- Driver -----------------------------------------------------------------
const RUNNERS = {
  journey: () => journeyCase(),
  ev: (i) => evCase(`SIM-${RUN}-DRV-${i}`),
  environment: (i) => environmentCase(`SIM-${RUN}-CIT-${i}`),
};

async function runProcess(name) {
  const inflight = [];
  let failures = 0;
  for (let i = 0; i < CASES; i++) {
    inflight.push(
      RUNNERS[name](i).catch((err) => {
        failures++;
        console.error(`[${name}] case ${i} failed: ${err.message}`);
      })
    );
    await sleep(expo(ARRIVAL_MS)); // Poisson arrivals
  }
  await Promise.all(inflight);
  return failures;
}

async function main() {
  const h = await call("GET", "/api/health").catch(() => null);
  if (!h || h.status !== 200) {
    console.error(`Gateway not reachable at ${BASE}. Start the stack first: docker compose up --build -d`);
    process.exit(1);
  }
  const down = Object.entries(h.body).filter(([, v]) => v !== "up");
  if (down.length) {
    console.error(`Some services are not up yet: ${down.map(([k]) => k).join(", ")}. Wait a few seconds and retry.`);
    process.exit(1);
  }

  const started = Date.now();
  console.log(`Simulating ${CASES} cases each of [${PROCESSES.join(", ")}] against ${BASE} (seed ${SEED})...`);
  const failures = await Promise.all(PROCESSES.map(runProcess));
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(0)} s.\n`);
  for (const p of PROCESSES) {
    console.log(p);
    for (const [k, v] of Object.entries(outcomes[p]).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  const totalFailures = failures.reduce((a, b) => a + b, 0);
  if (totalFailures) {
    console.error(`\n${totalFailures} simulated case(s) failed -- see errors above.`);
    process.exit(1);
  }
  console.log(`\nNext: export the event logs with TIME_SCALE=60 (1 wall-clock second = 1 simulated minute).`);
}

main();
