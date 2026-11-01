import Link from "next/link";
import { ReportActions } from "@/components/report-actions";
import { Card, Empty, Input, NoAccess, PageHeader, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { changedFields } from "@/lib/audit-diff";
import { canViewAudit } from "@/lib/auth/permissions";
import { requireStaff } from "@/server/current";
import { listStaffNames } from "@/server/queries";
import { auditChoices, auditFilters, loadAudit } from "@/server/report-data";

export const metadata = { title: "Audit log · MEI Attendance" };

const PAGE = 100;

/** Screens to open for an audited thing, where one exists. */
const LINK: Record<string, (id: string) => string> = {
  student: (id) => `/students/${id}`,
  staff: (id) => `/staff/${id}`,
  course: (id) => `/courses/${id}`,
  class_session: (id) => `/attendance/${id}`,
};

export default async function AuditPage(props: PageProps<"/admin/audit">) {
  const me = await requireStaff();
  if (!canViewAudit(me.actor)) return <NoAccess what="the audit log" />;
  const sp = await props.searchParams;
  const f = auditFilters(sp);
  const [rows, choices, staff] = await Promise.all([loadAudit(f, PAGE + 1), auditChoices(), listStaffNames()]);
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const params = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ action: f.action, entity: f.entity, id: f.entityId, actor: f.actorId === null ? null : String(f.actorId), from: f.from, to: f.to, ...patch })) if (v) p.set(k, v);
    return p.toString();
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every change, sign-in and download: who, when, what was there before and after. Rows can't be edited or deleted from the app."
        actions={<ReportActions excel={`/exports/audit?${params({})}`} print={false} />}
      />
      <Card
        actions={
          <form className="no-print flex flex-wrap items-end gap-2" action="">
            <Select name="action" defaultValue={f.action ?? ""} className="h-8 w-auto py-1" aria-label="Action">
              <option value="">Any action</option>
              {choices.actions.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </Select>
            <Select name="entity" defaultValue={f.entity ?? ""} className="h-8 w-auto py-1" aria-label="Kind">
              <option value="">Anything</option>
              {choices.entities.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </Select>
            <Input name="id" defaultValue={f.entityId ?? ""} placeholder="Id" className="h-8 w-20 py-1" aria-label="Id" />
            <Select name="actor" defaultValue={f.actorId === null ? "" : String(f.actorId)} className="h-8 w-auto max-w-48 py-1" aria-label="By">
              <option value="">Anyone</option>
              <option value="none">System / parent</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Input type="date" name="from" defaultValue={f.from ?? ""} className="h-8 w-auto py-1" aria-label="From" />
            <Input type="date" name="to" defaultValue={f.to ?? ""} className="h-8 w-auto py-1" aria-label="To" />
            <button className={buttonClass("secondary", "sm")}>Show</button>
          </form>
        }
      >
        {shown.length === 0 ? (
          <Empty>Nothing matches.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>What</Th>
                <Th>Change</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const changes = changedFields(r.before, r.after);
                const link = LINK[r.entity]?.(r.entity_id);
                return (
                  <tr key={r.id} className="align-top">
                    <Td className="whitespace-nowrap font-mono text-xs">{r.at}</Td>
                    <Td className="text-sm">{r.actor_name ?? <span className="text-slate-500">System / parent</span>}</Td>
                    <Td className="font-mono text-xs">{r.action}</Td>
                    <Td className="text-sm">
                      {r.entity}{" "}
                      {link ? (
                        <Link href={link} className="text-blue-700 hover:underline">
                          #{r.entity_id}
                        </Link>
                      ) : (
                        <span className="text-slate-500">#{r.entity_id}</span>
                      )}
                    </Td>
                    <Td className="max-w-xl text-xs">
                      {r.reason && <p className="mb-1 text-slate-800">Reason: {r.reason}</p>}
                      {changes.length > 0 && (
                        <ul className="space-y-0.5">
                          {changes.slice(0, 6).map((c) => (
                            <li key={c.field}>
                              <span className="text-slate-500">{c.field}:</span> <span className="text-red-800 line-through decoration-red-300">{c.before}</span> → <span className="text-green-800">{c.after}</span>
                            </li>
                          ))}
                          {changes.length > 6 && <li className="text-slate-500">…{changes.length - 6} more</li>}
                        </ul>
                      )}
                      {(r.before !== null || r.after !== null) && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-blue-700">Full record</summary>
                          <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify({ before: r.before, after: r.after }, null, 1)}</pre>
                        </details>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {more && (
          <div className="mt-3 text-right">
            <Link href={`/admin/audit?${params({ before: String(shown[shown.length - 1].id) })}`} className="text-sm text-blue-700 hover:underline">
              Older →
            </Link>
          </div>
        )}
      </Card>
    </>
  );
}
