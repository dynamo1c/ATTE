/**
 * Subject import: one row per subject, matched by subject code. New subjects are created and given to
 * this term's class of that department and semester. For an existing subject only the names can change
 * here; department, semester, type and marks scheme are protected by the rules on the subject page.
 */
import type { CourseKind } from "@/lib/domain/timetable";
import type { ReadRow } from "@/lib/sheet-read";
import { changeLine, choice, duplicates, emptyPlan, headingKey, readColumns, RowReader, textCell, wholeNumber, type Column, type Plan } from "./columns";

export const SUBJECT_COLUMNS = [
  { key: "department", label: "Department", aliases: ["Dept"], required: true, help: "Department code: CE, CS, EE, EC, EI, ME, CG.", example: "CS" },
  { key: "semester", label: "Semester", aliases: ["Sem"], required: true, help: "1 to 6.", example: "3" },
  { key: "code", label: "Subject code", aliases: ["Code", "Course code"], required: true, help: "Official code from the curriculum; must be unique.", example: "20CS31P" },
  { key: "shortName", label: "Short name", aliases: ["Short", "Abbreviation"], required: true, help: "As on the timetable, e.g. DSP. Unique within the semester.", example: "DSP" },
  { key: "name", label: "Full name", aliases: ["Subject name", "Name", "Subject"], required: true, help: "Full subject name.", example: "Data Structures with Python" },
  { key: "kind", label: "Type", aliases: ["Kind", "Subject type"], required: true, help: "Integrated (theory + lab), Theory only, Practical only, or Specialization.", example: "Integrated" },
  { key: "scheme", label: "Marks scheme", aliases: ["Scheme"], required: true, help: "Which marks scheme: Theory final, Practical final, or Minor (no final exam).", example: "Theory final" },
] as const satisfies readonly Column[];

type Key = (typeof SUBJECT_COLUMNS)[number]["key"];

export const KIND_WORDS: Record<string, CourseKind> = {
  Integrated: "INTEGRATED",
  "Theory only": "THEORY_ONLY",
  Theory: "THEORY_ONLY",
  "Practical only": "PRACTICAL_ONLY",
  Practical: "PRACTICAL_ONLY",
  Lab: "PRACTICAL_ONLY",
  Specialization: "SPECIALIZATION",
  Specialisation: "SPECIALIZATION",
};

export const KIND_NAME: Record<CourseKind, string> = { INTEGRATED: "Integrated", THEORY_ONLY: "Theory only", PRACTICAL_ONLY: "Practical only", SPECIALIZATION: "Specialization" };

export interface SubjectContext {
  departments: readonly { id: number; code: string }[];
  schemes: readonly { id: number; name: string }[];
  courses: readonly { id: number; code: string; departmentId: number; semester: number; shortName: string; name: string; kind: CourseKind; schemeId: number }[];
  /** Classes of the term being set up, with the subjects they already have. */
  classes: readonly { id: number; departmentId: number; semester: number; courseIds: readonly number[] }[];
}

export interface CourseValues {
  departmentId: number;
  semester: number;
  code: string;
  shortName: string;
  name: string;
  kind: CourseKind;
  schemeId: number;
}

export type SubjectOp =
  | { kind: "create"; line: number; values: CourseValues; offerTo: number | null }
  | { kind: "update"; line: number; id: number; set: Partial<CourseValues>; before: Partial<CourseValues>; offerTo: number | null };

/**
 * Scheme from what someone typed: its exact name, or words that appear in only one scheme's name
 * ("minor", "theory final", "practical").
 */
export function matchScheme<S extends { id: number; name: string }>(raw: string, schemes: readonly S[]): S | null | "many" {
  const want = headingKey(raw);
  const exact = schemes.find((s) => headingKey(s.name) === want);
  if (exact) return exact;
  const words = raw.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && w !== "exam" && w !== "subject");
  if (!words.length) return null;
  const hits = schemes.filter((s) => words.every((w) => s.name.toLowerCase().includes(w)));
  return hits.length === 1 ? hits[0] : hits.length > 1 ? "many" : null;
}

export function planSubjects(file: readonly ReadRow[], ctx: SubjectContext): Plan<SubjectOp> {
  const plan = emptyPlan<SubjectOp>();
  const { rows, errors, warnings } = readColumns<Key>(file, SUBJECT_COLUMNS);
  plan.errors.push(...errors);
  plan.warnings.push(...warnings);
  if (errors.length) return plan;

  const deptByCode = new Map(ctx.departments.map((d) => [d.code, d.id]));
  const deptCode = new Map(ctx.departments.map((d) => [d.id, d.code]));
  const schemeName = new Map(ctx.schemes.map((s) => [s.id, s.name]));
  const byCode = new Map(ctx.courses.map((c) => [c.code, c]));
  const codes: { line: number; key: string | undefined }[] = [];
  const shorts: { line: number; key: string | undefined }[] = [];

  for (const row of rows) {
    const r = new RowReader();
    const deptRaw = row.get("department").toUpperCase();
    const departmentId = deptByCode.get(deptRaw);
    if (!departmentId) r.errors.push(deptRaw ? `Department “${row.get("department")}” is not one of ${[...deptByCode.keys()].join(", ")}.` : "Department is empty.");
    const semester = r.take(wholeNumber(row.get("semester"), "Semester", 1, 6));
    const code = r.take(textCell(row.get("code").toUpperCase().replace(/\s+/g, ""), "Subject code", 30, true));
    const shortName = r.take(textCell(row.get("shortName"), "Short name", 30, true));
    const name = r.take(textCell(row.get("name"), "Full name", 150, true));
    const kind = row.get("kind") ? r.take(choice(row.get("kind"), "Type", KIND_WORDS)) : (r.errors.push("Type is empty."), undefined);
    let schemeId: number | undefined;
    if (!row.get("scheme")) r.errors.push("Marks scheme is empty.");
    else {
      const s = matchScheme(row.get("scheme"), ctx.schemes);
      if (s === "many") r.errors.push(`Marks scheme “${row.get("scheme")}” matches more than one scheme. Write more of the name.`);
      else if (!s) r.errors.push(`Marks scheme “${row.get("scheme")}” not found. Schemes: ${ctx.schemes.map((x) => x.name).join("; ")}.`);
      else schemeId = s.id;
    }
    codes.push({ line: row.line, key: code ?? undefined });
    shorts.push({ line: row.line, key: departmentId && semester && shortName ? `${departmentId}|${semester}|${shortName.toUpperCase()}` : undefined });

    if (r.errors.length || !departmentId || !semester || !code || !shortName || !name || !kind || !schemeId) {
      plan.errors.push(...r.errors.map((message) => ({ line: row.line, message })));
      continue;
    }
    const values: CourseValues = { departmentId, semester, code, shortName, name, kind, schemeId };
    const cls = ctx.classes.find((c) => c.departmentId === departmentId && c.semester === semester);
    const where = `${deptRaw} Sem ${semester}`;
    // Short names must stay unique per department + semester among subjects not in this file's rows.
    const clash = ctx.courses.find((c) => c.code !== code && c.departmentId === departmentId && c.semester === semester && c.shortName.toUpperCase() === shortName.toUpperCase());
    if (clash) {
      plan.errors.push({ line: row.line, message: `${where} already has a subject called ${shortName} (code ${clash.code}).` });
      continue;
    }

    const existing = byCode.get(code);
    if (!existing) {
      plan.ops.push({ kind: "create", line: row.line, values, offerTo: cls?.id ?? null });
      plan.items.push({ line: row.line, action: "create", label: `${code} ${shortName}`, changes: [`${where}, ${KIND_NAME[kind]}, ${schemeName.get(schemeId)}`, cls ? `Given to ${where} this term` : `No ${where} class this term`] });
      continue;
    }

    const locked: string[] = [];
    if (existing.departmentId !== departmentId || existing.semester !== semester) locked.push(`department/semester (saved: ${deptCode.get(existing.departmentId)} Sem ${existing.semester})`);
    if (existing.kind !== kind) locked.push(`type (saved: ${KIND_NAME[existing.kind]})`);
    if (existing.schemeId !== schemeId) locked.push(`marks scheme (saved: ${schemeName.get(existing.schemeId)})`);
    if (locked.length) {
      plan.errors.push({ line: row.line, message: `${code} already exists with a different ${locked.join(", ")}. Change those on the subject's page, or fix the file.` });
      continue;
    }
    const set: Partial<CourseValues> = {};
    const before: Partial<CourseValues> = {};
    const changes: string[] = [];
    if (existing.shortName !== shortName) {
      set.shortName = shortName;
      before.shortName = existing.shortName;
      changes.push(changeLine("Short name", existing.shortName, shortName));
    }
    if (existing.name !== name) {
      set.name = name;
      before.name = existing.name;
      changes.push(changeLine("Full name", existing.name, name));
    }
    const offerTo = cls && !cls.courseIds.includes(existing.id) ? cls.id : null;
    if (offerTo) changes.push(`Given to ${where} this term`);
    const action = changes.length ? "update" : "same";
    if (action === "update") plan.ops.push({ kind: "update", line: row.line, id: existing.id, set, before, offerTo });
    plan.items.push({ line: row.line, action, label: `${code} ${shortName}`, changes });
  }

  plan.errors.push(...duplicates(codes, (c) => `Subject code ${c}`));
  plan.errors.push(...duplicates(shorts, (k) => `Short name ${k.split("|")[2]} in ${deptCode.get(Number(k.split("|")[0]))} Sem ${k.split("|")[1]}`));
  return plan;
}
