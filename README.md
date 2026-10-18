# NetZero Hub — Parts E & F: Microservices and Process Analytics

Working implementation for **Part E** (microservices design & implementation) and **Part F** (service/process analytics) of the CSCI927/427 NetZero Hub group project. Five services from the platform designed in Parts A–C are implemented as independently deployable microservices. Their executions are logged per BPMN activity, simulated at scale, and mined with Disco, Apromore and pm4py.

| Document | Contents |
| --- | --- |
| [`docs/PART-E.md`](docs/PART-E.md) | Architecture, per-service design, code walkthrough, traceability to Parts A/B/C |
| [`docs/PART-F.md`](docs/PART-F.md) | Process execution, event logs, Disco/Apromore/pm4py method, results, insights |
| [`docs/DEMO.md`](docs/DEMO.md) | Week 12 live-demo runbook (8-minute run-of-show, keys, Q&A prep) and online hosting options |
| [`tools/apromore/README.md`](tools/apromore/README.md) | Running Apromore locally and loading the Part F logs |
| [`docs/part-f-results/`](docs/part-f-results/) | Snapshot of the Part F run used in the write-up: event logs, figures, `RESULTS.md` |

## Services in this stack

| Service | Port | Part A service | Part B process | Pattern |
| --- | --- | --- | --- | --- |
| `api-gateway` | 3000 | — | — | Single entry point for citizens, aggregation; serves the citizen app |
| `ev-reservation-service` | 3001 | 3.2 Charging Bay Reservation | Process 4 (4.1–4.8) | Synchronous |
| `ev-billing-service` | 3002 | 3.3 Automated EV Billing & Payment | Process 4 (4.9–4.12) | Asynchronous (event-driven) |
| `footprint-service` | 3003 | 5.1 Individual Carbon Footprint Calculator | Process 6 (6.1–6.4, 6.13) | Synchronous |
| `offset-service` | 3004 | 5.2 Carbon Offset Purchasing | Process 6 (6.5–6.12) | Asynchronous (event-driven) |
| `journey-planner-service` | 3005 | 2.1 Carbon-Optimized Journey Planner | Process 3 | Synchronous, scatter-gather |
| `rabbitmq` | 5672 / 15672 | — | — | Message broker for the two async flows |
| `ops-console` | 4000 (localhost only) | — | — | Operator console: live architecture, process map, event feed, stop/start controls for each service |

Each of the four data-owning services keeps its own SQLite file in its own Docker volume; no service reads another's database.

## Running it

Requires Docker with Docker Compose.

```bash
docker compose up --build -d
```

Then open:

| URL | What it is |
| --- | --- |
| **http://localhost:3000** | The **NetZero Hub citizen app**: sign up, then use all 20 Part A services from the six providers (web layout on desktop, app layout on phones; `?device=phone` frames it as a phone). Journey planning, EV booking, charging and billing, footprint and offsets run on the five microservices; the other providers' services are simulated in the app. |
| **http://localhost:4000** | **Operator console**, kept off the citizen port: a **Stop/Start switch for each microservice and RabbitMQ**, an architecture diagram animated by the services' own events (RabbitMQ queue depth, down services), a live process map, and the raw event feed. Keyboard shortcuts: `?`. |
| **http://localhost:4000/stage/** | **Stage view** for presenting: the app in a phone frame beside the operator console, so every tap can be seen reaching the services, and any service can be stopped mid-flow. |

The console controls containers through the Docker socket, which amounts to admin access to the host's Docker. It is therefore published on 127.0.0.1 only, can only stop or start this project's own services (never the gateway, never anything else on the machine), and only accepts control requests that carry its own `X-Ops-Console` header, so another website open in the same browser can't trigger them.

RabbitMQ's management UI is at http://localhost:15672 (guest/guest).

For the Week 12 demo: `./rehearse.sh` is a timed, segment-by-segment teleprompter for the 8-minute slot (`./rehearse.sh --check` checks the stack is ready). See `docs/DEMO.md`.

Stop with `docker compose down` (add `-v` to also wipe the demo databases).

### Terminal demo

```bash
./demo.sh            # all five services through the gateway, start to finish
PAUSE=1 ./demo.sh    # one step per Enter, for presenting
```

The script covers: journey plan → reservation → overlapping booking rejected with alternates → pre-authorisation declined, then retried → charging → asynchronous billing (hold captured, remainder released) → repeat unplug refused → footprint → offset purchase on the footprint's case → certificate → footprint score updated by callback → aggregated dashboard.

### Part F in one command

```bash
./partf.sh                     # 120 cases per process, seed 2026
CASES=200 SEED=7 ./partf.sh    # bigger / different run
```

It brings the stack up, archives old logs, runs the simulator against the live services, exports XES/CSV event logs for Disco and Apromore into `exports/` (plus unscaled logs in `exports/raw/`), and runs the pm4py analysis into `analysis/RESULTS.md`.

Apromore runs locally too: `docker compose -f tools/apromore/docker-compose.yml up -d`, then open http://localhost:8181 (see `tools/apromore/README.md`).

### Running a service without Docker (development)

Each service is a standalone Node/TypeScript app (`npm install && npm start` in `gateway/` or `services/<name>/`). Services that use events need a broker at `amqp://localhost:5672` (`docker run -d -p 5672:5672 rabbitmq:3-management`). Type-check with `npx tsc --noEmit`.

## Manual API reference

All routes are reachable through the gateway under `/api/...`.

```bash
# Journey planning (synchronous; maxDurationMins and modes are optional)
curl -X POST localhost:3000/api/journeys/plan -H "Content-Type: application/json" \
  -d '{"origin":"Wollongong","destination":"Sydney CBD","maxDurationMins":60,"modes":["train","bus","bike"]}'

# EV charging session
curl -X POST localhost:3000/api/reservations -H "Content-Type: application/json" \
  -d '{"stationId":"CN-WOL-01","userId":"USER-1","slotStart":"2026-11-01T09:00:00Z","slotEnd":"2026-11-01T09:30:00Z"}'
curl -X POST localhost:3000/api/reservations/<id>/start    -H "Content-Type: application/json" -d '{"paymentToken":"tok_ok"}'
curl -X POST localhost:3000/api/reservations/<id>/complete -H "Content-Type: application/json" -d '{"kWhConsumed":22.5}'
curl localhost:3000/api/billing/<id>                         # poll for the asynchronous receipt
curl -X POST localhost:3000/api/reservations/<id>/no-show    # (from 'confirmed')
curl -X POST localhost:3000/api/reservations/<id>/abandon    # (after a declined pre-authorisation)
curl -X POST localhost:3000/api/reservations/<id>/cancel     # (driver cancels a confirmed booking)
curl localhost:3000/api/stations                             # station catalogue + live status
curl "localhost:3000/api/stations/CN-WOL-01/availability?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z"

# Footprint, then offset on the same case (or decline at 6.4)
curl -X POST localhost:3000/api/footprint -H "Content-Type: application/json" \
  -d '{"userId":"USER-1","energyKwhMonth":350,"transportKmWeek":120,"dietScore":4}'
curl -X POST localhost:3000/api/offsets -H "Content-Type: application/json" \
  -d '{"userId":"USER-1","amountCo2Kg":500,"projectTypes":["reforestation","renewable"],"paymentToken":"tok_ok","caseId":"<footprint caseId>"}'
curl localhost:3000/api/offsets/<offsetId>                   # poll for the certificate
curl -X POST localhost:3000/api/footprint/USER-1/decline-offset -H "Content-Type: application/json" -d '{"caseId":"<footprint caseId>"}'

# Aggregation
curl localhost:3000/api/citizen/USER-1/dashboard

# Operator console (port 4000): health, broker, process-event feed, service controls
curl localhost:4000/api/health
curl localhost:4000/api/broker
curl "localhost:4000/api/process-events?limit=20"
curl localhost:4000/api/services
curl -X POST -H "X-Ops-Console: 1" localhost:4000/api/services/ev-billing-service/stop    # and .../start
```

Mock payment tokens (the bank network is simulated): `tok_ok` approves, `tok_decline_<n>` declines the first *n* attempts, and `tok_decline_all` always declines. Project types: `reforestation`, `renewable`, `waste-recycling`.

## Logging & process mining

Every service writes two independent logs:

- **Application logs**: structured JSON lines to stdout (`docker compose logs <service>`), with a `requestId` per HTTP request.
- **Process-event logs**: `logs/<service>.jsonl`, one line per BPMN activity, with `process`, `caseId`, `activity` (Part B task label), `lifecycle` (start/complete), `resource` (BPMN lane), `bpmnRef` (Part B element number), `service`, `timestamp` and `data`. Cases are correlated across services: a reservation's billing events, and a footprint's offset purchase and score update, share one case id.

`tools/log-exporter` turns these into, per process: `<process>.xes` (XES 1.0, which opens directly in Disco and Apromore), `<process>.activities.csv` (one row per activity instance with start and complete timestamps), and `<process>.csv` (one row per event).

```bash
docker compose run --rm log-exporter                     # real timestamps
docker compose run --rm -e TIME_SCALE=60 log-exporter    # for simulator logs: 1 s wall-clock = 1 simulated minute
```

## Repository layout

```
gateway/                 API gateway; public/ = citizen app (index.html + app/), ops/ console, stage/ view
services/<name>/         the five microservices (src/index.ts, db.ts, eventBus.ts, processLog.ts, paymentGateway.ts)
tools/simulator/         Part F process simulator (drives the live services)
tools/log-exporter/      JSONL -> XES / CSV
tools/apromore/          local Apromore Community Edition (Docker) for Part F
analytics/               Part F pm4py analysis (mine.py) and its Dockerfile
docs/                    Part E/F write-ups, demo runbook, diagrams (.mmd sources + .png), Part F results snapshot
demo.sh rehearse.sh partf.sh   terminal demo · timed demo rehearsal · Part F pipeline
logs/ exports/ analysis/ generated at runtime (git-ignored)
```
