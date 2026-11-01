/**
 * Database backups (docs/PLAN.md §11.9).
 *
 *   npm run db:backup          dump the database to BACKUP_DIR (default ./backups), keep the newest
 *                              BACKUP_KEEP (default 30), and copy to BACKUP_COPY_DIR if set
 *                              (a OneDrive / Google Drive folder or USB disk: the off-machine copy).
 *   npm run db:restore-check   restore the newest backup into a scratch database, compare it with the
 *                              live one, then drop it. Proves the backup can actually be restored.
 *
 * Uses pg_dump / pg_restore / psql from PATH (a normal PostgreSQL install), or, when they are not
 * installed, the ones inside the Docker container from docker-compose.yml.
 * Schedule db:backup nightly (Windows Task Scheduler / cron) and db:restore-check weekly.
 */
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = new URL(url);
const dbName = decodeURIComponent(db.pathname.slice(1));
const dbUser = decodeURIComponent(db.username);
const dir = path.resolve(process.env.BACKUP_DIR || "backups");
const keep = Math.max(1, Number(process.env.BACKUP_KEEP) || 30);
const SCRATCH = "mei_restore_check";
const PREFIX = "mei-";

const hasLocalTools = spawnSync("pg_dump", ["--version"], { stdio: "ignore", shell: false }).status === 0;
if (!hasLocalTools && spawnSync("docker", ["compose", "ps", "-q", "db"], { encoding: "utf8" }).stdout?.trim() === "") {
  throw new Error("Neither PostgreSQL tools (pg_dump) on PATH nor the Docker database container are available.");
}

/** Command line for a PostgreSQL tool, local or inside the container. Local tools get the password via PGPASSWORD. */
function tool(name: "pg_dump" | "pg_restore" | "psql" | "createdb" | "dropdb", args: string[], database = dbName): [string, string[], NodeJS.ProcessEnv] {
  if (hasLocalTools) {
    const conn = ["-h", db.hostname, "-p", db.port || "5432", "-U", dbUser];
    const dbArg = name === "createdb" || name === "dropdb" ? [database] : ["-d", database];
    return [name, [...conn, ...args, ...dbArg], { ...process.env, PGPASSWORD: decodeURIComponent(db.password) }];
  }
  const dbArg = name === "createdb" || name === "dropdb" ? [database] : ["-d", database];
  return ["docker", ["compose", "exec", "-T", "db", name, "-U", dbUser, ...args, ...dbArg], process.env];
}

function run(name: Parameters<typeof tool>[0], args: string[], opts: { database?: string; stdinFile?: string; stdoutFile?: string } = {}): Promise<string> {
  const [cmd, argv, env] = tool(name, args, opts.database);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    if (opts.stdoutFile) child.stdout.pipe(createWriteStream(opts.stdoutFile));
    else child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    if (opts.stdinFile) createReadStream(opts.stdinFile).pipe(child.stdin);
    else child.stdin.end();
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${name} failed (exit ${code}): ${err.trim().slice(0, 1000)}`))));
  });
}

const stamp = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
const backups = () =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.startsWith(PREFIX) && f.endsWith(".dump"))
        .sort()
    : [];

async function backup() {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${PREFIX}${stamp()}.dump`);
  const tmp = `${file}.partial`;
  // Custom format: compressed, and pg_restore can restore one table if ever needed.
  await run("pg_dump", ["-Fc", "--no-owner"], { stdoutFile: tmp });
  await new Promise((r) => setTimeout(r, 200)); // let the file stream flush on Windows
  const head = readFileSync(tmp).subarray(0, 5).toString("latin1");
  const size = statSync(tmp).size;
  if (head !== "PGDMP" || size < 1024) {
    unlinkSync(tmp);
    throw new Error(`Backup looks wrong (${size} bytes, header "${head}"). Nothing was kept.`);
  }
  renameSync(tmp, file); // only complete files ever carry the .dump name
  console.log(`Backup: ${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);

  const copyDir = process.env.BACKUP_COPY_DIR;
  if (copyDir) {
    mkdirSync(copyDir, { recursive: true });
    copyFileSync(file, path.join(copyDir, path.basename(file)));
    console.log(`Copied to ${copyDir}`);
  } else {
    console.warn("BACKUP_COPY_DIR is not set: this backup exists only on this machine. Set it to a synced or external folder.");
  }

  const all = backups();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    unlinkSync(path.join(dir, old));
    console.log(`Removed old backup ${old}`);
  }
}

const COUNT_SQL = `SELECT string_agg(t || '=' || n, ',' ORDER BY t) FROM (
  SELECT 'student' t, count(*) n FROM student UNION ALL SELECT 'parent_contact', count(*) FROM parent_contact
  UNION ALL SELECT 'class_session', count(*) FROM class_session UNION ALL SELECT 'attendance_record', count(*) FROM attendance_record
  UNION ALL SELECT 'mark', count(*) FROM mark UNION ALL SELECT 'audit_log', count(*) FROM audit_log
  UNION ALL SELECT 'migrations', count(*) FROM drizzle.__drizzle_migrations) x`;

async function counts(database: string): Promise<Record<string, number>> {
  const raw = (await run("psql", ["-At", "-c", COUNT_SQL], { database })).trim();
  return Object.fromEntries(raw.split(",").map((kv) => [kv.split("=")[0], Number(kv.split("=")[1])]));
}

async function restoreCheck() {
  const latest = backups().at(-1);
  if (!latest) throw new Error(`No backups in ${dir}. Run npm run db:backup first.`);
  const file = path.join(dir, latest);
  console.log(`Restoring ${latest} into scratch database "${SCRATCH}"…`);
  await run("dropdb", ["--if-exists"], { database: SCRATCH });
  await run("createdb", [], { database: SCRATCH });
  try {
    await run("pg_restore", ["--no-owner", "--exit-on-error"], { database: SCRATCH, stdinFile: file });
    const [restored, live] = await Promise.all([counts(SCRATCH), counts(dbName)]);
    console.table(Object.keys(live).map((t) => ({ table: t, backup: restored[t], live: live[t] })));
    const problems = Object.keys(live).filter((t) => live[t] > 0 && !(restored[t] > 0));
    if (restored.migrations !== live.migrations) problems.push(`migrations (backup ${restored.migrations}, live ${live.migrations}: backup is from an older version)`);
    if (problems.length) throw new Error(`Restore check FAILED: empty or different in the backup: ${problems.join(", ")}`);
    console.log(`Restore check passed: ${latest} restores completely. (Live counts can be higher: they include changes since the backup.)`);
  } finally {
    await run("dropdb", ["--if-exists"], { database: SCRATCH });
  }
}

const cmd = process.argv[2];
(cmd === "backup" ? backup() : cmd === "restore-check" ? restoreCheck() : Promise.reject(new Error("Use: backup | restore-check"))).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
