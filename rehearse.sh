#!/usr/bin/env bash
# NetZero Hub — Week 12 live-demo rehearsal / stage-manager script.
#
# A terminal teleprompter for the 8-minute demo: it shows each segment's
# speaker, the keys to press in the browser console, and the talking points,
# times every segment against its budget, and runs the terminal-side moves
# (stopping/starting billing, launching the live simulation) at the right
# moment. Use it to rehearse, and keep it open on the presenter's screen on
# the day.
#
#   ./rehearse.sh            # full run-through
#   ./rehearse.sh --check    # just verify the stack is ready to present
#
# Open http://localhost:3000/?present=1&theme=light on the projector first.
set -uo pipefail
cd "$(dirname "$0")"

BASE="${BASE:-http://localhost:3000}"
B=$'\e[1m'; D=$'\e[2m'; R=$'\e[0m'; G=$'\e[32m'; Y=$'\e[33m'; RED=$'\e[31m'; C=$'\e[36m'

healthy() { local h; h="$(curl -sf "$BASE/api/health")" || return 1; [[ -n "$h" && "$h" != *'"down"'* ]]; }

preflight() {
  echo "${B}Pre-flight checks${R}"
  local ok=1
  if healthy; then echo "  ${G}✔${R} all services up ($BASE)"; else echo "  ${RED}✘${R} services not healthy — run: docker compose up --build -d"; ok=0; fi
  if curl -sf "$BASE/api/broker" | grep -q '"broker":"up"'; then echo "  ${G}✔${R} RabbitMQ reachable"; else echo "  ${RED}✘${R} RabbitMQ not reachable"; ok=0; fi
  if curl -sf -o /dev/null http://localhost:8181/; then echo "  ${G}✔${R} Apromore up (http://localhost:8181)"; else echo "  ${Y}!${R} Apromore not running — start: docker compose -f tools/apromore/docker-compose.yml up -d"; fi
  if [[ -f docs/part-f-results/event-logs/ev-charging-session.xes ]]; then echo "  ${G}✔${R} Part F event logs present"; else echo "  ${Y}!${R} no Part F logs yet — run ./partf.sh"; fi
  [[ $ok == 1 ]]
}

TOTAL_BUDGET=0; TOTAL_USED=0; REPORT=()
segment() { # segment <budget-seconds> <title> <speaker> <keys> <talking points...>
  local budget=$1 title=$2 who=$3 keys=$4; shift 4
  echo; echo "${C}════════════════════════════════════════════════════════════════════${R}"
  printf "${B}%s${R}   ${D}speaker:${R} %s   ${D}budget:${R} %ss\n" "$title" "$who" "$budget"
  [[ -n "$keys" ]] && echo "  ${Y}keys:${R} $keys"
  for p in "$@"; do echo "  • $p"; done
  read -r -p "  ${D}[Enter] start segment${R} " _
  local t0=$SECONDS
  SEG_T0=$t0
}
end_segment() { # end_segment <budget> <title>
  read -r -p "  ${D}[Enter] segment done${R} " _
  local used=$((SECONDS - SEG_T0)) budget=$1
  TOTAL_BUDGET=$((TOTAL_BUDGET + budget)); TOTAL_USED=$((TOTAL_USED + used))
  local mark="${G}on time${R}"; (( used > budget + 10 )) && mark="${RED}+$((used - budget))s over${R}"; (( used < budget - 15 )) && mark="${Y}$((budget - used))s spare${R}"
  printf "  used %ss / %ss — %b   ${D}(running total %d:%02d of 8:00)${R}\n" "$used" "$budget" "$mark" $((TOTAL_USED / 60)) $((TOTAL_USED % 60))
  REPORT+=("$(printf '%-28s %4ss / %4ss' "$2" "$used" "$budget")")
}

preflight || { [[ "${1:-}" == "--check" ]] && exit 1; read -r -p "Continue anyway? [y/N] " a; [[ "$a" == "y" ]] || exit 1; }
[[ "${1:-}" == "--check" ]] && exit 0

echo; echo "${B}Projector:${R} $BASE/?present=1&theme=light   ${D}(P presenter mode, ? key list, S starts the on-screen timer)${R}"

segment 40 "1. Hook" "Member A" "S (start timer), A (architecture)" \
  "Five microservices, three Part B processes, one gateway, RabbitMQ — all running live." \
  "Every click is a real service call; the right panel is the services reporting each BPMN step as it happens."
end_segment 40 "1. Hook"

segment 80 "2. EV charging (P4)" "Member B" "2 reserve · 3 double-book · K (card → declined once) · 4 · 4 · 5" \
  "Reserve → overlapping booking rejected with alternates: QoS 0% double-booking, enforced in one SQLite transaction." \
  "Declined card → 4.7a alert → retry → charging. Unplug → ev.session.ended over RabbitMQ → billing settles asynchronously." \
  "Press E and click the case id: one case across two independently deployed services."
end_segment 80 "2. EV charging (P4)"

segment 60 "3. Resilience" "Member B + C" "A (architecture) · 2 · 4 · [terminal stops billing] · 5 · wait ~5s · [terminal restarts billing]" \
  "We now kill the billing service mid-session."
read -r -p "  ${Y}[Enter] to STOP ev-billing-service now${R} " _
docker compose stop ev-billing-service 2>&1 | tail -1
echo "  → press 5 (Unplug). Point at RabbitMQ: '→ billing: 1 waiting · no consumer!'. The message is safe in a durable queue."
read -r -p "  ${Y}[Enter] to START ev-billing-service again${R} " _
docker compose start ev-billing-service 2>&1 | tail -1
echo "  → the receipt appears by itself: no retry logic in the client, no lost charge."
end_segment 60 "3. Resilience"

segment 70 "4. Footprint → offset (P6)" "Member C" "6 · O (card → declined once) · 7" \
  "202 Accepted, then asynchronous: project-type reservations in parallel (6.6‖6.7), payment retry (6.9), registry retirement, certificate." \
  "offset-service calls footprint-service back (6.13) on the SAME case: one process instance, two services, two databases."
end_segment 70 "4. Footprint → offset (P6)"

segment 40 "5. Journey planner (P3)" "Member D" "type 40 in Max minutes · 1" \
  "Scatter-gather: timetable and emission factors fetched in parallel (3.2/3.7)." \
  "Inclusive gateway (3.10): only modes meeting the time budget are prepared."
end_segment 40 "5. Journey planner (P3)"

segment 30 "6. Gateway aggregation" "Member D" "[terminal stops footprint] · 9 · [terminal restarts footprint]" \
  "One endpoint composes four services into the citizen dashboard — and degrades gracefully when one is down."
read -r -p "  ${Y}[Enter] to STOP footprint-service${R} " _
docker compose stop footprint-service 2>&1 | tail -1
echo "  → press 9: dashboard still loads; footprint section is empty instead of the whole page failing."
read -r -p "  ${Y}[Enter] to START footprint-service again${R} " _
docker compose start footprint-service 2>&1 | tail -1
end_segment 30 "6. Gateway aggregation"

segment 115 "7. Live Part F" "Member E" "M (process map) · R (reset) · [terminal starts simulation] · M to switch process" \
  "Part F live: the simulator plays 40 citizens/drivers per process against the real services." \
  "The process map builds itself; red dashed = behaviour our own Part B model does not allow (no-shows, abandonments)." \
  "Then Apromore (localhost:8181): Process Discoverer on the 120-case log — map, duration overlay, discovered BPMN, animation."
read -r -p "  ${Y}[Enter] to START the live simulation (runs in background, ~2 min)${R} " _
( CASES=40 SEED=$RANDOM docker compose run --rm simulator > /tmp/netzero-live-sim.log 2>&1 & )
echo "  → simulation running (log: /tmp/netzero-live-sim.log). Switch to Apromore after ~60s."
end_segment 115 "7. Live Part F"

segment 45 "8. Close" "Member A" "A (architecture)" \
  "Traceability: Part A service → Part B process → Part C contract → Part E microservice → Part F evidence." \
  "Everything you saw is reproducible with one command: ./partf.sh."
end_segment 45 "8. Close"

echo; echo "${B}Rehearsal summary${R}"
for r in "${REPORT[@]}"; do echo "  $r"; done
printf "  ${B}TOTAL %d:%02d${R} of 8:00 budget\n" $((TOTAL_USED / 60)) $((TOTAL_USED % 60))
(( TOTAL_USED > 480 )) && echo "  ${RED}Over time — trim the longest segment.${R}" || echo "  ${G}Within the 8-minute slot.${R}"
