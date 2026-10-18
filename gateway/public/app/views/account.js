// Account: rewards (incentives for sustainable actions), wallet, profile and notifications.
import { html, raw, $, on, store, icon, toast, dialog, dialogData, notify, awardPoints, pointsBalance, num, day, dateTime, ago, uid, rerender } from "../lib.js";
import { REWARDS, SUBURBS, VEHICLES, PASS_TYPES } from "../data.js";

// ------------------------------------------------------------------ rewards
export async function rewards(view, _p, ctx) {
  ctx.title("Rewards");
  const s = store.get();
  const bal = pointsBalance();
  view.innerHTML = String(html`
    <section class="card points-hero">
      <div><p class="muted">Your green points</p><p class="points-big">${num(bal)}</p>
        <p class="muted small">Earn points every time you choose a lower-carbon option through NetZero Hub.</p></div>
      <ul class="earn">
        <li>${icon("route")}Low-carbon trip: 10 points per kg saved</li>
        <li>${icon("plug")}EV charging session: 20</li>
        <li>${icon("tree")}Offset: 1 point per 10 kg</li>
        <li>${icon("sun")}Renewable energy plan: 100</li>
        <li>${icon("people")}Event or volunteering: 25 to 40</li>
      </ul>
    </section>
    <section>
      <h3 class="section-title">Rewards</h3>
      <div class="reward-grid">${REWARDS.map((r) => html`<article class="card reward">
        <h4>${r.name}</h4><p class="muted">${r.body}</p>
        <div class="reward-foot"><span class="pill sun">${num(r.cost)} points</span>
          <button class="btn ${bal >= r.cost ? "primary" : ""}" data-act="redeem" data-id="${r.id}" ${bal >= r.cost ? "" : raw("disabled")}>${bal >= r.cost ? "Redeem" : `${num(r.cost - bal)} to go`}</button></div></article>`)}</div>
    </section>
    ${s.vouchers.length ? html`<section class="card"><h3>Your vouchers</h3><ul class="list">${s.vouchers.map((v) => html`<li><span class="tile sun">${icon("gift")}</span><span><strong>${v.name}</strong><span class="muted">Code ${v.code}, redeemed ${day(v.ts)}</span></span></li>`)}</ul></section>` : ""}
    <section class="card"><h3>Points history</h3>
      ${s.points.length ? html`<ul class="ledger">${s.points.slice(0, 20).map((p) => html`<li><span>${p.reason}</span><time class="muted">${ago(p.ts)}</time><strong class="${p.delta < 0 ? "neg" : ""}">${p.delta > 0 ? "+" : ""}${num(p.delta)}</strong></li>`)}</ul>` : html`<p class="muted">No points yet.</p>`}</section>`);
  on(view, "click", "[data-act=redeem]", async (_e, b) => {
    const r = REWARDS.find((x) => x.id === b.dataset.id);
    const ok = await dialog({ title: `Redeem ${r.name}?`, body: `This uses ${num(r.cost)} of your ${num(pointsBalance())} points.`, actions: [{ label: "Cancel", value: null }, { label: "Redeem", value: "yes", primary: true }] });
    if (ok !== "yes") return;
    const code = uid("NZ-");
    store.update((s) => {
      s.vouchers.unshift({ id: r.id, name: r.name, code, ts: Date.now() });
      if (r.id === "daypass") {
        const t = PASS_TYPES[0], now = Date.now();
        s.passes.unshift({ id: uid("P"), code: uid("ET-"), type: t.id, name: t.name, price: 0, concession: false, issued: now, expires: now + t.hours * 3600000 });
      }
    });
    awardPoints(-r.cost, `Redeemed ${r.name.toLowerCase()}`);
    notify(`${r.name} redeemed`, r.id === "daypass" ? "Your free day pass is in Transit passes." : `Voucher code ${code}.`, r.id === "daypass" ? "#/travel/pass" : "#/rewards", "success");
    rerender();
  });
}

// ------------------------------------------------------------------ wallet
// Test card numbers mirror the platform payment gateway's behaviour.
const TEST_CARDS = { "4000000000000002": "tok_decline_all", "4000000000000341": "tok_decline_1" };
const luhn = (n) => n.split("").reverse().map(Number).reduce((s, d, i) => s + (i % 2 ? ((d *= 2) > 9 ? d - 9 : d) : d), 0) % 10 === 0;

export async function wallet(view, _p, ctx) {
  ctx.title("Wallet");
  const w = store.get().wallet;
  view.innerHTML = String(html`
    <section>
      <header class="section-head"><h3>Payment cards</h3><button class="btn" data-act="add">${icon("plus")}Add a card</button></header>
      <div class="wallet">${w.map((c) => html`<article class="pay-card ${c.brand.toLowerCase()}">
        <span class="brand-name">${c.brand}</span><span class="pan">•••• •••• •••• ${c.last4}</span>
        <span class="label">${c.label}${c.isDefault ? " (default)" : ""}</span>
        <div class="pay-actions">${c.isDefault ? "" : html`<button class="btn subtle" data-act="default" data-id="${c.id}">Make default</button>`}<button class="btn subtle" data-act="remove" data-id="${c.id}">Remove</button></div></article>`)}</div>
      ${w.length ? "" : html`<p class="muted">No cards yet. Add one to pay for charging, offsets and passes.</p>`}
      <p class="muted small">Cards are used by NetZero Hub services through each provider's payment gateway. This is a demonstration wallet: don't add a real card.</p>
    </section>`);
  on(view, "click", "[data-act=default]", (_e, b) => { store.update((s) => s.wallet.forEach((c) => { c.isDefault = c.id === b.dataset.id; })); rerender(); });
  on(view, "click", "[data-act=remove]", async (_e, b) => {
    const ok = await dialog({ title: "Remove this card?", body: "You can add it again later.", actions: [{ label: "Keep", value: null }, { label: "Remove", value: "yes", danger: true }] });
    if (ok !== "yes") return;
    store.update((s) => { s.wallet = s.wallet.filter((c) => c.id !== b.dataset.id); if (s.wallet.length && !s.wallet.some((c) => c.isDefault)) s.wallet[0].isDefault = true; });
    rerender();
  });
  on(view, "click", "[data-act=add]", async () => {
    const ok = await dialog({
      title: "Add a card",
      body: String(html`<div class="form-grid">
        <label>Card number<input name="pan" inputmode="numeric" autocomplete="off" placeholder="4242 4242 4242 4242" required></label>
        <label>Expiry (MM/YY)<input name="exp" autocomplete="off" placeholder="08/29" required></label>
        <label>Name for this card<input name="label" placeholder="e.g. Work card"></label></div>
        <p class="muted small">Demonstration only. Test numbers: 4242 4242 4242 4242 always approves, 4000 0000 0000 0341 is declined once then approved, 4000 0000 0000 0002 is always declined.</p>`),
      actions: [{ label: "Cancel", value: null }, { label: "Add card", value: "add", primary: true }],
    });
    if (ok !== "add") return;
    const d = dialogData();
    const pan = String(d.pan || "").replace(/\s|-/g, "");
    const [mm, yy] = String(d.exp || "").split("/").map((x) => Number(x));
    if (!/^\d{13,19}$/.test(pan) || !luhn(pan)) { toast("That card number isn't valid. Check it and try again.", "error"); return; }
    if (!(mm >= 1 && mm <= 12) || new Date(2000 + yy, mm, 1) < new Date()) { toast("That card has expired or the expiry date isn't valid.", "error"); return; }
    const brand = pan.startsWith("4") ? "Visa" : /^5[1-5]|^2[2-7]/.test(pan) ? "Mastercard" : /^3[47]/.test(pan) ? "Amex" : "Card";
    store.update((s) => s.wallet.push({ id: uid("C"), brand, label: String(d.label || "").trim() || brand, last4: pan.slice(-4), token: TEST_CARDS[pan] || "tok_ok", isDefault: !s.wallet.length }));
    toast(`${brand} ending ${pan.slice(-4)} added`, "success");
    rerender();
  });
}

// ------------------------------------------------------------------ profile
export async function profile(view, _p, ctx) {
  ctx.title("Profile");
  const p = store.get().profile;
  view.innerHTML = String(html`
    <section class="card">
      <h2 class="card-title">Your details</h2>
      <form id="pf" class="form-grid">
        <label>Full name<input name="name" id="pf-name" value="${p.name}" required></label>
        <label>Email<input name="email" id="pf-email" type="email" value="${p.email}"></label>
        <label>Suburb<select name="suburb" id="pf-suburb">${SUBURBS.map((s) => html`<option value="${s.name}" ${s.name === p.suburb ? raw("selected") : ""}>${s.name} ${s.postcode}</option>`)}</select></label>
        <label>Electric vehicle<select name="vehicle" id="pf-vehicle"><option value="">I don't drive an EV</option>${VEHICLES.map((v) => html`<option value="${v.id}" ${v.id === p.vehicle ? raw("selected") : ""}>${v.name} (${v.plug})</option>`)}</select></label>
        <button class="btn primary" type="submit">Save changes</button>
      </form>
      <p class="muted small">Member since ${day(p.since)}. Your citizen ID is ${p.id}.</p>
    </section>
    <section class="card">
      <h3>Sign out</h3>
      <p class="muted">Signing out removes your profile, wallet and points from this device. Bookings and certificates stay with the providers.</p>
      <button class="btn danger" id="signout">${icon("logout")}Sign out and clear this device</button>
    </section>`);
  $("#pf").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const sub = SUBURBS.find((s) => s.name === f.get("suburb"));
    store.update((s) => Object.assign(s.profile, { name: String(f.get("name")).trim() || s.profile.name, email: String(f.get("email")), suburb: sub.name, postcode: sub.postcode, vehicle: String(f.get("vehicle")) }));
    toast("Changes saved", "success");
    document.querySelector(".avatar").textContent = store.get().profile.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  });
  $("#signout").addEventListener("click", async () => {
    const ok = await dialog({ title: "Sign out?", body: "Your profile, wallet and points on this device will be removed.", actions: [{ label: "Stay signed in", value: null }, { label: "Sign out", value: "yes", danger: true }] });
    if (ok !== "yes") return;
    store.reset();
    location.hash = "#/home";
    location.reload();
  });
}

// ------------------------------------------------------------------ notifications
export async function activity(view, _p, ctx) {
  ctx.title("Notifications");
  const list = store.get().notifications;
  view.innerHTML = String(html`
    <section class="card">
      <header class="card-head"><h2 class="card-title">Notifications</h2>${list.some((n) => !n.read) ? html`<button class="btn subtle" id="readAll">Mark all as read</button>` : ""}</header>
      ${list.length ? html`<ul class="feed">${list.map((n) => html`<li class="${n.kind} ${n.read ? "" : "unread"}"><a href="${n.link || "#/activity"}" data-nid="${n.id}"><strong>${n.title}</strong><span class="muted">${n.body}</span></a><time>${ago(n.ts)}</time></li>`)}</ul>`
      : html`<p class="muted">You're all caught up.</p>`}
    </section>`);
  $("#readAll")?.addEventListener("click", () => { store.update((s) => s.notifications.forEach((n) => { n.read = true; })); rerender(); });
  on(view, "click", "[data-nid]", (_e, a) => store.update((s) => { const n = s.notifications.find((x) => x.id === a.dataset.nid); if (n) n.read = true; }));
}
