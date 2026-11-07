import { sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { Badge, Card, Empty, Input, LinkButton, NoAccess, PageHeader, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { ROLE_LABEL, canAddStaff, canViewStaffList, type Role } from "@/lib/auth/permissions";
import { formatIndianMobile } from "@/lib/domain/phone";
import { requireStaff } from "@/server/current";
import { listDepartments } from "@/server/queries";

export const metadata = { title: "Staff · MEI Attendance" };

export default async function StaffPage(props: PageProps<"/staff">) {
  const me = await requireStaff();
  if (!canViewStaffList(me.actor)) return <NoAccess what="the staff list" />;
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const deptParam = typeof sp.dept === "string" ? sp.dept : "";
  const showInactive = sp.inactive === "1";

  const departments = await listDepartments();
  const deptFilter = deptParam === "common" ? "common" : departments.find((d) => String(d.id) === deptParam)?.id ?? null;

  const conds = [sql`true`];
  if (deptFilter === "common") conds.push(sql`s.department_id IS NULL`);
  else if (deptFilter) conds.push(sql`s.department_id = ${deptFilter}`);
  if (!showInactive) conds.push(sql`s.active`);
  if (q) {
    const digits = q.replace(/\D/g, "");
    conds.push(digits.length >= 4 ? sql`(s.name ILIKE ${`%${q}%`} OR s.phone LIKE ${`%${digits}%`})` : sql`s.name ILIKE ${`%${q}%`}`);
  }

  const { rows } = await getDb().execute<{ id: number; name: string; phone: string; designation: string | null; dept: string | null; active: boolean; roles: Role[] | null }>(sql`
    SELECT s.id, s.name, s.phone, s.designation, d.code AS dept, s.active,
           -- ::text[] because node-postgres can't parse arrays of custom enum types.
           (SELECT array_agg(DISTINCT g.role::text ORDER BY g.role::text) FROM role_grant g WHERE g.staff_id = s.id)::text[] AS roles
    FROM staff s LEFT JOIN department d ON d.id = s.department_id
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY d.code NULLS LAST, s.name
    LIMIT 500
  `);

  return (
    <>
      <PageHeader title="Staff" subtitle={`${rows.length} shown`} actions={canAddStaff(me.actor) && <LinkButton href="/staff/new">Add staff</LinkButton>} />
      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <Input name="q" defaultValue={q} placeholder="Search name or phone" className="max-w-xs" />
          <Select name="dept" defaultValue={deptParam} className="max-w-56">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
            <option value="common">Common (Maths, EVS, Kannada…)</option>
          </Select>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" name="inactive" value="1" defaultChecked={showInactive} /> Show inactive
          </label>
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
        {rows.length === 0 ? (
          <Empty>No staff match.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Mobile</Th>
                <Th>Dept</Th>
                <Th>Designation</Th>
                <Th>Roles</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.active ? "" : "opacity-60"}>
                  <Td>
                    <Link href={`/staff/${s.id}`} className="font-medium text-blue-700 hover:underline">
                      {s.name}
                    </Link>
                    {!s.active && <Badge tone="red">Inactive</Badge>}
                  </Td>
                  <Td className="tabular-nums">{formatIndianMobile(s.phone)}</Td>
                  <Td>{s.dept ?? <span className="text-slate-400">Common</span>}</Td>
                  <Td>{s.designation}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {(s.roles ?? []).map((r) => (
                        <Badge key={r} tone={r === "ADMIN" || r === "PRINCIPAL" ? "violet" : r === "HOD" ? "blue" : r === "CLASS_TEACHER" ? "green" : "slate"}>
                          {ROLE_LABEL[r]}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
