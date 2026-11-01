/** Display pieces for parent messages. Server-safe (no hooks). */
import { Badge } from "./ui";

const TONE = { QUEUED: "amber", SENDING: "amber", SENT: "green", DELIVERED: "green", READ: "green", FAILED: "red", SKIPPED: "slate" } as const;

export function MessageStatus({ status, scheduled, error, attempts }: { status: keyof typeof TONE; scheduled?: string | null; error?: string | null; attempts?: number }) {
  return (
    <div className="max-w-56">
      <Badge tone={TONE[status]}>{status === "QUEUED" && attempts ? "retrying" : status.toLowerCase()}</Badge>
      {scheduled && <div className="text-xs text-slate-500">at {scheduled}</div>}
      {error && <div className="mt-0.5 line-clamp-2 text-xs text-red-700" title={error}>{error}</div>}
    </div>
  );
}

/** The message as the parent sees it, collapsed to one line until opened. */
export function MessagePreview({ text, channel }: { text: string; channel: "WHATSAPP" | "SMS" }) {
  const first = text.split("\n").find((l) => l.trim()) ?? "";
  return (
    <details className="max-w-md">
      <summary className="cursor-pointer truncate text-sm text-slate-700">{first}</summary>
      <div className={`mt-2 rounded-lg p-3 text-sm whitespace-pre-wrap shadow-sm ${channel === "WHATSAPP" ? "bg-[#dcf8c6] text-slate-900" : "bg-slate-100 font-mono text-xs text-slate-800"}`} lang="kn">
        {text}
      </div>
    </details>
  );
}
