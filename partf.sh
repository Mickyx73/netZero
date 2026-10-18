#!/usr/bin/env bash
# NetZero Hub -- Part F pipeline, one command:
#   1. bring the Part E stack up (if it isn't already) and wait until healthy
#   2. archive any previous process-event logs, so this run's log is clean
#   3. execute the three business processes with the simulator (real services)
#   4. export XES + CSV for Disco / Apromore (business-time and raw versions)
#   5. run the scripted process-mining analysis (pm4py) -> analysis/RESULTS.md
#
# Usage:  ./partf.sh                 # 120 cases per process, seed 2026
#         CASES=200 SEED=7 ./partf.sh
set -euo pipefail
cd "$(dirname "$0")"

export CASES="${CASES:-120}" SEED="${SEED:-2026}"
export HOST_UID="$(id -u)" HOST_GID="$(id -g)"
OPS="${OPS:-http://localhost:4000}"   # operator console: reports every service's health

echo "== 1/5  Starting the stack"
docker compose up --build -d
healthy() { local h; h="$(curl -sf "$OPS/api/health")" || return 1; [[ -n "$h" && "$h" != *'"down"'* ]]; }
for _ in $(seq 1 60); do healthy && break; sleep 2; done
healthy || { echo "Services did not become healthy"; docker compose ps; exit 1; }

echo "== 2/5  Archiving previous process-event logs"
STAMP="$(date +%Y%m%d-%H%M%S)"
# Done inside a container: the services write the logs as root.
docker run --rm -v "$PWD/logs:/logs" node:20-bookworm-slim sh -c \
  "ls /logs/*.jsonl >/dev/null 2>&1 && mkdir -p /logs/archive/$STAMP && mv /logs/*.jsonl /logs/archive/$STAMP/ || true"

echo "== 3/5  Simulating $CASES cases per process (seed $SEED) against the live services"
docker compose run --rm --build simulator

echo "== 4/5  Exporting event logs"
docker compose run --rm --build -e TIME_SCALE=60 log-exporter
docker compose run --rm -e TIME_SCALE=1 -e OUT_DIR=/app/exports/raw log-exporter

echo "== 5/5  Process mining (pm4py)"
docker compose run --rm --build process-miner

echo
echo "Done."
echo "  Event logs for Disco/Apromore : exports/*.xes, exports/*.csv  (1 s wall-clock = 1 simulated minute)"
echo "  Unscaled logs (service timing): exports/raw/"
echo "  Mining results                : analysis/RESULTS.md"
