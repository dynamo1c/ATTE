/**
 * Student import: one row per student with their parents' numbers, matched by register number.
 *
 * - New student: created and put in this term's class (department + semester) and batch.
 * - Existing student without a class this term (e.g. next term's list): put in the class.
 * - Existing student already in a class: details are updated where cells are filled; moving class or
 *   batch is refused here (it changes attendance history; do it on the student's page).
 * - Parent numbers are added or updated, never removed. Consent is only recorded when the Consent
 *   column says how it was given; blank never removes consent already recorded.
 */
import { parseRegNo } from "@/lib/domain/regNo";
import type { ReadRow } from "@/lib/sheet-read";
import { changeLine, choice, dateCell, duplicates, emptyPlan, mobile, readColumns, RowReader, textCell, wholeNumber, yesNo, type Column, type Plan } from "./columns";

export const MAX_CONTACTS = 4;
const PARENTS = [1, 2, 3] as const;

const parentColumns = (n: number, required = false) =>
  [
    { key: `p${n}Relation`, label: `Parent ${n} relation`, required, help: "Father, Mother, Guardian or Other.", example: n === 1 ? "Father" : "Mother" },
    { key: `p${n}Name`, label: `Parent ${n} name`, help: "Optional.", example: n === 1 ? "Ramesh K" : "Sudha R" },
    { key: `p${n}Mobile`, label: `Parent ${n} mobile`, required, help: "10-digit mobile that gets the messages.", example: n === 1 ? "98450 12345" : "" },
    { key: `p${n}Language`, label: `Parent ${n} language`, help: "Kannada, English or Both (blank = Both).", example: "Kannada" },
    { key: `p${n}Whatsapp`, label: `Parent ${n} WhatsApp`, help: "Yes / No: is this number on WhatsApp? Blank = Yes. No = SMS only.", example: "Yes" },
  ] as const;

export const STUDENT_COLUMNS = [
  { key: "regNo", label: "Register no", aliases: ["Register number", "Reg no", "Regno", "Register no.", "Reg. no."], required: true, help: "e.g. 204CS25012.", example: "204CS25012" },
  { key: "name", label: "Name", aliases: ["Student name"], required: true, help: "Full name.", example: "Ananya R" },
  { key: "semester", label: "Semester", aliases: ["Sem", "Class"], required: true, help: "Semester the student is in this term (1 to 6).", example: "3" },
  { key: "batch", label: "Batch", required: true, help: "B1 or B2 (lab batch).", example: "B1" },
  { key: "department", label: "Department", aliases: ["Dept"], help: "Blank = from the register number. Fill only if the student sits in another department's class.", example: "" },
  { key: "gender", label: "Gender", aliases: ["Sex"], help: "Male, Female or Other. Optional.", example: "Female" },
  { key: "dob", label: "Date of birth", aliases: ["DOB", "Birth date"], help: "Day/month/year, e.g. 14/05/2008. Optional.", example: "14/05/2008" },
  { key: "lateral", label: "Lateral entry", aliases: ["Lateral"], help: "Yes for lateral-entry students. Blank = No.", example: "No" },
  ...parentColumns(1, true),
  ...parentColumns(2),
  ...parentColumns(3),
  { key: "consent", label: "Consent", aliases: ["Consent recorded", "Parent consent", "Consent method"], help: "How the parents agreed to get messages, e.g. “Signed admission form”. Blank = no consent: no messages are sent.", example: "Signed admission form" },
] as const satisfies readonly Column[];

/** Template columns: parent 3 is accepted but not shown (rarely needed). */
export const STUDENT_TEMPLATE_COLUMNS = STUDENT_COLUMNS.filter((c) => !c.key.startsWith("p3"));

type Key = (typeof STUDENT_COLUMNS)[number]["key"];
type Relation = "FATHER" | "MOTHER" | "GUARDIAN" | "OTHER";
type Language = "EN" | "KN" | "BOTH";
type Gender = "MALE" | "FEMALE" | "OTHER";
type Batch = "B1" | "B2";

const RELATIONS: Record<string, Relation> = { Father: "FATHER", Mother: "MOTHER", Guardian: "GUARDIAN", Other: "OTHER", Dad: "FATHER", Mom: "MOTHER", Mum: "MOTHER" };
const LANGUAGES: Record<string, Language> = { Kannada: "KN", KN: "KN", English: "EN", EN: "EN", Both: "BOTH", "Kannada and English": "BOTH", "English and Kannada": "BOTH" };
const GENDERS: Record<string, Gender> = { Male: "MALE", M: "MALE", Boy: "MALE", Female: "FEMALE", F: "FEMALE", Girl: "FEMALE", Other: "OTHER" };
const RELATION_NAME: Record<Relation, string> = { FATHER: "Father", MOTHER: "Mother", GUARDIAN: "Guardian", OTHER: "Other" };

export interface StudentContext {
  collegeCode: string;
  departments: readonly { id: number; code: string }[];
  classes: readonly { id: number; departmentId: number; departmentCode: string; semester: number }[];
  students: readonly {
    id: number;
    regNo: string;
    name: string;
    gender: Gender | null;
    dateOfBirth: string | null;
    lateralEntry: boolean;
    status: "ACTIVE" | "DETAINED" | "DROPPED" | "ALUMNI";
    /** This term's class, if any. */
    membership: { classGroupId: number; batch: Batch | null } | null;
    contacts: readonly { id: number; phone: string; name: string | null; relation: Relation; language: Language; whatsappOk: boolean; consentAt: Date | null; optedOutAt: Date | null }[];
  }[];
}

export interface ContactValues {
  phone: string;
  name: string | null;
  relation: Relation;
  language: Language;
  whatsappOk: boolean;
}

export interface StudentValues {
  regNo: string;
  name: string;
  gender: Gender | null;
  dateOfBirth: string | null;
  departmentId: number;
  admissionYear: number;
  lateralEntry: boolean;
}

export type StudentOp = {
  line: number;
  /** null = new student. */
  studentId: number | null;
  create: StudentValues | null;
  update: { set: Partial<StudentValues>; before: Partial<StudentValues> } | null;
  join: { classGroupId: number; batch: Batch } | null;
  addContacts: ContactValues[];
  updateContacts: { id: number; set: Partial<ContactValues>; before: Partial<ContactValues> }[];
  /** How consent was given (Consent column), recorded on the new numbers. Null = no consent. */
  consent: string | null;
  /** Saved numbers in this row that had no consent and now get it. */
  consentContactIds: number[];
  regNo: string;
};

export function planStudents(file: readonly ReadRow[], ctx: StudentContext): Plan<StudentOp> {
  const plan = emptyPlan<StudentOp>();
  const { rows, errors, warnings } = readColumns<Key>(file, STUDENT_COLUMNS);
  plan.errors.push(...errors);
  plan.warnings.push(...warnings);
  if (errors.length) return plan;

  const deptByCode = new Map(ctx.departments.map((d) => [d.code, d.id]));
  const classById = new Map(ctx.classes.map((c) => [c.id, c]));
  const byRegNo = new Map(ctx.students.map((s) => [s.regNo, s]));
  const regNos: { line: number; key: string | undefined }[] = [];
  const thisYear = new Date().getUTCFullYear();

  for (const row of rows) {
    const r = new RowReader();
    const reg = parseRegNo(row.get("regNo"), { collegeCode: ctx.collegeCode, departmentCodes: [...deptByCode.keys()] });
    if (!row.get("regNo")) r.errors.push("Register number is empty.");
    else if (!reg.ok) r.errors.push(`Register number “${row.get("regNo")}”: ${reg.error}.`);
    else if (reg.value.admissionYear > thisYear + 1) r.errors.push(`Register number ${row.get("regNo")} has admission year ${reg.value.admissionYear}, which is in the future.`);
    const regNo = reg.ok ? row.get("regNo").replace(/\s+/g, "").toUpperCase() : undefined;
    regNos.push({ line: row.line, key: regNo });
    const existing = regNo ? byRegNo.get(regNo) : undefined;

    const name = r.take(textCell(row.get("name"), "Name", 120, true));
    const semester = r.take(wholeNumber(row.get("semester"), "Semester", 1, 6));
    const batchRaw = row.get("batch").toUpperCase().replace(/^BATCH\s*/, "").replace(/^([12])$/, "B$1");
    const batch = batchRaw ? r.take(choice(batchRaw, "Batch", { B1: "B1" as Batch, B2: "B2" as Batch })) : (r.errors.push("Batch is empty (B1 or B2)."), undefined);
    const classDeptCode = row.get("department").toUpperCase() || (reg.ok ? reg.value.departmentCode : "");
    const classDept = deptByCode.get(classDeptCode);
    if (row.get("department") && !classDept) r.errors.push(`Department “${row.get("department")}” is not one of ${[...deptByCode.keys()].join(", ")}.`);
    const gender = row.get("gender") ? r.take(choice(row.get("gender"), "Gender", GENDERS)) : null;
    const dob = row.get("dob") ? r.take(dateCell(row.get("dob"), "Date of birth")) : null;
    if (dob && (dob < `${thisYear - 60}-01-01` || dob > `${thisYear - 10}-12-31`)) r.errors.push(`Date of birth ${dob} does not look right for a student.`);
    const lateral = r.take(yesNo(row.get("lateral"), "Lateral entry", existing?.lateralEntry ?? false));
    const consent = r.take(textCell(row.get("consent"), "Consent", 120, false));

    // Parents
    const contacts: (ContactValues & { n: number })[] = [];
    for (const n of PARENTS) {
      const get = (k: string) => row.get(`p${n}${k}` as Key);
      const any = ["Relation", "Name", "Mobile", "Language", "Whatsapp"].some((k) => get(k));
      if (!any) continue;
      const label = `Parent ${n}`;
      if (!get("Mobile")) {
        r.errors.push(`${label} mobile is empty (the other ${label} cells are filled).`);
        continue;
      }
      const phone = r.take(mobile(get("Mobile"), `${label} mobile`));
      const relation = get("Relation") ? r.take(choice(get("Relation"), `${label} relation`, RELATIONS)) : (r.errors.push(`${label} relation is empty (Father, Mother, Guardian or Other).`), undefined);
      const pname = r.take(textCell(get("Name"), `${label} name`, 120, false));
      const language = get("Language") ? r.take(choice(get("Language"), `${label} language`, LANGUAGES)) : "BOTH";
      const whatsappOk = r.take(yesNo(get("Whatsapp"), `${label} WhatsApp`, true));
      if (phone && relation && language && whatsappOk !== undefined) {
        if (contacts.some((c) => c.phone === phone)) r.errors.push(`${label} mobile is the same as Parent ${contacts.find((c) => c.phone === phone)!.n}'s.`);
        else contacts.push({ n, phone, relation, name: pname ?? null, language, whatsappOk });
      }
    }
    if (!contacts.length && !r.errors.some((e) => e.startsWith("Parent"))) r.errors.push("No parent mobile: fill Parent 1 relation and mobile.");

    if (r.errors.length || !reg.ok || !regNo || !name || !semester || !batch || !classDept || lateral === undefined || gender === undefined || dob === undefined || consent === undefined) {
      plan.errors.push(...r.errors.map((message) => ({ line: row.line, message })));
      continue;
    }

    const cls = ctx.classes.find((c) => c.departmentId === classDept && c.semester === semester);
    if (!cls) {
      plan.errors.push({ line: row.line, message: `There is no ${classDeptCode} Sem ${semester} class this term.` });
      continue;
    }
    const where = `${cls.departmentCode} Sem ${cls.semester} ${batch}`;
    const op: StudentOp = { line: row.line, studentId: existing?.id ?? null, create: null, update: null, join: null, addContacts: [], updateContacts: [], consent: consent ?? null, consentContactIds: [], regNo };
    const changes: string[] = [];

    if (!existing) {
      op.create = { regNo, name, gender, dateOfBirth: dob, departmentId: deptByCode.get(reg.value.departmentCode)!, admissionYear: reg.value.admissionYear, lateralEntry: lateral };
      op.join = { classGroupId: cls.id, batch };
      op.addContacts = contacts.map(({ n: _n, ...c }) => c);
      changes.push(where, ...contacts.map((c) => `+ ${RELATION_NAME[c.relation]} ${c.phone.slice(3)}`));
      if (!consent) plan.warnings.push({ line: row.line, message: `${regNo}: no consent recorded, so parents get no messages until it is.` });
      plan.ops.push(op);
      plan.items.push({ line: row.line, action: "create", label: `${regNo} ${name}`, changes });
      continue;
    }

    // Existing student
    if (existing.status === "DROPPED" || existing.status === "ALUMNI") {
      plan.errors.push({ line: row.line, message: `${regNo} is marked ${existing.status.toLowerCase()}. Change their status first if they are back.` });
      continue;
    }
    if (existing.membership) {
      const now = classById.get(existing.membership.classGroupId);
      if (existing.membership.classGroupId !== cls.id) {
        plan.errors.push({ line: row.line, message: `${regNo} is already in ${now ? `${now.departmentCode} Sem ${now.semester}` : "another class"} this term. Moving class is not done by import.` });
        continue;
      }
      if (existing.membership.batch !== batch) {
        plan.errors.push({ line: row.line, message: `${regNo} is in ${existing.membership.batch ?? "no batch"}, the file says ${batch}. Change batch on the student's page (from a date), or fix the file.` });
        continue;
      }
    } else {
      op.join = { classGroupId: cls.id, batch };
      changes.push(`Joins ${where}`);
    }

    const set: Partial<StudentValues> = {};
    const before: Partial<StudentValues> = {};
    const field = <F extends "name" | "gender" | "dateOfBirth" | "lateralEntry">(f: F, label: string, value: StudentValues[F] | null) => {
      if (value === null || (value as unknown) === existing[f]) return;
      set[f] = value;
      before[f] = existing[f];
      changes.push(changeLine(label, existing[f], value));
    };
    field("name", "Name", name);
    field("gender", "Gender", gender);
    field("dateOfBirth", "Date of birth", dob);
    if (row.get("lateral")) field("lateralEntry", "Lateral entry", lateral);
    if (Object.keys(set).length) op.update = { set, before };

    let total = existing.contacts.length;
    for (const { n: _n, ...c } of contacts) {
      const saved = existing.contacts.find((x) => x.phone === c.phone);
      if (!saved) {
        op.addContacts.push(c);
        changes.push(`+ ${RELATION_NAME[c.relation]} ${c.phone.slice(3)}`);
        total++;
        continue;
      }
      const cset: Partial<ContactValues> = {};
      const cbefore: Partial<ContactValues> = {};
      for (const k of ["relation", "language", "whatsappOk", "name"] as const) {
        if (k === "name" && c.name === null) continue;
        if (saved[k] !== c[k]) {
          (cset as Record<string, unknown>)[k] = c[k];
          (cbefore as Record<string, unknown>)[k] = saved[k];
        }
      }
      if (Object.keys(cset).length) {
        op.updateContacts.push({ id: saved.id, set: cset, before: cbefore });
        changes.push(`${c.phone.slice(3)}: ${Object.keys(cset).join(", ")} updated`);
      }
      if (saved.optedOutAt) plan.warnings.push({ line: row.line, message: `${c.phone.slice(3)} has stopped messages (opted out). Import does not turn them back on.` });
    }
    if (total > MAX_CONTACTS) {
      plan.errors.push({ line: row.line, message: `${regNo} would have ${total} parent numbers; at most ${MAX_CONTACTS} are allowed. Remove old ones on the student's page first.` });
      continue;
    }
    const needConsent = consent ? existing.contacts.filter((x) => !x.consentAt && contacts.some((c) => c.phone === x.phone)) : [];
    op.consentContactIds = needConsent.map((x) => x.id);
    if (needConsent.length) changes.push(`Consent recorded for ${needConsent.map((x) => x.phone.slice(3)).join(", ")}`);
    if (!consent && op.addContacts.length) plan.warnings.push({ line: row.line, message: `${regNo}: new numbers have no consent recorded, so they get no messages until it is.` });

    const action = changes.length ? "update" : "same";
    if (action === "update") plan.ops.push(op);
    plan.items.push({ line: row.line, action, label: `${regNo} ${existing.name}`, changes });
  }

  plan.errors.push(...duplicates(regNos, (k) => `Register number ${k}`));
  return plan;
}
