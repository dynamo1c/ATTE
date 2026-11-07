import { getDb } from "@/db/client";
import { Card, Empty } from "@/components/ui";
import { addDays, todayIn } from "@/lib/domain/dates";
import { requireParent } from "@/server/parent-session";
import { getCurrentTerm } from "@/server/queries";
import { updatesForClasses } from "@/server/updates";

export const metadata = { title: "Updates · Parent portal · MEI Polytechnic" };

export default async function ParentUpdatesPage() {
  const me = await requireParent();
  const term = await getCurrentTerm();
  const classes = me.children.filter((c) => c.classId && c.departmentId).map((c) => ({ classId: c.classId!, departmentId: c.departmentId! }));
  // This term's updates (at least the last 60 days, so a new term doesn't start empty).
  const termStart = term?.startsOn ?? todayIn();
  const since = addDays(todayIn(), -60) < termStart ? addDays(todayIn(), -60) : termStart;
  const updates = await updatesForClasses(getDb(), classes, since);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">College updates · ಕಾಲೇಜಿನ ಪ್ರಕಟಣೆಗಳು</h1>
      <p className="mb-4 text-sm text-slate-500">Notices from the college for your child&apos;s class. The same notices are sent on WhatsApp.</p>
      {updates.length === 0 ? (
        <Card>
          <Empty>No updates yet.</Empty>
        </Card>
      ) : (
        <ul className="space-y-3">
          {updates.map((u) => (
            <li key={u.id}>
              <Card>
                <p className="font-medium text-slate-900">{u.title}</p>
                <p className="mb-2 text-xs text-slate-500">
                  {u.publishedAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "long", year: "numeric" })} · {u.audience}
                </p>
                <p className="whitespace-pre-line text-sm text-slate-800">{u.bodyEn}</p>
                {u.bodyKn && (
                  <p lang="kn" className="mt-2 whitespace-pre-line text-sm text-slate-700">
                    {u.bodyKn}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
