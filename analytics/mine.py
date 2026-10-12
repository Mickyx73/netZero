"""NetZero Hub -- Part F process mining & service analytics.

Reads the XES event logs written by tools/log-exporter and, for each of the
three business processes realised in Part E, produces:

  1. Log profile      cases, events, variants, case outcomes, case durations
  2. Discovery        directly-follows graph (frequency + performance) and an
                      Inductive Miner BPMN model -- the scripted equivalent of
                      Disco's process map and Apromore's BPMN discovery
  3. Conformance      alignment-based fitness and precision of the *Part B
                      reference model* (hand-encoded from the BPMN diagrams)
                      against the observed log, with the deviations named
  4. Performance      activity service times (start/complete pairs), the
                      slowest hand-overs between activities, case durations
  5. Organisational   resource x activity matrix and hand-over-of-work counts

Everything is written to OUT_DIR (PNG figures + RESULTS.md). The numbers are
meant to be cross-checked against the same logs opened in Disco and Apromore
(see docs/PART-F.md).

Usage:
    python mine.py                            # EXPORT_DIR=../exports, OUT_DIR=./output
    EXPORT_DIR=/data/exports OUT_DIR=/data/analysis python mine.py
"""

from __future__ import annotations

import json
import os
import warnings
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
import pm4py  # noqa: E402

warnings.filterwarnings("ignore")

EXPORT_DIR = Path(os.environ.get("EXPORT_DIR", "../exports"))
OUT_DIR = Path(os.environ.get("OUT_DIR", "./output"))
TIME_UNIT = os.environ.get("TIME_UNIT", "min")  # unit used in tables: "min" for TIME_SCALE=60 logs, "s" for raw

CASE, ACT, TS, LC, RES = "case:concept:name", "concept:name", "time:timestamp", "lifecycle:transition", "org:resource"

# ---------------------------------------------------------------------------
# Part B reference models, encoded as process trees from the BPMN diagrams.
#   ->  sequence      X  exclusive gateway      +  parallel gateway
#   *(a, b)  loop: do a, then optionally b and a again (the BPMN retry loops)
# Inclusive gateways (3.10/3.11, 6.6/6.7) are encoded as a parallel block of
# optional branches, +(X(a, tau), X(b, tau), ...).
# Activities that the implementation logs but Part B does not model
# (no-shows, abandonments, cancelled purchases) are deliberately absent, so
# conformance checking can surface them.
# ---------------------------------------------------------------------------
REFERENCE_MODELS = {
    "carbon-optimized-journey-planner": {
        "title": "Process 3 — Carbon-Optimized Journey Planner",
        "tree": """->( 'Submit trip request',
                     +( 'Retrieve scheduled services and real-time data', 'Retrieve per-mode emission factors' ),
                     'Calculate candidate routes across all modes',
                     'Append CO2-e estimate to each route',
                     +( X('Prepare bus options', tau), X('Prepare train options', tau), X('Prepare bike share options', tau) ),
                     'Rank options by CO2 ascending',
                     'Present ranked journey plan' )""",
    },
    "ev-charging-session": {
        "title": "Process 4 — EV Charging Session",
        "tree": """->( 'Request bay reservation',
                     'Check bay availability',
                     X( 'Suggest alternate charging bays/time',
                        ->( 'Lock time slot and generate confirmation',
                            'Authenticate vehicle/driver at charging bay',
                            *( 'Pre-authorise estimated session cost', 'Alert driver and request pre-authorisation again' ),
                            'Conduct charging session',
                            'Retrieve final kWh and total duration',
                            'Calculate final cost from current tariff',
                            'Capture funds and settle transaction',
                            'Issue digital receipt' ) ) )""",
    },
    "environmental-services": {
        "title": "Process 6 — Carbon Footprint Calculation & Offset Purchase",
        "tree": """->( 'Initiate assessment',
                     'Calculate footprint',
                     'Present footprint report and peer comparison',
                     X( 'Record footprint baseline',
                        ->( 'Select amount of CO2 to offset',
                            +( X('Reserve reforestation credits', tau), X('Reserve renewable energy credits', tau), X('Reserve waste recycling credits', tau) ),
                            *( 'Process payment for offset units', 'Notify citizen of payment failure' ),
                            'Retire credits under citizen name',
                            'Mint and issue offset certificate',
                            'Update net emissions score and database' ) ) )""",
    },
}

# Chart styling: one series per chart, so one hue; recessive axes and grid.
SERIES = "#2a78d6"
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e4e3df"


def style_axes(ax):
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=INK_2, labelsize=9)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def to_unit(seconds: float) -> float:
    return seconds / 60 if TIME_UNIT == "min" else seconds


def fmt(seconds: float) -> str:
    return f"{to_unit(seconds):.1f} {TIME_UNIT}"


def md_table(df: pd.DataFrame) -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(str(c) for c in cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join(str(row[c]) for c in cols) + " |")
    return "\n".join(lines)


def service_times(df: pd.DataFrame) -> pd.DataFrame:
    """Pairs the k-th 'start' with the k-th 'complete' of each activity within a case."""
    rows = []
    for (case, act), g in df.groupby([CASE, ACT]):
        starts = g[g[LC] == "start"][TS].sort_values().tolist()
        ends = g[g[LC] == "complete"][TS].sort_values().tolist()
        for s, e in zip(starts, ends):
            rows.append({"activity": act, "seconds": (e - s).total_seconds()})
    if not rows:
        return pd.DataFrame(columns=["Activity", "Instances", "Mean", "Median", "Max"])
    st = pd.DataFrame(rows).groupby("activity")["seconds"].agg(["count", "mean", "median", "max"]).sort_values("mean", ascending=False)
    return pd.DataFrame(
        {
            "Activity": st.index,
            "Instances": st["count"].values,
            "Mean": [fmt(v) for v in st["mean"]],
            "Median": [fmt(v) for v in st["median"]],
            "Max": [fmt(v) for v in st["max"]],
        }
    )


def deviations(diagnostics) -> tuple[Counter, Counter, int]:
    """Counts log moves (observed but not allowed) and visible model moves (required but skipped)."""
    log_moves, model_moves, deviating = Counter(), Counter(), 0
    for d in diagnostics:
        trace_dev = False
        for log_label, model_label in d["alignment"]:
            if model_label == ">>":
                log_moves[log_label] += 1
                trace_dev = True
            elif log_label == ">>" and model_label is not None:
                model_moves[model_label] += 1
                trace_dev = True
        deviating += trace_dev
    return log_moves, model_moves, deviating


def chart_case_durations(durations_s: pd.Series, title: str, path: Path):
    fig, ax = plt.subplots(figsize=(7.5, 3.2), facecolor=SURFACE)
    values = durations_s.map(to_unit)
    ax.hist(values, bins=20, color=SERIES, edgecolor=SURFACE, linewidth=2)
    style_axes(ax)
    ax.grid(axis="x", visible=False)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_xlabel(f"Case duration ({TIME_UNIT})", color=INK_2, fontsize=9)
    ax.set_ylabel("Cases", color=INK_2, fontsize=9)
    fig.suptitle(title, color=INK, fontsize=11, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def chart_variants(variants: list[tuple[str, int]], total: int, title: str, path: Path):
    top = variants[:8][::-1]
    fig, ax = plt.subplots(figsize=(7.5, 0.45 * len(top) + 1.2), facecolor=SURFACE)
    labels = [name for name, _ in top]
    counts = [n for _, n in top]
    bars = ax.barh(labels, counts, color=SERIES, height=0.62, edgecolor=SURFACE, linewidth=2)
    style_axes(ax)
    for bar, n in zip(bars, counts):
        ax.text(bar.get_width(), bar.get_y() + bar.get_height() / 2, f"  {n} ({n / total:.0%})", va="center", color=INK_2, fontsize=8.5)
    ax.set_xlabel("Cases", color=INK_2, fontsize=9)
    fig.suptitle(title, color=INK, fontsize=11, x=0.01, ha="left")
    ax.tick_params(axis="y", labelsize=8.5, colors=INK)
    ax.set_xlim(0, max(counts) * 1.35)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def analyse(slug: str, spec: dict) -> tuple[str, dict]:
    xes = EXPORT_DIR / f"{slug}.xes"
    out = OUT_DIR / slug
    out.mkdir(parents=True, exist_ok=True)

    df = pm4py.read_xes(str(xes))
    df = df.sort_values([CASE, TS], kind="stable")
    # Activity-level view: one row per activity instance (its completion).
    dfc = df[df[LC] == "complete"].copy()

    n_cases = df[CASE].nunique()
    variants = Counter(tuple(g[ACT]) for _, g in dfc.groupby(CASE, sort=False))
    outcome = dfc.groupby(CASE)[ACT].last().value_counts()
    durations = df.groupby(CASE)[TS].agg(lambda s: (s.max() - s.min()).total_seconds())

    # --- Discovery -----------------------------------------------------------
    dfg, sa, ea = pm4py.discover_dfg(dfc)
    pm4py.save_vis_dfg(dfg, sa, ea, str(out / "dfg-frequency.png"))
    perf_dfg, psa, pea = pm4py.discover_performance_dfg(dfc)
    pm4py.save_vis_performance_dfg(perf_dfg, psa, pea, str(out / "dfg-performance.png"))
    discovered_tree = pm4py.discover_process_tree_inductive(dfc)
    discovered_bpmn = pm4py.convert_to_bpmn(discovered_tree)
    pm4py.save_vis_bpmn(discovered_bpmn, str(out / "discovered-bpmn.png"))
    pm4py.write_bpmn(discovered_bpmn, str(out / "discovered-model.bpmn"))
    d_net, d_im, d_fm = pm4py.convert_to_petri_net(discovered_tree)

    # --- Conformance against the Part B reference model ---------------------
    ref_tree = pm4py.parse_process_tree(spec["tree"])
    ref_bpmn = pm4py.convert_to_bpmn(ref_tree)
    pm4py.save_vis_bpmn(ref_bpmn, str(out / "reference-bpmn.png"))
    # BPMN 2.0 XML of the Part B reference model: import into Apromore for model-to-log conformance.
    pm4py.write_bpmn(ref_bpmn, str(out / "reference-model.bpmn"))
    r_net, r_im, r_fm = pm4py.convert_to_petri_net(ref_tree)
    ref_fit = pm4py.fitness_alignments(dfc, r_net, r_im, r_fm)
    ref_prec = pm4py.precision_alignments(dfc, r_net, r_im, r_fm)
    diag = pm4py.conformance_diagnostics_alignments(dfc, r_net, r_im, r_fm)
    log_moves, model_moves, deviating = deviations(diag)
    disc_fit = pm4py.fitness_alignments(dfc, d_net, d_im, d_fm)
    disc_prec = pm4py.precision_alignments(dfc, d_net, d_im, d_fm)

    # --- Performance ----------------------------------------------------------
    st = service_times(df)
    edges = sorted(perf_dfg.items(), key=lambda kv: kv[1]["mean"], reverse=True)[:6]
    slow_edges = pd.DataFrame(
        {
            "From": [a for (a, _), _ in edges],
            "To": [b for (_, b), _ in edges],
            "Occurrences": [dfg.get(k, 0) for k, _ in edges],
            "Mean wait": [fmt(v["mean"]) for _, v in edges],
            "Median wait": [fmt(v["median"]) for _, v in edges],
        }
    )

    # --- Organisational -------------------------------------------------------
    res_act = pd.crosstab(dfc[ACT], dfc[RES])
    handover = Counter()
    for _, g in dfc.groupby(CASE, sort=False):
        rs = g[RES].tolist()
        for a, b in zip(rs, rs[1:]):
            if a != b:
                handover[(a, b)] += 1
    handover_df = pd.DataFrame([{"From": a, "To": b, "Hand-overs": n} for (a, b), n in handover.most_common()])

    # --- Charts ---------------------------------------------------------------
    chart_case_durations(durations, f"{spec['title']}: case durations", out / "case-durations.png")
    # Labels match the numbering of the variant table in RESULTS.md (V1 = most frequent).
    vlist = [(f"V{i + 1} · {len(v)} steps → {v[-1]}", n) for i, (v, n) in enumerate(variants.most_common())]
    chart_variants(vlist, n_cases, f"{spec['title']}: top variants", out / "variants.png")

    metrics = {
        "cases": int(n_cases),
        "events": int(len(df)),
        "activity_instances": int(len(dfc)),
        "variants": len(variants),
        "case_duration_mean_s": float(durations.mean()),
        "case_duration_median_s": float(durations.median()),
        "reference_fitness": round(ref_fit["log_fitness"], 4),
        "reference_fitting_traces_pct": round(ref_fit["percentage_of_fitting_traces"], 2),
        "reference_precision": round(ref_prec, 4),
        "discovered_fitness": round(disc_fit["log_fitness"], 4),
        "discovered_precision": round(disc_prec, 4),
        "deviating_cases": deviating,
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2))

    # --- Report section -------------------------------------------------------
    variant_rows = pd.DataFrame(
        [{"#": f"V{i + 1}", "Cases": n, "Share": f"{n / n_cases:.0%}", "Variant (activity sequence)": " → ".join(v)} for i, (v, n) in enumerate(variants.most_common(6))]
    )
    outcome_df = pd.DataFrame({"Final activity (case outcome)": outcome.index, "Cases": outcome.values, "Share": [f"{v / n_cases:.0%}" for v in outcome.values]})
    dev_rows = [{"Deviation": "Observed but not allowed by Part B model (log move)", "Activity": a, "Count": n} for a, n in log_moves.most_common()]
    dev_rows += [{"Deviation": "Required by Part B model but not observed (model move)", "Activity": a, "Count": n} for a, n in model_moves.most_common()]
    dev_df = pd.DataFrame(dev_rows) if dev_rows else pd.DataFrame([{"Deviation": "none", "Activity": "—", "Count": 0}])

    s = [f"## {spec['title']}", ""]
    s.append(f"Source log: `{xes.name}` · {n_cases} cases · {len(df)} events ({len(dfc)} activity instances) · {len(variants)} variants · "
             f"mean case duration {fmt(durations.mean())}, median {fmt(durations.median())}.")
    s += ["", "### Case outcomes", "", md_table(outcome_df), "", "### Most frequent variants", "", md_table(variant_rows), "",
          f"![variants]({slug}/variants.png)", "", f"![case durations]({slug}/case-durations.png)", "",
          "### Discovery", "",
          "Directly-follows graph with frequencies (equivalent to Disco's map at 100% activities / 100% paths):", "",
          f"![DFG frequency]({slug}/dfg-frequency.png)", "",
          "Directly-follows graph with mean transition times (Disco's performance view):", "",
          f"![DFG performance]({slug}/dfg-performance.png)", "",
          "BPMN model discovered with the Inductive Miner (comparable to Apromore's BPMN discovery):", "",
          f"![Discovered BPMN]({slug}/discovered-bpmn.png)", "",
          "### Conformance against the Part B reference model", "",
          f"Reference model (encoded from the Part B BPMN diagram): ![reference]({slug}/reference-bpmn.png)", "",
          md_table(pd.DataFrame([
              {"Model": "Part B reference model", "Fitness (alignments)": f"{ref_fit['log_fitness']:.3f}",
               "Perfectly fitting cases": f"{ref_fit['percentage_of_fitting_traces']:.1f}%", "Precision": f"{ref_prec:.3f}"},
              {"Model": "Discovered (Inductive Miner)", "Fitness (alignments)": f"{disc_fit['log_fitness']:.3f}",
               "Perfectly fitting cases": f"{disc_fit['percentage_of_fitting_traces']:.1f}%", "Precision": f"{disc_prec:.3f}"},
          ])), "", f"{deviating} of {n_cases} cases deviate from the Part B model:", "", md_table(dev_df), "",
          "### Performance", "", "Activity service times (from start/complete event pairs):", "", md_table(st), "",
          "Slowest transitions between activities (waiting time, potential bottlenecks):", "", md_table(slow_edges), "",
          "### Organisational perspective", "", "Activity instances per resource (BPMN lane):", "",
          md_table(res_act.reset_index().rename(columns={ACT: "Activity"})), "", "Hand-overs of work between resources:", "",
          md_table(handover_df) if not handover_df.empty else "_none_", ""]
    return "\n".join(s), metrics


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sections, summary = [], []
    for slug, spec in REFERENCE_MODELS.items():
        if not (EXPORT_DIR / f"{slug}.xes").exists():
            print(f"skip {slug}: {EXPORT_DIR / f'{slug}.xes'} not found")
            continue
        print(f"analysing {slug} ...")
        text, m = analyse(slug, spec)
        sections.append(text)
        summary.append({"Process": spec["title"], "Cases": m["cases"], "Events": m["events"], "Variants": m["variants"],
                        "Fitness vs Part B": f"{m['reference_fitness']:.3f}", "Precision vs Part B": f"{m['reference_precision']:.3f}",
                        "Deviating cases": m["deviating_cases"], "Mean case duration": fmt(m["case_duration_mean_s"])})
    if not sections:
        raise SystemExit(f"No XES logs found in {EXPORT_DIR}. Run the simulator and the log exporter first.")

    header = ["# Part F — Process Mining Results", "",
              f"Generated by `analytics/mine.py` (pm4py {pm4py.__version__}) from the XES logs in `{EXPORT_DIR}`. "
              f"Durations are in {'simulated minutes (logs exported with TIME_SCALE=60)' if TIME_UNIT == 'min' else 'seconds'}.", "",
              "## Summary", "", md_table(pd.DataFrame(summary)), ""]
    (OUT_DIR / "RESULTS.md").write_text("\n".join(header + sections))
    print(f"\nwrote {OUT_DIR / 'RESULTS.md'}")


if __name__ == "__main__":
    main()
