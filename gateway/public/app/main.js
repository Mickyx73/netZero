// NetZero Hub citizen app — shell, routing, first-run setup and the
// background watcher that turns asynchronous service outcomes (an EV receipt,
// an offset certificate) into notifications.
import { html, raw, $, on, api, store, icon, toast, notify, awardPoints, pointsBalance, OfflineError, uid, aud, num, ago } from "./lib.js";
import { SUBURBS, VEHICLES } from "./data.js";

const qs = new URLSearchParams(location.search);
if (qs.get("device") === "phone") document.documentElement.classList.add("device-phone");

// route pattern -> [module, export, nav section]
const ROUTES = [
  [/^#?\/?(home)?$/, "home", "render", "home"],
  [/^#\/travel$/, "travel", "planner", "travel"],
  [/^#\/travel\/pass$/, "travel", "pass", "travel"],
  [/^#\/travel\/bikes$/, "travel", "bikes", "travel"],
  [/^#\/charge$/, "charge", "stations", "charge"],
  [/^#\/charge\/station\/([\w-]+)$/, "charge", "station", "charge"],
  [/^#\/charge\/bookings$/, "charge", "bookings", "charge"],
  [/^#\/charge\/session\/([\w-]+)$/, "charge", "session", "charge"],
  [/^#\/charge\/route$/, "charge", "route", "charge"],
  [/^#\/footprint$/, "footprint", "overview", "footprint"],
  [/^#\/footprint\/calc$/, "footprint", "calc", "footprint"],
  [/^#\/footprint\/offset$/, "footprint", "offset", "footprint"],
  [/^#\/footprint\/offset\/([\w-]+)$/, "footprint", "offsetStatus", "footprint"],
  [/^#\/business$/, "business", "render", "footprint"],
  [/^#\/energy$/, "energy", "overview", "energy"],
  [/^#\/energy\/plans$/, "energy", "plans", "energy"],
  [/^#\/energy\/solar$/, "energy", "solar", "energy"],
  [/^#\/energy\/meter$/, "energy", "meter", "energy"],
  [/^#\/energy\/buyback$/, "energy", "buyback", "energy"],
  [/^#\/waste$/, "waste", "overview", "waste"],
  [/^#\/waste\/ewaste$/, "waste", "ewaste", "waste"],
  [/^#\/waste\/guide$/, "waste", "guide", "waste"],
  [/^#\/waste\/compost$/, "waste", "compost", "waste"],
  [/^#\/community$/, "community", "overview", "community"],
  [/^#\/community\/events$/, "community", "events", "community"],
  [/^#\/community\/garden$/, "community", "garden", "community"],
  [/^#\/community\/volunteer$/, "community", "volunteer", "community"],
  [/^#\/rewards$/, "account", "rewards", "rewards"],
  [/^#\/wallet$/, "account", "wallet", "wallet"],
  [/^#\/profile$/, "account", "profile", "profile"],
  [/^#\/activity$/, "account", "activity", "activity"],
  [/^#\/services$/, "services", "render", "services"],
];

const NAV = [
  ["home", "#/home", "Home", "home"],
  ["travel", "#/travel", "Travel", "route"],
  ["charge", "#/charge", "Charging", "plug"],
  ["footprint", "#/footprint", "Footprint", "leaf"],
  ["energy", "#/energy", "Energy", "sun"],
  ["waste", "#/waste", "Waste", "recycle"],
  ["community", "#/community", "Community", "people"],
];
const NAV2 = [
  ["rewards", "#/rewards", "Rewards", "gift"],
  ["wallet", "#/wallet", "Wallet", "wallet"],
  ["profile", "#/profile", "Profile", "user"],
];
const TABS = [
  ["home", "#/home", "Home", "home"],
  ["travel", "#/travel", "Travel", "route"],
  ["charge", "#/charge", "Charge", "plug"],
  ["footprint", "#/footprint", "Footprint", "leaf"],
  ["services", "#/services", "More", "grid"],
];

const app = $("#app");

// ------------------------------------------------------------------ shell
function shell() {
  const s = store.get();
  const initials = (s.profile?.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  app.innerHTML = String(html`
    <a class="skip" href="#view">Skip to content</a>
    <div class="shell">
      <aside class="rail" aria-label="Main navigation">
        <a class="brand" href="#/home">${logo()}<span>NetZero Hub</span></a>
        <nav>${NAV.map(([k, h, l, i]) => html`<a data-nav="${k}" href="${h}">${icon(i)}<span>${l}</span></a>`)}</nav>
        <nav class="nav2">${NAV2.map(([k, h, l, i]) => html`<a data-nav="${k}" href="${h}">${icon(i)}<span>${l}</span></a>`)}</nav>
        <p class="rail-foot">Services from GreenEnergy Co., EcoTransit Authority, ChargeNet EV, GreenWaste Solutions, GovEnvironment Agency and EcoCommunity Action.</p>
      </aside>
      <div class="main">
        <header class="topbar">
          <a class="icon-btn back" id="backBtn" href="#/home" aria-label="Back" hidden>${icon("back")}</a>
          <a class="brand mobile-only" href="#/home">${logo()}</a>
          <h1 id="pageTitle">NetZero Hub</h1>
          <a class="points-chip" href="#/rewards" title="Green points">${icon("star")}<span id="pointsChip">${num(pointsBalance())}</span></a>
          <a class="icon-btn bell" href="#/activity" aria-label="Notifications">${icon("bell")}<span class="badge" id="bellBadge" hidden></span></a>
          <a class="avatar" href="#/profile" aria-label="Your profile">${initials}</a>
        </header>
        <main id="view" tabindex="-1"></main>
      </div>
      <nav class="tabbar" aria-label="Main">${TABS.map(([k, h, l, i]) => html`<a data-nav="${k}" href="${h}">${icon(i)}<span>${l}</span></a>`)}</nav>
    </div>`);
  refreshChrome();
}

function logo() {
  return raw(`<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M9 22c0-8 5-13 14-13-1 9-6 13-13 13M9 22l6-6" fill="none" stroke="var(--on-brand)" stroke-width="2.6" stroke-linecap="round"/></svg>`);
}

function refreshChrome() {
  const s = store.get();
  const unread = s.notifications.filter((n) => !n.read).length;
  const badge = $("#bellBadge");
  if (badge) { badge.hidden = !unread; badge.textContent = unread > 9 ? "9+" : String(unread); }
  const pc = $("#pointsChip");
  if (pc) pc.textContent = num(pointsBalance());
}
store.subscribe(() => refreshChrome());

// ------------------------------------------------------------------ routing
let renderToken = 0;
async function route() {
  if (!store.get().profile) return onboarding();
  if (!$(".shell")) shell();
  const hash = location.hash || "#/home";
  const match = ROUTES.map((r) => [r, hash.match(r[0])]).find(([, m]) => m);
  const [[, mod, fn, section], m] = match || [ROUTES[0], []];
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === section));
  const view = $("#view");
  const token = ++renderToken;
  const ctx = {
    title(t, back) {
      $("#pageTitle").textContent = t;
      document.title = t === "Home" ? "NetZero Hub" : `${t} · NetZero Hub`;
      const b = $("#backBtn"); b.hidden = !back; if (back) b.href = back;
    },
    stale: () => token !== renderToken,
  };
  view.innerHTML = `<div class="loading" aria-busy="true"><span class="spinner"></span></div>`;
  try {
    const module = await import(`./views/${mod}.js`);
    if (ctx.stale()) return;
    // A fresh page element per render: listeners a view attaches to it are
    // discarded with it, so nothing leaks into the next screen.
    const page = document.createElement("div");
    page.className = "page";
    view.replaceChildren(page);
    await module[fn](page, m ? m.slice(1) : [], ctx);
  } catch (err) {
    if (ctx.stale()) return;
    console.error(err);
    const offline = err instanceof OfflineError;
    view.innerHTML = String(html`<section class="empty-state">
      ${icon(offline ? "info" : "x", "big")}
      <h2>${offline ? "NetZero Hub is offline" : "This page didn't load"}</h2>
      <p>${offline ? err.message : "Something went wrong while loading this page. Try again; if it keeps happening, restart the app."}</p>
      <button class="btn primary" id="retry">Try again</button></section>`);
    $("#retry").addEventListener("click", route);
  }
  if (!ctx.stale()) { view.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}
window.addEventListener("hashchange", route);

// ------------------------------------------------------------------ first-run setup
function onboarding() {
  app.innerHTML = String(html`
    <div class="onboard">
      <section class="onboard-hero">
        <div class="brand big">${logo()}<span>NetZero Hub</span></div>
        <h1>Everything you need to live lower-carbon in the Illawarra, in one place.</h1>
        <ul class="onboard-points">
          <li>${icon("plug")}Book and pay for EV charging</li>
          <li>${icon("route")}Plan trips by their emissions</li>
          <li>${icon("leaf")}Measure and offset your footprint</li>
          <li>${icon("recycle")}Recycling, energy and community services</li>
        </ul>
      </section>
      <form class="onboard-form card" id="onboardForm" autocomplete="on">
        <h2>Create your profile</h2>
        <p class="muted">Your profile stays on this device. Services use it to fill in your details.</p>
        <label>Full name<input name="name" id="ob-name" required autocomplete="name" placeholder="e.g. Alex Nguyen"></label>
        <label>Email<input name="email" id="ob-email" type="email" autocomplete="email" placeholder="you@example.com"></label>
        <label>Suburb<select name="suburb" id="ob-suburb">${SUBURBS.map((s) => html`<option value="${s.name}">${s.name} ${s.postcode}</option>`)}</select></label>
        <label>Your electric vehicle<select name="vehicle" id="ob-vehicle"><option value="">I don't drive an EV</option>${VEHICLES.map((v) => html`<option value="${v.id}" ${v.id === "atto3" ? raw("selected") : ""}>${v.name} (${v.plug})</option>`)}</select></label>
        <button class="btn primary wide" type="submit">Get started</button>
      </form>
    </div>`);
  $("#onboardForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get("name")).trim();
    if (!name) return;
    const sub = SUBURBS.find((s) => s.name === f.get("suburb")) || SUBURBS[0];
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 20) || "citizen";
    store.update((s) => {
      s.profile = { id: `${slug}-${uid().slice(0, 4).toLowerCase()}`, name, email: String(f.get("email") || ""), suburb: sub.name, postcode: sub.postcode, vehicle: String(f.get("vehicle") || ""), since: Date.now() };
      // Demo wallet: card numbers follow the payment gateway's test conventions.
      s.wallet = [
        { id: uid("C"), brand: "Visa", label: "Everyday", last4: "4242", token: "tok_ok", isDefault: true },
        { id: uid("C"), brand: "Mastercard", label: "Travel", last4: "0341", token: "tok_decline_1", isDefault: false },
      ];
    });
    awardPoints(50, "Joined NetZero Hub");
    notify("Welcome to NetZero Hub", "Start by measuring your carbon footprint: it takes about two minutes.", "#/footprint/calc", "success");
    location.hash = "#/home";
    shell();
    route();
  });
}

// ------------------------------------------------------------------ async watcher
// Billing and offset certification finish asynchronously (RabbitMQ). The app
// keeps a watch list and tells the citizen when each one completes.
async function watch() {
  const s = store.get();
  if (!s.profile) return;
  for (const id of [...s.watch.receipts]) {
    try {
      const r = await api("GET", `/api/billing/${id}`);
      if (!store.get().watch.receipts.includes(id)) continue; // the session screen already handled it
      if (r.ok && r.data.status === "settled") {
        store.update((st) => { st.watch.receipts = st.watch.receipts.filter((x) => x !== id); });
        notify("Your charging receipt is ready", `${aud(r.data.cost)} for ${num(r.data.kwh, 1)} kWh. ${aud(r.data.released_amount)} of the hold was released.`, `#/charge/bookings`, "success");
        toast(`Receipt ready: ${aud(r.data.cost)}`, "success");
        awardPoints(20, "Charged an EV");
      }
    } catch { /* offline: try again next tick */ }
  }
  for (const id of [...s.watch.offsets]) {
    try {
      const r = await api("GET", `/api/offsets/${id}`);
      if (!r.ok || !store.get().watch.offsets.includes(id)) continue;
      if (r.data.status === "certified") {
        store.update((st) => { st.watch.offsets = st.watch.offsets.filter((x) => x !== id); });
        notify("Offset certificate issued", `${num(r.data.amount_co2_kg)} kg of CO₂-e retired in your name.`, `#/footprint/offset/${id}`, "success");
        toast("Offset certificate issued", "success");
        awardPoints(Math.max(10, Math.round(r.data.amount_co2_kg / 10)), "Offset emissions");
      } else if (r.data.status === "payment_failed") {
        store.update((st) => { st.watch.offsets = st.watch.offsets.filter((x) => x !== id); });
        notify("Offset purchase cancelled", "Your card was declined four times, so the purchase was cancelled and you weren't charged.", `#/footprint/offset/${id}`, "error");
        toast("Offset purchase cancelled: card declined", "error");
      }
    } catch { /* offline */ }
  }
}
setInterval(watch, 3000);

// Delegated: any element with data-href navigates (cards that aren't links).
on(document, "click", "[data-href]", (e, el) => { if (!e.target.closest("a,button,input,select,label")) location.hash = el.dataset.href; });

route();
watch();
