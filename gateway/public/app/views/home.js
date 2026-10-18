import { html, raw, api, store, icon, num, tonnes, kg, dateTime, ago, pointsBalance } from "../lib.js";
import { PROVIDERS, SERVICES, REWARDS } from "../data.js";

const STATIONS_CACHE = { list: null };
async function stationName(id) {
  if (!STATIONS_CACHE.list) {
    const r = await api("GET", "/api/stations").catch(() => null);
    STATIONS_CACHE.list = r?.ok ? r.data : [];
  }
  return STATIONS_CACHE.list.find((s) => s.id === id)?.name || id;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The carbon ring: the year's footprint as a circle, filled by what has been offset. */
function ring(fp) {
  const R = 92, C = 2 * Math.PI * R;
  if (!fp) {
    return html`<svg class="ring empty" viewBox="0 0 220 220" role="img" aria-label="No footprint measured yet">
      <circle cx="110" cy="110" r="${R}" class="track dashed"/>
      <text x="110" y="104" class="ring-big">?</text><text x="110" y="132" class="ring-small">not measured yet</text></svg>`;
  }
  const total = fp.total_co2_kg_year, off = Math.min(fp.net_offset_applied_kg || 0, total);
  const frac = total ? off / total : 0;
  return html`<svg class="ring" viewBox="0 0 220 220" role="img" aria-label="Footprint ${tonnes(total)} a year, ${Math.round(frac * 100)}% offset">
    <circle cx="110" cy="110" r="${R}" class="track"/>
    <circle cx="110" cy="110" r="${R}" class="fill" style="--len:${(frac * C).toFixed(1)};--c:${C.toFixed(1)}" stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 110 110)"/>
    <text x="110" y="106" class="ring-big">${num((total - off) / 1000, 1)}</text>
    <text x="110" y="134" class="ring-small">tonnes CO₂-e a year, net</text></svg>`;
}

export async function render(view, _p, ctx) {
  ctx.title("Home");
  const s = store.get();
  const p = s.profile;
  const r = await api("GET", `/api/citizen/${encodeURIComponent(p.id)}/dashboard`);
  if (ctx.stale()) return;
  const d = r.ok ? r.data : { footprint: null, offsets: [], evActivity: [] };
  const fp = d.footprint;

  const upcoming = (d.evActivity || []).map((x) => x.reservation)
    .filter((x) => ["confirmed", "preauth_declined", "charging"].includes(x.status))
    .sort((a, b) => (a.status === "charging" ? -1 : b.status === "charging" ? 1 : a.slot_start.localeCompare(b.slot_start)));
  const next = upcoming[0];
  const nextName = next ? await stationName(next.station_id) : "";
  const certified = (d.offsets || []).filter((o) => o.status === "certified");
  const bal = pointsBalance();
  const goal = REWARDS.find((x) => x.cost > bal) || REWARDS[REWARDS.length - 1];
  const bd = fp?.breakdown_kg_year;

  view.innerHTML = String(html`
    <section class="hero">
      <div class="hero-copy">
        <p class="hello">${greeting()}, ${p.name.split(" ")[0]}</p>
        <h2>${fp ? (fp.net_offset_applied_kg > 0 ? `You've offset ${Math.round(Math.min(1, fp.net_offset_applied_kg / fp.total_co2_kg_year) * 100)}% of your footprint` : "Your footprint is measured. Next step: bring it down.") : "Let's find out your carbon footprint"}</h2>
        ${fp ? html`
          <dl class="breakdown">
            ${[["Home energy", bd?.energy, "energy"], ["Transport", bd?.transport, "transport"], ["Food", bd?.diet, "diet"]].map(([l, v, k]) => html`
              <div><dt><i class="sw ${k}"></i>${l}</dt><dd>${tonnes(v)}</dd><span class="bar"><span class="${k}" style="width:${Math.round((v / fp.total_co2_kg_year) * 100)}%"></span></span></div>`)}
          </dl>
          <p class="muted small">${tonnes(fp.total_co2_kg_year)} before offsets, ${fp.percentile_vs_peers}. The national average is ${tonnes(fp.peer_average_co2_kg_year)}.</p>
          <div class="row-btns"><a class="btn primary" href="#/footprint/offset">Offset emissions</a><a class="btn" href="#/footprint">See how to cut it</a></div>`
        : html`<p>Answer a few questions about your home, travel and food. It takes about two minutes, and every other service can then show you its impact.</p>
          <div class="row-btns"><a class="btn primary" href="#/footprint/calc">Measure my footprint</a></div>`}
      </div>
      <div class="hero-ring">${ring(fp)}
        ${fp ? html`<p class="ring-note">${certified.length ? `${kg(fp.net_offset_applied_kg)} offset through ${certified.length} certificate${certified.length > 1 ? "s" : ""}` : "Nothing offset yet"}</p>` : ""}
      </div>
    </section>

    <section class="quick" aria-label="Quick actions">
      <a href="#/travel" class="qa transit">${icon("route")}<span>Plan a trip</span></a>
      <a href="#/charge" class="qa ev">${icon("plug")}<span>Book a charger</span></a>
      <a href="#/waste/guide" class="qa waste">${icon("search")}<span>Which bin?</span></a>
      <a href="#/community/events" class="qa community">${icon("calendar")}<span>Find an event</span></a>
      <a href="#/energy/plans" class="qa energy">${icon("sun")}<span>Go renewable</span></a>
    </section>

    <div class="grid-2">
      <section class="card">
        <header class="card-head"><h3>Up next</h3><a href="#/charge/bookings">All bookings</a></header>
        ${next ? html`
          <a class="next-item" href="${next.status === "charging" ? `#/charge/session/${next.id}` : "#/charge/bookings"}">
            <span class="tile ev">${icon("plug")}</span>
            <span><strong>${next.status === "charging" ? "Charging now" : next.status === "preauth_declined" ? "Payment needed to start charging" : "Charging bay booked"}</strong>
            <span class="muted">${nextName}, ${dateTime(next.slot_start)}, code ${next.confirmation_code}</span></span>${icon("chevron")}</a>`
        : html`<p class="muted">No bookings coming up. <a href="#/charge">Find a charger near ${p.suburb}</a>.</p>`}
        ${s.passes.filter((x) => x.expires > Date.now()).slice(0, 1).map((ps) => html`
          <a class="next-item" href="#/travel/pass"><span class="tile transit">${icon("ticket")}</span>
          <span><strong>${ps.name} active</strong><span class="muted">Valid until ${dateTime(ps.expires)}</span></span>${icon("chevron")}</a>`)}
      </section>

      <section class="card points-card">
        <header class="card-head"><h3>Green points</h3><a href="#/rewards">Rewards</a></header>
        <p class="points-big">${num(bal)}</p>
        <p class="muted small">${bal >= goal.cost ? `Enough for a ${goal.name.toLowerCase()}.` : `${num(goal.cost - bal)} more for a ${goal.name.toLowerCase()}.`}</p>
        <span class="bar sun"><span style="width:${Math.min(100, Math.round((bal / goal.cost) * 100))}%"></span></span>
      </section>
    </div>

    <section>
      <header class="section-head"><h3>Services near you</h3><a href="#/services">All 20 services</a></header>
      <div class="providers">
        ${PROVIDERS.map((pr) => html`
          <article class="provider ${pr.id}">
            <h4>${icon(pr.icon)}${pr.name}</h4>
            <ul>${SERVICES.filter((sv) => sv.provider === pr.id).map((sv) => html`<li><a href="${sv.href}">${sv.name}</a></li>`)}</ul>
          </article>`)}
      </div>
    </section>

    <section class="card">
      <header class="card-head"><h3>Recent activity</h3><a href="#/activity">See all</a></header>
      ${s.notifications.length ? html`<ul class="feed">${s.notifications.slice(0, 4).map((n) => html`
        <li class="${n.kind}"><a href="${n.link || "#/activity"}"><strong>${n.title}</strong><span class="muted">${n.body}</span></a><time>${ago(n.ts)}</time></li>`)}</ul>`
      : html`<p class="muted">Nothing yet.</p>`}
    </section>`);
}
