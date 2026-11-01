import { sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { MessagePreview, MessageStatus } from "@/components/messages";
import { Card, Empty } from "@/components/ui";
import { formatIndianMobile } from "@/lib/domain/phone";
import { TRIGGER_LABEL, type Trigger } from "@/lib/notify/rules";

/** The latest messages sent to this student's parents. */
export async function StudentMessagesCard({ studentId, regNo }: { studentId: number; regNo: string }) {
  const { rows } = await getDb().execute<{ id: number; trigger: Trigger; channel: "WHATSAPP" | "SMS"; status: "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "SKIPPED"; phone: string; text: string; last_error: string | null; at: string }>(sql`
    SELECT n.id, n.trigger::text AS trigger, n.channel::text AS channel, n.status::text AS status, n.phone, n.payload->>'text' AS text, n.last_error,
           to_char(n.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH24:MI') AS at
    FROM notification n WHERE n.student_id = ${studentId}
    ORDER BY n.id DESC LIMIT 8`);
  return (
    <Card
      title="Messages to parents"
      className="mt-6"
      actions={
        <Link href={`/messages?q=${regNo}`} className="text-sm text-blue-700 hover:underline">
          All →
        </Link>
      }
    >
      {rows.length === 0 ? (
        <Empty>No messages yet.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2 text-sm">
              <span className="w-24 shrink-0 text-xs text-slate-500">{r.at}</span>
              <span className="w-48 shrink-0">
                {TRIGGER_LABEL[r.trigger]}
                <span className="block font-mono text-xs text-slate-500">
                  {formatIndianMobile(r.phone)} · {r.channel === "WHATSAPP" ? "WhatsApp" : "SMS"}
                </span>
              </span>
              <MessageStatus status={r.status} error={r.last_error} />
              <div className="min-w-0 flex-1">
                <MessagePreview text={r.text} channel={r.channel} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
