#!/usr/bin/env node
// Reads every service's *.jsonl process-event log from LOG_DIR, groups
// events by (process, caseId), and writes per business process into OUT_DIR:
//   <process>.xes             XES 1.0 event log (Disco, Apromore, ProM, pm4py)
//   <process>.csv             one row per event, lifecycle as a column
//   <process>.activities.csv  one row per activity instance, start + complete
//                             timestamp columns (easiest CSV import for Disco/Apromore) No dependencies: this is meant to run anywhere
// Node runs, including inside the tiny `log-exporter` container defined in
// docker-compose.yml.
//
// Usage:
//   node index.mjs                      # LOG_DIR=./logs, OUT_DIR=./exports
//   LOG_DIR=/app/logs OUT_DIR=/app/exports node index.mjs
//   TIME_SCALE=60 node index.mjs        # see below
//
// TIME_SCALE (default 1): the Part F simulator (tools/simulator) compresses
// business time so a few hundred cases run in minutes -- one wall-clock
// second stands for one simulated minute. TIME_SCALE=60 stretches every
// timestamp away from the first event in the log by that factor
// (t' = t0 + (t - t0) * scale), a linear transform that keeps every
// ordering and every ratio between durations intact, so Disco/Apromore show
// durations in business units (minutes/hours) rather than seconds.

import fs from "node:fs";
import path from "node:path";

const LOG_DIR = process.env.LOG_DIR || "./logs";
const OUT_DIR = process.env.OUT_DIR || "./exports";
const TIME_SCALE = Number(process.env.TIME_SCALE || 1);
if (!(TIME_SCALE > 0)) {
  console.error(`TIME_SCALE must be a positive number (got ${process.env.TIME_SCALE})`);
  process.exit(1);
}

function readAllEvents(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`Log directory not found: ${dir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  if (files.length === 0) {
    console.warn(`No *.jsonl files found in ${dir} -- generate some traffic first (see demo.sh).`);
  }
  const events = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch (err) {
        console.warn(`Skipping malformed line in ${file}: ${err.message}`);
      }
    }
  }
  return events;
}

function groupByProcess(events) {
  const byProcess = new Map();
  for (const e of events) {
    if (!byProcess.has(e.process)) byProcess.set(e.process, []);
    byProcess.get(e.process).push(e);
  }
  return byProcess;
}

function groupByCase(events) {
  const byCase = new Map();
  for (const e of events) {
    if (!byCase.has(e.caseId)) byCase.set(e.caseId, []);
    byCase.get(e.caseId).push(e);
  }
  for (const trace of byCase.values()) {
    trace.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }
  return byCase;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// --- CSV -------------------------------------------------------------------

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(process_, byCase, outPath) {
  const dataKeys = new Set();
  for (const trace of byCase.values()) {
    for (const e of trace) {
      for (const k of Object.keys(e.data || {})) dataKeys.add(k);
    }
  }
  const dataKeysSorted = [...dataKeys].sort();
  const headers = ["Case ID", "Activity", "Timestamp", "Lifecycle", "Resource", "Service", "BPMN Ref", "Case Outcome", ...dataKeysSorted.map((k) => `data.${k}`)];

  const rows = [headers.join(",")];
  const cases = [...byCase.entries()].sort((a, b) => new Date(a[1][0].timestamp) - new Date(b[1][0].timestamp));
  for (const [caseId, trace] of cases) {
    for (const e of trace) {
      const row = [
        caseId,
        e.activity,
        e.timestamp,
        e.lifecycle,
        e.resource,
        e.service,
        e.bpmnRef ?? "",
        trace[trace.length - 1].activity,
        ...dataKeysSorted.map((k) => {
          const v = e.data ? e.data[k] : undefined;
          if (v === undefined || v === null) return "";
          return typeof v === "object" ? JSON.stringify(v) : v;
        }),
      ];
      rows.push(row.map(csvEscape).join(","));
    }
  }
  fs.writeFileSync(outPath, rows.join("\n") + "\n");
}

// --- Activity-instance CSV ----------------------------------------------------
// One row per activity *instance*: the k-th "start" of an activity in a case
// is paired with its k-th "complete". Activities logged only on completion
// get Start Timestamp = Complete Timestamp. This is the layout Disco and
// Apromore expect for durations from CSV (map both timestamp columns).

function writeActivityCsv(byCase, outPath) {
  const headers = ["Case ID", "Activity", "Start Timestamp", "Complete Timestamp", "Resource", "Service", "BPMN Ref", "Case Outcome"];
  const rows = [headers.join(",")];
  const cases = [...byCase.entries()].sort((a, b) => new Date(a[1][0].timestamp) - new Date(b[1][0].timestamp));
  for (const [caseId, trace] of cases) {
    const outcome = trace[trace.length - 1].activity;
    const openStarts = new Map(); // activity -> queue of start events
    const instances = [];
    for (const e of trace) {
      if (e.lifecycle === "start") {
        if (!openStarts.has(e.activity)) openStarts.set(e.activity, []);
        openStarts.get(e.activity).push(e);
      } else {
        const start = openStarts.get(e.activity)?.shift();
        instances.push({ start: start ? start.timestamp : e.timestamp, e });
      }
    }
    instances.sort((a, b) => new Date(a.start) - new Date(b.start));
    for (const { start, e } of instances) {
      rows.push([caseId, e.activity, start, e.timestamp, e.resource, e.service, e.bpmnRef ?? "", outcome].map(csvEscape).join(","));
    }
  }
  fs.writeFileSync(outPath, rows.join("\n") + "\n");
}

// --- XES 1.0 -----------------------------------------------------------------

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xesAttribute(key, value) {
  if (typeof value === "boolean") return `      <boolean key="${xmlEscape(key)}" value="${value}"/>`;
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? `      <int key="${xmlEscape(key)}" value="${value}"/>`
      : `      <float key="${xmlEscape(key)}" value="${value}"/>`;
  }
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `      <string key="${xmlEscape(key)}" value="${xmlEscape(s)}"/>`;
}

function writeXes(process_, byCase, outPath) {
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<log xes.version="1.0" xes.features="nested-attributes" xmlns="http://www.xes-standard.org/">`);
  lines.push(`  <extension name="Concept" prefix="concept" uri="http://code.deckfour.org/xes/concept.xesext"/>`);
  lines.push(`  <extension name="Lifecycle" prefix="lifecycle" uri="http://code.deckfour.org/xes/lifecycle.xesext"/>`);
  lines.push(`  <extension name="Organizational" prefix="org" uri="http://code.deckfour.org/xes/org.xesext"/>`);
  lines.push(`  <extension name="Time" prefix="time" uri="http://code.deckfour.org/xes/time.xesext"/>`);
  lines.push(`  <global scope="trace"><string key="concept:name" value="UNKNOWN"/></global>`);
  lines.push(
    `  <global scope="event"><string key="concept:name" value="UNKNOWN"/><string key="lifecycle:transition" value="complete"/><string key="org:resource" value="UNKNOWN"/><date key="time:timestamp" value="1970-01-01T00:00:00.000Z"/></global>`
  );
  lines.push(`  <classifier name="Activity" keys="concept:name"/>`);
  lines.push(`  <classifier name="Activity Classifier" keys="concept:name lifecycle:transition"/>`);
  lines.push(`  <string key="concept:name" value="${xmlEscape(process_)}"/>`);

  const cases = [...byCase.entries()].sort((a, b) => new Date(a[1][0].timestamp) - new Date(b[1][0].timestamp));
  for (const [caseId, trace] of cases) {
    lines.push(`  <trace>`);
    lines.push(`    <string key="concept:name" value="${xmlEscape(caseId)}"/>`);
    const userId = trace.find((e) => e.data && e.data.userId)?.data.userId;
    if (userId) lines.push(`    <string key="userId" value="${xmlEscape(userId)}"/>`);
    lines.push(`    <string key="outcome" value="${xmlEscape(trace[trace.length - 1].activity)}"/>`);
    for (const e of trace) {
      lines.push(`    <event>`);
      lines.push(`      <string key="concept:name" value="${xmlEscape(e.activity)}"/>`);
      lines.push(`      <string key="lifecycle:transition" value="${xmlEscape(e.lifecycle)}"/>`);
      lines.push(`      <string key="org:resource" value="${xmlEscape(e.resource)}"/>`);
      lines.push(`      <date key="time:timestamp" value="${xmlEscape(e.timestamp)}"/>`);
      if (e.bpmnRef) lines.push(xesAttribute("bpmnRef", e.bpmnRef));
      if (e.service) lines.push(xesAttribute("service", e.service));
      for (const [k, v] of Object.entries(e.data || {})) {
        if (v !== undefined && v !== null) lines.push(xesAttribute(k, v));
      }
      lines.push(`    </event>`);
    }
    lines.push(`  </trace>`);
  }
  lines.push(`</log>`);
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
}

// --- Main --------------------------------------------------------------------

const events = readAllEvents(LOG_DIR);
if (TIME_SCALE !== 1 && events.length > 0) {
  const t0 = events.reduce((min, e) => Math.min(min, Date.parse(e.timestamp)), Infinity);
  for (const e of events) e.timestamp = new Date(t0 + (Date.parse(e.timestamp) - t0) * TIME_SCALE).toISOString();
}
const byProcess = groupByProcess(events);
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`Read ${events.length} events across ${byProcess.size} process(es) from ${LOG_DIR}${TIME_SCALE !== 1 ? ` (time scale x${TIME_SCALE})` : ""}\n`);

for (const [process_, procEvents] of byProcess.entries()) {
  const byCase = groupByCase(procEvents);
  const slug = slugify(process_);
  const csvPath = path.join(OUT_DIR, `${slug}.csv`);
  const xesPath = path.join(OUT_DIR, `${slug}.xes`);

  const activityCsvPath = path.join(OUT_DIR, `${slug}.activities.csv`);
  writeCsv(process_, byCase, csvPath);
  writeActivityCsv(byCase, activityCsvPath);
  writeXes(process_, byCase, xesPath);

  console.log(`${process_}`);
  console.log(`  cases:  ${byCase.size}`);
  console.log(`  events: ${procEvents.length}`);
  console.log(`  -> ${csvPath}`);
  console.log(`  -> ${activityCsvPath}`);
  console.log(`  -> ${xesPath}\n`);
}

if (byProcess.size === 0) {
  console.log("Nothing to export yet. Run demo.sh against the running stack first, then re-run this exporter.");
}
