import { sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { MessagePreview, MessageStatus } from "@/components/messages";
import { ExcelLink } from "@/components/report-actions";
import { Card, Empty, Input, NoAccess, PageHeader, Select, Stat, Table, Td, Textarea, Th, buttonClass } from "@/components/ui";
import { canBroadcast, canManageOutbox, canViewMessages, classTeacherClassIds, seesWholeCollege, visibleDepartmentIds } from "@/lib/auth/permissions";
import { formatIndianMobile } from "@/lib/domain/phone";
import { TRIGGER_LABEL, type Trigger } from "@/lib/notify/rules";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, listClasses, listDepartments } from "@/server/queries";
import { MESSAGE_STATUSES, messageFilters, messageScope, messageWhere } from "@/server/report-data";
import { cancelMessage, retryMessage, runNow, sendBroadcast } from "./actions";

export const metadata = { title: "Messages · MEI Attendance" };

const STATUSES = MESSAGE_STATUSES;
const PAGE = 100;

type Row = {
  id: number;
  trigger: Trigger;
  channel: "WHATSAPP" | "SMS";
  status: (typeof STATUSES)[number];
  phone: string;
  text: string;
  last_error: string | null;
  attempts: number;
  at: string;
  scheduled: string | null;
  student_id: number | null;
  student_name: string | null;
  reg_no: string | null;
  relation: string | null;
  fallback_of: number | null;
};

export default async function MessagesPage(props: PageProps<"/messages">) {
  const me = await requireStaff();
  if (!canViewMessages(me.actor)) return <NoAccess what="parent messages" />;
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="messages (no term set up)" />;
  const sp = await props.searchParams;
  const f = messageFilters(sp);
  const { status, trigger, q } = f;
  const depts = visibleDepartmentIds(me.actor);
  const ownClasses = classTeacherClassIds(me.actor);
  const scope = messageScope(me.actor, term.id);
  const filters = messageWhere(me.actor, term.id, f);

  const db = getDb();
  const [{ rows }, { rows: [stats] }] = await Promise.all([
    db.execute<Row>(sql`
      SELECT n.id, n.trigger::text AS trigger, n.channel::text AS channel, n.status::text AS status, n.phone, n.payload->>'text' AS text,
             n.last_error, n.attempts, to_char(n.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH24:MI') AS at,
             CASE WHEN n.status = 'QUEUED' AND n.scheduled_for > now() THEN to_char(n.scheduled_for AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH24:MI') END AS scheduled,
             n.student_id, s.name AS student_name, s.reg_no, pc.relation::text AS relation, n.fallback_of
      FROM notification n
      LEFT JOIN student s ON s.id = n.student_id
      LEFT JOIN parent_contact pc ON pc.id = n.parent_contact_id
      WHERE ${filters}
      ORDER BY n.id DESC
      LIMIT ${PAGE}`),
    db.execute<{ queued: number; sent_week: number; failed: number; no_consent: number }>(sql`
      SELECT
        count(*) FILTER (WHERE n.status IN ('QUEUED', 'SENDING'))::int AS queued,
        count(*) FILTER (WHERE n.status IN ('SENT', 'DELIVERED', 'READ') AND n.sent_at > now() - interval '7 days')::int AS sent_week,
        count(*) FILTER (WHERE n.status = 'FAILED')::int AS failed,
        (SELECT count(DISTINCT m.student_id)::int FROM class_membership m JOIN student s2 ON s2.id = m.student_id JOIN class_group cg ON cg.id = m.class_group_id
           WHERE m.term_id = ${term.id} AND m.left_on IS NULL
             ${depts === null ? sql`` : sql`AND (${depts.length ? sql`cg.department_id IN (${sql.join(depts.map((d) => sql`${d}`), sql`, `)})` : sql`false`} OR ${ownClasses.length ? sql`cg.id IN (${sql.join(ownClasses.map((c) => sql`${c}`), sql`, `)})` : sql`false`})`}
             AND NOT EXISTS (SELECT 1 FROM parent_contact pc WHERE pc.student_id = m.student_id AND pc.consent_at IS NOT NULL)) AS no_consent
      FROM notification n WHERE ${scope}`),
  ]);

  const manage = canManageOutbox(me.actor);
  const broadcast = canBroadcast(me.actor);
  const [departments, classes] = broadcast ? await Promise.all([listDepartments(), listClasses(term.id)]) : [[], []];
  const link = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { status, trigger, q: q || null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/messages?${s}` : "/messages";
  };

  return (
    <>
      <PageHeader
        title="Messages to parents"
        subtitle={`${seesWholeCollege(me.actor) ? "Whole college" : "Your students"} · WhatsApp first, SMS if no WhatsApp · English + Kannada · nothing sent 9 pm – 8 am`}
        actions={
          <>
            <ExcelLink href={`/exports/messages${link({}).slice("/messages".length)}`} />
            {manage && (
              <ActionForm action={runNow}>
                <SubmitButton variant="secondary">Check &amp; send now</SubmitButton>
              </ActionForm>
            )}
          </>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting to send" value={stats.queued} hint="Sent every 15 minutes, 8 am – 9 pm" />
        <Stat label="Sent in the last 7 days" value={stats.sent_week.toLocaleString("en-IN")} />
        <Stat label="Failed" value={stats.failed} hint={stats.failed ? <Link href={link({ status: "FAILED" })} className="text-blue-700 hover:underline">Show them</Link> : undefined} />
        <Stat label="Students with no consented number" value={stats.no_consent} hint="Their parents get nothing" />
      </dl>

      {broadcast && (
        <details className="mb-6 rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">Send a notice to parents</summary>
          <div className="border-t border-slate-200 p-4">
            <ActionForm action={sendBroadcast} resetOnSuccess confirm="Send this notice to every consenting parent in the group?" className="max-w-3xl space-y-3">
              <Field label="To parents of" name="audience">
                <Select id="audience" name="audience" defaultValue="college">
                  <option value="college">Every student in the college</option>
                  <optgroup label="A department">
                    {departments.map((d) => (
                      <option key={d.id} value={`dept:${d.id}`}>
                        {d.code} — {d.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="A class">
                    {classes.map((c) => (
                      <option key={c.id} value={`class:${c.id}`}>
                        {c.departmentCode} Sem {c.semester}
                      </option>
                    ))}
                  </optgroup>
                </Select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="English" name="textEn">
                  <Textarea id="textEn" name="textEn" rows={4} maxLength={600} placeholder="The college will remain closed on 12 November for Deepavali." />
                </Field>
                <Field label="Kannada" name="textKn">
                  <Textarea id="textKn" name="textKn" rows={4} maxLength={600} lang="kn" placeholder="ದೀಪಾವಳಿ ಪ್ರಯುಕ್ತ ನವೆಂಬರ್ 12 ರಂದು ಕಾಲೇಜಿಗೆ ರಜೆ ಇರುತ್ತದೆ." />
                </Field>
              </div>
              <p className="text-xs text-slate-500">Each parent gets the language(s) saved for their number. Sent during the next run (8 am – 9 pm).</p>
              <SubmitButton>Queue notice</SubmitButton>
            </ActionForm>
          </div>
        </details>
      )}

      <Card
        title="Messages"
        actions={
          <form className="no-print flex flex-wrap items-end gap-2" action="">
            <Input name="q" defaultValue={q} placeholder="Reg. no, name or phone" className="h-8 w-44 py-1" aria-label="Search" />
            <Select name="status" defaultValue={status ?? ""} className="h-8 w-auto py-1" aria-label="Status">
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase()}
                </option>
              ))}
            </Select>
            <Select name="trigger" defaultValue={trigger ?? ""} className="h-8 w-auto py-1" aria-label="Kind">
              <option value="">Any kind</option>
              {(Object.keys(TRIGGER_LABEL) as Trigger[]).map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABEL[t]}
                </option>
              ))}
            </Select>
            <button className={buttonClass("secondary", "sm")}>Show</button>
          </form>
        }
      >
        {rows.length === 0 ? (
          <Empty>No messages{status || trigger || q ? " match" : " yet"}.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Student</Th>
                <Th>To</Th>
                <Th>Kind</Th>
                <Th>Status</Th>
                <Th>Message</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs text-slate-600">{r.at}</Td>
                  <Td>
                    {r.student_id ? (
                      <Link href={`/students/${r.student_id}`} className="text-blue-700 hover:underline">
                        {r.student_name}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {r.reg_no && <div className="font-mono text-xs text-slate-500">{r.reg_no}</div>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span className="font-mono text-xs">{formatIndianMobile(r.phone)}</span>
                    <div className="text-xs text-slate-500">
                      {r.relation ? r.relation.toLowerCase() : ""} · {r.channel === "WHATSAPP" ? "WhatsApp" : "SMS"}
                      {r.fallback_of && " (fallback)"}
                    </div>
                  </Td>
                  <Td className="text-sm">{TRIGGER_LABEL[r.trigger]}</Td>
                  <Td>
                    <MessageStatus status={r.status} scheduled={r.scheduled} error={r.last_error} attempts={r.attempts} />
                    {manage && (r.status === "FAILED" || r.status === "SKIPPED") && (
                      <ActionForm action={retryMessage} className="mt-1">
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton size="sm" variant="ghost">
                          Retry
                        </SubmitButton>
                      </ActionForm>
                    )}
                    {manage && r.status === "QUEUED" && (
                      <ActionForm action={cancelMessage} confirm="Cancel this message?" className="mt-1">
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton size="sm" variant="ghost">
                          Cancel
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                  <Td>
                    <MessagePreview text={r.text} channel={r.channel} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {rows.length === PAGE && <p className="mt-3 text-xs text-slate-500">Showing the newest {PAGE}. Use the filters to find older ones.</p>}
      </Card>
    </>
  );
}
