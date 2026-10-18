// EcoTransit Authority: 2.1 journey planner (journey-planner-service),
// 2.2 transit passes and 2.3 share-bike locator (simulated).
import { html, raw, $, $$, on, api, store, rerender, icon, toast, awardPoints, notify, num, kg, aud, dateTime, time, uid, seeded, cardPicker, cardById, simulatePayment, passCode, sleep } from "../lib.js";
import { PLACES, PASS_TYPES, BIKE_DOCKS, SUBURBS, suburbByName } from "../data.js";

const MODE = {
  train: { name: "Train", icon: "train" },
  bus: { name: "Bus", icon: "bus" },
  bike: { name: "Share bike", icon: "bike" },
};

function subnav(active) {
  return html`<nav class="subnav" aria-label="Travel services">
    <a href="#/travel" class="${active === "plan" ? "active" : ""}">Plan a trip</a>
    <a href="#/travel/pass" class="${active === "pass" ? "active" : ""}">Transit passes</a>
    <a href="#/travel/bikes" class="${active === "bikes" ? "active" : ""}">Share bikes</a></nav>`;
}

// ------------------------------------------------------------------ 2.1 planner
export async function planner(view, _p, ctx) {
  ctx.title("Travel");
  const s = store.get();
  const home = PLACES.includes(s.profile.suburb) ? s.profile.suburb : "Wollongong";
  const leave = new Date(Date.now() + 15 * 60000);
  const leaveLocal = new Date(leave.getTime() - leave.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const saved = s.trips.reduce((a, t) => a + (t.savedKg || 0), 0);

  view.innerHTML = String(html`
    ${subnav("plan")}
    <section class="card transit-card">
      <h2 class="card-title">Where are you going?</h2>
      <form id="planForm" class="form-grid">
        <label>From<select id="jp-from" name="from">${PLACES.map((x) => html`<option ${x === home ? raw("selected") : ""}>${x}</option>`)}</select></label>
        <label>To<select id="jp-to" name="to">${PLACES.map((x) => html`<option ${x === (home === "Sydney CBD" ? "Wollongong" : "Sydney CBD") ? raw("selected") : ""}>${x}</option>`)}</select></label>
        <label>Leave at<input id="jp-leave" name="leave" type="datetime-local" value="${leaveLocal}"></label>
        <fieldset class="chips-field"><legend>I need to arrive within</legend>
          ${[["", "Any time"], ["30", "30 min"], ["45", "45 min"], ["60", "1 hour"], ["90", "1.5 hours"]].map(([v, l], i) => html`
            <label class="chip"><input type="radio" name="max" value="${v}" ${i === 0 ? raw("checked") : ""}><span>${l}</span></label>`)}
        </fieldset>
        <fieldset class="chips-field"><legend>Ways to travel</legend>
          ${Object.entries(MODE).map(([k, m]) => html`<label class="chip"><input type="checkbox" name="modes" value="${k}" checked><span>${icon(m.icon)}${m.name}</span></label>`)}
        </fieldset>
        <button class="btn primary" type="submit">Find routes</button>
      </form>
    </section>
    <div id="results"></div>
    <section class="card">
      <header class="card-head"><h3>Your trips</h3>${s.trips.length ? html`<span class="muted">${kg(saved)} CO₂-e saved versus driving</span>` : ""}</header>
      ${s.trips.length ? html`<ul class="list">${s.trips.slice(0, 6).map((t) => html`
        <li><span class="tile transit">${icon(MODE[t.mode]?.icon || "route")}</span><span><strong>${t.from} to ${t.to}</strong>
        <span class="muted">${MODE[t.mode]?.name || t.mode}, ${num(t.durationMins)} min, ${dateTime(t.ts)}</span></span><span class="pill ok">${kg(t.savedKg)} saved</span></li>`)}</ul>`
      : html`<p class="muted">Trips you choose appear here, with the emissions you saved.</p>`}
    </section>`);

  let journey = null, trip = null;
  on($("#results"), "click", "[data-act=choose]", (_e, btn) => {
    if (!journey) return;
    const o = journey.options[Number(btn.dataset.i)];
    const { from, to } = trip;
    store.update((st) => st.trips.unshift({ id: uid("T"), ts: Date.now(), from, to, mode: o.mode, durationMins: o.durationMins, co2Kg: o.co2Kg, savedKg: o.co2SavedVsDrivingKg }));
    awardPoints(Math.max(5, Math.round(o.co2SavedVsDrivingKg * 10)), "Chose a low-carbon trip");
    const follow = o.mode === "bike"
      ? html`<a class="btn primary" href="#/travel/bikes">Find a share bike</a>`
      : html`<a class="btn primary" href="#/travel/pass">Get a transit pass</a>`;
    journey = null;
    $("#results").innerHTML = String(html`<section class="card success-card">${icon("check", "big")}
      <h3>${MODE[o.mode].name} it is</h3>
      <p>You'll save ${kg(o.co2SavedVsDrivingKg)} of CO₂-e compared with driving. The trip is in your history.</p>
      <div class="row-btns">${follow}<button class="btn" data-act="again">Plan another trip</button></div></section>`);
  });

  on($("#results"), "click", "[data-act=again]", () => rerender());

  $("#planForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const from = f.get("from"), to = f.get("to");
    const out = $("#results");
    if (from === to) { out.innerHTML = String(html`<p class="notice warn">Pick a destination different from where you're starting.</p>`); return; }
    const modes = f.getAll("modes");
    if (!modes.length) { out.innerHTML = String(html`<p class="notice warn">Choose at least one way to travel.</p>`); return; }
    const body = { origin: from, destination: to, departureTime: new Date(f.get("leave")).toISOString(), modes };
    if (f.get("max")) body.maxDurationMins = Number(f.get("max"));
    out.innerHTML = `<div class="loading"><span class="spinner"></span><span>Checking timetables and emissions…</span></div>`;
    const r = await api("POST", "/api/journeys/plan", body);
    if (!r.ok) { out.innerHTML = String(html`<p class="notice error">${r.data?.error || "Routes couldn't be found. Try again."}</p>`); return; }
    const j = r.data;
    out.innerHTML = String(html`
      <section class="results">
        <header class="section-head"><h3>${from} to ${to}, ${num(j.distanceKm)} km</h3>
          <span class="muted">Driving: ${num(j.driveBaseline.durationMins)} min, ${num(j.driveBaseline.co2Kg, 2)} kg CO₂-e</span></header>
        ${j.constraintRelaxed ? html`<p class="notice info">No option gets you there within your time limit, so here's the fastest one.</p>` : ""}
        <ol class="options">${j.options.map((o, i) => html`
          <li class="option ${i === 0 ? "best" : ""}">
            <span class="tile transit">${icon(MODE[o.mode].icon)}</span>
            <div class="opt-main"><strong>${MODE[o.mode].name}</strong>${i === 0 ? html`<span class="pill brand">Lowest emissions</span>` : ""}
              <span class="muted">${num(o.durationMins)} min, arrive about ${time(Date.parse(j.departureTime) + o.durationMins * 60000)}</span></div>
            <div class="opt-co2"><strong>${num(o.co2Kg, 2)} kg</strong><span class="muted">${o.co2SavedVsDrivingKg > 0 ? `${num(o.co2SavedVsDrivingKg, 2)} kg less than driving` : "CO₂-e"}</span></div>
            <button class="btn ${i === 0 ? "primary" : ""}" data-act="choose" data-i="${i}">Choose</button>
          </li>`)}</ol>
      </section>`);
    journey = j; trip = { from, to };
  });
}

// ------------------------------------------------------------------ 2.2 passes
export async function pass(view, _p, ctx) {
  ctx.title("Transit passes", "#/travel");
  const draw = () => {
    const s = store.get();
    const active = s.passes.filter((x) => x.expires > Date.now());
    const past = s.passes.filter((x) => x.expires <= Date.now());
    view.innerHTML = String(html`
      ${subnav("pass")}
      ${active.map((x) => html`
        <section class="card pass-card">
          ${passCode(x.code)}
          <div><p class="muted">EcoTransit ${x.concession ? "concession " : ""}${x.name.toLowerCase()}</p>
            <h2>${x.name}</h2>
            <p>Valid until <strong>${dateTime(x.expires)}</strong> on all Illawarra buses and South Coast line trains.</p>
            <p class="muted small">Show this code to the driver or scan it at the gate. Pass ${x.code}.</p></div>
        </section>`)}
      <section class="card">
        <h2 class="card-title">Buy a pass</h2>
        <form id="passForm" class="stack">
          <fieldset class="choice-grid"><legend>Pass</legend>${PASS_TYPES.map((t, i) => html`
            <label class="choice"><input type="radio" name="type" value="${t.id}" ${i === 0 ? raw("checked") : ""}>
              <span><strong>${t.name}</strong><span class="price" data-price="${t.price}">${aud(t.price)}</span></span></label>`)}</fieldset>
          <label class="check"><input type="checkbox" name="concession" id="pass-concession"> I have a concession card (half price)</label>
          ${cardPicker("card")}
          <p class="notice error" id="passErr" hidden></p>
          <button class="btn primary" type="submit" id="passBuy">Buy pass</button>
        </form>
      </section>
      ${past.length ? html`<section class="card"><h3>Expired passes</h3><ul class="list">${past.slice(0, 5).map((x) => html`
        <li><span class="tile transit">${icon("ticket")}</span><span><strong>${x.name}</strong><span class="muted">Expired ${dateTime(x.expires)}, paid ${aud(x.price)}</span></span></li>`)}</ul></section>` : ""}`);

    const form = $("#passForm");
    const priceLabel = () => {
      const f = new FormData(form);
      const t = PASS_TYPES.find((p) => p.id === f.get("type"));
      const price = t.price * (f.get("concession") ? 0.5 : 1);
      $("#passBuy").textContent = `Buy pass for ${aud(price)}`;
      return { t, price };
    };
    form.addEventListener("change", priceLabel);
    priceLabel();
    const key = uid("PASS");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { t, price } = priceLabel();
      const card = cardById(new FormData(form).get("card"));
      if (!card) return;
      const btn = $("#passBuy"); btn.disabled = true; btn.textContent = "Paying…";
      const pay = await simulatePayment(card, key);
      if (!pay.approved) {
        btn.disabled = false; priceLabel();
        const err = $("#passErr"); err.hidden = false;
        err.textContent = `${card.brand} ending ${card.last4} was declined. Try again or choose another card.`;
        return;
      }
      const now = Date.now();
      store.update((s) => s.passes.unshift({ id: uid("P"), code: uid("ET-"), type: t.id, name: t.name, price, concession: !!new FormData(form).get("concession"), issued: now, expires: now + t.hours * 3600000 }));
      awardPoints(10, "Bought a transit pass");
      notify(`${t.name} ready`, `Paid ${aud(price)} with ${card.brand} ending ${card.last4}.`, "#/travel/pass", "success");
      draw();
    });
  };
  draw();
}

// ------------------------------------------------------------------ 2.3 share bikes
function dockPosition(dock) {
  const base = suburbByName(dock.suburb === "Keiraville" ? "Wollongong" : dock.suburb);
  return { lat: base.lat + (seeded(dock.id, 1) - 0.5) * 0.008, lng: base.lng + (seeded(dock.id, 2) - 0.5) * 0.008 };
}
function metres(a, b) {
  const dx = (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), dy = (a.lat - b.lat) * 110540;
  return Math.round(Math.hypot(dx, dy));
}
function dockStock(dock) {
  const slot = Math.floor(Date.now() / 600000); // changes every 10 minutes
  const bikes = Math.floor(seeded(dock.id, slot) * 9);
  const ebikes = Math.floor(seeded(dock.id, slot + 7) * 5);
  const batteries = Array.from({ length: ebikes }, (_, i) => 25 + Math.floor(seeded(dock.id + i, slot) * 75));
  return { bikes, ebikes, batteries };
}

export async function bikes(view, _p, ctx) {
  ctx.title("Share bikes", "#/travel");
  let where = store.get().profile.suburb, radius = 1500;
  const draw = () => {
    const s = store.get();
    const hold = s.bikeHolds.find((h) => h.expires > Date.now());
    const centre = suburbByName(where);
    const docks = BIKE_DOCKS.map((d) => ({ ...d, dist: metres(centre, dockPosition(d)), ...dockStock(d) }))
      .filter((d) => d.dist <= radius).sort((a, b) => a.dist - b.dist);
    view.innerHTML = String(html`
      ${subnav("bikes")}
      ${hold ? html`<section class="card success-card">${icon("bike", "big")}
        <h3>Bike held at ${hold.dock}</h3>
        <p>Unlock code <strong class="code">${hold.code}</strong>. Your hold ends at ${time(hold.expires)}.</p>
        <button class="btn" id="cancelHold">Cancel hold</button></section>` : ""}
      <section class="card">
        <form id="bikeForm" class="form-grid">
          <label>Near<select id="bk-near" name="near">${SUBURBS.map((x) => html`<option ${x.name === where ? raw("selected") : ""}>${x.name}</option>`)}</select></label>
          <fieldset class="chips-field"><legend>Within</legend>${[[500, "500 m"], [1500, "1.5 km"], [3000, "3 km"]].map(([v, l]) => html`
            <label class="chip"><input type="radio" name="r" value="${v}" ${v === radius ? raw("checked") : ""}><span>${l}</span></label>`)}</fieldset>
        </form>
      </section>
      <section>
        <header class="section-head"><h3>${docks.length ? `${docks.length} bike dock${docks.length > 1 ? "s" : ""} nearby` : "No docks within that distance"}</h3><span class="muted">Updated ${time(Date.now())}</span></header>
        ${docks.length ? html`<ul class="list cards">${docks.map((d) => html`
          <li class="card"><span class="tile transit">${icon("bike")}</span>
            <span><strong>${d.name}</strong><span class="muted">${num(d.dist)} m away, ${d.suburb}</span>
              <span class="small">${d.bikes} bikes, ${d.ebikes} e-bikes${d.ebikes ? ` (battery ${d.batteries.map((b) => b + "%").join(", ")})` : ""}</span></span>
            <button class="btn" data-act="hold" data-dock="${d.name}" ${d.bikes + d.ebikes && !hold ? "" : raw("disabled")}>Hold a bike</button></li>`)}</ul>`
        : html`<p class="muted">Try a wider distance or another suburb.</p>`}
      </section>`);
    $("#bikeForm").addEventListener("change", (e) => {
      const f = new FormData(e.currentTarget);
      where = f.get("near"); radius = Number(f.get("r")); draw();
    });
    $("#cancelHold")?.addEventListener("click", () => { store.update((st) => { st.bikeHolds = []; }); toast("Hold cancelled"); draw(); });
  };
  on(view, "click", "[data-act=hold]", (_e, b) => {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    store.update((st) => { st.bikeHolds = [{ dock: b.dataset.dock, code, expires: Date.now() + 10 * 60000 }]; });
    toast(`Bike held for 10 minutes at ${b.dataset.dock}`, "success");
    draw();
  });
  draw();
}
