import { Field } from "@/components/action-form";
import { Input, Select } from "@/components/ui";
import { formatIndianMobile } from "@/lib/domain/phone";

/** Profile fields shared by "add staff" and "edit staff". */
export function StaffFields({
  departments,
  values,
  allowNone = true,
}: {
  departments: { id: number; code: string; name: string }[];
  values?: { name: string; phone: string; email: string | null; departmentId: number | null; designation: string | null };
  /** False for an HOD: staff they add always belong to their department. */
  allowNone?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" name="name">
        <Input id="name" name="name" defaultValue={values?.name} autoComplete="off" />
      </Field>
      <Field label="Mobile number (used to sign in)" name="phone">
        <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={values ? formatIndianMobile(values.phone) : ""} placeholder="98450 12345" />
      </Field>
      <Field label="Department" name="departmentId" hint={allowNone ? "Leave empty for common staff (Maths, EVS, Kannada, office)." : undefined}>
        <Select id="departmentId" name="departmentId" defaultValue={values?.departmentId ?? (allowNone ? "" : departments[0]?.id)}>
          {allowNone && <option value="">— Common / none —</option>}
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} — {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Designation" name="designation">
        <Input id="designation" name="designation" defaultValue={values?.designation ?? ""} placeholder="Lecturer" />
      </Field>
      <Field label="Email (optional)" name="email">
        <Input id="email" name="email" type="email" defaultValue={values?.email ?? ""} />
      </Field>
    </div>
  );
}
