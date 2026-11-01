"use client";

/**
 * Mark entry grid. Type a mark, AB or MP per student; Enter / ↓ moves to the next student.
 *
 * Reliability (same as attendance):
 *  - every change is kept as a browser draft, so a dropped connection or closed tab loses nothing;
 *  - each save carries one id (clientOpId) reused on retry, so a retry can't save twice;
 *  - the server refuses the save if someone else saved meanwhile (version check).
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { formatMark, parseMarkInput } from "@/lib/domain/marks";
import { buttonClass, inputClass } from "@/components/ui";
import { saveMarks } from "../../actions";

interface Student {
  studentId: number;
  regNo: string;
  name: string;
  roll: string;
  /** Current saved value as typed form ("38.5", "AB", ""). */
  saved: string;
  former: boolean;
}

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; text: string } | { kind: "error"; text: string };
type Draft = { heldOn: string; values: Record<string, string> };

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

function parseDraft(raw: string | null, students: Student[]): Draft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Draft;
    if (typeof d?.heldOn !== "string" || typeof d.values !== "object" || d.values === null) return null;
    const values: Record<string, string> = {};
    for (const s of students) values[s.studentId] = typeof d.values[s.studentId] === "string" ? d.values[s.studentId] : s.saved;
    return { heldOn: d.heldOn, values };
  } catch {
    return null;
  }
}

export function MarkEntry({ assessment, maxMarks, students, today }: { assessment: { id: number; version: number; heldOn: string | null }; maxMarks: number; students: Student[]; today: string }) {
  const router = useRouter();
  const draftKey = `marks-draft:${assessment.id}`;
  const server = useMemo<Draft>(() => ({ heldOn: assessment.heldOn ?? "", values: Object.fromEntries(students.map((s) => [s.studentId, s.saved])) }), [assessment.heldOn, students]);
  const [form, setForm] = useState<Draft>(server);
  const [touched, setTouched] = useState(false);
  const [dismissedDraft, setDismissedDraft] = useState(false);
  const draftRaw = useSyncExternalStore(subscribeStorage, () => readStorage(draftKey), () => null);
  const draft = useMemo(() => parseDraft(draftRaw, students), [draftRaw, students]);
  const differs = (a: Draft, b: Draft) => a.heldOn !== b.heldOn || students.some((s) => (a.values[s.studentId] ?? "").trim() !== (b.values[s.studentId] ?? "").trim());
  const offerDraft = !touched && !dismissedDraft && draft !== null && differs(draft, server);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const opId = useRef<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const parsed = useMemo(() => new Map(students.map((s) => [s.studentId, parseMarkInput(form.values[s.studentId] ?? "", maxMarks)])), [form, students, maxMarks]);
  const invalid = students.filter((s) => !parsed.get(s.studentId)!.ok).length;
  const entered = students.filter((s) => {
    const p = parsed.get(s.studentId)!;
    return p.ok && p.entry !== null;
  }).length;
  const expected = students.filter((s) => !s.former).length;
  const average = useMemo(() => {
    const vals = students.map((s) => parsed.get(s.studentId)!).flatMap((p) => (p.ok && p.entry ? [p.entry.flag ? 0 : p.entry.value] : []));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [parsed, students]);
  const dirty = differs(form, server);

  const update = (next: Draft) => {
    setForm(next);
    setTouched(true);
    opId.current = null;
    if (status.kind !== "saving") setStatus({ kind: "idle" });
    try {
      localStorage.setItem(draftKey, JSON.stringify(next));
    } catch {
      /* private mode: entry still works, just no draft */
    }
  };

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty && status.kind !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, status.kind]);

  const focus = (i: number) => {
    const el = inputs.current[Math.max(0, Math.min(students.length - 1, i))];
    el?.focus();
    el?.select();
  };

  const save = () => {
    if (invalid) {
      setStatus({ kind: "error", text: `Fix the ${invalid} mark${invalid === 1 ? "" : "s"} in red first.` });
      return;
    }
    if (form.heldOn && form.heldOn > today) {
      setStatus({ kind: "error", text: "The test date can't be in the future." });
      return;
    }
    opId.current ??= crypto.randomUUID();
    const clientOpId = opId.current;
    setStatus({ kind: "saving" });
    startTransition(async () => {
      try {
        const res = await saveMarks({
          assessmentId: assessment.id,
          version: assessment.version,
          clientOpId,
          heldOn: form.heldOn || null,
          marks: students.map((s) => {
            const p = parsed.get(s.studentId)!;
            const e = p.ok ? p.entry : null;
            return { studentId: s.studentId, value: e && !e.flag ? e.value : null, flag: e?.flag ?? null };
          }),
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
          opId.current = null;
          try {
            localStorage.setItem(draftKey, JSON.stringify(form));
          } catch {}
          setStatus({ kind: "error", text: res?.error ?? "Not saved." });
        }
      } catch {
        setStatus({ kind: "error", text: "Not saved — no connection. Your marks are kept on this device. Tap Save again." });
      }
    });
  };

  return (
    <div className="pb-28">
      {offerDraft && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You have marks on this device that weren&apos;t saved.
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

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-slate-700">
          Test date
          <input type="date" value={form.heldOn} max={today} onChange={(e) => update({ ...form, heldOn: e.target.value })} className={`${inputClass} mt-1 w-44`} />
        </label>
        <p className="text-xs text-slate-500">Type marks out of {formatMark(maxMarks)}, or AB (absent) / MP (malpractice) — both count as 0. Leave empty if not entered yet. Enter or ↓ moves down.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full max-w-2xl border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="border-b border-slate-200 px-2 py-2">Roll</th>
              <th className="border-b border-slate-200 px-2 py-2">Student</th>
              <th className="border-b border-slate-200 px-2 py-2">Marks / {formatMark(maxMarks)}</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, i) => {
              const p = parsed.get(s.studentId)!;
              const value = form.values[s.studentId] ?? "";
              const changed = value.trim() !== s.saved;
              return (
                <tr key={s.studentId} className={s.former ? "opacity-50" : undefined}>
                  <td className="border-b border-slate-100 px-2 py-1.5 tabular-nums">{s.roll}</td>
                  <td className="border-b border-slate-100 px-2 py-1.5">
                    <label htmlFor={`m-${s.studentId}`}>{s.name}</label>
                    <div className="font-mono text-xs text-slate-500">{s.regNo}{s.former && " · left the class"}</div>
                  </td>
                  <td className="border-b border-slate-100 px-2 py-1.5">
                    <input
                      id={`m-${s.studentId}`}
                      ref={(el) => {
                        inputs.current[i] = el;
                      }}
                      value={value}
                      onChange={(e) => update({ ...form, values: { ...form.values, [s.studentId]: e.target.value } })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "ArrowDown") {
                          e.preventDefault();
                          focus(i + 1);
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          focus(i - 1);
                        }
                      }}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-invalid={!p.ok}
                      aria-describedby={!p.ok ? `e-${s.studentId}` : undefined}
                      className={`w-24 rounded-md border px-2 py-1.5 text-right tabular-nums uppercase focus:outline-none focus:ring-2 ${
                        !p.ok ? "border-red-500 bg-red-50 focus:ring-red-500/30" : changed ? "border-blue-400 bg-blue-50 focus:ring-blue-600/20" : "border-slate-300 focus:ring-blue-600/20"
                      }`}
                    />
                    {!p.ok && (
                      <span id={`e-${s.studentId}`} className="ml-2 text-xs text-red-700">
                        {p.error}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <span className="text-sm tabular-nums">
            <b>{entered}</b> of {expected} entered{invalid ? <b className="text-red-700"> · {invalid} invalid</b> : null}
            {average !== null && <span className="text-slate-500"> · average {formatMark(average)}</span>}
          </span>
          <span aria-live="polite" className={`text-sm ${status.kind === "error" ? "text-red-700" : status.kind === "saved" ? "text-green-700" : "text-slate-500"}`}>
            {status.kind === "saving" ? "Saving…" : status.kind === "idle" ? (dirty ? "Not saved yet" : "Saved") : status.text}
          </span>
          <button type="button" onClick={save} disabled={status.kind === "saving" || students.length === 0} className={`${buttonClass("primary")} ml-auto min-w-32`}>
            Save marks
          </button>
        </div>
      </div>
    </div>
  );
}
