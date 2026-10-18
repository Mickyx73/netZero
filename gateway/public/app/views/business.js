// GovEnvironment Agency: 5.3 green business certification lookup (simulated registry).
import { html, $, on, icon, sleep, day, rerender } from "../lib.js";
import { BUSINESSES } from "../data.js";

const STATUS = {
  certified: ["Certified", "ok"],
  expired: ["Certification expired", "warn"],
  pending: ["Assessment in progress", "warn"],
  none: ["Not certified", "muted"],
};

export async function render(view, _p, ctx) {
  ctx.title("Green businesses", "#/footprint");
  view.innerHTML = String(html`
    <nav class="subnav" aria-label="Footprint services"><a href="#/footprint">My footprint</a><a href="#/footprint/offset">Offset</a><a href="#/business" class="active">Green businesses</a></nav>
    <section class="card">
      <h2 class="card-title">Is this business really green?</h2>
      <p class="muted">Search the GovEnvironment certification register by business name or ABN.</p>
      <form id="bizForm" class="search-row" role="search">
        <label class="sr" for="bizQ">Business name or ABN</label>
        <input id="bizQ" type="search" placeholder="e.g. Illawarra Coffee or 51 824 753 556" autocomplete="off">
        <button class="btn primary" type="submit">${icon("search")}Search</button>
      </form>
    </section>
    <div id="bizOut"><section><h3 class="section-title">Certified near you</h3>${list(BUSINESSES.filter((b) => b.status === "certified").slice(0, 4))}</section></div>`);

  $("#bizForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#bizQ").value.trim().toLowerCase();
    const out = $("#bizOut");
    if (!q) return;
    out.innerHTML = `<div class="loading"><span class="spinner"></span><span>Searching the register…</span></div>`;
    await sleep(450);
    const digits = q.replace(/\D/g, "");
    const hits = BUSINESSES.filter((b) => b.name.toLowerCase().includes(q) || (digits.length >= 4 && b.abn.replace(/\D/g, "").includes(digits)));
    out.innerHTML = String(hits.length
      ? html`<section><h3 class="section-title">${hits.length} result${hits.length > 1 ? "s" : ""}</h3>${list(hits)}</section>`
      : html`<section class="empty-state">${icon("search", "big")}<h3>No business matches "${q}"</h3><p>Check the spelling, or search by the 11-digit ABN. Businesses that have never applied aren't on the register.</p></section>`);
  });
  on(view, "click", "[data-act=back]", () => rerender());
  on(view, "click", "[data-abn]", (_e, el) => {
    const b = BUSINESSES.find((x) => x.abn === el.dataset.abn);
    $("#bizOut").innerHTML = String(detail(b));
  });
}

const stars = (n) => html`<span class="stars" aria-label="${n} out of 5 stars">${[1, 2, 3, 4, 5].map((i) => html`<span class="${i <= n ? "on" : ""}">${icon("star")}</span>`)}</span>`;

function list(items) {
  return html`<ul class="list cards">${items.map((b) => {
    const [label, tone] = STATUS[b.status];
    return html`<li class="card clickable" data-abn="${b.abn}"><span class="tile gov">${icon("store")}</span>
      <span><strong>${b.name}</strong><span class="muted">${b.suburb}, ABN ${b.abn}</span>${stars(b.rating)}</span>
      <span class="pill ${tone}">${label}</span></li>`;
  })}</ul>`;
}

function detail(b) {
  const [label, tone] = STATUS[b.status];
  return html`<section class="card">
    <header class="card-head"><h2 class="card-title">${b.name}</h2><span class="pill ${tone}">${label}</span></header>
    <p class="muted">${b.suburb}, ABN ${b.abn}</p>
    <p>Sustainability rating ${stars(b.rating)} <strong>${b.rating} of 5</strong></p>
    ${b.certs.length ? html`<h3>Certificates</h3><ul class="checklist">${b.certs.map((c) => html`<li>${icon("check")}${c}</li>`)}</ul>` : html`<p class="muted">No sustainability certificates are linked to this business.</p>`}
    ${b.until ? html`<p class="muted small">${b.status === "expired" ? "Expired" : "Valid until"} ${day(b.until)}.</p>` : ""}
    <button class="btn" data-act="back">Back to search</button>
  </section>`;
}
