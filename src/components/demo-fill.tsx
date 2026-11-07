"use client";

/** Demo only: buttons that fill the sign-in form (shown while the dummy college is loaded). */
export function DemoFill({ title, note, rows }: { title: string; note?: string; rows: { label: string; detail: string; values: Record<string, string> }[] }) {
  const fill = (values: Record<string, string>) => {
    for (const [id, value] of Object.entries(values)) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = value;
    }
    (document.querySelector("form button[type=submit]") as HTMLButtonElement | null)?.focus();
  };
  return (
    <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-950" open>
      <summary className="cursor-pointer px-4 py-2 font-medium">{title}</summary>
      <div className="border-t border-amber-200 px-2 py-2">
        {note && <p className="px-2 pb-2 text-xs text-amber-900">{note}</p>}
        <ul>
          {rows.map((r) => (
            <li key={r.label}>
              <button type="button" onClick={() => fill(r.values)} className="flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left hover:bg-amber-100">
                <span className="font-medium">{r.label}</span>
                <span className="truncate text-xs tabular-nums text-amber-900">{r.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
