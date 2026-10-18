# Week 12 Live Demo Runbook (8 minutes + 3 minutes Q&A)

The rules from the lecture: **no PPT slides, run the tool live, focus on what was implemented for the microservices, and every member present.** The demo is told from the **citizen's side**: a resident uses the NetZero Hub app, while the screen beside it shows the microservices reacting to every tap.

## What runs where

| URL | What it is | Used for |
| --- | --- | --- |
| http://localhost:4000/stage/ | **Stage view:** the citizen app in a phone frame (left) beside the operator console (right) | The projector, for the whole demo |
| http://localhost:3000/ | The **NetZero Hub citizen app** (web and mobile layouts). The only thing on the citizen port | The product itself; `?device=phone` shows it in a phone frame |
| http://localhost:4000/ | **Operator console** (localhost only): Stop/Start for each microservice and RabbitMQ, live architecture, queues, live process map, event feed | "Behind the scenes"; embedded on the right of the stage view |
| http://localhost:8181 | **Apromore** (admin / password) with the Part F logs loaded | Part F segment |

The app covers all 20 Part A services from the six providers. The five built as microservices (2.1 journey planner, 3.2 bay reservation, 3.3 charging and billing, 5.1 footprint, 5.2 offsets, plus 3.1's live station status) run on the real backend. The other services are simulated providers inside the app, so every option works end to end.

**Demo cards** (already in the wallet after sign-up): Visa ending 4242 always approves. Mastercard ending 0341 is declined on the first try and approved on the retry. To show a card that is always declined, add 4000 0000 0000 0002 in Wallet.

## Setup (before the lecture: our slot is random, so be ready from the start)

```bash
docker compose up --build -d                                   # the Part E stack + the app
docker compose -f tools/apromore/docker-compose.yml up -d      # Apromore, for the Part F segment
./rehearse.sh --check                                          # all green?
```

1. Open http://localhost:4000/stage/ on the projector (full screen, browser zoom 100–110%).
2. In the app on the left, **sign out** (Profile → Sign out) so the demo starts with a fresh sign-up.
3. Open Apromore in a second tab, with Process Discoverer on *P4 EV Charging Session* and Arcs at 100%.
4. Keep `./rehearse.sh` open on the presenter laptop. It prompts each segment and runs the terminal moves.

## Run-of-show (8:00)

| Time | Segment | In the app (left) | What the audience sees on the right / what to say |
| --- | --- | --- | --- |
| 0:00–0:40 | **A citizen signs up** (A) | Create a profile: name, suburb, BYD Atto 3 | "NetZero Hub as a citizen sees it: six providers, twenty services, one account." Home shows an empty carbon ring. |
| 0:40–1:55 | **Footprint, then offset** (C) | Measure my footprint (3 steps) → Choose an offset → two projects → Mastercard 0341 → Buy | footprint-service answers synchronously. The offset is accepted at once, then the stages tick through asynchronously: the card is declined and retried automatically, credits are retired, the certificate is issued. The ring on Home fills in. |
| 1:55–4:15 | **EV charging, then kill billing** (B, C on the service panel) | Charging → a charger → Tomorrow → a time (booked times greyed out) → Reserve → I've arrived → Mastercard 0341 → declined → Try payment again → live session | Right side: tokens through gateway → reservation → payment gateway. **Press Stop on EV billing** in the service panel, then press *Stop charging and pay* in the app. The app says the receipt will come later; billing turns red and RabbitMQ shows "1 waiting · no consumer!". **Press Start on EV billing**: the "receipt is ready" notification arrives by itself. |
| 4:15–4:50 | **Plan a trip** (D) | Travel → Find routes → Choose the train | Parallel timetable and emission-factor lookups; green points for the low-carbon choice. |
| 4:50–5:30 | **The other providers** (D) | More → e-waste pickup with 5 TVs (rejected, fix, booked), or Which bin? → batteries; join a community event | All twenty services work. The e-waste flow is Part B Process 5 with its fix-and-retry loop. |
| 5:30–7:20 | **Live Part F** (E) | (the right panel) Process map → Reset; terminal starts a 40-case simulation; switch process; then Apromore | The map builds itself from the services' logs. Red dashed = behaviour our Part B model doesn't allow. Apromore: map, Duration overlay, discovered BPMN, Animate. |
| 7:20–8:00 | **Close** (A) | Home: ring, points, notifications | Part A service → Part B process → Part C contract → Part E microservice → Part F evidence, in one app. `./partf.sh` reproduces it all. |

`rehearse.sh` holds these budgets (exactly 8:00) and reports over/under time per segment after each rehearsal. Speaker letters are placeholders: assign each to a team member, who also takes that topic in Q&A.

## Q&A preparation (3 minutes)

| Likely question | Answer, with where to point |
| --- | --- |
| Which parts are real and which are simulated? | The journey planner, bay reservation, charging and billing, footprint and offsets are the five Part E microservices; the app calls them through the API gateway. The other fifteen providers' services are simulated inside the app, so the whole platform can be used end to end. |
| Why RabbitMQ and not HTTP calls? | Billing and offset certification have genuinely delayed outcomes (Part C's asynchronous contracts). The broker decouples producer from consumer, which is exactly what the billing-down demo showed. |
| How is double-booking prevented under concurrency? | Interval-overlap check and insert in one SQLite `IMMEDIATE` transaction (`ev-reservation-service/src/index.ts`, `tryBook`). The app also greys out booked slots using the station availability endpoint. |
| What if RabbitMQ itself goes down? | The event bus reconnects with back-off, re-subscribes, uses publisher confirms, and holds unsent events in an outbox. Show it live: press **Stop on RabbitMQ** in the service panel, end a charging session in the app, press **Start**; the receipt still arrives. |
| Can a citizen reach the operator console? | No. The citizen app on port 3000 only reaches the gateway's business APIs. The console runs as its own service on port 4000, bound to localhost. Its Stop/Start controls accept only this project's services, only stop and start, and only requests carrying the console's own header, so a web page can't trigger them cross-site. |
| What if a message is delivered twice? | Consumers are idempotent: billing claims the session with `INSERT … ON CONFLICT DO NOTHING`; offset claims `pending → processing` atomically. |
| How does the app know when billing finishes? | It keeps a watch list and polls the billing and offset services; when an asynchronous outcome lands it shows a notification. In production this would be a push channel fed by the `ev.billing.settled` and `offset.certified` events. |
| Why SQLite? | Database-per-service with zero ops for a demo; each service owns its file and volume. In production each would get its own Postgres. |
| Where is authentication? | Out of scope for the project: sign-up is local to the device. It would be added at the gateway (OAuth2/OIDC token validation) so services trust the gateway. |
| Are the Part F logs real? | Every event is written by the real running services; only the human actors are simulated (seeded, reproducible), as stated in PART-F §F.1/F.7. |

## Fallbacks

- A service misbehaves: `docker compose restart <service>`. Worst case: `docker compose down -v && docker compose up --build -d` (about 20 s).
- The stage view misbehaves: open http://localhost:3000/?device=phone on its own; use http://localhost:4000/ for the behind-the-scenes view.
- The Stop/Start buttons say the controls are unavailable (no Docker socket at /var/run/docker.sock, e.g. rootless Docker or Podman): use `docker compose stop ev-billing-service` / `docker compose start ev-billing-service` in a terminal instead.
- Terminal-only fallback: `PAUSE=1 ./demo.sh` tells the same story through the API.
- Everything fails: play the recorded demo video (the same run-of-show, required for submission anyway).

## The ≤10-minute video (due with the final deliverables, 11:00 Wed 21 Oct 2026)

Record this run-of-show on the stage view (OBS or similar, 1920×1080). The extra 2 minutes can show the app's mobile layout, more of the simulated providers (energy plan switch, solar check, garden plot), and Apromore's animation.

## Hosting the app online (Vercel), optional

The backend cannot run on Vercel: it is long-running containers (RabbitMQ, five services with their own SQLite volumes, background consumers). The citizen app in `gateway/public/` is static files that call whichever gateway URL they are given (`?api=`). The operator console is deliberately not published: it controls the host's Docker and stays on localhost.

```bash
npx vercel deploy gateway/public --prod      # your own Vercel account
docker run --rm --network host cloudflare/cloudflared:latest tunnel --url http://localhost:3000   # temporary public HTTPS URL for the local gateway
```

Then open `https://<app>.vercel.app/?api=https://<random>.trycloudflare.com`. Stop the tunnel after use; while it runs, anyone with the link can use the demo API. For the lecture itself, the local setup is the most reliable.
