import { Field } from "@/components/action-form";
import { Input, Select } from "@/components/ui";

export const COURSE_KIND_LABEL = {
  INTEGRATED: "Theory + lab",
  THEORY_ONLY: "Theory only (e.g. EVS, Kannada)",
  PRACTICAL_ONLY: "Lab only",
  SPECIALIZATION: "Programme specialization",
} as const;

export function CourseFields({
  departments,
  schemes,
  values,
}: {
  departments: { id: number; code: string; name: string }[];
  schemes: { id: number; name: string }[];
  values?: { departmentId: number; semester: number; code: string; shortName: string; name: string; kind: keyof typeof COURSE_KIND_LABEL; schemeId: number };
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Department" name="departmentId">
        <Select id="departmentId" name="departmentId" defaultValue={values?.departmentId ?? departments[0]?.id}>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} — {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Semester" name="semester">
        <Select id="semester" name="semester" defaultValue={values?.semester ?? 1}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              Sem {n}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Subject code" name="code" hint="As in the DTE syllabus, e.g. 20CS31P">
        <Input id="code" name="code" defaultValue={values?.code} className="font-mono uppercase" />
      </Field>
      <Field label="Short name (shown in timetable)" name="shortName">
        <Input id="shortName" name="shortName" defaultValue={values?.shortName} placeholder="DSP" />
      </Field>
      <Field label="Full name" name="name" className="sm:col-span-2">
        <Input id="name" name="name" defaultValue={values?.name} />
      </Field>
      <Field label="Type" name="kind">
        <Select id="kind" name="kind" defaultValue={values?.kind ?? "INTEGRATED"}>
          {Object.entries(COURSE_KIND_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Marks scheme" name="schemeId" hint="Internal tests and finals. Rules still to be confirmed by the college.">
        <Select id="schemeId" name="schemeId" defaultValue={values?.schemeId}>
          {schemes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
