// Directory of all twenty Part A services, grouped by provider.
import { html, icon } from "../lib.js";
import { PROVIDERS, SERVICES } from "../data.js";

export async function render(view, _p, ctx) {
  ctx.title("All services");
  view.innerHTML = String(html`
    <p class="lede">Twenty services from six providers, all in one account.</p>
    <div class="directory">${PROVIDERS.map((p) => html`
      <section class="card provider-block ${p.id}">
        <header><span class="tile ${p.id}">${icon(p.icon)}</span><div><h3>${p.name}</h3><p class="muted small">${p.blurb}</p></div></header>
        <ul class="list compact">${SERVICES.filter((s) => s.provider === p.id).map((s) => html`
          <li data-href="${s.href}" class="clickable"><span class="svc-ico">${icon(s.icon)}</span><a href="${s.href}">${s.name}</a>${icon("chevron")}</li>`)}</ul>
      </section>`)}</div>
    <section class="card">
      <h3>Your account</h3>
      <ul class="list compact">
        <li data-href="#/rewards" class="clickable"><span class="svc-ico">${icon("gift")}</span><a href="#/rewards">Rewards and green points</a>${icon("chevron")}</li>
        <li data-href="#/wallet" class="clickable"><span class="svc-ico">${icon("wallet")}</span><a href="#/wallet">Wallet</a>${icon("chevron")}</li>
        <li data-href="#/activity" class="clickable"><span class="svc-ico">${icon("bell")}</span><a href="#/activity">Notifications</a>${icon("chevron")}</li>
        <li data-href="#/profile" class="clickable"><span class="svc-ico">${icon("user")}</span><a href="#/profile">Profile</a>${icon("chevron")}</li>
      </ul>
    </section>`);
}
