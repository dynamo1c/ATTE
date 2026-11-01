/**
 * Outbox (docs/PLAN.md §8.3): messages are rows written in the same transaction as the event that
 * causes them. A background run sends them later (worker.ts). Never call a provider from here.
 *
 * No "server-only" import: the scheduled job imports this too.
 */
import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { notification, notificationSetting, parentContact } from "@/db/schema";
import { chooseRecipients, sendableAt, TRIGGER_DEFAULT, type ContactFact, type Trigger } from "@/lib/notify/rules";
import { renderSms, renderWhatsApp, type MessageData } from "@/lib/notify/templates";

/** A db or a transaction. */
export type Tx = Pick<Db, "insert" | "select" | "execute" | "update">;

export interface Contact extends ContactFact {
  studentId: number;
}

export async function loadTriggerSettings(db: Pick<Db, "select">): Promise<Record<Trigger, boolean>> {
  const rows = await db.select().from(notificationSetting);
  const out = { ...TRIGGER_DEFAULT };
  for (const r of rows) out[r.trigger] = r.enabled;
  return out;
}

export async function loadContacts(db: Pick<Db, "select">, studentIds: readonly number[]): Promise<Map<number, Contact[]>> {
  const out = new Map<number, Contact[]>();
  // Chunked: an IN list of a whole college is fine, but keep each query bounded.
  for (let i = 0; i < studentIds.length; i += 2000) {
    const chunk = studentIds.slice(i, i + 2000);
    if (!chunk.length) continue;
    const rows = await db
      .select({
        id: parentContact.id,
        studentId: parentContact.studentId,
        phone: parentContact.phone,
        language: parentContact.language,
        whatsappOk: parentContact.whatsappOk,
        consentAt: parentContact.consentAt,
        optedOutAt: parentContact.optedOutAt,
      })
      .from(parentContact)
      .where(inArray(parentContact.studentId, chunk))
      .orderBy(parentContact.id);
    for (const r of rows) {
      const list = out.get(r.studentId) ?? [];
      list.push(r);
      out.set(r.studentId, list);
    }
  }
  return out;
}

export interface Draft {
  trigger: Trigger;
  studentId: number | null;
  data: MessageData;
  /** Builds the dedupe key for one recipient. */
  key: (contactId: number) => string;
}

export interface Prepared {
  dedupeKey: string;
  trigger: Trigger;
  studentId: number | null;
  parentContactId: number;
  phone: string;
  channel: "WHATSAPP" | "SMS";
  template: string;
  payload: { data: MessageData; text: string };
  scheduledFor: Date;
  createdBy: number | null;
}

/** Turn one event into one row per eligible parent number (consent, opt-out, channel, quiet hours applied). */
export function prepare(draft: Draft, contacts: readonly Contact[], now: Date, createdBy: number | null = null): Prepared[] {
  return chooseRecipients(contacts, draft.trigger).map(({ contact, channel }) => ({
    dedupeKey: draft.key(contact.id),
    trigger: draft.trigger,
    studentId: draft.studentId,
    parentContactId: contact.id,
    phone: contact.phone,
    channel,
    template: draft.data.kind,
    payload: { data: draft.data, text: channel === "WHATSAPP" ? renderWhatsApp(draft.data, contact.language) : renderSms(draft.data, contact.language) },
    scheduledFor: sendableAt(now, draft.trigger),
    createdBy,
  }));
}

/** Insert rows; a row whose dedupe key already exists is silently skipped. Returns how many were new. */
export async function enqueue(tx: Tx, rows: readonly Prepared[]): Promise<number> {
  // Never queue a message without text: fail the whole transaction instead (the cause is a bug, not data).
  const blank = rows.find((r) => typeof r.payload.text !== "string" || r.payload.text.trim() === "");
  if (blank) throw new Error(`Refusing to queue an empty "${blank.template}" message.`);
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await tx.insert(notification).values(chunk).onConflictDoNothing({ target: notification.dedupeKey }).returning({ id: notification.id });
    added += res.length;
  }
  return added;
}

/** Portal link for messages (parent portal arrives in phase 7). Null until PUBLIC_BASE_URL is set. */
export function portalLink(env: NodeJS.ProcessEnv = process.env): string | null {
  const base = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  return base && /^https?:\/\//.test(base) ? `${base}/parent` : null;
}

/** For one-off events inside an action's transaction (leave approved, broadcast). */
export async function enqueueForStudents(tx: Tx, drafts: readonly Draft[], opts: { now?: Date; createdBy?: number | null } = {}): Promise<number> {
  const ids = [...new Set(drafts.map((d) => d.studentId).filter((x): x is number => x !== null))];
  const contacts = await loadContacts(tx, ids);
  const now = opts.now ?? new Date();
  const rows = drafts.flatMap((d) => (d.studentId === null ? [] : prepare(d, contacts.get(d.studentId) ?? [], now, opts.createdBy ?? null)));
  return enqueue(tx, rows);
}

/** "CS Sem 3" for many students at once (current membership in the term). */
export async function studentRefs(db: Pick<Db, "execute">, studentIds: readonly number[], termId: number) {
  const out = new Map<number, { name: string; regNo: string; className: string }>();
  if (!studentIds.length) return out;
  const { rows } = await db.execute<{ id: number; name: string; reg_no: string; class_name: string | null }>(sql`
    SELECT s.id, s.name, s.reg_no, d.code || ' Sem ' || cg.semester AS class_name
    FROM student s
    LEFT JOIN class_membership m ON m.student_id = s.id AND m.term_id = ${termId}
    LEFT JOIN class_group cg ON cg.id = m.class_group_id
    LEFT JOIN department d ON d.id = cg.department_id
    WHERE s.id IN (${sql.join(studentIds.map((i) => sql`${i}`), sql`, `)})`);
  for (const r of rows) out.set(r.id, { name: r.name, regNo: r.reg_no, className: r.class_name ?? "" });
  return out;
}
