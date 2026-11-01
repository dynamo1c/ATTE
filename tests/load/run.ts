/**
 * Load test against a running server with the full dummy college (docs/PLAN.md §13 phase 9).
 *
 *   npm run build && npx next start -p 3100      (in another terminal)
 *   npm run load-test -- http://localhost:3100 40 60
 *                         base URL            users seconds
 *
 * Each virtual user is a real staff member or parent (temporary sessions, deleted afterwards) clicking
 * through the pages they would use, with no pause between clicks: far heavier than a real college.
 * Reports p50 / p95 / max per page type and fails if any request errors or p95 exceeds 1.5 s.
 * Excel downloads it makes are audited like any other (the audit log is append-only).
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";

const [base = "http://localhost:3100", usersArg = "40", secondsArg = "60"] = process.argv.slice(2);
const USERS = Number(usersArg);
const SECONDS = Number(secondsArg);
const P95_LIMIT_MS = 1500;
const MARK = "load-test";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type User = { cookie: string; urls: [group: string, path: string][] };

async function makeUsers(): Promise<User[]> {
  const q = async <T>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
  const classes = await q<{ id: number; dept: number }>(`SELECT cg.id, cg.department_id AS dept FROM class_group cg JOIN term t ON t.id = cg.term_id ORDER BY t.starts_on DESC, cg.id`);
  const staff = await q<{ id: number; role: string; dept: number | null; class_id: number | null }>(`
    SELECT s.id, g.role::text AS role, coalesce(g.department_id, s.department_id) AS dept, g.class_group_id AS class_id
    FROM staff s JOIN role_grant g ON g.staff_id = s.id WHERE s.active ORDER BY s.id`);
  const students = await q<{ id: number; class_id: number }>(`SELECT m.student_id AS id, m.class_group_id AS class_id FROM class_membership m WHERE m.left_on IS NULL ORDER BY m.student_id`);
  const sessions = await q<{ id: number; class_id: number }>(`
    SELECT cs.id, o.class_group_id AS class_id FROM class_session cs JOIN course_offering o ON o.id = cs.offering_id
    WHERE cs.date = (SELECT max(date) FROM class_session WHERE status = 'HELD') ORDER BY cs.id`);
  const offerings = await q<{ id: number; class_id: number }>(`SELECT id, class_group_id AS class_id FROM course_offering ORDER BY id`);
  const parents = await q<{ phone: string; student_id: number }>(`SELECT DISTINCT ON (phone) phone, student_id FROM parent_contact ORDER BY phone, id LIMIT 400`);
  const pick = <T>(xs: T[], i: number) => xs[i % xs.length];

  const users: User[] = [];
  for (let i = 0; i < USERS; i++) {
    const token = randomBytes(32).toString("base64url");
    // Mix like a real day: mostly teachers, some HODs / class teachers, a few parents, one admin.
    const kind = i % 10 === 0 ? "parent" : i % 10 === 1 ? "HOD" : i % 10 === 2 ? "CLASS_TEACHER" : i === 3 ? "ADMIN" : "FACULTY";
    if (kind === "parent") {
      const p = pick(parents, i);
      await pool.query(`INSERT INTO parent_session (token_hash, phone, expires_at, user_agent) VALUES ($1, $2, now() + interval '1 hour', $3)`, [sha(token), p.phone, MARK]);
      users.push({ cookie: `mei_parent=${token}`, urls: [["parent: home", "/parent"], ["parent: child", `/parent/${p.student_id}`]] });
      continue;
    }
    const candidates = staff.filter((s) => s.role === kind);
    const s = pick(candidates.length ? candidates : staff, i);
    await pool.query(`INSERT INTO staff_session (token_hash, staff_id, expires_at, user_agent) VALUES ($1, $2, now() + interval '1 hour', $3)`, [sha(token), s.id, MARK]);
    const cls = s.class_id ?? pick(classes.filter((c) => c.dept === s.dept).length ? classes.filter((c) => c.dept === s.dept) : classes, i).id;
    const stu = pick(students.filter((x) => x.class_id === cls), i);
    const ses = pick(sessions.filter((x) => x.class_id === cls).length ? sessions.filter((x) => x.class_id === cls) : sessions, i);
    const off = pick(offerings.filter((x) => x.class_id === cls), i);
    const urls: User["urls"] = [
      ["dashboard", "/"],
      ["attendance list", "/attendance"],
      ["take attendance", `/attendance/${ses.id}`],
      ["class page", `/classes/${cls}`],
      ["class attendance", `/classes/${cls}/attendance`],
      ["student", `/students/${stu?.id ?? 1}`],
      ["marks list", "/marks"],
      ["subject marks", `/marks/${off?.id ?? 1}`],
    ];
    if (kind !== "FACULTY") urls.push(["shortage report", "/reports/attendance"], ["class marks", `/classes/${cls}/marks`], ["excel: class attendance", `/exports/class-attendance?class=${cls}`]);
    if (kind === "ADMIN") urls.push(["messages", "/messages"], ["audit log", "/admin/audit"], ["excel: shortage (college)", "/exports/shortage"]);
    users.push({ cookie: `mei_session=${token}`, urls });
  }
  return users;
}

const timings = new Map<string, number[]>();
const errors: string[] = [];

async function runUser(u: User, until: number, offset: number) {
  for (let n = offset; Date.now() < until; n++) {
    const [group, path] = u.urls[n % u.urls.length];
    const t = performance.now();
    try {
      const res = await fetch(base + path, { headers: { cookie: u.cookie }, redirect: "manual" });
      await res.arrayBuffer();
      // /parent sends a one-child parent straight to the child's page.
      const expected = path === "/parent" ? [200, 307] : [200];
      if (!expected.includes(res.status)) errors.push(`${res.status} ${path}`);
    } catch (e) {
      errors.push(`${(e as Error).message} ${path}`);
    }
    const list = timings.get(group) ?? [];
    list.push(performance.now() - t);
    timings.set(group, list);
  }
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))];

async function main() {
  const health = await fetch(`${base}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`${base} is not running (start it with: npx next start -p 3100).`);
  const users = await makeUsers();
  console.log(`${USERS} users for ${SECONDS}s against ${base}…`);
  try {
    // Warm-up: first hit of each page compiles caches; not counted.
    await Promise.all(users.slice(0, 10).map((u) => Promise.all(u.urls.map(([, p]) => fetch(base + p, { headers: { cookie: u.cookie } }).then((r) => r.arrayBuffer())))));
    const until = Date.now() + SECONDS * 1000;
    await Promise.all(users.map((u, i) => runUser(u, until, i)));
  } finally {
    await pool.query(`DELETE FROM staff_session WHERE user_agent = $1`, [MARK]);
    await pool.query(`DELETE FROM parent_session WHERE user_agent = $1`, [MARK]);
  }
  const rows = [...timings.entries()].map(([group, xs]) => ({ page: group, requests: xs.length, p50: Math.round(pct(xs, 50)), p95: Math.round(pct(xs, 95)), max: Math.round(Math.max(...xs)) }));
  rows.sort((a, b) => b.p95 - a.p95);
  console.table(rows);
  const total = rows.reduce((n, r) => n + r.requests, 0);
  console.log(`${total} requests, ${(total / SECONDS).toFixed(1)} per second, ${errors.length} errors.`);
  if (errors.length) console.log([...new Set(errors)].slice(0, 20).join("\n"));
  const slow = rows.filter((r) => r.p95 > P95_LIMIT_MS);
  await pool.end();
  if (errors.length || slow.length) {
    console.error(`FAILED: ${errors.length} errors; slow (p95 > ${P95_LIMIT_MS} ms): ${slow.map((r) => r.page).join(", ") || "none"}`);
    process.exit(1);
  }
  console.log("PASSED");
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
