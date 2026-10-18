// GovEnvironment Agency: 5.1 footprint calculator (footprint-service) and
// 5.2 offset purchasing (offset-service, asynchronous via RabbitMQ).
import { html, raw, $, $$, on, api, store, icon, toast, notify, awardPoints, num, aud, kg, tonnes, day, dayLong, dateTime, cardPicker, cardById, defaultCard, stepper, download, esc, sleep, sqlDate } from "../lib.js";
import { OFFSET_PROJECTS } from "../data.js";

const PRICE_PER_KG = 0.03; // must match offset-service
const DIETS = [
  [1, "Plant-based", "No meat or dairy"],
  [2, "Vegetarian", "No meat, some dairy and eggs"],
  [3, "Some meat", "Meat a few times a week"],
  [4, "Meat most days", "Meat at one meal most days"],
  [5, "Meat lover", "Meat with most meals"],
];
const CATS = [["energy", "Home energy"], ["transport", "Transport"], ["diet", "Food"]];

function subnav(active) {
  return html`<nav class="subnav" aria-label="Footprint services">
    <a href="#/footprint" class="${active === "me" ? "active" : ""}">My footprint</a>
    <a href="#/footprint/offset" class="${active === "offset" ? "active" : ""}">Offset</a>
    <a href="#/business" class="${active === "biz" ? "active" : ""}">Green businesses</a></nav>`;
}

async function myFootprint() {
  const r = await api("GET", `/api/footprint/${encodeURIComponent(store.get().profile.id)}`);
  return r.ok ? r.data : null;
}

function breakdownBars(b, total) {
  return html`<dl class="breakdown">${CATS.map(([k, l]) => html`
    <div><dt><i class="sw ${k}"></i>${l}</dt><dd>${tonnes(b[k])}</dd><span class="bar"><span class="${k}" style="width:${Math.round((b[k] / total) * 100)}%"></span></span></div>`)}</dl>`;
}

const TIPS = {
  energy: [["Switch to a renewable electricity plan", "#/energy/plans", "Grid power is your biggest source. A 100% GreenPower plan removes most of it."], ["Check if solar suits your home", "#/energy/solar", "Rooftop solar cuts both bills and emissions."]],
  transport: [["Plan trips by their emissions", "#/travel", "Train and bus trips emit a fraction of a car's CO₂-e."], ["Charge an EV on clean power", "#/charge", "Book a ChargeNet bay near you."]],
  diet: [["Swap a few meals a week", "#/community/events", "Food is a big share for you. Community cooking and garden events are a good start."], ["Grow your own", "#/community/garden", "Book a community garden plot."]],
};

// ------------------------------------------------------------------ overview
export async function overview(view, _p, ctx) {
  ctx.title("My footprint");
  const [fp, offs] = await Promise.all([myFootprint(), api("GET", `/api/offsets?userId=${encodeURIComponent(store.get().profile.id)}`)]);
  if (ctx.stale()) return;
  const offsets = offs.ok ? offs.data : [];
  if (!fp) {
    view.innerHTML = String(html`${subnav("me")}<section class="empty-state">${icon("leaf", "big")}
      <h2>You haven't measured your footprint yet</h2>
      <p>Three questions about your home, travel and food. About two minutes.</p>
      <a class="btn primary" href="#/footprint/calc">Measure my footprint</a></section>`);
    return;
  }
  const b = fp.breakdown_kg_year, total = fp.total_co2_kg_year;
  const biggest = CATS.map(([k]) => k).sort((x, y) => b[y] - b[x])[0];
  const max = Math.max(total, fp.peer_average_co2_kg_year);
  view.innerHTML = String(html`
    ${subnav("me")}
    <section class="card">
      <header class="card-head"><h2 class="card-title">${tonnes(total)} CO₂-e a year</h2><a class="btn" href="#/footprint/calc">Recalculate</a></header>
      <p class="muted">Measured ${day(sqlDate(fp.updated_at))}. That's ${fp.percentile_vs_peers}.</p>
      <div class="compare" role="img" aria-label="You ${tonnes(total)}, national average ${tonnes(fp.peer_average_co2_kg_year)}">
        <div><span>You</span><span class="cbar"><span class="you" style="width:${(total / max) * 100}%"></span></span><strong>${tonnes(total)}</strong></div>
        <div><span>Australian average</span><span class="cbar"><span class="avg" style="width:${(fp.peer_average_co2_kg_year / max) * 100}%"></span></span><strong>${tonnes(fp.peer_average_co2_kg_year)}</strong></div>
        ${fp.net_offset_applied_kg > 0 ? html`<div><span>You, after offsets</span><span class="cbar"><span class="net" style="width:${(Math.max(0, total - fp.net_offset_applied_kg) / max) * 100}%"></span></span><strong>${tonnes(Math.max(0, total - fp.net_offset_applied_kg))}</strong></div>` : ""}
      </div>
      ${breakdownBars(b, total)}
    </section>
    <section class="card">
      <h3>Where you can cut the most</h3>
      <p class="muted">${CATS.find(([k]) => k === biggest)[1]} is your largest source at ${tonnes(b[biggest])} a year.</p>
      <ul class="list">${TIPS[biggest].map(([t, h, d]) => html`<li data-href="${h}" class="clickable"><span class="tile gov">${icon("leaf")}</span><span><a href="${h}"><strong>${t}</strong></a><span class="muted">${d}</span></span>${icon("chevron")}</li>`)}</ul>
    </section>
    <section class="card">
      <header class="card-head"><h3>Offset certificates</h3><a href="#/footprint/offset">Offset more</a></header>
      ${offsets.length ? html`<ul class="list">${offsets.map((o) => html`<li data-href="#/footprint/offset/${o.id}" class="clickable"><span class="tile gov">${icon("tree")}</span>
        <span><a href="#/footprint/offset/${o.id}"><strong>${kg(o.amount_co2_kg)} offset</strong></a><span class="muted">${JSON.parse(o.project_types).map((t) => OFFSET_PROJECTS.find((p) => p.id === t)?.name).join(", ")}, ${aud(o.price_aud)}</span></span>
        <span class="pill ${o.status === "certified" ? "ok" : o.status === "payment_failed" ? "error" : "warn"}">${o.status === "certified" ? "Certified" : o.status === "payment_failed" ? "Cancelled" : "In progress"}</span></li>`)}</ul>`
      : html`<p class="muted">No offsets yet.</p>`}
    </section>`);
}

// ------------------------------------------------------------------ 5.1 calculator
export async function calc(view, _p, ctx) {
  ctx.title("Measure your footprint", "#/footprint");
  const prev = await myFootprint();
  let step = 0;
  const vals = { energy: prev?.energy_kwh_month ?? 350, km: prev?.transport_km_week ?? 120, diet: prev?.diet_score ?? 3 };
  const draw = () => {
    view.innerHTML = String(html`
      <ol class="wizard-steps" aria-label="Steps">${["Home energy", "Getting around", "Food"].map((l, i) => html`<li class="${i < step ? "done" : i === step ? "active" : ""}">${l}</li>`)}</ol>
      <section class="card wizard">
        ${step === 0 ? html`
          <h2>How much electricity does your home use?</h2>
          <p class="muted">Find it on your power bill as kWh. A typical Illawarra household uses 300 to 500 kWh a month.</p>
          <label class="big-range">kWh per month: <output id="eOut">${vals.energy}</output>
            <input type="range" id="eRange" min="50" max="1500" step="10" value="${vals.energy}"></label>
          <details><summary>Only know your bill amount?</summary>
            <label>Quarterly bill (AUD)<input type="number" id="billAud" min="0" step="10" placeholder="e.g. 450"></label>
            <button class="btn" type="button" id="fromBill">Use my bill</button></details>`
        : step === 1 ? html`
          <h2>How far do you drive each week?</h2>
          <p class="muted">Kilometres in a petrol or diesel car. Public transport, cycling and EV kilometres don't count here.</p>
          <label class="big-range">km per week: <output id="kOut">${vals.km}</output>
            <input type="range" id="kRange" min="0" max="800" step="10" value="${vals.km}"></label>`
        : html`
          <h2>Which best describes what you eat?</h2>
          <fieldset class="choice-grid diets"><legend class="sr">Diet</legend>${DIETS.map(([v, n, d]) => html`
            <label class="choice"><input type="radio" name="diet" value="${v}" ${v === vals.diet ? raw("checked") : ""}><span><strong>${n}</strong><span class="muted">${d}</span></span></label>`)}</fieldset>`}
        <div class="row-btns">
          ${step > 0 ? html`<button class="btn" data-act="prev">Back</button>` : ""}
          <button class="btn primary" data-act="next">${step < 2 ? "Next" : "Calculate my footprint"}</button></div>
      </section>`);
    $("#eRange")?.addEventListener("input", (e) => { vals.energy = Number(e.target.value); $("#eOut").textContent = vals.energy; });
    $("#kRange")?.addEventListener("input", (e) => { vals.km = Number(e.target.value); $("#kOut").textContent = vals.km; });
    $("#fromBill")?.addEventListener("click", () => {
      const bill = Number($("#billAud").value);
      if (!bill) return;
      vals.energy = Math.min(1500, Math.max(50, Math.round(((bill - 90) / 0.33 / 3) / 10) * 10)); // ~$90 supply charge, 33c/kWh
      draw();
      toast(`About ${vals.energy} kWh a month`);
    });
    $$("input[name=diet]").forEach((r) => r.addEventListener("change", (e) => { vals.diet = Number(e.target.value); }));
  };
  on(view, "click", "[data-act=prev]", () => { step--; draw(); });
  on(view, "click", "[data-act=next]", async (_e, b) => {
    if (step < 2) { step++; draw(); return; }
    b.disabled = true; b.textContent = "Calculating…";
    const first = !prev;
    const r = await api("POST", "/api/footprint", { userId: store.get().profile.id, energyKwhMonth: vals.energy, transportKmWeek: vals.km, dietScore: vals.diet });
    if (!r.ok) { b.disabled = false; b.textContent = "Calculate my footprint"; toast(r.data?.error || "Couldn't calculate. Try again.", "error"); return; }
    const f = r.data;
    store.update((s) => { s.footprintCase = f.caseId; });
    if (first) awardPoints(50, "Measured your footprint");
    view.innerHTML = String(html`
      <section class="card result">
        <p class="muted">Your carbon footprint</p>
        <p class="result-big">${num(f.totalCo2KgYear / 1000, 1)} <span>tonnes CO₂-e a year</span></p>
        <p>That's ${f.comparisonToPeers} of ${tonnes(f.peerAverageCo2KgYear)}.</p>
        ${breakdownBars(f.breakdownKgYear, f.totalCo2KgYear)}
      </section>
      <section class="card decide">
        <h3>Would you like to offset it now?</h3>
        <p class="muted">Buy certified carbon credits that are retired in your name. Offsetting a quarter of your footprint costs ${aud(f.totalCo2KgYear * 0.25 * PRICE_PER_KG)}.</p>
        <div class="row-btns"><a class="btn primary" href="#/footprint/offset">Choose an offset</a><button class="btn" id="notNow">Not now</button></div>
      </section>`);
    $("#notNow").addEventListener("click", async () => {
      await api("POST", `/api/footprint/${encodeURIComponent(store.get().profile.id)}/decline-offset`, { caseId: f.caseId });
      toast("Your footprint is saved as your baseline");
      location.hash = "#/footprint";
    });
  });
  draw();
}

// ------------------------------------------------------------------ 5.2 offset purchase
export async function offset(view, _p, ctx) {
  ctx.title("Offset emissions", "#/footprint");
  const fp = await myFootprint();
  if (ctx.stale()) return;
  if (!fp) {
    view.innerHTML = String(html`${subnav("offset")}<section class="empty-state">${icon("tree", "big")}<h2>Measure your footprint first</h2>
      <p>We use it to suggest how much to offset.</p><a class="btn primary" href="#/footprint/calc">Measure my footprint</a></section>`);
    return;
  }
  const total = fp.total_co2_kg_year;
  const remaining = Math.max(0, total - (fp.net_offset_applied_kg || 0));
  view.innerHTML = String(html`
    ${subnav("offset")}
    <form id="offForm" class="stack">
      <section class="card">
        <h2 class="card-title">How much would you like to offset?</h2>
        <p class="muted">Your footprint is ${tonnes(total)} a year${fp.net_offset_applied_kg ? `, and you've already offset ${kg(fp.net_offset_applied_kg)}` : ""}.</p>
        <fieldset class="choice-grid"><legend class="sr">Amount</legend>
          ${[[0.25, "A quarter"], [0.5, "Half"], [1, "All of it"]].map(([f, l], i) => {
            const amt = Math.max(1, Math.round(remaining * f || total * f));
            return html`<label class="choice"><input type="radio" name="amt" value="${amt}" ${i === 0 ? raw("checked") : ""}><span><strong>${l}</strong><span class="muted">${kg(amt)}, ${aud(amt * PRICE_PER_KG)}</span></span></label>`;
          })}
          <label class="choice"><input type="radio" name="amt" value="custom"><span><strong>Another amount</strong><input type="number" id="customKg" min="1" step="10" placeholder="kg CO₂-e" aria-label="Custom amount in kg"></span></label>
        </fieldset>
      </section>
      <section class="card">
        <h2 class="card-title">Choose projects to support</h2>
        <fieldset class="project-grid"><legend class="sr">Projects</legend>${OFFSET_PROJECTS.map((p, i) => html`
          <label class="project ${p.id}"><input type="checkbox" name="proj" value="${p.id}" ${i === 0 ? raw("checked") : ""}>
            <span><strong>${p.name}</strong><span class="muted small">${p.place}</span><span>${p.body}</span></span></label>`)}</fieldset>
        <p class="muted small">Your amount is split evenly across the projects you choose. Credits are retired with the Verified Carbon Registry in your name.</p>
      </section>
      <section class="card">${cardPicker("card")}
        <p class="notice error" id="offErr" hidden></p>
        <button class="btn primary wide" type="submit" id="buyBtn">Buy offsets</button></section>
    </form>`);
  const form = $("#offForm");
  const amount = () => {
    const f = new FormData(form);
    return f.get("amt") === "custom" ? Number($("#customKg").value) : Number(f.get("amt"));
  };
  const label = () => { const a = amount(); $("#buyBtn").textContent = a > 0 ? `Buy ${kg(a)} for ${aud(a * PRICE_PER_KG)}` : "Enter an amount"; };
  form.addEventListener("input", label);
  $("#customKg").addEventListener("focus", () => { form.querySelector("input[name=amt][value=custom]").checked = true; label(); });
  label();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const err = $("#offErr");
    const amountCo2Kg = amount();
    const projectTypes = f.getAll("proj");
    if (!(amountCo2Kg > 0)) { err.hidden = false; err.textContent = "Enter how many kilograms to offset."; return; }
    if (!projectTypes.length) { err.hidden = false; err.textContent = "Choose at least one project to support."; return; }
    const card = cardById(f.get("card")) || defaultCard();
    if (!card) { err.hidden = false; err.textContent = "Add a card in your wallet first."; return; }
    const btn = $("#buyBtn"); btn.disabled = true; btn.textContent = "Sending order…";
    const r = await api("POST", "/api/offsets", { userId: store.get().profile.id, amountCo2Kg, projectTypes, paymentToken: card.token, caseId: store.get().footprintCase || undefined });
    if (r.status !== 202) { btn.disabled = false; label(); err.hidden = false; err.textContent = r.data?.error || "The order didn't go through. Try again."; return; }
    store.update((s) => { s.watch.offsets.push(r.data.offsetId); s.offsetCards = { ...(s.offsetCards || {}), [r.data.offsetId]: `${card.brand} ending ${card.last4}` }; });
    location.hash = `#/footprint/offset/${r.data.offsetId}`;
  });
}

const STAGES = ["Order received", "Credits reserved", "Payment approved", "Credits retired", "Certificate issued"];
const STAGE_INDEX = { queued: 0, reserving: 1, paying: 2, retiring: 3, certified: 5, payment_failed: 2 };

export async function offsetStatus(view, [id], ctx) {
  ctx.title("Offset order", "#/footprint");
  const profile = store.get().profile;
  let done = false;
  const draw = (o) => {
    const types = JSON.parse(o.project_types).map((t) => OFFSET_PROJECTS.find((p) => p.id === t)?.name || t);
    const failed = o.status === "payment_failed";
    const idx = STAGE_INDEX[o.stage] ?? 0;
    const cardText = store.get().offsetCards?.[o.id] || "your card";
    view.innerHTML = String(html`
      <section class="card">
        <header class="card-head"><h2 class="card-title">${kg(o.amount_co2_kg)} of CO₂-e, ${aud(o.price_aud)}</h2><span class="pill ${o.status === "certified" ? "ok" : failed ? "error" : "warn"}">${o.status === "certified" ? "Certified" : failed ? "Cancelled" : "In progress"}</span></header>
        <p class="muted">${types.join(", ")}. Ordered ${dateTime(sqlDate(o.created_at))}, paying with ${cardText}.</p>
        ${raw(String(stepper(STAGES, idx, failed ? 2 : -1)))}
        ${!failed && o.status !== "certified" && o.retry_count > 0 ? html`<p class="notice warn">Your bank declined the payment ${o.retry_count === 1 ? "once" : `${o.retry_count} times`}. We're retrying automatically.</p>` : ""}
        ${!failed && o.status !== "certified" ? html`<p class="muted small">This usually takes under a minute. You can leave this page; we'll notify you when the certificate is issued.</p>` : ""}
        ${failed ? html`<p class="notice error">Your card was declined ${o.retry_count + 1} times, so the order was cancelled. You haven't been charged.</p>
          <div class="row-btns"><a class="btn primary" href="#/footprint/offset">Try with another card</a></div>` : ""}
      </section>
      ${o.status === "certified" ? html`
        <section class="certificate" aria-label="Offset certificate">
          <p class="cert-kicker">Certificate of carbon credit retirement</p>
          <h2>${kg(o.amount_co2_kg)} CO₂-e</h2>
          <p>retired on behalf of <strong>${profile.name}</strong></p>
          <dl>
            <div><dt>Projects</dt><dd>${types.join(", ")}</dd></div>
            <div><dt>Registry serials</dt><dd>${o.retired_serials}</dd></div>
            <div><dt>Certificate</dt><dd class="small">${o.certificate_id}</dd></div>
            <div><dt>Issued</dt><dd>${dayLong(sqlDate(o.updated_at))}</dd></div>
          </dl>
          <p class="cert-foot">GovEnvironment Agency, Verified Carbon Registry</p>
        </section>
        <div class="row-btns"><button class="btn" id="dlCert">${icon("download")}Download certificate</button><a class="btn primary" href="#/footprint">See my footprint</a></div>` : ""}`);
    $("#dlCert")?.addEventListener("click", () => download(`offset-certificate-${o.certificate_id.slice(0, 8)}.svg`, certificateSvg(o, types, profile.name), "image/svg+xml"));
  };
  while (!done && !ctx.stale()) {
    const r = await api("GET", `/api/offsets/${id}`);
    if (!r.ok) { view.innerHTML = String(html`<section class="empty-state"><h2>Order not found</h2><a class="btn" href="#/footprint">My footprint</a></section>`); return; }
    if (ctx.stale()) return;
    draw(r.data);
    done = r.data.status === "certified" || r.data.status === "payment_failed";
    if (!done) await sleep(800);
  }
}

function certificateSvg(o, types, name) {
  const e = esc;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700">
<rect width="1000" height="700" fill="#f7faf8"/><rect x="24" y="24" width="952" height="652" fill="none" stroke="#165d47" stroke-width="3"/>
<text x="500" y="130" font-family="Georgia, serif" font-size="26" text-anchor="middle" fill="#4a5b53">Certificate of carbon credit retirement</text>
<text x="500" y="250" font-family="Georgia, serif" font-size="84" text-anchor="middle" fill="#13261e">${e(Math.round(o.amount_co2_kg).toLocaleString("en-AU"))} kg CO2-e</text>
<text x="500" y="320" font-family="Arial, sans-serif" font-size="24" text-anchor="middle" fill="#13261e">retired on behalf of ${e(name)}</text>
<text x="500" y="410" font-family="Arial, sans-serif" font-size="20" text-anchor="middle" fill="#4a5b53">Projects: ${e(types.join(", "))}</text>
<text x="500" y="450" font-family="Arial, sans-serif" font-size="20" text-anchor="middle" fill="#4a5b53">Registry serials: ${e(o.retired_serials)}</text>
<text x="500" y="490" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" fill="#7a8a82">Certificate ${e(o.certificate_id)}, issued ${e(sqlDate(o.updated_at).toLocaleDateString("en-AU"))}</text>
<text x="500" y="610" font-family="Arial, sans-serif" font-size="18" text-anchor="middle" fill="#165d47">GovEnvironment Agency, Verified Carbon Registry (via NetZero Hub)</text></svg>`;
}
