# Apromore (local) for Part F

Apromore Community Edition 8.1 runs locally in Docker, so the team can use it on Linux, Windows or macOS with no account or licence. (Disco needs Windows or macOS.) The setup is adapted from the official [apromore/ApromoreDocker](https://github.com/apromore/ApromoreDocker) `release/v8.1` distribution; see the comments in `docker-compose.yml` for what was changed.

```bash
docker compose -f tools/apromore/docker-compose.yml up -d     # first start: ~300 MB download, ~1-2 min to boot
docker compose -f tools/apromore/docker-compose.yml down      # stop (add -v to wipe uploaded logs)
```

Open http://localhost:8181 and log in with the distribution's default account, `admin` / `password` (local only).

## Loading the Part F artefacts

**Upload** (cloud-arrow icon) accepts `.xes` and `.bpmn`. Upload:

| File | What it is |
| --- | --- |
| `docs/part-f-results/event-logs/ev-charging-session.xes` | Process 4 event log (131 cases) |
| `docs/part-f-results/event-logs/environmental-services.xes` | Process 6 event log (120 cases) |
| `docs/part-f-results/event-logs/carbon-optimized-journey-planner.xes` | Process 3 event log (120 cases) |
| `docs/part-f-results/<process>/reference-model.bpmn` | The Part B model of each process, as BPMN 2.0 XML |

Use a fresh run's logs from `exports/` instead if you re-ran `./partf.sh`.

## What to do in Apromore

1. Select a log → **Discover → Discover model** opens **Process Discoverer**.
2. Set **Arcs** to 100 (the default of 10% hides the less frequent arcs, such as the retry loops) and press *Fit to screen*.
3. **Frequency overlay** (default) shows case counts on every activity and arc. Click **Duration** to switch to the performance overlay (mean times on arcs and activities).
4. Flip **Process map → BPMN model** to see the BPMN model Apromore discovers (Split Miner) from the log.
5. **Animate** (play icon) replays the log as tokens over the map; press ▶ in the player.
6. **Filter** (funnel) narrows the log, for example *Case attribute* `outcome` ≠ `Issue digital receipt` to isolate the unsuccessful EV cases.
7. Select a `reference-model` → **Discover → Edit model** opens it in the BPMN editor, for a side-by-side comparison with the discovered model.

Apromore Community Edition 8.1 has no automated conformance checker (that is in the commercial edition), so the fitness/precision numbers in `docs/PART-F.md` come from pm4py. The visual comparison between the discovered and reference models in Apromore shows the same deviations.

Screenshots of these steps from the reference run are in `docs/part-f-results/apromore/`.
