/**
 * Minimal Prometheus-text metrics (no external dependency).
 * Counters for events, gauges for live state. Exposed at GET /metrics.
 */

const counters = new Map<string, number>();
const gauges = new Map<string, number>();

export function incCounter(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function setGauge(name: string, value: number): void {
  gauges.set(name, value);
}

/** Prometheus text exposition format (TYPE lines only, HELP optional). */
export function metricsText(): string {
  const lines: string[] = [];
  for (const [name, value] of Array.from(counters.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`# TYPE ${name} counter`, `${name} ${value}`);
  }
  for (const [name, value] of Array.from(gauges.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
  }
  return lines.join("\n") + "\n";
}
