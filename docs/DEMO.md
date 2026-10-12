# Week 12 Live Demo Runbook (8 minutes + 3 minutes Q&A)

The rules from the lecture: **no PPT slides, run the tool live, focus on what was implemented for the microservices, and every member present.** The demo is run entirely from the system itself: the browser console is the "slide", and a terminal next to it provides the proof.

## Setup (before the lecture: our slot is random, so be ready from the start)

```bash
docker compose up --build -d                                   # the Part E stack
docker compose -f tools/apromore/docker-compose.yml up -d      # Apromore, for the Part F segment
./rehearse.sh --check                                          # all green?
./demo.sh                                                      # warm-up: every step prints a 2xx outcome
```

| Screen | What is on it |
| --- | --- |
| Projector (browser, full screen) | `http://localhost:3000/?present=1&theme=light`: presenter mode, light theme for projectors |
| Second browser tab | Apromore (`http://localhost:8181`), with Process Discoverer already open on *P4 EV Charging Session*, arcs at 100% |
| Presenter laptop terminal | `./rehearse.sh` (teleprompter, timings, and the stop/start/simulate moves) |

Press `?` on the console for the key list. One person drives the keyboard; the others speak.

## Run-of-show

| Time | Segment | Keys / terminal | Say |
| --- | --- | --- | --- |
| 0:00–0:40 | **Hook** (A) | `S` starts the on-screen timer · `A` architecture view | "Five microservices, three of our Part B processes, an API gateway and RabbitMQ, all running live. Every click is a real service call; the diagram lights up from the services' own event logs." |
| 0:40–2:00 | **EV charging** (B) | `2` reserve · `3` double-book · `K` card → *declined once* · `4` · `4` · `5` | Overlap rejected with alternates (QoS 0% double-booking, in one SQLite transaction) → declined pre-authorisation, alert, retry (4.7a) → charging → unplug → billing settles asynchronously over RabbitMQ. `E`, click the case id: **one case across two services**. |
| 2:00–3:00 | **Resilience** (B+C) | `A` · `2` · `4` · terminal stops billing · `5` · *wait ~5 s* · terminal starts billing | "We kill the billing service mid-session." RabbitMQ turns to "→ billing: 1 waiting · no consumer!" and billing is red. Restart: the receipt appears by itself. No lost charge, no client retry. |
| 3:00–4:10 | **Footprint → offset** (C) | `6` · `O` card → *declined once* · `7` | 202 Accepted, then asynchronous: parallel credit reservations (6.6‖6.7), payment declined and retried (6.9), registry retirement, certificate, then offset-service calls footprint-service back (6.13) on the **same case**. |
| 4:10–4:50 | **Journey planner** (D) | type 40 in *Max minutes* · `1` | Scatter-gather: timetable and emission factors fetched in parallel (3.2/3.7); the inclusive gateway (3.10) prepares only modes within the time budget. |
| 4:50–5:20 | **Gateway aggregation** (D) | terminal stops footprint · `9` · terminal starts footprint | One endpoint composes four services, and it **degrades gracefully**: with footprint down the dashboard still loads, with that section empty. |
| 5:20–7:15 | **Live Part F** (E) | `M` process map · `R` reset · terminal starts a 40-case simulation · `M` again switches process | The map builds itself as simulated citizens and drivers hit the real services. **Red dashed = behaviour our own Part B model doesn't allow** (no-shows, abandonments, cancelled purchases): conformance checking, live. Then switch to Apromore: the 120-case log's process map, duration overlay (`Duration`), discovered BPMN (flip *BPMN model*), and *Animate*. |
| 7:15–8:00 | **Close** (A) | `A` | "Part A service → Part B process → Part C contract → Part E microservice → Part F evidence. All of it reproducible with one command, `./partf.sh`." |

The segment budgets in `rehearse.sh` add up to exactly 8:00, and it reports over/under time per segment after each rehearsal. The on-screen timer turns amber at 7:00 and red at 8:00.

Speaker letters are placeholders: assign A–E to team members (one segment each, plus the matching Q&A topic).

## Q&A preparation (3 minutes)

| Likely question | Answer, with where to point |
| --- | --- |
| Why RabbitMQ and not HTTP calls? | Billing and offset certification have genuinely delayed outcomes (Part C's asynchronous contracts). The broker decouples producer from consumer, which is exactly what the billing-down demo showed. |
| How is double-booking prevented under concurrency? | Interval-overlap check and insert in one SQLite `IMMEDIATE` transaction (`ev-reservation-service/src/index.ts`, `tryBook`). |
| What if RabbitMQ itself goes down? | The event bus reconnects with back-off, re-subscribes, uses publisher confirms, and holds unsent events in an outbox. Tested by stopping RabbitMQ mid-session: the event was delivered and billed after the broker returned. |
| What if a message is delivered twice? | Consumers are idempotent: billing claims the session with `INSERT … ON CONFLICT DO NOTHING`; offset claims `pending → processing` atomically. |
| How do you correlate one case across services? | The case id travels in the event payload (P4) or the API call (P6); every service logs against it. Click any case id in the Events view. |
| Why SQLite? | Database-per-service with zero ops for a demo; each service owns its file and volume. In production each would get its own Postgres. |
| How would it scale? | Stateless services scale horizontally behind the gateway; RabbitMQ consumers scale as competing consumers on the same durable queue. |
| Where is authentication? | Out of scope for the project; it would be added at the gateway (OAuth2/OIDC token validation) so that services trust the gateway. |
| Are the Part F logs real? | Every event is written by the real running services; only the human actors are simulated (seeded, reproducible), and that is stated in PART-F §F.1/F.7. |

## Fallbacks

- A service misbehaves: `docker compose restart <service>`. Worst case, `docker compose down -v && docker compose up --build -d` (about 20 s) gives a fresh stack.
- Browser problem: `PAUSE=1 ./demo.sh` tells the same story in the terminal.
- Everything fails: play the recorded demo video (the same run-of-show, required for submission anyway).

## The ≤10-minute video (due with the final deliverables, 11:00 Wed 21 Oct 2026)

Record this exact run-of-show (OBS or similar, 1920×1080, browser in presenter mode). With an 8-minute live slot, the video can use the remaining 2 minutes to slow down the Apromore part (animation, filters) and show `./partf.sh` running.

## Hosting the console online (Vercel), optional

The backend cannot run on Vercel. Vercel runs static sites and short-lived serverless functions; this system is long-running containers (RabbitMQ, five services with their own SQLite volumes, background consumers). The console itself (`gateway/public/index.html`) is a single static file that talks to whichever gateway URL is in its **API** field or `?api=` parameter:

```bash
npx vercel deploy gateway/public --prod      # your own Vercel account
docker run --rm --network host cloudflare/cloudflared:latest tunnel --url http://localhost:3000   # temporary public HTTPS URL for the local gateway
```

Then open `https://<app>.vercel.app/?api=https://<random>.trycloudflare.com&present=1`. Stop the tunnel after use; while it runs, anyone with the link can use the demo API. For the lecture itself, the local setup (no network dependency) is the most reliable.
