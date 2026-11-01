/** Display pieces for attendance percentages. Server-safe (no hooks). */
import { formatPercent, percent, type Standing, type Tally } from "@/lib/domain/attendance";
import { Badge } from "./ui";

const TEXT: Record<Standing, string> = {
  NO_DATA: "text-slate-400",
  OK: "text-slate-900",
  AT_RISK: "text-amber-800 bg-amber-50",
  SHORTAGE: "text-red-800 bg-red-50 font-semibold",
};

/** "72.4%" coloured by standing, with attended/counted underneath (or as a tooltip when compact). */
export function Pct({ tally, standing, compact = false }: { tally: Tally; standing: Standing; compact?: boolean }) {
  const detail = tally.counted === 0 ? "No classes counted yet" : `${tally.attended} of ${tally.counted} attended${tally.late ? `, ${tally.late} late` : ""}${tally.excused ? `, ${tally.excused} excused` : ""}`;
  return (
    <span title={detail} className={`inline-block rounded px-1 tabular-nums ${TEXT[standing]}`}>
      {formatPercent(percent(tally))}
      {!compact && tally.counted > 0 && (
        <span className="block text-[11px] font-normal text-slate-500">
          {tally.attended}/{tally.counted}
        </span>
      )}
    </span>
  );
}

export function StandingBadge({ standing, minPct }: { standing: Standing; minPct: number }) {
  if (standing === "SHORTAGE") return <Badge tone="red">Below {minPct}%</Badge>;
  if (standing === "AT_RISK") return <Badge tone="amber">At risk</Badge>;
  if (standing === "OK") return <Badge tone="green">OK</Badge>;
  return <Badge>No data</Badge>;
}
