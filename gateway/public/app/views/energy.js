// GreenEnergy Co. (simulated provider): 1.1 renewable plan subscription,
// 1.2 solar feasibility, 1.3 smart-meter analytics, 1.4 solar buy-back.
// Flows follow Part B Processes 1 and 2 (validation checks, then approval).
import { html, raw, $, on, api, store, icon, toast, notify, awardPoints, num, aud, kg, day, dateTime, uid, seeded, cardPicker, cardById, defaultCard, simulatePayment, stepper, sleep, rerender } from "../lib.js";
import { ENERGY_PLANS, GRID_KG_PER_KWH, FEED_IN_C_PER_KWH, WOLLONGONG_POSTCODES } from "../data.js";

function subnav(active) {
  return html`<nav class="subnav" aria-label="Energy services">
    <a href="#/energy" class="${active === "home" ? "active" : ""}">My energy</a>
    <a href="#/energy/plans" class="${active === "plans" ? "active" : ""}">Renewable plans</a>
    <a href="#/energy/solar" class="${active === "solar" ? "active" : ""}">Solar check</a>
    <a href="#/energy/meter" class="${active === "meter" ? "active" : ""}">Usage insights</a>
    <a href="#/energy/buyback" class="${active === "buyback" ? "active" : ""}">Sell solar</a></nav>`;
}

async function usageKwhMonth() {
  const r = await api("GET", `/api/footprint/${encodeURIComponent(store.get().profile.id)}`).catch(() => null);
  return r?.ok ? r.data.energy_kwh_month : 400;
}

// ------------------------------------------------------------------ overview
export async function overview(view, _p, ctx) {
  ctx.title("Energy");
  const s = store.get();
  const plan = s.energyPlans.find((p) => p.status === "active");
  const sell = s.buyback.find((b) => b.status === "active");
  view.innerHTML = String(html`
    ${subnav("home")}
    <section class="card energy-card">
      ${plan ? html`<header class="card-head"><h2 class="card-title">${plan.name}</h2><span class="pill ok">Active</span></header>
        <p>Contract ${plan.contractId} since ${day(plan.since)}. ${Math.round(plan.greenShare * 100)}% of your power is matched with renewables.</p>
        <p class="stat-line"><strong>${kg(plan.savingKgYear)}</strong> <span class="muted">less CO₂-e a year than standard grid power</span></p>
        <div class="row-btns"><button class="btn" data-act="end">End plan</button></div>`
      : html`<h2 class="card-title">You're on standard grid power</h2>
        <p class="muted">Grid electricity in NSW emits about ${GRID_KG_PER_KWH} kg of CO₂-e per kWh. A renewable plan is the fastest way to cut your home's footprint.</p>
        <a class="btn primary" href="#/energy/plans">Compare renewable plans</a>`}
    </section>
    <div class="grid-2">
      <a class="card link-card" href="#/energy/solar">${icon("sun", "big")}<strong>Could solar work for you?</strong><span class="muted">${s.solarReports.length ? `Last check: ${num(s.solarReports[0].kw, 1)} kW system, pays back in ${num(s.solarReports[0].paybackYears, 1)} years` : "Get a yield and payback estimate"}</span></a>
      <a class="card link-card" href="#/energy/buyback">${icon("zap", "big")}<strong>${sell ? "Selling solar back to the grid" : "Sell your solar back"}</strong><span class="muted">${sell ? `Agreement ${sell.agreementId}, ${FEED_IN_C_PER_KWH}c per kWh exported` : "Register your system for a feed-in tariff"}</span></a>
      <a class="card link-card" href="#/energy/meter">${icon("chart", "big")}<strong>Usage insights</strong><span class="muted">Daily use and peak alerts from your smart meter</span></a>
    </div>`);
  on(view, "click", "[data-act=end]", async () => {
    store.update((st) => { const p = st.energyPlans.find((x) => x.status === "active"); if (p) p.status = "ended"; });
    toast("Plan ended. You'll move to standard grid power from your next bill.");
    rerender();
  });
}

// ------------------------------------------------------------------ 1.1 plans
export async function plans(view, _p, ctx) {
  ctx.title("Renewable plans", "#/energy");
  const usage = await usageKwhMonth();
  if (ctx.stale()) return;
  const p = store.get().profile;
  const active = store.get().energyPlans.find((x) => x.status === "active");
  let chosen = ENERGY_PLANS[0].id;
  const draw = () => {
    view.innerHTML = String(html`
      ${subnav("plans")}
      ${active ? html`<p class="notice info">You're on ${active.name}. Choosing another plan replaces it.</p>` : ""}
      <section class="plan-grid">${ENERGY_PLANS.map((pl) => {
        const bill = (usage * 3 * pl.cPerKwh) / 100 + pl.supplyPerDay * 91;
        const save = Math.round(usage * 12 * GRID_KG_PER_KWH * pl.greenShare);
        return html`<label class="plan card ${pl.id === chosen ? "on" : ""}"><input type="radio" name="plan" value="${pl.id}" ${pl.id === chosen ? raw("checked") : ""}>
          <strong>${pl.name}</strong><span class="muted">${pl.summary}</span>
          <span class="plan-price">${num(pl.cPerKwh, 1)}c <span class="muted">per kWh</span></span>
          <span class="small">About ${aud(bill)} a quarter at your usage of ${num(usage)} kWh a month</span>
          <span class="pill ok">${kg(save)} less CO₂-e a year</span></label>`;
      })}</section>
      <section class="card">
        <h2 class="card-title">Your details</h2>
        <form id="planForm" class="form-grid">
          <label>Supply address<input name="addr" id="pl-addr" required placeholder="Street address" autocomplete="street-address"></label>
          <label>Postcode<input name="pc" id="pl-pc" required inputmode="numeric" pattern="\\d{4}" value="${p.postcode}"></label>
          <label>Monthly usage (kWh)<input name="kwh" id="pl-kwh" type="number" min="50" value="${usage}"></label>
          ${cardPicker("card")}
          <p class="notice error" id="planErr" hidden></p>
          <button class="btn primary" type="submit">Switch to ${ENERGY_PLANS.find((x) => x.id === chosen).name}</button>
        </form>
      </section>`);
    $("#planForm").addEventListener("submit", submit);
  };
  on(view, "change", "input[name=plan]", (e) => { chosen = e.target.value; const keep = new FormData($("#planForm")); draw(); ["addr", "pc", "kwh"].forEach((k) => { const el = $(`[name=${k}]`); if (keep.get(k)) el.value = keep.get(k); }); });
  const key = uid("PLAN");
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = $("#planErr");
    const btn = e.target.querySelector("button[type=submit]");
    const pl = ENERGY_PLANS.find((x) => x.id === chosen);
    btn.disabled = true; btn.textContent = "Checking your address…";
    await sleep(600);
    if (!/^2\d{3}$/.test(String(f.get("pc")))) { btn.disabled = false; btn.textContent = `Switch to ${pl.name}`; err.hidden = false; err.textContent = "GreenEnergy Co. supplies NSW addresses only (postcodes starting with 2)."; return; }
    btn.textContent = "Setting up direct debit…";
    const card = cardById(f.get("card")) || defaultCard();
    const pay = await simulatePayment(card, key);
    if (!pay.approved) { btn.disabled = false; btn.textContent = `Switch to ${pl.name}`; err.hidden = false; err.textContent = `${card.brand} ending ${card.last4} couldn't be verified for direct debit. Try again or use another card.`; return; }
    const usageNow = Number(f.get("kwh")) || usage;
    const contract = { id: uid("E"), contractId: `GE-${new Date().getFullYear()}-${uid().slice(0, 5)}`, planId: pl.id, name: pl.name, greenShare: pl.greenShare, since: Date.now(), address: String(f.get("addr")), status: "active", savingKgYear: Math.round(usageNow * 12 * GRID_KG_PER_KWH * pl.greenShare) };
    store.update((s) => { s.energyPlans.forEach((x) => { if (x.status === "active") x.status = "replaced"; }); s.energyPlans.unshift(contract); });
    awardPoints(100, "Switched to renewable power");
    notify(`Welcome to ${pl.name}`, `Contract ${contract.contractId}. You'll avoid about ${kg(contract.savingKgYear)} of CO₂-e a year.`, "#/energy", "success");
    view.innerHTML = String(html`${subnav("plans")}<section class="card success-card">${icon("check", "big")}
      <h2>You're switching to ${pl.name}</h2>
      <p>Contract <strong>${contract.contractId}</strong>. Your new plan starts from your next meter read, and you'll avoid about <strong>${kg(contract.savingKgYear)}</strong> of CO₂-e a year.</p>
      <div class="row-btns"><a class="btn primary" href="#/energy">Done</a></div></section>`);
  }
  draw();
}

// ------------------------------------------------------------------ 1.2 solar feasibility
export async function solar(view, _p, ctx) {
  ctx.title("Solar check", "#/energy");
  const p = store.get().profile;
  view.innerHTML = String(html`
    ${subnav("solar")}
    <section class="card">
      <h2 class="card-title">Could rooftop solar pay off for you?</h2>
      <form id="solarForm" class="form-grid">
        <label>Property address<input name="addr" id="so-addr" required placeholder="Street address"></label>
        <label>Postcode<input name="pc" id="so-pc" required value="${p.postcode}" inputmode="numeric"></label>
        <label>Average monthly power bill (AUD)<input name="bill" id="so-bill" type="number" min="20" value="160"></label>
        <label>Main roof faces<select name="dir" id="so-dir"><option value="1">North</option><option value="0.88">East or west</option><option value="0.7">South</option></select></label>
        <button class="btn primary" type="submit">Estimate my solar</button>
      </form>
    </section>
    <div id="solarOut"></div>`);
  $("#solarForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = $("#solarOut");
    out.innerHTML = `<div class="loading"><span class="spinner"></span><span>Checking roof angle and local sunshine…</span></div>`;
    await sleep(900);
    const bill = Number(f.get("bill")), factor = Number(f.get("dir"));
    const kw = Math.min(10, Math.max(3, Math.round((bill / 28) * 2) / 2));
    const yieldKwh = Math.round(kw * 1450 * factor); // Illawarra ~4 peak sun hours
    const cost = Math.round(kw * 1050);
    const selfUse = 0.45;
    const savings = yieldKwh * selfUse * 0.33 + yieldKwh * (1 - selfUse) * (FEED_IN_C_PER_KWH / 100);
    const payback = cost / savings;
    const co2 = Math.round(yieldKwh * GRID_KG_PER_KWH);
    const report = { id: uid("S"), ts: Date.now(), address: String(f.get("addr")), kw, yieldKwh, cost, savings, paybackYears: payback, co2 };
    store.update((s) => { s.solarReports.unshift(report); });
    out.innerHTML = String(html`<section class="card">
      <h3>Solar estimate for ${report.address}</h3>
      <div class="stat-grid">
        <div><span class="muted">Recommended system</span><strong>${num(kw, 1)} kW</strong></div>
        <div><span class="muted">Yearly generation</span><strong>${num(yieldKwh)} kWh</strong></div>
        <div><span class="muted">Installed cost after rebates</span><strong>${aud(cost)}</strong></div>
        <div><span class="muted">Savings a year</span><strong>${aud(savings)}</strong></div>
        <div><span class="muted">Pays for itself in</span><strong>${num(payback, 1)} years</strong></div>
        <div><span class="muted">CO₂-e avoided a year</span><strong>${kg(co2)}</strong></div>
      </div>
      <p class="muted small">Assumes you use 45% of what you generate at 33c per kWh and export the rest at ${FEED_IN_C_PER_KWH}c. ${factor < 1 ? "A north-facing roof would generate more." : ""}</p>
      <div class="row-btns"><a class="btn primary" href="#/energy/buyback">Already have solar? Sell it back</a></div></section>`);
  });
}

// ------------------------------------------------------------------ 1.3 smart meter
export async function meter(view, _p, ctx) {
  ctx.title("Usage insights", "#/energy");
  const p = store.get().profile;
  const meterId = `NMI 4103 ${String(Math.floor(seeded(p.id) * 900000) + 100000)}`;
  let days = 14;
  const draw = () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const base = 10 + seeded(p.id, 3) * 6;
    const series = Array.from({ length: days }, (_, i) => {
      const d = new Date(today.getTime() - (days - 1 - i) * 86400000);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      return { d, kwh: Math.round((base * (weekend ? 1.25 : 1) * (0.75 + seeded(p.id + d.toDateString()) * 0.6)) * 10) / 10 };
    });
    const avg = series.reduce((a, x) => a + x.kwh, 0) / series.length;
    const peaks = series.filter((x) => x.kwh > avg * 1.3);
    const max = Math.max(...series.map((x) => x.kwh)) * 1.1;
    const W = 640, H = 220, bw = (W - 40) / days;
    view.innerHTML = String(html`
      ${subnav("meter")}
      <section class="card">
        <header class="card-head"><h2 class="card-title">Daily electricity use</h2>
          <div class="seg" role="group" aria-label="Period">${[7, 14, 30].map((n) => html`<button class="${n === days ? "on" : ""}" data-act="days" data-n="${n}">${n} days</button>`)}</div></header>
        <p class="muted small">Smart meter ${meterId}, last ${days} days. Average ${num(avg, 1)} kWh a day.</p>
        <svg class="usage-chart" viewBox="0 0 ${W} ${H + 30}" role="img" aria-label="Daily kWh for the last ${days} days">
          <line x1="30" x2="${W}" y1="${H - (avg / max) * H}" y2="${H - (avg / max) * H}" class="avg-line"/>
          <text x="${W}" y="${H - (avg / max) * H - 6}" text-anchor="end" class="avg-label">average ${num(avg, 1)}</text>
          ${series.map((x, i) => html`<g><rect x="${30 + i * bw + 2}" y="${H - (x.kwh / max) * H}" width="${Math.max(2, bw - 4)}" height="${(x.kwh / max) * H}" rx="3" class="${x.kwh > avg * 1.3 ? "peak" : ""}"><title>${day(x.d)}: ${x.kwh} kWh</title></rect>
            ${days <= 14 || i % 5 === 0 ? html`<text x="${30 + i * bw + bw / 2}" y="${H + 18}" text-anchor="middle" class="tick">${x.d.getDate()}</text>` : ""}</g>`)}
        </svg>
      </section>
      <section class="card">
        <h3>${peaks.length ? `${peaks.length} high-use day${peaks.length > 1 ? "s" : ""}` : "No unusual days"}</h3>
        ${peaks.length ? html`<ul class="list">${peaks.map((x) => html`<li><span class="tile energy">${icon("zap")}</span><span><strong>${day(x.d)}: ${x.kwh} kWh</strong><span class="muted">${Math.round((x.kwh / avg - 1) * 100)}% above your average${x.d.getDay() % 6 === 0 ? ", a weekend" : ""}</span></span></li>`)}</ul>
          <p class="muted small">Heating, cooling and pool pumps are the usual causes. Running them between 10 am and 3 pm uses more of the day's solar on the grid.</p>`
        : html`<p class="muted">Your use has been steady.</p>`}
      </section>`);
  };
  on(view, "click", "[data-act=days]", (_e, b) => { days = Number(b.dataset.n); draw(); });
  draw();
}

// ------------------------------------------------------------------ 1.4 solar buy-back (Process 2)
export async function buyback(view, _p, ctx) {
  ctx.title("Sell solar back", "#/energy");
  const existing = store.get().buyback.find((b) => b.status === "active");
  if (existing) {
    view.innerHTML = String(html`${subnav("buyback")}<section class="card success-card">${icon("zap", "big")}
      <h2>You're selling solar to the grid</h2>
      <p>Agreement <strong>${existing.agreementId}</strong> since ${day(existing.since)}. You earn <strong>${FEED_IN_C_PER_KWH}c per kWh</strong> exported, up to ${existing.exportLimitKw} kW.</p>
      <p class="muted small">Inverter ${existing.inverterId}, ${existing.capacityKw} kW system.</p></section>`);
    return;
  }
  view.innerHTML = String(html`
    ${subnav("buyback")}
    <section class="card">
      <h2 class="card-title">Register for a solar feed-in tariff</h2>
      <p class="muted">You need a working solar system and a smart meter. Payments go to your bank account each quarter.</p>
      <form id="bbForm" class="form-grid">
        <label class="check wide"><input type="checkbox" name="hasSolar" required> I have an operating solar system and a smart meter</label>
        <label>Inverter serial number<input name="inv" id="bb-inv" required placeholder="e.g. SMA-3012-88412" autocomplete="off"></label>
        <label>System size (kW)<input name="cap" id="bb-cap" type="number" step="0.1" min="0.5" max="30" required value="6.6"></label>
        <label>BSB<input name="bsb" id="bb-bsb" required inputmode="numeric" placeholder="6 digits" autocomplete="off"></label>
        <label>Account number<input name="acct" id="bb-acct" required inputmode="numeric" placeholder="6 to 10 digits" autocomplete="off"></label>
        <p class="muted small wide">This is a demonstration service: don't enter real bank details.</p>
        <button class="btn primary" type="submit">Submit registration</button>
      </form>
    </section>
    <div id="bbOut"></div>`);
  const steps = ["Application received", "Inverter checked", "Bank details checked", "Network approval", "Agreement issued"];
  $("#bbForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = $("#bbOut");
    e.target.querySelector("button[type=submit]").disabled = true;
    const show = (i, failedAt = -1, msg = "") => { out.innerHTML = String(html`<section class="card">${raw(String(stepper(steps, i, failedAt)))}${msg ? html`<p class="notice error">${msg}</p>` : ""}</section>`); };
    const fail = (i, msg) => { show(i, i, msg); e.target.querySelector("button[type=submit]").disabled = false; };
    show(1); await sleep(800);
    if (!/^[A-Za-z]{2,5}-?\d{3,5}-?\d{3,6}$/.test(String(f.get("inv")).trim())) return fail(1, "That inverter serial doesn't match a registered model. Check the label on the inverter (for example SMA-3012-88412).");
    show(2); await sleep(800);
    if (!/^\d{3}-?\d{3}$/.test(String(f.get("bsb")).trim()) || !/^\d{6,10}$/.test(String(f.get("acct")).trim())) return fail(2, "The BSB must be 6 digits and the account number 6 to 10 digits.");
    show(3); await sleep(1000);
    const cap = Number(f.get("cap"));
    if (cap > 15) return fail(3, "Endeavour Energy only pre-approves systems up to 15 kW. Larger systems need a network connection study first.");
    const limit = cap <= 10 ? Math.min(cap, 5) : 10;
    const agreement = { id: uid("B"), agreementId: `FIT-${uid().slice(0, 6)}`, since: Date.now(), inverterId: String(f.get("inv")).trim(), capacityKw: cap, exportLimitKw: limit, status: "active" };
    store.update((s) => s.buyback.unshift(agreement));
    show(5);
    awardPoints(50, "Registered solar for buy-back");
    notify("Feed-in tariff approved", `Agreement ${agreement.agreementId}: ${FEED_IN_C_PER_KWH}c per kWh, export limit ${limit} kW.`, "#/energy/buyback", "success");
    out.insertAdjacentHTML("beforeend", String(html`<section class="card success-card"><h3>Approved</h3>
      <p>Agreement <strong>${agreement.agreementId}</strong>. You'll earn ${FEED_IN_C_PER_KWH}c for every kWh you export, up to ${limit} kW at a time.</p>
      <a class="btn primary" href="#/energy">Done</a></section>`));
  });
}
