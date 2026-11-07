import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Input, NoAccess, PageHeader, Select, Textarea } from "@/components/ui";
import { canPublishUpdates, canPublishUpdateTo, hodDepartmentIds, isAdmin, isOffice } from "@/lib/auth/permissions";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, listClasses, listDepartments } from "@/server/queries";
import { publishUpdate, withdrawUpdate } from "./actions";

export const metadata = { title: "College updates · MEI Attendance" };

const dateTime = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function UpdatesPage() {
  const me = await requireStaff();
  if (!canPublishUpdates(me.actor)) return <NoAccess what="college updates" />;
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="college updates (no term set up)" />;
  const db = getDb();
  // Office and admin write to anyone; an HOD only to their own department and its classes.
  const wholeCollege = isAdmin(me.actor) || isOffice(me.actor);
  const ownDepts = wholeCollege ? null : hodDepartmentIds(me.actor);
  const [allDepartments, classes, { rows: updates }] = await Promise.all([
    listDepartments(),
    listClasses(term.id, { departmentIds: ownDepts }),
    db.execute<{
      id: number;
      title: string;
      body_en: string;
      body_kn: string | null;
      audience: string;
      send_whatsapp: boolean;
      messages: number;
      published_at: Date;
      published_by: string;
      withdrawn_at: Date | null;
      withdrawn_by: string | null;
      audience_dept: number | null;
    }>(sql`
      SELECT u.id, u.title, u.body_en, u.body_kn, u.send_whatsapp, u.messages, u.published_at, p.name AS published_by, u.withdrawn_at, w.name AS withdrawn_by,
             COALESCE(d.code || ' department', cd.code || ' Sem ' || cg.semester, 'Whole college') AS audience,
             COALESCE(u.department_id, cg.department_id) AS audience_dept
      FROM college_update u
      JOIN staff p ON p.id = u.published_by
      LEFT JOIN staff w ON w.id = u.withdrawn_by
      LEFT JOIN department d ON d.id = u.department_id
      LEFT JOIN class_group cg ON cg.id = u.class_group_id
      LEFT JOIN department cd ON cd.id = cg.department_id
      ORDER BY u.published_at DESC
      LIMIT 60`),
  ]);
  const oldest = updates.at(-1)?.published_at;
  const { rows: delivery } = oldest
    ? await db.execute<{ id: number; sent: number; failed: number; waiting: number }>(sql`
        SELECT split_part(dedupe_key, ':', 2)::int AS id,
               count(*) FILTER (WHERE status IN ('SENT', 'DELIVERED', 'READ'))::int AS sent,
               count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
               count(*) FILTER (WHERE status IN ('QUEUED', 'SENDING'))::int AS waiting
        FROM notification
        WHERE trigger = 'BROADCAST' AND dedupe_key LIKE 'UPDATE:%' AND created_at >= ${new Date(oldest)}
        GROUP BY 1`)
    : { rows: [] };
  const deliveryOf = new Map(delivery.map((d) => [d.id, d]));
  const departments = ownDepts ? allDepartments.filter((d) => ownDepts.includes(d.id)) : allDepartments;

  return (
    <>
      <PageHeader
        title="College updates"
        subtitle={`Notices to parents: sent on WhatsApp (English and/or Kannada, as each parent chose) and kept on the parent portal's Updates page.${wholeCollege ? "" : " As HOD you publish for your own department and its classes."}`}
      />

      <Card title="Publish an update" className="mb-6 max-w-4xl">
        <ActionForm action={publishUpdate} resetOnSuccess confirm="Publish this update? Parents will see it on the portal, and WhatsApp messages go out if ticked." className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" name="title">
              <Input id="title" name="title" maxLength={120} placeholder="Deepavali holidays" />
            </Field>
            <Field label="For parents of" name="audience">
              <Select id="audience" name="audience" defaultValue={wholeCollege ? "college" : departments[0] ? `dept:${departments[0].id}` : undefined}>
                {wholeCollege && <option value="college">The whole college</option>}
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
            <Field label="English" name="bodyEn">
              <Textarea id="bodyEn" name="bodyEn" rows={5} maxLength={900} placeholder="The college will remain closed from 9 to 11 November for Deepavali. Classes resume on 12 November." />
            </Field>
            <Field label="Kannada (optional)" name="bodyKn" hint="If empty, Kannada-only parents get the English text.">
              <Textarea id="bodyKn" name="bodyKn" rows={5} maxLength={900} lang="kn" placeholder="ದೀಪಾವಳಿ ಪ್ರಯುಕ್ತ ನವೆಂಬರ್ 9 ರಿಂದ 11 ರವರೆಗೆ ಕಾಲೇಜಿಗೆ ರಜೆ ಇರುತ್ತದೆ." />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="sendWhatsApp" defaultChecked className="size-4" /> Also send on WhatsApp (to parents who gave consent; nothing goes out 9 pm – 8 am)
          </label>
          <SubmitButton>Publish</SubmitButton>
        </ActionForm>
      </Card>

      <Card title="Published">
        {updates.length === 0 ? (
          <Empty>Nothing published yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {updates.map((u) => {
              const d = deliveryOf.get(u.id);
              return (
                <li key={u.id} className={`py-3 first:pt-0 last:pb-0 ${u.withdrawn_at ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        {u.title} {u.withdrawn_at && <Badge tone="red">Withdrawn</Badge>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {u.audience} · {dateTime(new Date(u.published_at))} · by {u.published_by}
                        {u.withdrawn_at && ` · withdrawn by ${u.withdrawn_by}`}
                      </p>
                    </div>
                    {!u.withdrawn_at && canPublishUpdateTo(me.actor, u.audience_dept) && (
                      <ActionForm action={withdrawUpdate} confirm="Withdraw this update from the parent portal? Messages already sent stay sent.">
                        <input type="hidden" name="id" value={u.id} />
                        <SubmitButton size="sm" variant="ghost">
                          Withdraw
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{u.body_en}</p>
                  {u.body_kn && (
                    <p lang="kn" className="mt-1 whitespace-pre-line text-sm text-slate-600">
                      {u.body_kn}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    {u.send_whatsapp
                      ? `WhatsApp: ${u.messages} queued${d ? ` · ${d.sent} sent${d.waiting ? ` · ${d.waiting} waiting` : ""}${d.failed ? ` · ${d.failed} failed` : ""}` : ""}`
                      : "Portal only (no WhatsApp)"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
