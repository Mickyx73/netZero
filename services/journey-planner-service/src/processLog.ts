import fs from "node:fs";
import path from "node:path";

// Process-mining event log. Every business-relevant task/gateway execution
// across the whole system is appended here as one JSON line, in a shared
// directory every service writes into (see docker-compose.yml's ./logs bind
// mount). tools/log-exporter/ later reads every service's *.jsonl file,
// groups events by (process, caseId), and emits one CSV and one XES file per
// business process -- directly importable into Disco and Apromore.
//
// Field choices deliberately mirror the XES standard so the export step is a
// near-direct mapping rather than a reinterpretation:
//   process    -> groups events into one of the Part B business processes
//   caseId     -> XES trace / concept:name of the trace
//   activity   -> XES event / concept:name
//   lifecycle  -> XES lifecycle:transition ("start" | "complete")
//   resource   -> XES org:resource
//   timestamp  -> XES time:timestamp
//   bpmnRef    -> cross-reference back to the Part B element numbering
//                 (e.g. "4.4"), kept as a plain event attribute
//   data       -> any other case/event attributes (amounts, ids, outcomes)

const LOG_DIR = process.env.LOG_DIR || "./logs";
fs.mkdirSync(LOG_DIR, { recursive: true });

const SERVICE_NAME = process.env.SERVICE_NAME || "unknown-service";
const LOG_FILE = path.join(LOG_DIR, `${SERVICE_NAME}.jsonl`);

export type Lifecycle = "start" | "complete";

export interface ProcessEvent {
  /** One of the Part B business process names, e.g. "EV Charging Session". */
  process: string;
  /** Process-instance (case) identifier. Shared across services for a composed process. */
  caseId: string;
  /** Task/gateway label, matching Part B's element names where possible. */
  activity: string;
  lifecycle: Lifecycle;
  /** Participant or service performing the activity (e.g. "Driver", "ev-billing-service"). */
  resource: string;
  /** Cross-reference to the Part B element numbering, e.g. "4.4". */
  bpmnRef?: string;
  /** Any additional case/event attributes (amounts, ids, outcomes, ...). */
  data?: Record<string, unknown>;
  /** Overrides the timestamp (defaults to now). Rarely needed. */
  timestamp?: string;
}

export function logEvent(evt: ProcessEvent): void {
  const record = {
    process: evt.process,
    caseId: evt.caseId,
    activity: evt.activity,
    lifecycle: evt.lifecycle,
    resource: evt.resource,
    timestamp: evt.timestamp ?? new Date().toISOString(),
    bpmnRef: evt.bpmnRef ?? null,
    service: SERVICE_NAME,
    data: evt.data ?? {},
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + "\n");
  console.log(
    `[process-log] ${evt.process} | case=${evt.caseId} | ${evt.activity} (${evt.lifecycle})${
      evt.bpmnRef ? ` [BPMN ${evt.bpmnRef}]` : ""
    }`
  );
}
