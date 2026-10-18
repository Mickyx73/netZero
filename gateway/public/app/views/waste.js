// GreenWaste Solutions (simulated provider): 4.1 e-waste pickup (Part B
// Process 5: service-area check, item limits, route assignment),
// 4.2 recycling sorting guide, 4.3 compost bin request.
import { html, raw, $, $$, on, store, icon, toast, notify, awardPoints, num, day, dayLong, uid, stepper, sleep, rerender } from "../lib.js";
import { WOLLONGONG_POSTCODES, EWASTE_ITEMS, SORTING_GUIDE, BINS } from "../data.js";

function subnav(active) {
  return html`<nav class="subnav" aria-label="Waste services">
    <a href="#/waste" class="${active === "home" ? "active" : ""}">My bookings</a>
    <a href="#/waste/ewaste" class="${active === "ewaste" ? "active" : ""}">E-waste pickup</a>
    <a href="#/waste/guide" class="${active === "guide" ? "active" : ""}">Which bin?</a>
    <a href="#/waste/compost" class="${active === "compost" ? "active" : ""}">Compost bin</a></nav>`;
}

/** Next collection days: GreenWaste trucks run Tuesdays and Thursdays, from 2 days out. */
function collectionDays(n = 6) {
  const out = [], d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 2);
  while (out.length < n) { if (d.getDay() === 2 || d.getDay() === 4) out.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return out;
}

export async function overview(view, _p, ctx) {
  ctx.title("Waste and recycling");
  const s = store.get();
  const upcoming = s.ewaste.filter((b) => b.date >= Date.now() - 86400000);
  view.innerHTML = String(html`
    ${subnav("home")}
    <div class="grid-2">
      <a class="card link-card" href="#/waste/ewaste">${icon("recycle", "big")}<strong>Book an e-waste pickup</strong><span class="muted">Free kerbside collection for TVs, computers, phones and batteries</span></a>
      <a class="card link-card" href="#/waste/guide">${icon("search", "big")}<strong>Which bin does it go in?</strong><span class="muted">Type an item or add a photo</span></a>
      <a class="card link-card" href="#/waste/compost">${icon("sprout", "big")}<strong>Request a compost bin</strong><span class="muted">${s.compost.length ? `Delivery ${day(s.compost[0].delivery)}` : "Turn food scraps into garden soil"}</span></a>
    </div>
    <section class="card">
      <h3>Your pickups</h3>
      ${upcoming.length ? html`<ul class="list">${upcoming.map((b) => html`<li><span class="tile waste">${icon("recycle")}</span>
        <span><strong>${dayLong(b.date)}, 7 am to 3 pm</strong><span class="muted">${b.items.map((i) => `${i.qty} ${i.name.toLowerCase()}`).join(", ")}</span><span class="small">Booking ${b.ref}, ${b.address}</span></span>
        <button class="btn" data-act="cancel" data-ref="${b.ref}">Cancel</button></li>`)}</ul>`
      : html`<p class="muted">No pickups booked.</p>`}
    </section>`);
  on(view, "click", "[data-act=cancel]", (_e, b) => {
    store.update((st) => { st.ewaste = st.ewaste.filter((x) => x.ref !== b.dataset.ref); });
    toast("Pickup cancelled");
    rerender();
  });
}

// ------------------------------------------------------------------ 4.1 e-waste (Process 5)
export async function ewaste(view, _p, ctx) {
  ctx.title("E-waste pickup", "#/waste");
  const p = store.get().profile;
  const days = collectionDays();
  view.innerHTML = String(html`
    ${subnav("ewaste")}
    <form id="ewForm" class="stack">
      <section class="card">
        <h2 class="card-title">Where should we collect from?</h2>
        <div class="form-grid">
          <label>Street address<input name="addr" id="ew-addr" required placeholder="e.g. 14 Smith St" autocomplete="street-address"></label>
          <label>Postcode<input name="pc" id="ew-pc" required inputmode="numeric" value="${p.postcode}"></label>
        </div>
      </section>
      <section class="card">
        <h2 class="card-title">What are you putting out?</h2>
        <ul class="qty-list">${EWASTE_ITEMS.map((it) => html`<li>
          <label for="q-${it.id}"><strong>${it.name}</strong><span class="muted small">${it.max ? `Up to ${it.max} ${it.unit === "kg" ? "kg" : it.max === 1 ? "item" : "items"}` : it.note}</span></label>
          <input type="number" id="q-${it.id}" name="${it.id}" min="0" step="1" value="0" inputmode="numeric"></li>`)}</ul>
      </section>
      <section class="card">
        <h2 class="card-title">Pick a collection day</h2>
        <div class="day-chips">${days.map((d, i) => html`<label class="chip"><input type="radio" name="date" value="${d.getTime()}" ${i === 0 ? raw("checked") : ""}><span>${day(d)}</span></label>`)}</div>
        <p class="muted small">Put items on the kerb the night before. Trucks collect between 7 am and 3 pm.</p>
        <div id="ewMsg"></div>
        <button class="btn primary" type="submit">Book pickup</button>
      </section>
    </form>`);
  $("#ewForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = $("#ewMsg");
    const btn = e.target.querySelector("button[type=submit]");
    const steps = ["Address checked", "Items checked", "Added to a truck route", "Confirmed"];
    const items = EWASTE_ITEMS.map((it) => ({ ...it, qty: Number(f.get(it.id)) || 0 })).filter((it) => it.qty > 0);
    btn.disabled = true;
    msg.innerHTML = String(stepper(steps, 0));
    await sleep(600);
    // 5.2-5.4: service-area check with the council registry
    if (!WOLLONGONG_POSTCODES.includes(String(f.get("pc")).trim())) {
      msg.innerHTML = String(html`${stepper(steps, 0, 0)}<p class="notice error">We don't collect in postcode ${f.get("pc")}. GreenWaste covers the Wollongong council area; other councils run their own e-waste days.</p>`);
      btn.disabled = false; return;
    }
    msg.innerHTML = String(stepper(steps, 1)); await sleep(600);
    // 5.5-5.6: items against accepted categories and limits; non-compliant -> back to the resident
    if (!items.length) { msg.innerHTML = String(html`${stepper(steps, 1, 1)}<p class="notice error">Add at least one item to collect.</p>`); btn.disabled = false; return; }
    const problems = items.filter((it) => it.qty > it.max).map((it) => it.max === 0 ? `${it.name}: ${it.note.toLowerCase()}.` : `${it.name}: the limit is ${it.max}${it.unit === "kg" ? " kg" : ""}, you entered ${it.qty}.`);
    if (problems.length) {
      msg.innerHTML = String(html`${stepper(steps, 1, 1)}<div class="notice error"><strong>Some items can't be collected. Change them and book again:</strong><ul>${problems.map((x) => html`<li>${x}</li>`)}</ul></div>`);
      btn.disabled = false; return;
    }
    msg.innerHTML = String(stepper(steps, 2)); await sleep(700);
    const booking = { ref: uid("EW-"), address: String(f.get("addr")), postcode: String(f.get("pc")), date: Number(f.get("date")), items: items.map(({ name, qty }) => ({ name, qty })), truck: `Route ${1 + Math.floor(Math.random() * 6)}` };
    store.update((s) => s.ewaste.unshift(booking));
    awardPoints(30, "Booked an e-waste pickup");
    notify("E-waste pickup booked", `${dayLong(booking.date)}, 7 am to 3 pm. Booking ${booking.ref}.`, "#/waste", "success");
    view.innerHTML = String(html`${subnav("ewaste")}<section class="card success-card">${stepper(steps, 4)}
      <h2>Pickup booked for ${dayLong(booking.date)}</h2>
      <p>Booking <strong>${booking.ref}</strong>, ${booking.truck}. Put these out on the kerb at ${booking.address} the night before:</p>
      <ul class="checklist">${booking.items.map((i) => html`<li>${icon("check")}${i.qty} × ${i.name}</li>`)}</ul>
      <p class="muted small">Tape battery terminals and put batteries in a clear bag. Wipe personal data from computers and phones.</p>
      <div class="row-btns"><a class="btn primary" href="#/waste">Done</a></div></section>`);
  });
}

// ------------------------------------------------------------------ 4.2 sorting guide
function classify(text) {
  const t = text.toLowerCase();
  let best = null, score = 0;
  for (const g of SORTING_GUIDE) for (const k of g.keys) {
    if (t.includes(k) && k.length > score) { best = g; score = k.length; }
  }
  return best;
}

export async function guide(view, _p, ctx) {
  ctx.title("Which bin?", "#/waste");
  view.innerHTML = String(html`
    ${subnav("guide")}
    <section class="card">
      <h2 class="card-title">What are you throwing out?</h2>
      <form id="gForm" class="search-row">
        <label class="sr" for="gQ">Item</label>
        <input id="gQ" type="search" placeholder="e.g. pizza box, AA batteries, coffee cup" autocomplete="off">
        <button class="btn primary" type="submit">Check</button>
      </form>
      <label class="file-pick">${icon("plus")}<span>Or add a photo of it</span><input type="file" id="gPhoto" accept="image/*"></label>
      <p class="muted small">Try: ${["pizza box", "batteries", "coffee cup", "glass jar", "old laptop", "grass clippings"].map((x, i) => html`${i ? ", " : ""}<button class="linklike" data-q="${x}">${x}</button>`)}</p>
    </section>
    <div id="gOut"></div>`);
  const answer = async (text, fromPhoto) => {
    const out = $("#gOut");
    out.innerHTML = `<div class="loading"><span class="spinner"></span><span>${fromPhoto ? "Looking at your photo…" : "Checking…"}</span></div>`;
    await sleep(fromPhoto ? 1100 : 350);
    const g = classify(text);
    if (!g) {
      out.innerHTML = String(html`<section class="card"><h3>We're not sure about "${text}"</h3><p>Try a simpler name, like "plastic bottle" or "battery". If in doubt, the red general waste bin is the safe choice, except for batteries and electronics, which must never go in any bin.</p></section>`);
      return;
    }
    const bin = BINS[g.bin];
    const confidence = 88 + Math.round((text.length % 10) * 1.1);
    out.innerHTML = String(html`<section class="card bin-answer" style="--bin:${bin.colour}">
      <span class="bin-swatch" aria-hidden="true"></span>
      <div><p class="muted">${g.item}${fromPhoto ? `, identified from your photo (${confidence}% match)` : ""}</p>
        <h3>${bin.name}</h3><p>${g.note}.</p>
        ${g.bin === "dropoff" && /battery|batteries|electronic/i.test(g.item) ? html`<a class="btn" href="#/waste/ewaste">Book an e-waste pickup</a>` : ""}</div></section>`);
  };
  $("#gForm").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#gQ").value.trim(); if (q) answer(q, false); });
  on(view, "click", "[data-q]", (_e, b) => { $("#gQ").value = b.dataset.q; answer(b.dataset.q, false); });
  $("#gPhoto").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // The demo classifier reads the photo's file name (e.g. "pizza-box.jpg") plus anything typed.
    const hint = `${file.name.replace(/[-_.]/g, " ")} ${$("#gQ").value}`;
    answer(hint, true);
  });
}

// ------------------------------------------------------------------ 4.3 compost bin
export async function compost(view, _p, ctx) {
  ctx.title("Compost bin", "#/waste");
  const p = store.get().profile;
  view.innerHTML = String(html`
    ${subnav("compost")}
    <section class="card">
      <h2 class="card-title">Request a compost bin</h2>
      <p class="muted">Free for Wollongong households, one per address.</p>
      <form id="cForm" class="form-grid">
        <label>Delivery address<input name="addr" id="cb-addr" required autocomplete="street-address"></label>
        <label>Postcode<input name="pc" id="cb-pc" required value="${p.postcode}" inputmode="numeric"></label>
        <fieldset class="choice-grid wide"><legend>Bin size</legend>
          ${[["140", "140 litres", "1 to 2 people"], ["240", "240 litres", "3 or more people, or a big garden"]].map(([v, n, d], i) => html`<label class="choice"><input type="radio" name="size" value="${v}" ${i ? "" : raw("checked")}><span><strong>${n}</strong><span class="muted">${d}</span></span></label>`)}</fieldset>
        <p class="notice error wide" id="cErr" hidden></p>
        <button class="btn primary" type="submit">Request bin</button>
      </form>
    </section>`);
  $("#cForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = $("#cErr");
    if (!WOLLONGONG_POSTCODES.includes(String(f.get("pc")).trim())) { err.hidden = false; err.textContent = "Compost bins are only available for addresses in the Wollongong council area."; return; }
    if (store.get().compost.some((c) => c.address.toLowerCase() === String(f.get("addr")).trim().toLowerCase())) { err.hidden = false; err.textContent = "This address already has a compost bin on its way."; return; }
    e.target.querySelector("button").disabled = true;
    await sleep(600);
    const d = new Date(); let added = 0;
    while (added < 5) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) added++; } // 5 business days
    const req = { ref: uid("CB-"), address: String(f.get("addr")).trim(), size: String(f.get("size")), delivery: d.getTime() };
    store.update((s) => s.compost.unshift(req));
    awardPoints(15, "Requested a compost bin");
    notify("Compost bin on its way", `${req.size}-litre bin arriving ${dayLong(req.delivery)}.`, "#/waste", "success");
    view.innerHTML = String(html`${subnav("compost")}<section class="card success-card">${icon("sprout", "big")}
      <h2>Your ${req.size}-litre bin arrives ${dayLong(req.delivery)}</h2>
      <p>Request <strong>${req.ref}</strong>. It comes with a kitchen caddy and a guide to what can go in.</p>
      <a class="btn primary" href="#/waste">Done</a></section>`);
  });
}
