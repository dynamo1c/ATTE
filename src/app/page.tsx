import { connection } from "next/server";
import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/** Phase-0 status page: proves the app reaches the database. Replaced by role dashboards in phase 2. */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">MEI Polytechnic — Attendance &amp; Marks</h1>
      <p className="mt-1 text-sm text-zinc-500">Prototype · dummy data</p>
      <Suspense fallback={<p className="mt-8 text-sm text-zinc-500">Checking database…</p>}>
        <SystemStatus />
      </Suspense>
    </main>
  );
}

type Counts = {
  students: number;
  classes: number;
  staff: number;
  sessions_held: number;
  sessions_pending: number;
  attendance_records: number;
  parents: number;
};

async function loadCounts(): Promise<Counts | null> {
  try {
    const { rows } = await getDb().execute<Counts>(sql`
      SELECT
        (SELECT count(*) FROM student WHERE status = 'ACTIVE')::int                          AS students,
        (SELECT count(*) FROM class_group)::int                                              AS classes,
        (SELECT count(*) FROM staff WHERE active)::int                                       AS staff,
        (SELECT count(*) FROM class_session WHERE status = 'HELD')::int                      AS sessions_held,
        (SELECT count(*) FROM class_session WHERE status = 'SCHEDULED' AND date <= CURRENT_DATE)::int AS sessions_pending,
        (SELECT count(*) FROM attendance_record)::int                                        AS attendance_records,
        (SELECT count(*) FROM parent_contact)::int                                           AS parents
    `);
    return rows[0];
  } catch (err) {
    console.error("Status check failed", err);
    return null;
  }
}

async function SystemStatus() {
  await connection();
  const s = await loadCounts();
  if (!s) return <p className="mt-8 text-sm text-red-700">● Database unreachable. Is it running? (npm run db:up)</p>;
  const items: [string, number][] = [
    ["Active students", s.students],
    ["Classes", s.classes],
    ["Staff", s.staff],
    ["Parent contacts", s.parents],
    ["Classes held", s.sessions_held],
    ["Attendance pending", s.sessions_pending],
    ["Attendance marks", s.attendance_records],
  ];
  return (
    <>
      <p className="mt-8 text-sm text-green-700">● Database connected</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 p-4">
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString("en-IN")}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
