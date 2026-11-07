/** Display pieces for marks. Server-safe (no hooks). */
import Link from "next/link";
import { formatMark, type MarkEntry, type SubjectResult } from "@/lib/domain/marks";

type Status = "DRAFT" | "SUBMITTED" | "PUBLISHED";

const CHIP: Record<Status | "NONE", string> = {
  NONE: "border-slate-200 bg-white text-slate-500",
  DRAFT: "border-slate-300 bg-slate-50 text-slate-700",
  SUBMITTED: "border-amber-300 bg-amber-50 text-amber-900",
  PUBLISHED: "border-green-300 bg-green-50 text-green-900",
};
const SHORT: Record<Status | "NONE", string> = { NONE: "not started", DRAFT: "being entered", SUBMITTED: "being entered", PUBLISHED: "shown to parents" };

/** A test of a subject, with its status; a link when the viewer can open it. */
export function PartChip({ href, part, mine }: { href: string; part: { code: string; label: string; assessment: { status: Status; marked: number } | null }; mine: boolean }) {
  const st = part.assessment?.status ?? "NONE";
  const body = (
    <>
      <span className="font-medium">{shortLabel(part.code, part.label)}</span> <span className="opacity-75">{SHORT[st]}</span>
      {st === "DRAFT" && part.assessment ? <span className="opacity-75"> · {part.assessment.marked}</span> : null}
    </>
  );
  const cls = `inline-block rounded border px-1.5 py-0.5 text-xs ${CHIP[st]}`;
  return mine || st !== "NONE" ? (
    <Link href={href} className={`${cls} hover:brightness-95`} title={part.label}>
      {body}
    </Link>
  ) : (
    <span className={cls} title={part.label}>
      {body}
    </span>
  );
}

export function StatusPill({ status }: { status: Status | null }) {
  const st = status ?? "NONE";
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${CHIP[st]}`}>{SHORT[st]}</span>;
}

/** "T1", "P2", "Act", "Final" — compact column headers. */
export function shortLabel(code: string, label: string): string {
  if (code.startsWith("CIE_T")) return `T${code.slice(5)}`;
  if (code.startsWith("CIE_P")) return `P${code.slice(5)}`;
  if (code === "ACT") return "Act";
  if (code === "SEE") return "Final";
  return label;
}

export function EntryCell({ entry }: { entry: MarkEntry | undefined }) {
  if (!entry) return <span className="text-slate-300">—</span>;
  if (entry.flag) return <span className="font-medium text-red-700">{entry.flag}</span>;
  return <span className="tabular-nums">{formatMark(entry.value)}</span>;
}

/** Scaled result: final value when complete, else "so far" in grey with a tooltip. */
export function ResultCell({ value, soFar, outOf, low }: { value: number | null; soFar?: number | null; outOf: number; low?: boolean }) {
  if (value !== null) return <span className={`tabular-nums ${low ? "rounded bg-red-50 px-1 font-semibold text-red-800" : "font-medium"}`}>{formatMark(value)}</span>;
  if (soFar !== null && soFar !== undefined)
    return (
      <span className="tabular-nums text-slate-500" title={`So far, from the tests entered (out of ${outOf}). Not final until every test is in.`}>
        {formatMark(soFar)}*
      </span>
    );
  return <span className="text-slate-300">—</span>;
}

/** Is a scaled internal below the low-marks level? */
export function lowCie(r: SubjectResult, lowPct: number): boolean {
  const v = r.cie.scaled ?? r.cie.scaledSoFar;
  return v !== null && v * 100 < lowPct * r.cieOutOf;
}
