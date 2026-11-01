import type { NextRequest } from "next/server";
import { buildXlsx } from "@/lib/xlsx";
import { audit } from "@/server/audit";
import { getCurrentStaff } from "@/server/current";
import { getDb } from "@/db/client";
import { EXPORTS, isExportKind } from "@/server/exports";

/** Excel downloads: /exports/<kind>?<same filters as the screen>. */
export async function GET(req: NextRequest, ctx: RouteContext<"/exports/[kind]">) {
  const me = await getCurrentStaff();
  if (!me || me.mustChangePassword) return new Response("Sign in first.", { status: 401 });
  const { kind } = await ctx.params;
  if (!isExportKind(kind)) return new Response("Unknown report.", { status: 404 });

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = await EXPORTS[kind](me, params);
  if (!result.ok) return new Response(result.error, { status: result.status });

  const body = buildXlsx(result.sheets);
  // Student data leaving the system: record who downloaded what.
  await audit(getDb(), { actorStaffId: me.id, action: "EXPORT", entity: "report", entityId: kind, after: { params, rows: result.sheets.reduce((n, s) => n + s.rows.length, 0) } });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.file}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
