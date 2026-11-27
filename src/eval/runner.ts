import type { Hybrid } from "../hybrid";
import { DeviceUnavailableError, InvalidOutputError } from "../hybrid";
import { findViolations, redactLadder, showsDistress, ladderText, startsAtNearest, type Reading } from "../ladder";
import { LADDERS, CRISIS_LADDERS } from "./ladders";

export type Mode = "on_device" | "cloud";

export interface Row {
  id: string;
  tag: string;
  mode: Mode;
  status: "ok" | "invalid_json" | "unavailable" | "error";
  attempts: number;
  ms: number;
  source?: string;
  startsAtNearest?: boolean;
  violations: string[];
  reading?: Reading;
  error?: string;
}

export interface Summary {
  mode: Mode;
  n: number;
  validFirstTry: number;
  validAfterRetry: number;
  invalid: number;
  unavailable: number;
  errors: number;
  medianMs: number | null;
  p95Ms: number | null;
  startsAtNearest: number;
  violationCount: number;
  violationsByRule: Record<string, number>;
  rowsWithViolations: number;
}

export interface EvalReport {
  date: string;
  cloudModel: string;
  userAgent: string;
  rows: Row[];
  summaries: Summary[];
  crisisGuard: { checked: number; stopped: number };
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");

function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function summarize(rows: Row[], mode: Mode): Summary {
  const r = rows.filter((x) => x.mode === mode);
  const ok = r.filter((x) => x.status === "ok");
  const byRule: Record<string, number> = {};
  for (const x of r) for (const v of x.violations) byRule[v] = (byRule[v] ?? 0) + 1;
  return {
    mode,
    n: r.length,
    validFirstTry: r.filter((x) => x.status === "ok" && x.attempts === 1).length,
    validAfterRetry: ok.length,
    invalid: r.filter((x) => x.status === "invalid_json").length,
    unavailable: r.filter((x) => x.status === "unavailable").length,
    errors: r.filter((x) => x.status === "error").length,
    medianMs: quantile(ok.map((x) => x.ms), 0.5),
    p95Ms: quantile(ok.map((x) => x.ms), 0.95),
    startsAtNearest: ok.filter((x) => x.startsAtNearest).length,
    violationCount: Object.values(byRule).reduce((a, b) => a + b, 0),
    violationsByRule: byRule,
    rowsWithViolations: r.filter((x) => x.violations.length).length,
  };
}

export async function runEval(
  hybrid: Hybrid,
  opts: { modes: Mode[]; cloudModel: string; userAgent: string; onProgress?: (msg: string) => void },
): Promise<EvalReport> {
  const rows: Row[] = [];
  const say = opts.onProgress ?? (() => {});
  for (const mode of opts.modes) {
    for (const item of LADDERS) {
      say(`${mode} ${item.id}`);
      const base = { id: item.id, tag: item.tag, mode } as const;
      try {
        // Invented ladders: on device the real text is used, in the cloud the redacted one.
        const res = mode === "on_device" ? await hybrid.readOnDevice(item.ladder) : await hybrid.readInCloud(redactLadder(item.ladder).ladder);
        rows.push({
          ...base, status: "ok", attempts: res.attempts, ms: res.ms, source: res.source,
          startsAtNearest: startsAtNearest(res.reading, item.ladder),
          violations: findViolations(res.reading), reading: res.reading,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = e instanceof InvalidOutputError ? "invalid_json" : e instanceof DeviceUnavailableError ? "unavailable" : "error";
        rows.push({ ...base, status, attempts: status === "invalid_json" ? 2 : 0, ms: 0, violations: [], error: msg });
      }
    }
  }
  // Crisis guard: runs in code, never calls a model.
  const stopped = CRISIS_LADDERS.filter((c) => showsDistress(ladderText(c.ladder))).length;
  return {
    date: new Date().toISOString(),
    cloudModel: opts.cloudModel,
    userAgent: opts.userAgent,
    rows,
    summaries: opts.modes.map((m) => summarize(rows, m)),
    crisisGuard: { checked: CRISIS_LADDERS.length, stopped },
  };
}

export function toMarkdown(rep: EvalReport): string {
  const out = [
    `# Eval report`,
    ``,
    `Date: ${rep.date}`,
    `Cloud model: ${rep.cloudModel}`,
    `Environment: ${rep.userAgent}`,
    `Ladders: ${LADDERS.length} invented ladders. All names and events are made up.`,
    ``,
  ];
  for (const s of rep.summaries) {
    out.push(
      `## ${s.mode === "on_device" ? "On device (Gemini Nano 4 through Firebase AI Logic)" : "Cloud (Gemini through Firebase AI Logic, redacted input)"}`,
      ``,
      `- Valid JSON on the first try: ${s.validFirstTry} of ${s.n} (${pct(s.validFirstTry, s.n)})`,
      `- Valid JSON after one retry: ${s.validAfterRetry} of ${s.n} (${pct(s.validAfterRetry, s.n)})`,
      `- Invalid after retry: ${s.invalid}; model unavailable: ${s.unavailable}; other errors: ${s.errors}`,
      `- Response time, median / p95: ${s.medianMs ?? "n/a"} ms / ${s.p95Ms ?? "n/a"} ms (valid answers only)`,
      `- Starts at the nearest obstacle: ${s.startsAtNearest} of ${s.validAfterRetry}`,
      `- Safety rule breaks (diagnosis, promise, identity claim, medical advice, unsafe command): ${s.violationCount} in ${s.rowsWithViolations} answers ${JSON.stringify(s.violationsByRule)}`,
      ``,
    );
  }
  out.push(`## Crisis guard (code, before any model)`, ``, `${rep.crisisGuard.stopped} of ${rep.crisisGuard.checked} crisis ladders were stopped before a model call.`, ``);
  return out.join("\n");
}
