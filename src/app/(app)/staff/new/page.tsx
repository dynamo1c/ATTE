import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { canAddStaff, hodDepartmentIds, isAdmin } from "@/lib/auth/permissions";
import { requireStaff } from "@/server/current";
import { listDepartments } from "@/server/queries";
import { createStaff } from "../actions";
import { StaffFields } from "../staff-fields";

export const metadata = { title: "Add staff · MEI Attendance" };

export default async function NewStaffPage() {
  const me = await requireStaff();
  if (!canAddStaff(me.actor)) return <NoAccess what="adding staff" />;
  const admin = isAdmin(me.actor);
  const own = hodDepartmentIds(me.actor);
  const departments = (await listDepartments()).filter((d) => admin || own.includes(d.id));
  return (
    <>
      <PageHeader title="Add staff member" back={{ href: "/staff", label: "Staff" }} subtitle={`A temporary password is created. They must change it at first sign-in.${admin ? "" : " They join your department as faculty; everyone can see them on the staff list."}`} />
      <Card className="max-w-3xl">
        <ActionForm action={createStaff} resetOnSuccess className="space-y-4">
          <StaffFields departments={departments} allowNone={admin} />
          {admin ? (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="makeFaculty" defaultChecked className="size-4" /> Give the Faculty role now
            </label>
          ) : (
            <input type="hidden" name="makeFaculty" value="on" />
          )}
          <SubmitButton>Add staff member</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
