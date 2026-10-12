// Two independent upstream data sources, called concurrently by the
// service in index.ts. In a full deployment these would be genuine external
// systems (a GTFS/Transmodel timetable feed from the Transport Operators, a
// national emissions-factor registry); here they are modelled as in-process
// mocks with artificial latency so the scatter-gather pattern (BPMN
// Process 3, gateways 3.2/3.7) is faithfully reproduced without standing up
// two extra containers for what is effectively static reference data.

export type Mode = "train" | "bus" | "bike";
export type TransitOption = { mode: Exclude<Mode, "bike">; durationMins: number };

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function hash(origin: string, destination: string): number {
  const s = `${origin.trim().toLowerCase()}|${destination.trim().toLowerCase()}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministic pseudo-distance so the same origin/destination pair always
// produces the same journey options in a demo (no real geocoding call).
export function estimateDistanceKm(origin: string, destination: string): number {
  return 3 + (hash(origin, destination) % 28); // 3..30 km
}

// FetchTimetable(t) -> TimetableFetched(t) [BPMN 3.3 / 3.5]
// Roughly one origin/destination pair in four has no rail link, so the train
// branch of inclusive gateway 3.10 is genuinely optional.
export async function fetchTimetable(origin: string, destination: string, distanceKm: number): Promise<TransitOption[]> {
  await delay(300 + Math.random() * 400, null);
  const options: TransitOption[] = [];
  if (hash(origin, destination) % 4 !== 0) options.push({ mode: "train", durationMins: Math.round(distanceKm * 1.4 + 8) });
  options.push({ mode: "bus", durationMins: Math.round(distanceKm * 2.5 + 5) });
  return options;
}

// FetchEmissions(t) -> EmissionsFetched(t) [BPMN 3.4 / 3.6]
export async function fetchEmissionFactors(): Promise<Record<Mode | "drive", number>> {
  await delay(250 + Math.random() * 400, null);
  return {
    train: 0.04, // kg CO2-e per passenger-km, illustrative
    bus: 0.1,
    bike: 0,
    drive: 0.17, // used only as the "versus driving" baseline
  };
}
