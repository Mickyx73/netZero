// ChargeNet EV: 3.1 station finder and live status, 3.2 bay reservation and
// 3.3 charging + billing (ev-reservation-service, ev-billing-service via the
// gateway), 3.4 road-trip range planner (simulated).
import { html, raw, $, on, api, store, icon, toast, dialog, dialogData, notify, rerender, awardPoints, num, aud, kg, day, dayLong, time, dateTime, cardPicker, cardById, defaultCard, download, sleep } from "../lib.js";
import { VEHICLES, vehicleById, suburbByName, ROAD_TRIPS } from "../data.js";

const SLOT_FIRST_HOUR = 6, SLOT_LAST_HOUR = 22; // bookable 06:00 to 22:00
const STATUS_TEXT = { available: "Available now", reserved: "Reserved right now", charging: "In use" };

function subnav(active) {
  return html`<nav class="subnav" aria-label="Charging services">
    <a href="#/charge" class="${active === "find" ? "active" : ""}">Find a charger</a>
    <a href="#/charge/bookings" class="${active === "bookings" ? "active" : ""}">My bookings</a>
    <a href="#/charge/route" class="${active === "route" ? "active" : ""}">Road trip planner</a></nav>`;
}

async function loadStations() {
  const r = await api("GET", "/api/stations");
  if (!r.ok) throw new Error("stations unavailable");
  return r.data;
}
const distanceKm = (a, b) => Math.hypot((a.lng - b.lng) * 92.3, (a.lat - b.lat) * 110.5);
const myVehicle = () => vehicleById(store.get().profile.vehicle);

// ------------------------------------------------------------------ 3.1 finder
function miniMap(stations, me) {
  // Schematic Illawarra map: stations plotted by coordinates, ocean to the east.
  const W = 300, H = 360, minLat = -34.60, maxLat = -34.30, minLng = 150.80, maxLng = 150.98;
  const X = (lng) => ((lng - minLng) / (maxLng - minLng)) * W, Y = (lat) => ((maxLat - lat) / (maxLat - minLat)) * H;
  const coast = [[150.93, -34.30], [150.925, -34.33], [150.91, -34.36], [150.905, -34.39], [150.905, -34.42], [150.902, -34.44], [150.91, -34.47], [150.895, -34.50], [150.875, -34.54], [150.866, -34.58], [150.86, -34.60]];
  const sea = `M${coast.map(([lng, lat]) => `${X(lng).toFixed(1)},${Y(lat).toFixed(1)}`).join(" L")} L${W},${H} L${W},0 Z`;
  return html`<svg class="minimap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of charging stations">
    <path d="${sea}" class="sea"/>
    <text x="${W - 12}" y="${H / 2}" class="sea-label" text-anchor="end">Tasman Sea</text>
    ${me ? html`<g class="me"><circle cx="${X(me.lng)}" cy="${Y(me.lat)}" r="7"/><text x="${X(me.lng) - 10}" y="${Y(me.lat) + 4}" text-anchor="end">You</text></g>` : ""}
    ${stations.map((s, i) => html`<a href="#/charge/station/${s.id}"><g class="pin ${s.status}">
      <circle cx="${X(s.lng)}" cy="${Y(s.lat)}" r="11"/><text x="${X(s.lng)}" y="${Y(s.lat) + 4}" text-anchor="middle">${i + 1}</text></g></a>`)}
  </svg>`;
}

export async function stations(view, _p, ctx) {
  ctx.title("Charging");
  const all = await loadStations();
  if (ctx.stale()) return;
  const v = myVehicle();
  let plug = v?.plug || "all";
  const me = suburbByName(store.get().profile.suburb);
  const draw = () => {
    const list = all.filter((s) => plug === "all" || s.plugs.includes(plug))
      .map((s) => ({ ...s, km: distanceKm(me, s) })).sort((a, b) => a.km - b.km);
    view.innerHTML = String(html`
      ${subnav("find")}
      <div class="split">
        <section class="card">
          <header class="card-head"><h2 class="card-title">Chargers near ${store.get().profile.suburb}</h2>
            <label class="inline">Plug<select id="plugSel">${["all", "CCS2", "Type 2", "CHAdeMO"].map((p) => html`<option value="${p}" ${p === plug ? raw("selected") : ""}>${p === "all" ? "Any plug" : p}</option>`)}</select></label></header>
          ${v ? html`<p class="muted small">Showing chargers that fit your ${v.name} (${v.plug}). <a href="#/profile">Change vehicle</a></p>` : ""}
          <ol class="list stations">${list.map((s, i) => html`
            <li data-href="#/charge/station/${s.id}" class="clickable">
              <span class="pin-num ${s.status}">${i + 1}</span>
              <span><a href="#/charge/station/${s.id}"><strong>${s.name}</strong></a>
                <span class="muted">${s.suburb}, ${num(s.km, 1)} km away</span>
                <span class="small">${s.plugs.join(", ")}, up to ${s.kw} kW, ${num(s.tariffPerKwh * 100)}c per kWh</span></span>
              <span class="pill ${s.status === "available" ? "ok" : "warn"}">${STATUS_TEXT[s.status]}</span></li>`)}</ol>
          ${list.length ? "" : html`<p class="muted">No chargers with that plug nearby.</p>`}
        </section>
        <section class="card map-card" aria-label="Map">${miniMap(list, me)}</section>
      </div>`);
    $("#plugSel").addEventListener("change", (e) => { plug = e.target.value; draw(); });
  };
  draw();
}

// ------------------------------------------------------------------ 3.2 booking
function localDayStart(offset) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; }

export async function station(view, [id], ctx) {
  const all = await loadStations();
  const st = all.find((s) => s.id === id);
  if (!st) { ctx.title("Charger", "#/charge"); view.innerHTML = String(html`<section class="empty-state"><h2>Charger not found</h2><a class="btn" href="#/charge">See all chargers</a></section>`); return; }
  ctx.title(st.name, "#/charge");
  const v = myVehicle();
  let dayOffset = new Date().getHours() >= SLOT_LAST_HOUR - 1 ? 1 : 0, length = 30, picked = null, requested = null;

  const draw = async () => {
    const dayStart = localDayStart(dayOffset), dayEnd = new Date(dayStart.getTime() + 86400000);
    const r = await api("GET", `/api/stations/${id}/availability?from=${encodeURIComponent(dayStart.toISOString())}&to=${encodeURIComponent(dayEnd.toISOString())}`);
    const booked = r.ok ? r.data.booked : [];
    const slots = [];
    for (let h = SLOT_FIRST_HOUR; h < SLOT_LAST_HOUR; h++) for (const m of [0, 30]) {
      const start = new Date(dayStart); start.setHours(h, m);
      const end = new Date(start.getTime() + length * 60000);
      const busy = booked.some((b) => Date.parse(b.start) < end.getTime() && Date.parse(b.end) > start.getTime());
      const past = start.getTime() < Date.now() + 5 * 60000;
      const closing = new Date(dayStart); closing.setHours(SLOT_LAST_HOUR, 0, 0, 0);
      const late = end > closing;
      slots.push({ start, end, free: !busy && !past && !late, busy });
    }
    if (picked && !slots.find((x) => x.start.getTime() === picked.getTime() && x.free)) picked = null;
    const fits = !v || st.plugs.includes(v.plug);
    view.innerHTML = String(html`
      <section class="card station-head">
        <span class="tile ev big">${icon("plug")}</span>
        <div><h2>${st.name}</h2><p class="muted">${st.suburb}, ${st.plugs.join(" and ")}, up to ${st.kw} kW</p>
          <p><span class="pill ${st.status === "available" ? "ok" : "warn"}">${STATUS_TEXT[st.status]}</span> <span class="muted">${num(st.tariffPerKwh * 100)}c per kWh. A ${aud(27)} hold is placed on your card when you plug in and released after billing.</span></p></div>
      </section>
      ${fits ? "" : html`<p class="notice warn">This charger doesn't have a ${v.plug} plug for your ${v.name}. You can still book it with an adapter.</p>`}
      <section class="card">
        <h3>Choose a time</h3>
        <div class="day-chips" role="group" aria-label="Day">${[0, 1, 2, 3, 4, 5, 6].map((o) => html`
          <button class="chip-btn ${o === dayOffset ? "on" : ""}" data-act="day" data-o="${o}">${o === 0 ? "Today" : o === 1 ? "Tomorrow" : day(localDayStart(o))}</button>`)}</div>
        <div class="seg" role="group" aria-label="Length">${[30, 60].map((l) => html`<button class="${l === length ? "on" : ""}" data-act="len" data-l="${l}">${l} minutes</button>`)}</div>
        <div class="slots" role="group" aria-label="Start time">${slots.map((x) => html`
          <button class="slot ${picked && x.start.getTime() === picked.getTime() ? "picked" : ""}" data-act="slot" data-t="${x.start.getTime()}" ${x.free ? "" : raw("disabled")} title="${x.busy ? "Already booked" : ""}">${time(x.start)}${x.busy ? html`<span class="sr">booked</span>` : ""}</button>`)}</div>
        <p class="muted small">Greyed-out times are booked or have passed. ${dayLong(dayStart)}.</p>
        <div class="row-btns"><button class="btn primary" id="reserveBtn" ${picked ? "" : raw("disabled")}>${picked ? `Reserve ${time(picked)} to ${time(picked.getTime() + length * 60000)}` : "Pick a start time"}</button></div>
        <div id="bookResult"></div>
      </section>`);
    $("#reserveBtn").addEventListener("click", () => reserve(st.id, picked, length));
  };

  const reserve = async (stationId, start, len) => {
    requested = { start, len };
    const btn = $("#reserveBtn"); btn.disabled = true; btn.textContent = "Reserving…";
    const body = { stationId, userId: store.get().profile.id, slotStart: new Date(start).toISOString(), slotEnd: new Date(start.getTime() + len * 60000).toISOString() };
    const r = await api("POST", "/api/reservations", body);
    const out = $("#bookResult");
    if (r.status === 201) {
      const name = all.find((s) => s.id === stationId)?.name || stationId;
      notify("Charging bay booked", `${name}, ${dateTime(body.slotStart)}. Confirmation code ${r.data.confirmationCode}.`, "#/charge/bookings", "success");
      const choice = await dialog({
        title: "Charging bay booked",
        body: String(html`<div class="confirm-code"><span class="muted">Confirmation code</span><strong>${r.data.confirmationCode}</strong></div>
          <p>${name}<br>${dayLong(body.slotStart)}, ${time(body.slotStart)} to ${time(body.slotEnd)}</p>
          <p class="muted small">Arrive on time: unclaimed bookings are released 15 minutes after the start.</p>`),
        actions: [{ label: "Add to calendar", value: "ics" }, { label: "See my bookings", value: "list", primary: true }],
      });
      if (choice === "ics") {
        download(`chargenet-${r.data.confirmationCode}.ics`, ics(`EV charging at ${name}`, body.slotStart, body.slotEnd, `ChargeNet booking ${r.data.confirmationCode}`, name), "text/calendar");
      }
      location.hash = "#/charge/bookings";
    } else if (r.status === 409) {
      const alts = all.filter((s) => r.data.alternateStations.includes(s.id));
      out.innerHTML = String(html`<div class="notice warn"><strong>Someone has just booked that time.</strong> These chargers are free for the same slot:</div>
        <ul class="list">${alts.map((a) => html`<li><span class="tile ev">${icon("plug")}</span><span><strong>${a.name}</strong><span class="muted">${a.suburb}, ${a.kw} kW</span></span>
          <button class="btn" data-act="alt" data-id="${a.id}">Book here instead</button></li>`)}</ul>
        ${alts.length ? "" : html`<p class="muted">No other chargers are free then. Pick another time.</p>`}`);
      await draw().then(() => { $("#bookResult").innerHTML = out.innerHTML; });
    } else {
      btn.disabled = false; btn.textContent = "Try again";
      out.innerHTML = String(html`<p class="notice error">${r.data?.error || "The booking didn't go through. Try again."}</p>`);
    }
  };

  on(view, "click", "[data-act=day]", (_e, b) => { dayOffset = Number(b.dataset.o); picked = null; draw(); });
  on(view, "click", "[data-act=len]", (_e, b) => { length = Number(b.dataset.l); draw(); });
  on(view, "click", "[data-act=slot]", (_e, b) => { picked = new Date(Number(b.dataset.t)); draw(); });
  on(view, "click", "[data-act=alt]", (_e, b) => { if (requested) reserve(b.dataset.id, requested.start, requested.len); });
  await draw();
}

function ics(summary, start, end, description, location) {
  const f = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NetZero Hub//EN", "BEGIN:VEVENT", `UID:${f(start)}-${Math.random().toString(36).slice(2)}@netzerohub`, `DTSTAMP:${f(Date.now())}`,
    `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${summary}`, `DESCRIPTION:${description}`, `LOCATION:${location}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
export { ics };

// ------------------------------------------------------------------ bookings + 3.3
const LABEL = {
  confirmed: ["Booked", "ok"], preauth_declined: ["Card declined", "error"], charging: ["Charging", "brand"], session_ended: ["Completed", "muted"],
  cancelled: ["Cancelled", "muted"], expired: ["Missed", "warn"], abandoned: ["Not started", "muted"],
};

export async function bookings(view, _p, ctx) {
  ctx.title("My bookings", "#/charge");
  const me = store.get().profile.id;
  const [rs, st, bills] = await Promise.all([
    api("GET", `/api/reservations?userId=${encodeURIComponent(me)}`),
    loadStations(),
    api("GET", `/api/billing?userId=${encodeURIComponent(me)}`),
  ]);
  if (ctx.stale()) return;
  const name = (id) => st.find((s) => s.id === id)?.name || id;
  const bill = (id) => (bills.ok ? bills.data : []).find((b) => b.session_id === id);
  const list = rs.ok ? rs.data : [];
  const active = list.filter((x) => x.status === "charging" || x.status === "preauth_declined");
  const upcoming = list.filter((x) => x.status === "confirmed").sort((a, b) => a.slot_start.localeCompare(b.slot_start));
  const past = list.filter((x) => !["charging", "preauth_declined", "confirmed"].includes(x.status));

  const item = (x) => {
    const [label, tone] = LABEL[x.status] || [x.status, "muted"];
    const b = bill(x.id);
    return html`<li class="booking card">
      <div class="booking-main"><span class="tile ev">${icon("plug")}</span>
        <span><strong>${name(x.station_id)}</strong><span class="muted">${dateTime(x.slot_start)} to ${time(x.slot_end)}, code ${x.confirmation_code}</span>
        ${x.status === "session_ended" ? html`<span class="small">${num(x.kwh_consumed, 1)} kWh${b ? `, ${aud(b.cost)} charged` : ", receipt on its way"}</span>` : ""}
        ${x.status === "preauth_declined" ? html`<span class="small error-text">Your bank declined the ${aud(x.hold_amount || 27)} pre-authorisation. Try again or use another card.</span>` : ""}
        ${x.status === "expired" ? html`<span class="small">You didn't arrive within 15 minutes, so the bay was released. No charge.</span>` : ""}</span>
        <span class="pill ${tone}">${label}</span></div>
      <div class="row-btns">
        ${x.status === "confirmed" ? html`<button class="btn primary" data-act="start" data-id="${x.id}">I've arrived: start charging</button><button class="btn" data-act="cancel" data-id="${x.id}">Cancel booking</button>` : ""}
        ${x.status === "preauth_declined" ? html`<button class="btn primary" data-act="start" data-id="${x.id}">Try payment again</button><button class="btn" data-act="abandon" data-id="${x.id}">Leave without charging</button>` : ""}
        ${x.status === "charging" ? html`<a class="btn primary" href="#/charge/session/${x.id}">Open charging session</a>` : ""}
        ${x.status === "session_ended" && b ? html`<button class="btn" data-act="receipt" data-id="${x.id}">View receipt</button>` : ""}
      </div></li>`;
  };
  view.innerHTML = String(html`
    ${subnav("bookings")}
    ${active.length ? html`<section><h3 class="section-title">Now</h3><ul class="list plain">${active.map(item)}</ul></section>` : ""}
    <section><h3 class="section-title">Upcoming</h3>${upcoming.length ? html`<ul class="list plain">${upcoming.map(item)}</ul>` : html`<p class="muted">No upcoming bookings. <a href="#/charge">Find a charger</a>.</p>`}</section>
    ${past.length ? html`<section><h3 class="section-title">Past</h3><ul class="list plain">${past.slice(0, 12).map(item)}</ul></section>` : ""}`);

  on(view, "click", "[data-act=start]", async (_e, b) => {
    const choice = await dialog({
      title: "Start charging",
      body: String(html`<p>Plug in your car. We'll place a ${aud(27)} hold on your card for the estimated session cost; you're only charged for what you use.</p>${cardPicker("startCard")}`),
      actions: [{ label: "Cancel", value: null }, { label: "Authorise and start", value: "go", primary: true }],
    });
    if (choice !== "go") return;
    const card = cardById(dialogData().startCard) || defaultCard();
    await startCharging(b.dataset.id, card);
  });
  on(view, "click", "[data-act=cancel]", async (_e, b) => {
    const ok = await dialog({ title: "Cancel this booking?", body: "The bay is released for other drivers. There's no fee.", actions: [{ label: "Keep booking", value: null }, { label: "Cancel booking", value: "yes", danger: true }] });
    if (ok !== "yes") return;
    const r = await api("POST", `/api/reservations/${b.dataset.id}/cancel`);
    toast(r.ok ? "Booking cancelled" : r.data?.error || "Couldn't cancel", r.ok ? "info" : "error");
    rerender();
  });
  on(view, "click", "[data-act=abandon]", async (_e, b) => {
    const r = await api("POST", `/api/reservations/${b.dataset.id}/abandon`);
    toast(r.ok ? "Booking closed without charging. No charge." : r.data?.error || "Couldn't update the booking", r.ok ? "info" : "error");
    rerender();
  });
  on(view, "click", "[data-act=receipt]", (_e, b) => showReceipt(bill(b.dataset.id), name(list.find((x) => x.id === b.dataset.id)?.station_id)));
}

// Pre-authorises the card at the charger (BPMN 4.5-4.8) and opens the live session.
async function startCharging(id, card) {
  const r = await api("POST", `/api/reservations/${id}/start`, { paymentToken: card.token });
  if (r.status === 200) {
    store.update((s) => { s.charging[id] = { startedAt: Date.now(), startBattery: 22 + Math.floor(Math.random() * 20), card: `${card.brand} ending ${card.last4}` }; });
    toast(`${aud(r.data.holdAmount)} hold placed. Charging started.`, "success");
    location.hash = `#/charge/session/${id}`;
  } else if (r.status === 402) {
    toast(`${card.brand} ending ${card.last4} was declined. Try again or use another card.`, "error");
    notify("Card declined at the charger", `Your bank declined the pre-authorisation on ${card.brand} ending ${card.last4}. Try again from My bookings.`, "#/charge/bookings", "error");
    if (location.hash === "#/charge/bookings") rerender(); else location.hash = "#/charge/bookings";
  } else {
    toast(r.data?.error || "Charging couldn't start", "error");
  }
}

function showReceipt(b, stationName) {
  if (!b) return;
  dialog({
    title: "Charging receipt",
    body: String(html`<dl class="receipt">
      <div><dt>Charger</dt><dd>${stationName}</dd></div>
      <div><dt>Energy</dt><dd>${num(b.kwh, 1)} kWh at ${num(b.tariff_per_kwh * 100)}c</dd></div>
      <div><dt>Charged to your card</dt><dd><strong>${aud(b.cost)}</strong></dd></div>
      <div><dt>Hold released</dt><dd>${aud(b.released_amount)} of ${aud(b.hold_amount)}</dd></div>
      <div><dt>Transaction</dt><dd>${b.transaction_id}</dd></div>
      <div><dt>Receipt</dt><dd class="small">${b.receipt_id}</dd></div></dl>`),
  });
}

// ------------------------------------------------------------------ live session
export async function session(view, [id], ctx) {
  ctx.title("Charging session", "#/charge/bookings");
  const [r, all] = await Promise.all([api("GET", `/api/reservations/${id}`), loadStations()]);
  if (!r.ok) { view.innerHTML = String(html`<section class="empty-state"><h2>Session not found</h2><a class="btn" href="#/charge/bookings">My bookings</a></section>`); return; }
  const x = r.data, st = all.find((s) => s.id === x.station_id) || { name: x.station_id, kw: 50 };
  if (x.status !== "charging") { location.hash = "#/charge/bookings"; return; }
  const v = myVehicle() || VEHICLES[1];
  const meta = store.get().charging[id] || { startedAt: Date.parse(x.session_started_at) || Date.now(), startBattery: 30, card: "your card" };
  const kw = Math.min(st.kw, 100) * 0.9;
  // Time-lapse: one second on screen is one minute at the charger.
  const delivered = () => Math.min(v.batteryKwh * 0.95, ((Date.now() - meta.startedAt) / 1000) * (kw / 60));

  view.innerHTML = String(html`
    <section class="card session">
      <div class="battery" aria-hidden="true"><span class="fill" id="batFill"></span></div>
      <div class="session-stats">
        <p class="muted">${st.name}, bay booked ${time(x.slot_start)} to ${time(x.slot_end)}</p>
        <p class="big-stat"><span id="pct">0</span>%</p>
        <dl class="kv">
          <div><dt>Energy delivered</dt><dd><span id="kwh">0.0</span> kWh</dd></div>
          <div><dt>Charging at</dt><dd>${num(kw)} kW</dd></div>
          <div><dt>Cost so far</dt><dd id="cost">${aud(0)}</dd></div>
          <div><dt>Paying with</dt><dd>${meta.card}</dd></div>
        </dl>
        <p class="muted small">Shown in time-lapse: one second here is one minute of charging.</p>
        <button class="btn primary wide" id="stopBtn">Stop charging and pay</button>
      </div>
    </section>
    <div id="after"></div>`);

  const tick = () => {
    if (!document.body.contains($("#kwh"))) return clearInterval(timer);
    const k = delivered();
    const pct = Math.min(100, Math.round(meta.startBattery + (k / v.batteryKwh) * 100));
    $("#kwh").textContent = num(k, 1);
    $("#pct").textContent = pct;
    $("#cost").textContent = aud(k * st.tariffPerKwh);
    $("#batFill").style.height = pct + "%";
  };
  const timer = setInterval(tick, 250);
  tick();

  $("#stopBtn").addEventListener("click", async () => {
    clearInterval(timer);
    const kWh = Math.round(delivered() * 10) / 10;
    // Freeze the meter on exactly what will be billed.
    $("#kwh").textContent = num(kWh, 1);
    $("#cost").textContent = aud(kWh * st.tariffPerKwh);
    const btn = $("#stopBtn"); btn.disabled = true; btn.textContent = "Ending session…";
    const c = await api("POST", `/api/reservations/${id}/complete`, { kWhConsumed: kWh });
    if (!c.ok) { btn.disabled = false; btn.textContent = "Stop charging and pay"; toast(c.data?.error || "Couldn't stop the session", "error"); return; }
    store.update((s) => { if (!s.watch.receipts.includes(id)) s.watch.receipts.push(id); delete s.charging[id]; });
    const after = $("#after");
    $(".session").classList.add("ended");
    btn.remove();
    after.innerHTML = String(html`<section class="card"><h3>Session ended: ${num(kWh, 1)} kWh</h3>
      ${raw(String(stepperHtml(1)))}<p class="muted" id="billMsg">You can unplug now. Billing is working out your final cost.</p></section>`);
    for (let i = 0; i < 30; i++) {
      await sleep(700);
      const b = await api("GET", `/api/billing/${id}`).catch(() => null);
      if (b?.ok && b.data.status === "settled") {
        const mine = store.get().watch.receipts.includes(id); // false if the background watcher got there first
        store.update((s) => { s.watch.receipts = s.watch.receipts.filter((z) => z !== id); });
        if (mine) awardPoints(20, "Charged an EV");
        after.innerHTML = String(html`<section class="card success-card">${raw(String(stepperHtml(4)))}
          <h3>Paid ${aud(b.data.cost)}</h3>
          <p>${num(b.data.kwh, 1)} kWh at ${num(b.data.tariff_per_kwh * 100)}c per kWh. The remaining ${aud(b.data.released_amount)} of your hold has been released.</p>
          <div class="row-btns"><button class="btn" id="rcpt">View receipt</button><a class="btn primary" href="#/charge/bookings">Done</a></div></section>`);
        $("#rcpt").addEventListener("click", () => showReceipt(b.data, st.name));
        return;
      }
    }
    $("#billMsg").textContent = "Your receipt is taking longer than usual. We'll notify you as soon as it's ready; you don't need to wait here.";
  });
}
function stepperHtml(current) {
  const steps = ["Session ended", "Final cost calculated", "Payment captured", "Receipt issued"];
  return html`<ol class="stepper">${steps.map((s, i) => html`<li class="${i < current ? "done" : i === current ? "active" : "todo"}"><span class="dot">${i < current ? icon("check") : ""}</span><span>${s}</span></li>`)}</ol>`;
}

// ------------------------------------------------------------------ 3.4 road trips
export async function route(view, _p, ctx) {
  ctx.title("Road trip planner", "#/charge");
  const pv = myVehicle();
  view.innerHTML = String(html`
    ${subnav("route")}
    <section class="card">
      <h2 class="card-title">Where are you driving from Wollongong?</h2>
      <form id="tripForm" class="form-grid">
        <label>Destination<select name="to" id="rt-to">${ROAD_TRIPS.map((t) => html`<option>${t.to}</option>`)}</select></label>
        <label>Vehicle<select name="veh" id="rt-veh">${VEHICLES.map((x) => html`<option value="${x.id}" ${pv?.id === x.id ? raw("selected") : ""}>${x.name}, ${x.rangeKm} km range</option>`)}</select></label>
        <label>Battery now: <output id="batOut">60</output>%<input type="range" min="10" max="100" step="5" value="60" name="bat" id="rt-bat"></label>
        <button class="btn primary" type="submit">Plan the drive</button>
      </form>
    </section>
    <div id="tripOut"></div>`);
  $("#rt-bat").addEventListener("input", (e) => { $("#batOut").textContent = e.target.value; });
  $("#tripForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const trip = ROAD_TRIPS.find((t) => t.to === f.get("to"));
    const veh = vehicleById(f.get("veh"));
    const plan = planTrip(trip, veh, Number(f.get("bat")));
    $("#tripOut").innerHTML = String(html`<section class="card">
      <header class="card-head"><h3>Wollongong to ${trip.to}, ${trip.km} km</h3><span class="muted">${plan.stops.length ? `${plan.stops.length} charging stop${plan.stops.length > 1 ? "s" : ""}, about ${num(plan.chargeMins)} min charging` : "No charging stops needed"}</span></header>
      <ol class="timeline">
        <li><strong>Leave Wollongong</strong><span class="muted">${f.get("bat")}% battery, about ${num(veh.rangeKm * Number(f.get("bat")) / 100)} km of range</span></li>
        ${plan.stops.map((s) => html`<li class="stop"><strong>Charge at ${s.name}</strong><span class="muted">km ${s.at}: arrive with ${s.arrive}%, charge to ${s.leave}% at ${s.kw} kW, about ${num(s.mins)} min</span></li>`)}
        <li><strong>Arrive in ${trip.to}</strong><span class="muted">${plan.arrive}% battery left</span></li>
      </ol>
      ${plan.ok ? "" : html`<p class="notice warn">This trip needs more charging than the stops on this route can give. Start with a fuller battery.</p>`}
      ${Number(f.get("bat")) < 50 ? html`<p class="muted small">Low battery? <a href="#/charge">Book a charger in Wollongong</a> before you leave.</p>` : ""}
    </section>`);
  });
}

function planTrip(trip, veh, startPct) {
  const reservePct = 10, kmPerPct = veh.rangeKm / 100;
  let pos = 0, pct = startPct, stops = [], chargeMins = 0, ok = true;
  const reach = (from, to, p) => p - (to - from) / kmPerPct;
  while (reach(pos, trip.km, pct) < reservePct) {
    const options = trip.stops.filter((s) => s.at > pos && reach(pos, s.at, pct) >= reservePct);
    if (!options.length) { ok = false; break; }
    const s = options[options.length - 1];
    const arrive = Math.round(reach(pos, s.at, pct));
    const need = Math.min(90, Math.max(arrive + 10, Math.ceil(reservePct + (trip.km - s.at) / kmPerPct + 5)));
    const leave = Math.max(arrive, Math.min(90, need));
    const mins = (((leave - arrive) / 100) * veh.batteryKwh / Math.min(s.kw, 120)) * 60 * 1.15;
    stops.push({ ...s, arrive, leave, mins });
    chargeMins += mins; pos = s.at; pct = leave;
  }
  return { stops, chargeMins, ok, arrive: Math.max(0, Math.round(reach(pos, trip.km, pct))) };
}
