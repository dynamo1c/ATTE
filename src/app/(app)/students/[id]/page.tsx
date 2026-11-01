import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { parentContact } from "@/db/schema";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Input, NoAccess, PageHeader, Select } from "@/components/ui";
import { formatDateShort, todayIn } from "@/lib/domain/dates";
import { formatIndianMobile } from "@/lib/domain/phone";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, parseId } from "@/server/queries";
import { canManageStudent, canViewStudent, getStudent } from "@/server/student-data";
import { canViewMessages } from "@/lib/auth/permissions";
import { StudentAttendanceCard } from "./attendance-card";
import { StudentMarksCard } from "./marks-card";
import { StudentMessagesCard } from "./messages-card";
import { addContact, changeBatch, removeContact, updateContact, updateStudentProfile } from "../actions";

const RELATION = { FATHER: "Father", MOTHER: "Mother", GUARDIAN: "Guardian", OTHER: "Other" } as const;
const LANGUAGE = { BOTH: "English + Kannada", KN: "Kannada", EN: "English" } as const;

type Contact = typeof parentContact.$inferSelect;

export default async function StudentPage(props: PageProps<"/students/[id]">) {
  const me = await requireStaff();
  const id = parseId((await props.params).id);
  if (!id) notFound();
  const term = await getCurrentTerm();
  const s = await getStudent(id, term?.id ?? null);
  if (!s) notFound();
  if (!canViewStudent(me.actor, s)) return <NoAccess what="this student" />;
  const canEdit = canManageStudent(me.actor, s);
  const contacts = await getDb().select().from(parentContact).where(eq(parentContact.studentId, s.id)).orderBy(asc(parentContact.id));
  const m = s.membership;

  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={
          <span className="font-mono">
            {s.regNo}
            <span className="font-sans">
              {m ? ` · ${m.classDept} Sem ${m.semester} · Batch ${m.batch ?? "—"}` : " · Not in a class this term"} · Admitted {s.admissionYear}
            </span>
          </span>
        }
        back={m ? { href: `/classes/${m.classGroupId}`, label: `${m.classDept} Sem ${m.semester}` } : { href: "/students", label: "Students" }}
      />
      <div className="mb-4 flex flex-wrap gap-1">
        {s.lateralEntry && <Badge tone="blue">Lateral entry</Badge>}
        {s.status !== "ACTIVE" && <Badge tone="red">{s.status.toLowerCase()}</Badge>}
        {m?.leftOn && <Badge tone="red">Left class on {formatDateShort(m.leftOn)}</Badge>}
        {m && m.joinedOn > (term?.startsOn ?? "") && <Badge tone="amber">Joined {formatDateShort(m.joinedOn)}</Badge>}
      </div>

      {m && <StudentAttendanceCard studentId={s.id} classId={m.classGroupId} />}
      {m && <StudentMarksCard studentId={s.id} classId={m.classGroupId} />}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Parent / guardian numbers" className="xl:row-span-2">
          <p className="mb-3 text-sm text-slate-600">WhatsApp updates go to every number with consent. Without recorded consent no message is sent (DPDP Act).</p>
          {contacts.length === 0 && <Empty>No numbers yet — parents will get no updates.</Empty>}
          <div className="space-y-4">
            {contacts.map((c) => (
              <ContactEditor key={c.id} contact={c} studentId={s.id} canEdit={canEdit} />
            ))}
          </div>
          {canEdit && contacts.length < 4 && (
            <details className="mt-4 rounded-md border border-dashed border-slate-300 p-3">
              <summary className="cursor-pointer text-sm font-medium text-blue-700">Add a number</summary>
              <ActionForm action={addContact} resetOnSuccess className="mt-3 space-y-3">
                <input type="hidden" name="studentId" value={s.id} />
                <ContactFields prefix="new" />
                <SubmitButton size="sm">Add number</SubmitButton>
              </ActionForm>
            </details>
          )}
        </Card>

        <Card title="Student details">
          <ActionForm action={updateStudentProfile} className="space-y-3">
            <input type="hidden" name="studentId" value={s.id} />
            <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-3">
              <Field label="Name" name="name" className="sm:col-span-3">
                <Input id="name" name="name" defaultValue={s.name} />
              </Field>
              <Field label="Gender" name="gender">
                <Select id="gender" name="gender" defaultValue={s.gender ?? ""}>
                  <option value="">—</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label="Date of birth" name="dateOfBirth">
                <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={s.dateOfBirth ?? ""} />
              </Field>
            </fieldset>
            {canEdit && <SubmitButton size="sm">Save details</SubmitButton>}
          </ActionForm>
        </Card>

        {canEdit && m && !m.leftOn && (
          <Card title="Batch">
            <ActionForm action={changeBatch} className="grid gap-3 sm:grid-cols-3 sm:items-end">
              <input type="hidden" name="studentId" value={s.id} />
              <Field label="Move to" name="batch">
                <Select id="batch" name="batch" defaultValue={m.batch === "B1" ? "B2" : "B1"}>
                  <option value="B1">B1</option>
                  <option value="B2">B2</option>
                </Select>
              </Field>
              <Field label="From" name="effectiveFrom">
                <Input id="effectiveFrom" name="effectiveFrom" type="date" min={todayIn()} defaultValue={todayIn()} />
              </Field>
              <SubmitButton variant="secondary" size="sm">
                Change batch
              </SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
      {canViewMessages(me.actor) && <StudentMessagesCard studentId={s.id} regNo={s.regNo} />}
    </>
  );
}

function ContactFields({ prefix, c }: { prefix: string; c?: Contact }) {
  const id = (n: string) => `${prefix}-${n}`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Relation" name="relation" htmlFor={id("relation")}>
        <Select id={id("relation")} name="relation" defaultValue={c?.relation ?? "FATHER"}>
          {Object.entries(RELATION).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Name (optional)" name="name" htmlFor={id("name")}>
        <Input id={id("name")} name="name" defaultValue={c?.name ?? ""} />
      </Field>
      <Field label="Mobile number" name="phone" htmlFor={id("phone")}>
        <Input id={id("phone")} name="phone" type="tel" inputMode="tel" defaultValue={c ? formatIndianMobile(c.phone) : ""} placeholder="98450 12345" />
      </Field>
      <Field label="Message language" name="language" htmlFor={id("language")}>
        <Select id={id("language")} name="language" defaultValue={c?.language ?? "BOTH"}>
          {Object.entries(LANGUAGE).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="whatsappOk" defaultChecked={c?.whatsappOk ?? true} className="size-4" /> Has WhatsApp
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="consent" defaultChecked={Boolean(c?.consentAt)} className="size-4" /> Consent to receive updates
      </label>
      <Field label="How consent was given" name="consentMethod" htmlFor={id("consentMethod")} className="sm:col-span-2">
        <Input id={id("consentMethod")} name="consentMethod" defaultValue={c?.consentMethod ?? ""} placeholder="Signed admission form" />
      </Field>
    </div>
  );
}

function ContactEditor({ contact: c, studentId, canEdit }: { contact: Contact; studentId: number; canEdit: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{RELATION[c.relation]}</span>
        {c.name && <span className="text-slate-600">{c.name}</span>}
        <span className="font-mono">{formatIndianMobile(c.phone)}</span>
        {c.consentAt ? <Badge tone="green">Consent</Badge> : <Badge tone="amber">No consent — no messages</Badge>}
        {!c.whatsappOk && <Badge>SMS only</Badge>}
      </div>
      {canEdit && (
        <details>
          <summary className="cursor-pointer text-sm text-blue-700">Edit</summary>
          <ActionForm action={updateContact} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="studentId" value={studentId} />
            <ContactFields prefix={`c${c.id}`} c={c} />
            <SubmitButton size="sm">Save</SubmitButton>
          </ActionForm>
          <ActionForm action={removeContact} confirm={`Remove ${formatIndianMobile(c.phone)}?`} className="mt-2">
            <input type="hidden" name="id" value={c.id} />
            <SubmitButton size="sm" variant="danger">
              Remove number
            </SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
