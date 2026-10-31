import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { canManageStaff } from "@/lib/auth/permissions";
import { requireStaff } from "@/server/current";
import { listDepartments } from "@/server/queries";
import { createStaff } from "../actions";
import { StaffFields } from "../staff-fields";

export const metadata = { title: "Add staff · MEI Attendance" };

export default async function NewStaffPage() {
  const me = await requireStaff();
  if (!canManageStaff(me.actor)) return <NoAccess what="adding staff" />;
  const departments = await listDepartments();
  return (
    <>
      <PageHeader title="Add staff member" back={{ href: "/staff", label: "Staff" }} subtitle="A temporary password is created. They must change it at first sign-in." />
      <Card className="max-w-3xl">
        <ActionForm action={createStaff} resetOnSuccess className="space-y-4">
          <StaffFields departments={departments} />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="makeFaculty" defaultChecked className="size-4" /> Give the Faculty role now
          </label>
          <SubmitButton>Add staff member</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
