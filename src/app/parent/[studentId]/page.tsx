import { and, desc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { notification } from "@/db/schema";
import { StudentAttendanceCard } from "@/components/student-attendance-card";
import { StudentMarksCard } from "@/components/student-marks-card";
import { Badge, Card } from "@/components/ui";
import { formatDateShort, todayIn } from "@/lib/domain/dates";
import { istParts, TRIGGER_LABEL } from "@/lib/notify/rules";
import { parentOptedOut, requireParent } from "@/server/parent-session";
import { parseId } from "@/server/queries";
import { MessageSettings } from "../message-settings";

export default async function ParentChildPage(props: PageProps<"/parent/[studentId]">) {
  const me = await requireParent();
  const id = parseId((await props.params).studentId);
  // Only children linked to this number; anything else looks like it doesn't exist.
  const child = me.children.find((c) => c.id === id);
  if (!child) notFound();

  const [messages, optedOut] = await Promise.all([
    getDb()
      .select({ id: notification.id, trigger: notification.trigger, sentAt: notification.sentAt })
      .from(notification)
      .where(and(eq(notification.studentId, child.id), eq(notification.phone, me.phone), eq(notification.status, "SENT"), ne(notification.trigger, "LOGIN_OTP")))
      .orderBy(desc(notification.sentAt))
      .limit(10),
    parentOptedOut(me.phone),
  ]);

  return (
    <>
      {me.children.length > 1 && (
        <Link href="/parent" className="mb-2 inline-block text-sm text-blue-700 hover:underline">
          ← All children
        </Link>
      )}
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">{child.name}</h1>
        <p className="text-sm text-slate-500">
          <span className="font-mono">{child.regNo}</span> · {child.className ?? "Not in a class this term"}
          {child.status !== "ACTIVE" && (
            <>
              {" "}
              <Badge tone="amber">{child.status.toLowerCase()}</Badge>
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-slate-400">As of {formatDateShort(todayIn())}. Classes not yet entered by teachers are not counted.</p>
      </div>

      {child.classId ? (
        <>
          <StudentAttendanceCard studentId={child.id} classId={child.classId} forParent />
          <StudentMarksCard studentId={child.id} classId={child.classId} forParent />
        </>
      ) : (
        <Card className="mb-6">
          <p className="text-sm text-slate-700">Not in a class this term, so there is no attendance or marks to show.</p>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Recent messages to you">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {messages.map((m) => (
                <li key={m.id} className="flex justify-between gap-3 py-1.5">
                  <span>{TRIGGER_LABEL[m.trigger]}</span>
                  <span className="shrink-0 text-slate-500">{m.sentAt ? formatDateShort(istParts(m.sentAt).date) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <MessageSettings optedOut={optedOut} />
      </div>
    </>
  );
}
