// EcoCommunity Action (simulated provider): 6.1 event registration,
// 6.2 community garden plots, 6.3 volunteer matching.
import { html, raw, $, on, store, icon, toast, dialog, dialogData, notify, awardPoints, num, aud, day, dayLong, uid, cardPicker, cardById, defaultCard, simulatePayment, passCode, download, sleep, rerender } from "../lib.js";
import { EVENTS, GARDENS, SKILLS, OPPORTUNITIES, SUBURBS } from "../data.js";
import { ics } from "./charge.js";

function subnav(active) {
  return html`<nav class="subnav" aria-label="Community services">
    <a href="#/community" class="${active === "home" ? "active" : ""}">My community</a>
    <a href="#/community/events" class="${active === "events" ? "active" : ""}">Events</a>
    <a href="#/community/garden" class="${active === "garden" ? "active" : ""}">Garden plots</a>
    <a href="#/community/volunteer" class="${active === "vol" ? "active" : ""}">Volunteering</a></nav>`;
}

const eventDate = (ev, which = "start") => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + ev.dayOffset);
  const [h, m] = ev[which].split(":").map(Number); d.setHours(h, m);
  return d;
};
const seatsLeft = (ev) => ev.capacity - ev.taken - (store.get().events.some((r) => r.eventId === ev.id && r.status === "registered") ? 1 : 0);

export async function overview(view, _p, ctx) {
  ctx.title("Community");
  const s = store.get();
  const regs = s.events.filter((r) => r.status !== "cancelled");
  view.innerHTML = String(html`
    ${subnav("home")}
    <section class="card">
      <header class="card-head"><h3>Your events</h3><a href="#/community/events">Browse events</a></header>
      ${regs.length ? html`<ul class="list">${regs.map((r) => { const ev = EVENTS.find((e) => e.id === r.eventId); return html`<li data-href="#/community/events" class="clickable"><span class="tile community">${icon(r.status === "waitlist" ? "clock" : "ticket")}</span>
        <span><strong>${ev.title}</strong><span class="muted">${dayLong(eventDate(ev))}, ${ev.start}, ${ev.place}</span></span><span class="pill ${r.status === "waitlist" ? "warn" : "ok"}">${r.status === "waitlist" ? "Waitlist" : "Going"}</span></li>`; })}</ul>`
      : html`<p class="muted">You haven't joined any events yet.</p>`}
    </section>
    <div class="grid-2">
      <section class="card"><header class="card-head"><h3>Garden plot</h3><a href="#/community/garden">${s.plots.length ? "Manage" : "Book a plot"}</a></header>
        ${s.plots.length ? html`<p><strong>Plot ${s.plots[0].plot}</strong> at ${s.plots[0].garden}</p><p class="muted">Gate code ${s.plots[0].code}. Lease ends ${day(s.plots[0].until)}.</p>` : html`<p class="muted">Grow your own food at a community garden.</p>`}</section>
      <section class="card"><header class="card-head"><h3>Volunteering</h3><a href="#/community/volunteer">Find roles</a></header>
        ${s.volunteering.length ? html`<ul class="list compact">${s.volunteering.map((v) => html`<li><strong>${v.title}</strong><span class="muted">${v.org}, interest sent ${day(v.ts)}</span></li>`)}</ul>` : html`<p class="muted">Get matched to local sustainability groups.</p>`}</section>
    </div>`);
}

// ------------------------------------------------------------------ 6.1 events
export async function events(view, _p, ctx) {
  ctx.title("Community events", "#/community");
  const mine = (id) => store.get().events.find((r) => r.eventId === id && r.status !== "cancelled");
  view.innerHTML = String(html`
    ${subnav("events")}
    <ul class="list plain events">${EVENTS.map((ev) => {
      const reg = mine(ev.id), left = seatsLeft(ev), start = eventDate(ev);
      return html`<li class="card event">
        <div class="date-badge"><span>${start.toLocaleDateString("en-AU", { month: "short" })}</span><strong>${start.getDate()}</strong></div>
        <div class="event-main"><strong>${ev.title}</strong><span class="muted">${dayLong(start)}, ${ev.start} to ${ev.end}, ${ev.place}</span>
          <span class="small">${ev.kind}. ${left > 0 ? `${left} of ${ev.capacity} spots left` : "Fully booked"}</span></div>
        <div class="event-act">${reg ? html`<span class="pill ${reg.status === "waitlist" ? "warn" : "ok"}">${reg.status === "waitlist" ? "On waitlist" : "You're going"}</span>
            ${reg.status === "registered" ? html`<button class="btn" data-act="ticket" data-id="${ev.id}">Ticket</button>` : ""}
            <button class="btn subtle" data-act="leave" data-id="${ev.id}">${reg.status === "waitlist" ? "Leave waitlist" : "Cancel"}</button>`
          : left > 0 ? html`<button class="btn primary" data-act="register" data-id="${ev.id}">Register</button>`
          : html`<button class="btn" data-act="waitlist" data-id="${ev.id}">Join waitlist</button>`}</div></li>`;
    })}</ul>`);

  on(view, "click", "[data-act=register]", async (_e, b) => {
    const ev = EVENTS.find((x) => x.id === b.dataset.id);
    const p = store.get().profile;
    const ok = await dialog({
      title: `Register for ${ev.title}`,
      body: String(html`<p class="muted">${dayLong(eventDate(ev))}, ${ev.start} to ${ev.end}, ${ev.place}.</p>
        <div class="form-grid"><label>Your name<input name="name" value="${p.name}" required></label>
        <label>Emergency contact name<input name="ecName" required placeholder="Who should we call?"></label>
        <label>Emergency contact phone<input name="ecPhone" type="tel" required placeholder="04xx xxx xxx"></label></div>
        <p class="muted small">Bring: ${ev.bring}.</p>`),
      actions: [{ label: "Cancel", value: null }, { label: "Register", value: "go", primary: true }],
    });
    if (ok !== "go") return;
    const d = dialogData();
    if (!String(d.ecName || "").trim() || !/^[\d +()-]{8,}$/.test(String(d.ecPhone || ""))) { toast("Add an emergency contact name and phone number to register.", "error"); return; }
    const reg = { id: uid("R"), eventId: ev.id, status: "registered", ticket: uid("TK-"), contact: `${d.ecName}, ${d.ecPhone}`, ts: Date.now() };
    store.update((s) => { s.events = s.events.filter((r) => r.eventId !== ev.id); s.events.unshift(reg); });
    awardPoints(25, "Joined a community event");
    notify(`You're going to ${ev.title}`, `${dayLong(eventDate(ev))}, ${ev.start}. Ticket ${reg.ticket}.`, "#/community/events", "success");
    showTicket(ev, reg);
    rerender();
  });
  on(view, "click", "[data-act=waitlist]", (_e, b) => {
    const ev = EVENTS.find((x) => x.id === b.dataset.id);
    store.update((s) => s.events.unshift({ id: uid("R"), eventId: ev.id, status: "waitlist", ts: Date.now() }));
    toast("You're on the waitlist. We'll let you know if a spot opens.");
    rerender();
  });
  on(view, "click", "[data-act=leave]", (_e, b) => {
    store.update((s) => { s.events.forEach((r) => { if (r.eventId === b.dataset.id) r.status = "cancelled"; }); });
    toast("Registration cancelled");
    rerender();
  });
  on(view, "click", "[data-act=ticket]", (_e, b) => {
    const ev = EVENTS.find((x) => x.id === b.dataset.id);
    showTicket(ev, mine(ev.id));
  });
}

async function showTicket(ev, reg) {
  const choice = await dialog({
    title: "Your ticket",
    body: String(html`<div class="ticket">${passCode(reg.ticket, 150)}<div><strong>${ev.title}</strong><p class="muted">${dayLong(eventDate(ev))}<br>${ev.start} to ${ev.end}, ${ev.place}</p><p class="small">Ticket ${reg.ticket}</p></div></div>`),
    actions: [{ label: "Safety briefing", value: "brief" }, { label: "Add to calendar", value: "ics" }, { label: "Done", value: null, primary: true }],
  });
  if (choice === "ics") download(`${ev.id}.ics`, ics(ev.title, eventDate(ev), eventDate(ev, "end"), `EcoCommunity Action ticket ${reg.ticket}`, ev.place), "text/calendar");
  if (choice === "brief") {
    await dialog({
      title: "Safety briefing",
      body: String(html`<ul class="checklist">
        <li>${icon("check")}Sign in with the coordinator in the yellow vest when you arrive.</li>
        <li>${icon("check")}Wear ${ev.bring.toLowerCase().includes("boots") ? "sturdy boots" : "closed shoes"}, a hat and sunscreen; bring water.</li>
        <li>${icon("check")}Don't pick up needles or sharp objects: report them to the coordinator.</li>
        <li>${icon("check")}First aid kit and the event phone are at the sign-in table.</li>
        <li>${icon("check")}In an emergency call 000, then tell the coordinator.</li></ul>`),
    });
  }
}

// ------------------------------------------------------------------ 6.2 garden plots
export async function garden(view, _p, ctx) {
  ctx.title("Garden plots", "#/community");
  const s = store.get();
  const current = s.plots[0];
  let gid = GARDENS.find((g) => g.plots - g.taken > 0).id, months = 6;
  const draw = () => {
    const g = GARDENS.find((x) => x.id === gid);
    view.innerHTML = String(html`
      ${subnav("garden")}
      ${current ? html`<section class="card success-card">${icon("sprout", "big")}<h2>Plot ${current.plot}, ${current.garden}</h2>
        <p>Gate code <strong class="code">${current.code}</strong>. Your lease runs until ${dayLong(current.until)}.</p></section>` : ""}
      <section class="card">
        <h2 class="card-title">${current ? "Book another plot" : "Book a garden plot"}</h2>
        <fieldset class="choice-grid"><legend>Garden</legend>${GARDENS.map((x) => {
          const free = x.plots - x.taken;
          return html`<label class="choice ${free ? "" : "disabled"}"><input type="radio" name="garden" value="${x.id}" ${x.id === gid ? raw("checked") : ""} ${free ? "" : raw("disabled")}>
            <span><strong>${x.name}</strong><span class="muted">${x.suburb}, ${free ? `${free} plots free` : "no plots free"}, ${aud(x.feeMonth)} a month</span></span></label>`;
        })}</fieldset>
        <div class="seg" role="group" aria-label="Lease length">${[3, 6, 12].map((m) => html`<button class="${m === months ? "on" : ""}" data-act="months" data-m="${m}">${m} months</button>`)}</div>
        <form id="gpForm" class="stack">
          ${cardPicker("card")}
          <p class="notice error" id="gpErr" hidden></p>
          <button class="btn primary" type="submit">Book plot for ${aud(g.feeMonth * months)}</button>
        </form>
      </section>`);
    $("#gpForm").addEventListener("submit", submit);
  };
  on(view, "change", "input[name=garden]", (e) => { gid = e.target.value; draw(); });
  on(view, "click", "[data-act=months]", (_e, b) => { months = Number(b.dataset.m); draw(); });
  const key = uid("GP");
  async function submit(e) {
    e.preventDefault();
    const g = GARDENS.find((x) => x.id === gid);
    const card = cardById(new FormData(e.target).get("card")) || defaultCard();
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Paying…";
    const pay = await simulatePayment(card, key);
    if (!pay.approved) { btn.disabled = false; btn.textContent = `Book plot for ${aud(g.feeMonth * months)}`; const err = $("#gpErr"); err.hidden = false; err.textContent = `${card.brand} ending ${card.last4} was declined. Try again or use another card.`; return; }
    g.taken += 1;
    const until = new Date(); until.setMonth(until.getMonth() + months);
    const plot = { garden: g.name, plot: `${"ABC"[Math.floor(Math.random() * 3)]}-${String(g.taken).padStart(2, "0")}`, code: String(1000 + Math.floor(Math.random() * 9000)), until: until.getTime(), paid: g.feeMonth * months };
    store.update((s) => s.plots.unshift(plot));
    awardPoints(20, "Booked a garden plot");
    notify("Garden plot booked", `Plot ${plot.plot} at ${plot.garden}. Gate code ${plot.code}.`, "#/community/garden", "success");
    rerender();
  }
  draw();
}

// ------------------------------------------------------------------ 6.3 volunteer matching
export async function volunteer(view, _p, ctx) {
  ctx.title("Volunteering", "#/community");
  const p = store.get().profile;
  view.innerHTML = String(html`
    ${subnav("vol")}
    <section class="card">
      <h2 class="card-title">What can you help with?</h2>
      <form id="vForm" class="stack">
        <fieldset class="chips-field"><legend>Your skills</legend>${SKILLS.map((sk) => html`<label class="chip"><input type="checkbox" name="skill" value="${sk}"><span>${sk}</span></label>`)}</fieldset>
        <div class="form-grid">
          <label>When are you free?<select name="when" id="vo-when"><option value="weekends">Weekends</option><option value="weekdays">Weekdays</option><option value="flexible">Either</option></select></label>
          <label>Near<select name="near" id="vo-near">${SUBURBS.map((x) => html`<option ${x.name === p.suburb ? raw("selected") : ""}>${x.name}</option>`)}</select></label>
        </div>
        <button class="btn primary" type="submit">Find matches</button>
      </form>
    </section>
    <div id="vOut"></div>`);
  $("#vForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const skills = f.getAll("skill"), when = f.get("when"), near = f.get("near");
    const out = $("#vOut");
    if (!skills.length) { out.innerHTML = String(html`<p class="notice warn">Pick at least one skill so we can match you.</p>`); return; }
    out.innerHTML = `<div class="loading"><span class="spinner"></span><span>Matching you with local groups…</span></div>`;
    await sleep(600);
    const matches = OPPORTUNITIES.map((o) => {
      const skill = o.skills.filter((x) => skills.includes(x)).length / o.skills.length;
      const time = when === "flexible" || o.when === "flexible" || o.when === when ? 1 : 0;
      const place = o.suburb === "Remote" || o.suburb === near ? 1 : 0.5;
      return { ...o, score: Math.round((skill * 0.6 + time * 0.25 + place * 0.15) * 100) };
    }).filter((o) => o.score >= 40).sort((a, b) => b.score - a.score);
    const sent = store.get().volunteering.map((v) => v.id);
    out.innerHTML = String(matches.length ? html`<section><h3 class="section-title">${matches.length} match${matches.length > 1 ? "es" : ""}</h3><ul class="list cards">${matches.map((o) => html`
      <li class="card"><span class="score" title="Match score">${o.score}%</span>
        <span><strong>${o.title}</strong><span class="muted">${o.org}, ${o.suburb}, ${o.when}</span><span class="small">Uses: ${o.skills.join(", ")}</span></span>
        ${sent.includes(o.id) ? html`<span class="pill ok">Interest sent</span>` : html`<button class="btn" data-act="interest" data-id="${o.id}">I'm interested</button>`}</li>`)}</ul></section>`
      : html`<section class="empty-state"><h3>No strong matches yet</h3><p>Try adding more skills or choosing "Either" for when you're free.</p></section>`);
  });
  on(view, "click", "[data-act=interest]", (_e, b) => {
    const o = OPPORTUNITIES.find((x) => x.id === b.dataset.id);
    store.update((s) => s.volunteering.unshift({ id: o.id, title: o.title, org: o.org, ts: Date.now() }));
    awardPoints(40, "Signed up to volunteer");
    notify("Interest sent", `${o.org} will contact you about "${o.title}" within a week.`, "#/community", "success");
    b.replaceWith(Object.assign(document.createElement("span"), { className: "pill ok", textContent: "Interest sent" }));
  });
}
