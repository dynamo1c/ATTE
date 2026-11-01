"use client";

/**
 * The attendance screen. Works for both ways of marking:
 *  - live in class: everyone starts Present, tap the absentees;
 *  - from the attendance book later: type absentee roll numbers ("3, 12, 27" or "5-8").
 *
 * Reliability:
 *  - every change is kept as a browser draft, so a dropped connection or closed tab loses nothing;
 *  - each save carries one id (clientOpId) that is reused on retry, so a retry can't save twice;
 *  - the server rejects the save if someone else saved meanwhile (version check).
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { parseRolls, type Mark } from "@/lib/domain/marking";
import { buttonClass, inputClass } from "@/components/ui";
import { saveAttendance } from "../actions";

interface Student {
  studentId: number;
  regNo: string;
  name: string;
  label: string;
  mark: Mark | null;
  leave: string | null;
}

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; text: string } | { kind: "error"; text: string };

const NEXT: Record<Mark, Mark> = { PRESENT: "ABSENT", ABSENT: "PRESENT", LATE: "PRESENT" };
const STYLE: Record<Mark, string> = {
  PRESENT: "border-green-300 bg-green-50 text-green-900",
  ABSENT: "border-red-400 bg-red-100 text-red-900",
  LATE: "border-amber-400 bg-amber-50 text-amber-900",
};
const SHORT: Record<Mark, string> = { PRESENT: "P", ABSENT: "A", LATE: "L" };

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A draft is usable only if it has a valid mark for exactly the current students. */
function parseDraft(raw: string | null, students: Student[]): Record<number, Mark> | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const ok = students.every((s) => d[s.studentId] === "PRESENT" || d[s.studentId] === "ABSENT" || d[s.studentId] === "LATE");
    return ok ? (Object.fromEntries(students.map((s) => [s.studentId, d[s.studentId] as Mark])) as Record<number, Mark>) : null;
  } catch {
    return null;
  }
}

function initialMarks(students: Student[]): Record<number, Mark> {
  // Unmarked: present by default, except students on approved leave/OD that day.
  return Object.fromEntries(students.map((s) => [s.studentId, s.mark ?? (s.leave ? "ABSENT" : "PRESENT")]));
}

export function Marker({ session, students, mode }: { session: { id: number; version: number; status: string }; students: Student[]; mode: "save" | "request" }) {
  const router = useRouter();
  // One draft per class (not per version): after a conflict the teacher can still restore their marks on top of the newer data.
  const draftKey = `attendance-draft:${session.id}`;
  const server = useMemo(() => initialMarks(students), [students]);
  const [marks, setMarks] = useState<Record<number, Mark>>(server);
  const [touched, setTouched] = useState(false);
  const [dismissedDraft, setDismissedDraft] = useState(false);
  // Read any unsaved draft straight from storage (null on the server and when storage is unavailable).
  const draftRaw = useSyncExternalStore(subscribeStorage, () => readStorage(draftKey), () => null);
  const draft = useMemo(() => parseDraft(draftRaw, students), [draftRaw, students]);
  const offerDraft = !touched && !dismissedDraft && draft !== null && students.some((s) => draft[s.studentId] !== server[s.studentId]);
  const [rollInput, setRollInput] = useState("");
  const [rollMsg, setRollMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const opId = useRef<string | null>(null);

  const dirty = students.some((s) => marks[s.studentId] !== server[s.studentId]) || session.status !== "HELD";

  const update = (next: Record<number, Mark>) => {
    setMarks(next);
    setTouched(true);
    opId.current = null; // content changed: a new save is a new operation
    if (status.kind !== "saving") setStatus({ kind: "idle" });
    try {
      localStorage.setItem(draftKey, JSON.stringify(next));
    } catch {
      /* private mode etc. — marking still works, just no draft */
    }
  };

  // Warn before leaving with unsaved marks.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty && status.kind !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, status.kind]);

  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, LATE: 0 };
    for (const s of students) c[marks[s.studentId]]++;
    return c;
  }, [marks, students]);

  const applyRolls = (mark: Mark) => {
    const r = parseRolls(rollInput, students);
    const next = { ...marks };
    for (const id of r.studentIds) next[id] = mark;
    update(next);
    const problems = [r.unknown.length ? `Not in this class: ${r.unknown.join(", ")}` : "", r.ambiguous.length ? `Two students share roll ${r.ambiguous.join(", ")} — type the 5-digit number shown on the tile` : ""].filter(Boolean);
    setRollMsg(`${r.studentIds.length} marked ${mark.toLowerCase()}.${problems.length ? " " + problems.join(". ") : ""}`);
    if (!problems.length) setRollInput("");
  };

  const save = () => {
    if (mode === "request" && !reason.trim()) {
      setStatus({ kind: "error", text: "Write why the attendance is being changed." });
      return;
    }
    opId.current ??= crypto.randomUUID();
    const clientOpId = opId.current;
    setStatus({ kind: "saving" });
    startTransition(async () => {
      try {
        const res = await saveAttendance({
          sessionId: session.id,
          version: session.version,
          clientOpId,
          marks: students.map((s) => ({ studentId: s.studentId, mark: marks[s.studentId] })),
          reason: reason.trim() || undefined,
        });
        if (res?.ok) {
          try {
            localStorage.removeItem(draftKey);
          } catch {}
          opId.current = null;
          setDismissedDraft(true);
          setStatus({ kind: "saved", text: res.message ?? "Saved." });
          router.refresh();
        } else {
          // Keep opId only for network-type retries; a refused save is a new attempt next time.
          opId.current = null;
          // Make sure these marks survive a reload (another tab may have cleared the draft).
          try {
            localStorage.setItem(draftKey, JSON.stringify(marks));
          } catch {}
          setStatus({ kind: "error", text: res?.error ?? res?.fieldErrors?.reason?.[0] ?? "Not saved." });
        }
      } catch {
        // Network failure: keep the same opId so retrying can never double-save.
        setStatus({ kind: "error", text: "Not saved — no connection. Your marks are kept on this phone. Tap Save again." });
      }
    });
  };

  return (
    <div className="pb-28">
      {offerDraft && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You have marks on this phone that weren&apos;t saved.
          <button type="button" className="font-medium underline" onClick={() => update(draft!)}>
            Restore them
          </button>
          <button
            type="button"
            className="underline"
            onClick={() => {
              setDismissedDraft(true);
              try {
                localStorage.removeItem(draftKey);
              } catch {}
            }}
          >
            Discard
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="rolls" className="mb-1 block text-sm font-medium text-slate-700">
            From the attendance book: type roll numbers
          </label>
          <input
            id="rolls"
            value={rollInput}
            onChange={(e) => setRollInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyRolls("ABSENT");
              }
            }}
            inputMode="numeric"
            placeholder="e.g. 3, 12, 27 or 5-8"
            className={inputClass}
          />
        </div>
        <div className="flex gap-2">
          <button type="button" className={buttonClass("danger", "md")} onClick={() => applyRolls("ABSENT")}>
            Mark absent
          </button>
          <button type="button" className={buttonClass("secondary", "md")} onClick={() => applyRolls("LATE")}>
            Mark late
          </button>
          <button type="button" className={buttonClass("ghost", "md")} onClick={() => update(Object.fromEntries(students.map((s) => [s.studentId, "PRESENT" as Mark])))}>
            All present
          </button>
        </div>
      </div>
      {rollMsg && <p className="-mt-2 mb-3 text-sm text-slate-600">{rollMsg}</p>}

      <p className="mb-2 text-xs text-slate-500">Tap a student to switch Present ↔ Absent. Tap the small L to mark late.</p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
        {students.map((s) => {
          const m = marks[s.studentId];
          return (
            <li key={s.studentId} className="relative">
              <button
                type="button"
                onClick={() => update({ ...marks, [s.studentId]: NEXT[m] })}
                aria-pressed={m !== "PRESENT"}
                aria-label={`${s.regNo} ${s.name}: ${m.toLowerCase()}`}
                className={`flex h-20 w-full flex-col items-center justify-center rounded-lg border-2 px-1 text-center transition-colors ${STYLE[m]}`}
              >
                <span className="text-xl font-bold tabular-nums leading-none">{s.label}</span>
                <span className="mt-1 line-clamp-1 w-full text-[11px] leading-tight opacity-80">{s.name}</span>
                <span className="text-[10px] font-semibold">{SHORT[m]}{s.leave ? ` · ${s.leave}` : ""}</span>
              </button>
              <button
                type="button"
                onClick={() => update({ ...marks, [s.studentId]: m === "LATE" ? "PRESENT" : "LATE" })}
                aria-label={`Mark ${s.name} late`}
                className={`absolute right-1 top-1 rounded px-1 text-[10px] font-bold ${m === "LATE" ? "bg-amber-500 text-white" : "bg-white/70 text-slate-500"}`}
              >
                L
              </button>
            </li>
          );
        })}
      </ul>

      {mode === "request" && (
        <div className="mt-4 max-w-xl">
          <label htmlFor="reason" className="mb-1 block text-sm font-medium text-slate-700">
            Why is this being changed late? (sent to the HOD)
          </label>
          <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} placeholder="Student showed medical certificate / marked wrongly" />
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <span className="text-sm tabular-nums">
            <b className="text-green-800">{counts.PRESENT}</b> present · <b className="text-red-800">{counts.ABSENT}</b> absent · <b className="text-amber-800">{counts.LATE}</b> late
            <span className="text-slate-400"> / {students.length}</span>
          </span>
          <span aria-live="polite" className={`text-sm ${status.kind === "error" ? "text-red-700" : status.kind === "saved" ? "text-green-700" : "text-slate-500"}`}>
            {status.kind === "saving" ? "Saving…" : status.kind === "idle" ? (dirty ? "Not saved yet" : "Saved") : status.text}
          </span>
          <button type="button" onClick={save} disabled={status.kind === "saving" || students.length === 0} className={`${buttonClass("primary")} ml-auto min-w-36`}>
            {mode === "request" ? "Send to HOD" : session.status === "HELD" ? "Save changes" : "Save attendance"}
          </button>
        </div>
      </div>
    </div>
  );
}
