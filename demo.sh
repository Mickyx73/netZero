#!/usr/bin/env bash
# NetZero Hub — Part E live demo script.
# Exercises all five microservices through the API gateway, in the order
# used for the Week 12 demonstration. Run after `docker compose up --build -d`.
#
#   ./demo.sh            # runs straight through
#   PAUSE=1 ./demo.sh    # waits for Enter before each step (for presenting)
#
# Tip: open http://localhost:3000 alongside -- its "Live process events"
# panel shows every step below arriving from the services in real time.
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
USER_ID="DEMO-USER-$RANDOM"
STATION_ID="CN-WOL-0$((RANDOM % 8 + 1))"
# A slot far enough in the future that repeated runs never collide.
DAY=$(( (RANDOM % 300) + 30 ))
SLOT_START=$(python3 -c "import datetime as d; print((d.datetime(2026,11,1,9,tzinfo=d.timezone.utc)+d.timedelta(days=$DAY)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
SLOT_END=$(python3 -c "import datetime as d; print((d.datetime(2026,11,1,9,30,tzinfo=d.timezone.utc)+d.timedelta(days=$DAY)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
OVERLAP_START=$(python3 -c "import datetime as d; print((d.datetime(2026,11,1,9,15,tzinfo=d.timezone.utc)+d.timedelta(days=$DAY)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
OVERLAP_END=$(python3 -c "import datetime as d; print((d.datetime(2026,11,1,9,45,tzinfo=d.timezone.utc)+d.timedelta(days=$DAY)).strftime('%Y-%m-%dT%H:%M:%SZ'))")

pretty() { python3 -m json.tool 2>/dev/null || cat; }
field() { python3 -c "import sys,json; print(json.load(sys.stdin)['$1'])"; }
step() {
  echo; echo "=================================================================="; echo "== $1"; echo "=================================================================="
  if [[ "${PAUSE:-0}" == "1" ]]; then read -r -p "   [Enter] to run " _; fi
}
post() { curl -s -X POST "$BASE$1" -H "Content-Type: application/json" -d "$2"; }

curl -sf "$BASE/api/health" >/dev/null || { echo "Gateway not reachable at $BASE — run: docker compose up --build -d"; exit 1; }

step "1. Carbon-Optimized Journey Planner (synchronous, scatter-gather + inclusive gateway)"
post /api/journeys/plan '{"origin":"Wollongong","destination":"Sydney CBD","maxDurationMins":60}' | pretty

step "2a. EV Charging Reservation — $STATION_ID $SLOT_START succeeds"
RES=$(post /api/reservations "{\"stationId\":\"$STATION_ID\",\"userId\":\"$USER_ID\",\"slotStart\":\"$SLOT_START\",\"slotEnd\":\"$SLOT_END\"}")
echo "$RES" | pretty
RESERVATION_ID=$(echo "$RES" | field reservationId)

step "2b. Another driver asks for an OVERLAPPING slot -> rejected with alternates (QoS: 0% double-booking)"
post /api/reservations "{\"stationId\":\"$STATION_ID\",\"userId\":\"OTHER-USER\",\"slotStart\":\"$OVERLAP_START\",\"slotEnd\":\"$OVERLAP_END\"}" | pretty

step "3a. Driver plugs in: authenticated, but the card's pre-authorisation is DECLINED (BPMN 4.7 = No -> 4.7a)"
post "/api/reservations/$RESERVATION_ID/start" '{"paymentToken":"tok_decline_1"}' | pretty

step "3b. Driver retries (loop back to 4.6): approved -> charging session starts (4.8)"
post "/api/reservations/$RESERVATION_ID/start" '{"paymentToken":"tok_decline_1"}' | pretty

step "3c. Driver unplugs -> publishes ev.session.ended to RabbitMQ"
post "/api/reservations/$RESERVATION_ID/complete" '{"kWhConsumed": 22.5}' | pretty
echo "Waiting for ev-billing-service to consume the event and settle asynchronously..."
for _ in $(seq 1 20); do
  BILL=$(curl -s "$BASE/api/billing/$RESERVATION_ID")
  echo "$BILL" | grep -q '"settled"' && break
  sleep 0.5
done

step "3d. Receipt from EV Billing Service (captured against the hold, remainder released)"
echo "$BILL" | pretty

step "3e. A second unplug is refused — the session can only end (and be billed) once"
post "/api/reservations/$RESERVATION_ID/complete" '{"kWhConsumed": 30}' | pretty

step "4. Carbon Footprint Calculator (synchronous)"
FP=$(post /api/footprint "{\"userId\":\"$USER_ID\",\"energyKwhMonth\":350,\"transportKmWeek\":120,\"dietScore\":4}")
echo "$FP" | pretty
FOOTPRINT_CASE_ID=$(echo "$FP" | field caseId)
echo "Footprint case ID: $FOOTPRINT_CASE_ID — threaded into the offset purchase below, so the whole"
echo "Environmental Services process (BPMN 6.1 through 6.13) is ONE process-mining case across two services."

step "5a. Carbon Offset Purchase (6.4 = Yes) — accepted immediately (202), fulfilled asynchronously"
OFF=$(post /api/offsets "{\"userId\":\"$USER_ID\",\"amountCo2Kg\":500,\"projectTypes\":[\"reforestation\",\"renewable\"],\"paymentToken\":\"tok_ok\",\"caseId\":\"$FOOTPRINT_CASE_ID\"}")
echo "$OFF" | pretty
OFFSET_ID=$(echo "$OFF" | field offsetId)
echo "Waiting for: reserve credits (6.6||6.7) -> payment (6.8) -> registry retirement (6.10) -> certificate (6.12)..."
for _ in $(seq 1 30); do
  CERT=$(curl -s "$BASE/api/offsets/$OFFSET_ID")
  echo "$CERT" | grep -q '"certified"\|"payment_failed"' && break
  sleep 0.5
done

step "5b. Offset certificate"
echo "$CERT" | pretty

step "5c. Footprint re-read — net-emissions score updated by offset-service's callback (6.13), same case"
sleep 0.5
curl -s "$BASE/api/footprint/$USER_ID" | pretty

step "6. Gateway aggregate dashboard — four services composed into one citizen view"
curl -s "$BASE/api/citizen/$USER_ID/dashboard" | pretty

echo
echo "Demo complete for user $USER_ID."
echo
echo "Every step above was written as a case-correlated process event to ./logs/<service>.jsonl."
echo "For Part F (hundreds of simulated cases + exports + mining) run: ./partf.sh"
