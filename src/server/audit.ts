import "server-only";
import { auditLog } from "@/db/schema";
import type { Db } from "@/db/client";

type Executor = Pick<Db, "insert">;

/** Record who changed what. Call inside the same transaction as the change. */
export async function audit(
  db: Executor,
  entry: { actorStaffId: number | null; action: string; entity: string; entityId: string | number; before?: unknown; after?: unknown; reason?: string | null },
) {
  await db.insert(auditLog).values({
    actorStaffId: entry.actorStaffId,
    action: entry.action,
    entity: entry.entity,
    entityId: String(entry.entityId),
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
  });
}
