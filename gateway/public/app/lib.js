// NetZero Hub citizen app — shared helpers: templating, API client, local
// state, dialogs, formatting and icons. No dependencies, no build step.

// ---------------------------------------------------------------- templating
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
/** Marks a string as already-safe HTML. */
export const raw = (s) => new Raw(String(s ?? ""));
const fmtVal = (v) => (v == null || v === false ? "" : Array.isArray(v) ? v.map(fmtVal).join("") : v instanceof Raw ? v.s : esc(v));
/** Tagged template: interpolations are escaped unless they are raw()/html`` values. */
export const html = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? fmtVal(vals[i]) : ""), ""));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
/** Delegated event listener: on(root, "click", "[data-act=book]", (e, el) => …). */
export function on(root, type, selector, fn) {
  root.addEventListener(type, (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  });
}

// ---------------------------------------------------------------- API client
function apiBase() {
  const q = new URLSearchParams(location.search).get("api");
  if (q) storage.set("nzh-api", q);
  return (q || storage.get("nzh-api") || "").replace(/\/+$/, "");
}
export class OfflineError extends Error {}
/** Calls the NetZero Hub API gateway. Resolves {ok, status, data}; throws OfflineError when unreachable. */
export async function api(method, path, body) {
  let r;
  try {
    r = await fetch(apiBase() + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new OfflineError("NetZero Hub can't be reached right now. Check your connection and try again.");
  }
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { ok: r.ok, status: r.status, data };
}
export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
/** Re-renders the current screen from scratch. */
export const rerender = () => window.dispatchEvent(new HashChangeEvent("hashchange"));

// ---------------------------------------------------------------- storage + state
export const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const STATE_KEY = "nzh-state-v1";
const EMPTY = () => ({
  profile: null, wallet: [], points: [], notifications: [], vouchers: [],
  trips: [], passes: [], bikeHolds: [],
  energyPlans: [], solarReports: [], buyback: [],
  ewaste: [], compost: [],
  events: [], plots: [], volunteering: [],
  charging: {}, // reservationId -> { startedAt, startBattery }
  watch: { receipts: [], offsets: [] },
  eventSeats: {}, // eventId -> seats taken by other people (simulated)
});
let state;
try { state = { ...EMPTY(), ...JSON.parse(storage.get(STATE_KEY) || "{}") }; } catch { state = EMPTY(); }
const listeners = new Set();
export const store = {
  get: () => state,
  /** Mutates state through fn, persists it and notifies subscribers. */
  update(fn) { fn(state); storage.set(STATE_KEY, JSON.stringify(state)); listeners.forEach((l) => l(state)); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  reset() { state = EMPTY(); storage.remove(STATE_KEY); listeners.forEach((l) => l(state)); },
};

export const uid = (prefix = "") => prefix + Math.random().toString(36).slice(2, 8).toUpperCase();
/** Deterministic 0..1 value from a string — stable "random" data for simulated providers. */
export function seeded(str, n = 0) {
  let h = 2166136261 ^ n;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- points + notifications
export function awardPoints(delta, reason) {
  if (!delta) return;
  store.update((s) => s.points.unshift({ ts: Date.now(), delta, reason }));
  toast(`${delta > 0 ? "+" : ""}${delta} green points: ${reason.charAt(0).toLowerCase() + reason.slice(1)}`, "points");
}
export const pointsBalance = () => store.get().points.reduce((s, p) => s + p.delta, 0);

export function notify(title, body, link, kind = "info") {
  store.update((s) => {
    s.notifications.unshift({ id: uid("N"), ts: Date.now(), title, body, link, kind, read: false });
    s.notifications = s.notifications.slice(0, 60);
  });
}

// ---------------------------------------------------------------- toasts + dialogs
export function toast(message, kind = "info") {
  let host = $("#toasts");
  if (!host) { host = document.createElement("div"); host.id = "toasts"; host.setAttribute("role", "status"); document.body.appendChild(host); }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => { t.classList.add("leaving"); setTimeout(() => t.remove(), 300); }, kind === "error" ? 6000 : 3800);
}

let lastData = {};
/** Form values from the most recently closed dialog (its inputs are gone by then). */
export const dialogData = () => lastData;
/** Opens a modal dialog. actions: [{label, value, primary?, danger?}]. Resolves with the chosen value (or null). */
export function dialog({ title, body = "", actions = [{ label: "Close", value: null, primary: true }], wide = false }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "sheet" + (wide ? " wide" : "");
    d.innerHTML = String(html`
      <form method="dialog">
        <header><h2>${title}</h2><button class="icon-btn" value="__close" aria-label="Close">${icon("x")}</button></header>
        <div class="sheet-body">${raw(String(body))}</div>
        <footer>${actions.map((a, i) => html`<button class="btn ${a.primary ? "primary" : ""} ${a.danger ? "danger" : ""}" value="${i}">${a.label}</button>`)}</footer>
      </form>`);
    document.body.appendChild(d);
    d.addEventListener("close", () => {
      const v = d.returnValue;
      lastData = Object.fromEntries(new FormData(d.querySelector("form")));
      d.remove();
      resolve(v === "" || v === "__close" ? null : actions[Number(v)]?.value ?? null);
    });
    d.showModal();
  });
}

// ---------------------------------------------------------------- formatting
const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
export const aud = (n) => AUD.format(Number(n) || 0);
export const num = (n, d = 0) => Number(n || 0).toLocaleString("en-AU", { maximumFractionDigits: d, minimumFractionDigits: d });
export const kg = (n) => `${num(n)} kg`;
export const tonnes = (kgv, d = 1) => `${num((kgv || 0) / 1000, d)} t`;
/** SQLite's datetime('now') text ("2026-10-18 09:00:00", UTC) as a Date. */
export const sqlDate = (s) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? s : String(s).replace(" ", "T") + "Z");
export const time = (d) => new Date(d).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
export const day = (d) => new Date(d).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
export const dayLong = (d) => new Date(d).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
export const dateTime = (d) => `${day(d)}, ${time(d)}`;
export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return day(ts);
}
export const plural = (n, one, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- payment helpers
export function defaultCard() {
  const w = store.get().wallet;
  return w.find((c) => c.isDefault) || w[0] || null;
}
/** Radio list of wallet cards for a payment step. */
export function cardPicker(name = "card", selectedId) {
  const w = store.get().wallet;
  if (!w.length) return html`<p class="muted">No card on file. <a href="#/wallet">Add a card</a> to pay.</p>`;
  const sel = selectedId || defaultCard()?.id;
  return html`<fieldset class="cards-pick"><legend>Pay with</legend>${w.map((c) => html`
    <label class="card-opt"><input type="radio" name="${name}" value="${c.id}" ${c.id === sel ? raw("checked") : ""}>
      <span class="card-chip ${c.brand.toLowerCase()}">${c.brand}</span><span>${c.label} ending ${c.last4}</span></label>`)}</fieldset>`;
}
export const cardById = (id) => store.get().wallet.find((c) => c.id === id);

// Simulated providers charge cards with the same rules as the platform's
// payment gateway (services/*/src/paymentGateway.ts): tok_decline_all always
// declines, tok_decline_<n> declines the first n attempts of a purchase.
const attempts = new Map();
/** Resolves {approved, reference}. purchaseKey identifies one purchase across retries. */
export async function simulatePayment(card, purchaseKey) {
  await sleep(700 + Math.random() * 500);
  const n = (attempts.get(purchaseKey) || 0) + 1;
  attempts.set(purchaseKey, n);
  const m = /^tok_decline_(\d+)$/.exec(card?.token || "");
  const approved = card && card.token !== "tok_decline_all" && !(m && n <= Number(m[1]));
  return { approved, attempt: n, reference: approved ? uid("PAY-") : null };
}

/** Visual progress tracker for a multi-step async process. */
export function stepper(steps, current, failedAt = -1) {
  return html`<ol class="stepper">${steps.map((s, i) => {
    const st = i === failedAt ? "failed" : i < current ? "done" : i === current ? "active" : "todo";
    return html`<li class="${st}"><span class="dot">${st === "done" ? icon("check") : st === "failed" ? icon("x") : ""}</span><span>${s}</span></li>`;
  })}</ol>`;
}

/** A QR-style pass code (decorative, deterministic from the code string). */
export function passCode(code, size = 168) {
  const n = 25, cell = size / n, cells = [];
  const finder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let on;
    if (finder(x, y)) {
      const fx = x < 7 ? x : x - (n - 7), fy = y < 7 ? y : y - (n - 7);
      on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
    } else on = seeded(code, y * n + x) > 0.52;
    if (on) cells.push(`<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`);
  }
  return raw(`<svg class="passcode" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Pass code ${esc(code)}"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#13261e">${cells.join("")}</g></svg>`);
}

/** Saves a text file through the browser (calendar invites, certificates). */
export function download(filename, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- icons (24px stroke set)
const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  leaf: "M5 21c0-9 6-15 16-16-1 10-7 16-16 16zM5 21l7-7",
  sun: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  recycle: "M7 19H4.5a1.5 1.5 0 0 1-1.3-2.2L5 13.5M8.5 7.5 10.7 3.8a1.5 1.5 0 0 1 2.6 0L15 6.7M19 13.5l1.8 3.3a1.5 1.5 0 0 1-1.3 2.2H12M12 19l2-2m-2 2 2 2M5 13.5l-.5 2.7m.5-2.7 2.6.9M15 6.7l-2.7-.3m2.7.3.4-2.7",
  people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.7",
  store: "M4 9h16l-1.5-5h-13zM5 9v11h14V9M9 20v-6h6v6",
  gift: "M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10.5 3 8 3a2 2 0 0 0 0 4M12 7s1.5-4 4-4a2 2 0 0 1 0 4",
  wallet: "M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4",
  back: "M15 18l-6-6 6-6",
  chevron: "M9 6l6 6-6 6",
  check: "M5 12.5l4.5 4.5L19 7",
  x: "M6 6l12 12M18 6 6 18",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  bike: "M5.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM18.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5.5 14.5 9 7h5l4.5 7.5M9 7l3 7.5h-6.5M14 7l-1-2h-2.5",
  train: "M7 3h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM5 11h14M8 21l2-4M16 21l-2-4M9 14h.01M15 14h.01",
  bus: "M5 4h14a1 1 0 0 1 1 1v12H4V5a1 1 0 0 1 1-1zM4 12h16M7 17v3M17 17v3M8 15h.01M16 15h.01",
  car: "M5 16h14v-4l-2-5H7l-2 5zM5 16v3M19 16v3M7.5 13.5h.01M16.5 13.5h.01",
  zap: "M13 2 4 14h7l-1 8 9-12h-7z",
  tree: "M12 22v-6M7 16h10l-5-13zM5 16h14",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  ticket: "M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3zM14 4v16",
  shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
  plus: "M12 5v14M5 12h14",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  battery: "M3 8h15v8H3zM21 11v2M6 11h6",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  logout: "M15 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3",
  download: "M12 4v12M7 11l5 5 5-5M5 20h14",
  meter: "M4 18a8 8 0 1 1 16 0M12 18l4-6",
  sprout: "M12 21v-8M12 13c0-4-3-6-7-6 0 4 3 6 7 6zM12 11c0-4 3-7 8-7 0 5-3 7-8 7z",
};
export function icon(name, cls = "") {
  return raw(`<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name] || ICONS.info}"/></svg>`);
}
