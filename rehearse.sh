#!/usr/bin/env bash
# NetZero Hub — Week 12 live-demo rehearsal / stage-manager script.
#
# A terminal teleprompter for the 8-minute demo: it shows each segment's
# speaker, what to do in the citizen app, and the talking points, times every
# segment against its budget, and runs the terminal-side moves (stopping and
# restarting billing, launching the live simulation) at the right moment.
#
#   ./rehearse.sh            # full run-through
#   ./rehearse.sh --check    # just verify the stack is ready to present
#
# On the projector open http://localhost:4000/stage/ : the citizen app (served
# on :3000) in a phone frame on the left, the live operator view of the
# services, with a stop/start switch for each, on the right.
set -uo pipefail
cd "$(dirname "$0")"

BASE="${BASE:-http://localhost:3000}"   # citizen app + API gateway
OPS="${OPS:-http://localhost:4000}"     # operator console
B=$'\e[1m'; D=$'\e[2m'; R=$'\e[0m'; G=$'\e[32m'; Y=$'\e[33m'; RED=$'\e[31m'; C=$'\e[36m'

healthy() { local h; h="$(curl -sf "$OPS/api/health")" || return 1; [[ -n "$h" && "$h" != *'"down"'* ]]; }

preflight() {
  echo "${B}Pre-flight checks${R}"
  local ok=1
  if healthy; then echo "  ${G}✔${R} all services up (app at $BASE)"; else echo "  ${RED}✘${R} services not healthy — run: docker compose up --build -d"; ok=0; fi
  if curl -sf "$OPS/api/broker" | grep -q '"broker":"up"'; then echo "  ${G}✔${R} RabbitMQ reachable"; else echo "  ${RED}✘${R} RabbitMQ not reachable"; ok=0; fi
  if curl -sf -o /dev/null "$OPS/stage/"; then echo "  ${G}✔${R} stage view at $OPS/stage/"; else echo "  ${RED}✘${R} stage view missing"; ok=0; fi
  if curl -sf "$OPS/api/services" | grep -q '"available":true'; then echo "  ${G}✔${R} stop/start controls working"; else echo "  ${Y}!${R} stop/start controls unavailable (Docker socket not mounted) — use the terminal"; fi
  if curl -sf -o /dev/null http://localhost:8181/; then echo "  ${G}✔${R} Apromore up (http://localhost:8181)"; else echo "  ${Y}!${R} Apromore not running — start: docker compose -f tools/apromore/docker-compose.yml up -d"; fi
  if [[ -f docs/part-f-results/event-logs/ev-charging-session.xes ]]; then echo "  ${G}✔${R} Part F event logs present"; else echo "  ${Y}!${R} no Part F logs yet — run ./partf.sh"; fi
  [[ $ok == 1 ]]
}

TOTAL_USED=0; REPORT=()
segment() { # segment <budget-seconds> <title> <speaker> <in the app> <talking points...>
  local budget=$1 title=$2 who=$3 todo=$4; shift 4
  echo; echo "${C}════════════════════════════════════════════════════════════════════${R}"
  printf "${B}%s${R}   ${D}speaker:${R} %s   ${D}budget:${R} %ss\n" "$title" "$who" "$budget"
  [[ -n "$todo" ]] && echo "  ${Y}do:${R} $todo"
  for p in "$@"; do echo "  • $p"; done
  read -r -p "  ${D}[Enter] start segment${R} " _
  SEG_T0=$SECONDS
}
end_segment() { # end_segment <budget> <title>
  read -r -p "  ${D}[Enter] segment done${R} " _
  local used=$((SECONDS - SEG_T0)) budget=$1
  TOTAL_USED=$((TOTAL_USED + used))
  local mark="${G}on time${R}"; (( used > budget + 10 )) && mark="${RED}+$((used - budget))s over${R}"; (( used < budget - 15 )) && mark="${Y}$((budget - used))s spare${R}"
  printf "  used %ss / %ss — %b   ${D}(running total %d:%02d of 8:00)${R}\n" "$used" "$budget" "$mark" $((TOTAL_USED / 60)) $((TOTAL_USED % 60))
  REPORT+=("$(printf '%-30s %4ss / %4ss' "$2" "$used" "$budget")")
}

preflight || { [[ "${1:-}" == "--check" ]] && exit 1; read -r -p "Continue anyway? [y/N] " a; [[ "$a" == "y" ]] || exit 1; }
[[ "${1:-}" == "--check" ]] && exit 0

echo; echo "${B}Projector:${R} $OPS/stage/   ${D}(app on the left, live services on the right; Apromore in a second tab)${R}"
echo "${D}Demo cards in the app's wallet: Visa ending 4242 always approves; Mastercard ending 0341 is declined on the first try, then approved.${R}"

segment 40 "1. Hook: a citizen signs up" "Member A" "In the app: create a profile (name, suburb, EV)." \
  "NetZero Hub as a citizen sees it: six providers, twenty services, one account." \
  "Left is the app; right is the five microservices, RabbitMQ and the gateway reacting to every tap."
end_segment 40 "1. Hook: a citizen signs up"

segment 75 "2. Footprint, then offset" "Member C" "Measure my footprint (3 steps) → Choose an offset → pick 2 projects → pay with Mastercard 0341." \
  "footprint-service calculates it in one synchronous call; the ring on Home shows it." \
  "The offset is accepted at once (202) and fulfilled asynchronously over RabbitMQ: the card is declined, retried automatically, credits are retired, the certificate is issued." \
  "One process instance across two services: offset-service calls footprint-service back and the ring fills in."
end_segment 75 "2. Footprint, then offset"

segment 140 "3. EV charging + kill billing" "Member B (+ C on the service panel)" "Charging → pick a charger → Tomorrow → a time (booked times are greyed out) → Reserve → I've arrived → Mastercard 0341 → declined → Try payment again → live session." \
  "Booked slots come from the reservation service; overlapping bookings are impossible (one SQLite transaction)." \
  "Declined pre-authorisation → the app explains it → retry: BPMN 4.6 → 4.7a → 4.6."
echo "  ${Y}On the stage view's left-hand panel, press Stop on EV billing${R} (before pressing 'Stop charging and pay')."
echo "  → press 'Stop charging and pay'. The app says the receipt will come later; right side: billing red, '→ billing: 1 waiting · no consumer!'"
echo "  ${Y}Then press Start on EV billing.${R}"
echo "  → a 'Your charging receipt is ready' notification arrives by itself. No lost charge, no retry by the user."
echo "  ${D}(If the panel's controls are unavailable: docker compose stop ev-billing-service / docker compose start ev-billing-service)${R}"
end_segment 140 "3. EV charging + kill billing"

segment 35 "4. Plan a trip" "Member D" "Travel → Find routes (Wollongong to Sydney CBD) → Choose the train." \
  "journey-planner-service fetches timetable and emission factors in parallel, then ranks only the modes that fit the time budget." \
  "Choosing the low-carbon trip earns green points: the platform's incentive scheme."
end_segment 35 "4. Plan a trip"

segment 40 "5. The other providers" "Member D" "More → Book an e-waste pickup with 5 TVs (rejected, then fix) or Which bin? → batteries; Join a community event (ticket)." \
  "Every one of the twenty Part A services works; the five we built as microservices run on the real backend, the other fifteen are simulated providers behind the same app." \
  "The e-waste flow is Part B Process 5: service-area check, item limits with a fix-and-retry loop, then a truck route."
end_segment 40 "5. The other providers"

segment 110 "6. Live Part F" "Member E" "Right panel: Process map tab, Reset; terminal starts the simulation; switch process; then the Apromore tab." \
  "The simulator plays 40 citizens and drivers per process against the same services; the map builds itself from their event logs." \
  "Red dashed = behaviour our own Part B model doesn't allow: no-shows, abandonments, cancelled purchases. Conformance checking, live." \
  "Apromore on the 120-case log: process map, Duration overlay, discovered BPMN, Animate."
read -r -p "  ${Y}[Enter] to START the live simulation (runs in background, ~2 min)${R} " _
( CASES=40 SEED=$RANDOM docker compose run --rm simulator > /tmp/netzero-live-sim.log 2>&1 & )
echo "  → simulation running (log: /tmp/netzero-live-sim.log). Switch to Apromore after ~60s."
end_segment 110 "6. Live Part F"

segment 40 "7. Close" "Member A" "Back to the app's Home: the carbon ring, points, notifications." \
  "Part A service → Part B process → Part C contract → Part E microservice → Part F evidence, all visible in one app." \
  "Everything you saw is reproducible with one command: ./partf.sh."
end_segment 40 "7. Close"

echo; echo "${B}Rehearsal summary${R}"
for r in "${REPORT[@]}"; do echo "  $r"; done
printf "  ${B}TOTAL %d:%02d${R} of 8:00 budget\n" $((TOTAL_USED / 60)) $((TOTAL_USED % 60))
(( TOTAL_USED > 480 )) && echo "  ${RED}Over time — trim the longest segment.${R}" || echo "  ${G}Within the 8-minute slot.${R}"
