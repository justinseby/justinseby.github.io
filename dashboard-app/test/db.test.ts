// Runs every migration in supabase/migrations against a real Postgres engine (PGlite) with a
// minimal stand-in for Supabase's auth and storage schemas, then checks security and logic.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = join(import.meta.dirname, "../../supabase/migrations");
const OWNER = "11111111-1111-1111-1111-111111111111";
const STRANGER = "22222222-2222-2222-2222-222222222222";

// What Supabase provides that the migrations rely on.
const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;

  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

  insert into auth.users values ('${OWNER}', 'owner@example.test'), ('${STRANGER}', 'other@example.test');
`;

let db: PGlite;

/** Run SQL as a given user (null = anonymous visitor). Returns rows, or the error message. */
async function as(user: string | null, sql: string, params: unknown[] = []): Promise<any[] | string> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user ?? ""}', false)`);
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  try {
    return (await db.query(sql, params)).rows as any[];
  } catch (e) {
    return (e as Error).message;
  } finally {
    await db.exec("reset role");
  }
}
const rows = async (user: string | null, sql: string, params: unknown[] = []) => {
  const r = await as(user, sql, params);
  if (typeof r === "string") throw new Error(r);
  return r;
};

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8")); // re-runnable
});

describe("owner lock", () => {
  test("before an owner is set, nobody can use the workspace", async () => {
    assert.match(String(await as(OWNER, "insert into projects (title) values ('x')")), /row-level security/);
    assert.deepEqual(await rows(OWNER, "select * from projects"), []);
  });

  test("owner can be set once", async () => {
    await db.exec(`insert into private.app_owner (user_id) values ('${OWNER}')`);
    assert.match(String(await db.exec(`insert into private.app_owner (user_id) values ('${STRANGER}')`).catch((e) => e.message)), /duplicate key/);
  });

  test("every public table has row level security and the owner policy", async () => {
    const tables = await db.query<{ relname: string; rls: boolean; policy: boolean }>(`
      select c.relname, c.relrowsecurity as rls,
             exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'owner_all') as policy
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`);
    assert.ok(tables.rows.length >= 20, `expected all tables, got ${tables.rows.length}`);
    for (const t of tables.rows) assert.ok(t.rls && t.policy, `${t.relname} is not locked down`);
  });

  test("anonymous visitors have no table access and cannot call functions", async () => {
    for (const t of ["projects", "tasks", "papers", "notes", "meetings", "deadlines", "transactions", "habits", "loans", "attachments"]) {
      assert.match(String(await as(null, `select * from ${t}`)), /permission denied/, t);
    }
    assert.match(String(await as(null, "select * from search_workspace('x')")), /permission denied/);
    assert.match(String(await as(null, "select private.is_owner()")), /permission denied/);
  });

  test("a second account sees nothing and cannot write, even rows it claims to own", async () => {
    await rows(OWNER, "insert into projects (title) values ('Owner project')");
    assert.deepEqual(await rows(STRANGER, "select * from projects"), []);
    assert.match(String(await as(STRANGER, "insert into projects (title) values ('mine')")), /row-level security/);
    assert.match(String(await as(STRANGER, `insert into projects (user_id, title) values ('${OWNER}', 'spoof')`)), /row-level security/);
    assert.deepEqual(await rows(STRANGER, "update projects set title = 'hacked' returning id"), []);
    assert.deepEqual(await rows(STRANGER, "delete from projects returning id"), []);
    assert.deepEqual(await rows(STRANGER, "select * from search_workspace('Owner')"), []);
    assert.equal((await rows(OWNER, "select title from projects"))[0].title, "Owner project");
  });

  test("the owner table itself is not readable from the app", async () => {
    assert.match(String(await as(OWNER, "select * from private.app_owner")), /permission denied/);
  });

  test("am_i_owner tells the app who is the owner", async () => {
    assert.equal((await rows(OWNER, "select am_i_owner() as v"))[0].v, true);
    assert.equal((await rows(STRANGER, "select am_i_owner() as v"))[0].v, false);
    assert.match(String(await as(null, "select am_i_owner()")), /permission denied/);
  });
});

describe("storage", () => {
  const put = (user: string | null, path: string) =>
    as(user, "insert into storage.objects (bucket_id, name) values ('workspace-files', $1) returning name", [path]);

  test("bucket is private", async () => {
    assert.equal((await db.query<{ public: boolean }>("select public from storage.buckets where id = 'workspace-files'")).rows[0].public, false);
  });
  test("owner can store and read files in their own folder only", async () => {
    assert.ok(Array.isArray(await put(OWNER, `${OWNER}/a/paper.pdf`)));
    assert.match(String(await put(OWNER, `${STRANGER}/a/paper.pdf`)), /row-level security/);
    assert.match(String(await put(OWNER, "paper.pdf")), /row-level security/);
    assert.equal((await rows(OWNER, "select name from storage.objects")).length, 1);
  });
  test("other accounts and anonymous visitors cannot read or upload", async () => {
    assert.deepEqual(await rows(STRANGER, "select name from storage.objects"), []);
    assert.match(String(await put(STRANGER, `${STRANGER}/x.pdf`)), /row-level security/);
    assert.deepEqual(await rows(null, "select name from storage.objects"), []);
    assert.match(String(await put(null, `${OWNER}/x.pdf`)), /row-level security/);
  });
});

describe("recurring tasks", () => {
  const next = async (d: string, rule: object) =>
    (await rows(OWNER, "select next_occurrence($1::date, $2::jsonb)::text as n", [d, JSON.stringify(rule)]))[0].n;

  test("next_occurrence handles daily, weekly, weekdays, monthly and until", async () => {
    assert.equal(await next("2026-10-26", { freq: "daily", interval: 3 }), "2026-10-29");
    assert.equal(await next("2026-10-27", { freq: "weekly" }), "2026-11-03");
    assert.equal(await next("2026-10-27", { freq: "weekly", weekdays: [2, 4] }), "2026-10-29"); // Tue → Thu
    assert.equal(await next("2026-10-29", { freq: "weekly", weekdays: [2, 4] }), "2026-11-03"); // Thu → Tue
    assert.equal(await next("2026-10-27", { freq: "weekly", interval: 2, weekdays: [2] }), "2026-11-10");
    assert.equal(await next("2027-01-31", { freq: "monthly" }), "2027-02-28");
    assert.equal(await next("2026-10-27", { freq: "weekly", until: "2026-10-30" }), null);
  });

  test("completing a recurring task creates the next one once and keeps history", async () => {
    const [t] = await rows(OWNER, `insert into tasks (title, due_date, recurrence)
      values ('Prepare lab meeting', '2026-10-27', '{"freq":"weekly","weekdays":[2]}') returning id, series_id`);
    assert.equal(t.series_id, t.id);
    await rows(OWNER, "update tasks set status = 'done' where id = $1", [t.id]);
    await rows(OWNER, "update tasks set status = 'todo' where id = $1", [t.id]);
    await rows(OWNER, "update tasks set status = 'done' where id = $1", [t.id]);
    const series = await rows(OWNER, "select status, due_date::text, previous_id, completed_at from tasks where series_id = $1 order by due_date", [t.id]);
    assert.equal(series.length, 2);
    assert.equal(series[0].status, "done");
    assert.ok(series[0].completed_at);
    assert.deepEqual([series[1].status, series[1].due_date, series[1].previous_id], ["todo", "2026-11-03", t.id]);
  });

  test("non-recurring tasks just complete", async () => {
    const [t] = await rows(OWNER, "insert into tasks (title) values ('One-off') returning id");
    await rows(OWNER, "update tasks set status = 'done' where id = $1", [t.id]);
    assert.equal((await rows(OWNER, "select count(*)::int n from tasks where previous_id = $1", [t.id]))[0].n, 0);
  });
});

describe("papers, meetings and links", () => {
  test("a paper is stored once and linked to several projects", async () => {
    const [a] = await rows(OWNER, "insert into projects (title) values ('AML networks') returning id");
    const [b] = await rows(OWNER, "insert into projects (title) values ('LLM annotation') returning id");
    const [p] = await rows(OWNER, `insert into papers (title, doi, abstract, authors)
      values ('Protein networks in leukemia', '10.1000/xyz', 'Proteomics of acute myeloid leukemia', '{Smith,Lee}') returning id`);
    await rows(OWNER, "insert into project_papers (project_id, paper_id) values ($1, $3), ($2, $3)", [a.id, b.id, p.id]);
    assert.equal((await rows(OWNER, "select count(*)::int n from project_papers where paper_id = $1", [p.id]))[0].n, 2);
    assert.match(String(await as(OWNER, "insert into papers (title, doi) values ('Dup', '10.1000/xyz')")), /duplicate key/);
    assert.match(String(await as(OWNER, "insert into papers (title, doi) values ('Upper', '10.1000/ABC')")), /check constraint/);
  });

  test("action items convert to tasks linked to the meeting, once", async () => {
    const [proj] = await rows(OWNER, "insert into projects (title) values ('Thesis') returning id");
    const [m] = await rows(OWNER, "insert into meetings (title, type, starts_at) values ('Supervisor 1:1', 'supervisor', '2026-10-28 10:00+01') returning id");
    await rows(OWNER, "insert into meeting_projects (meeting_id, project_id) values ($1, $2)", [m.id, proj.id]);
    const [item] = await rows(OWNER, "insert into meeting_action_items (meeting_id, text) values ($1, 'Rerun clustering') returning id", [m.id]);
    const [{ convert_action_item: taskId }] = await rows(OWNER, "select convert_action_item($1, '2026-11-01')", [item.id]);
    const [{ convert_action_item: again }] = await rows(OWNER, "select convert_action_item($1)", [item.id]);
    assert.equal(again, taskId);
    const [task] = await rows(OWNER, "select title, meeting_id, project_id, due_date::text from tasks where id = $1", [taskId]);
    assert.deepEqual(task, { title: "Rerun clustering", meeting_id: m.id, project_id: proj.id, due_date: "2026-11-01" });
    assert.match(String(await as(STRANGER, "select convert_action_item($1)", [item.id])), /not found/);
  });

  test("meetings take any date and time and end after they start", async () => {
    assert.match(String(await as(OWNER, "insert into meetings (title, starts_at, ends_at) values ('x', '2026-10-28 10:00', '2026-10-28 09:00')")), /check constraint/);
  });

  test("attachments belong to exactly one record and to the owner's folder", async () => {
    const [n] = await rows(OWNER, "insert into notes (title, body) values ('Idea', 'Use graph transformers') returning id");
    assert.ok(Array.isArray(await as(OWNER, "insert into attachments (storage_path, file_name, note_id) values ($1, 'a.pdf', $2)", [`${OWNER}/n/a.pdf`, n.id])));
    assert.match(String(await as(OWNER, "insert into attachments (storage_path, file_name) values ($1, 'b.pdf')", [`${OWNER}/n/b.pdf`])), /check constraint/);
    assert.match(String(await as(OWNER, "insert into attachments (storage_path, file_name, note_id) values ($1, 'c.pdf', $2)", [`${STRANGER}/c.pdf`, n.id])), /check constraint/);
  });
});

describe("search, budget and habits", () => {
  test("global search finds records by title, body and tags", async () => {
    await rows(OWNER, "insert into deadlines (title, due_date, category, tags) values ('ISMB abstract', '2027-01-15', 'abstract_submission', '{conference}')");
    const kinds = async (q: string) => (await rows(OWNER, "select kind, title from search_workspace($1)", [q])).map((r) => r.kind);
    assert.ok((await kinds("leukemia")).includes("paper"));
    assert.ok((await kinds("graph transformers")).includes("note"));
    assert.ok((await kinds("conference")).includes("deadline"));
    assert.ok((await kinds("clustering")).includes("task"));
    const tags = await rows(OWNER, "select tag from all_tags()");
    assert.ok(tags.some((t) => t.tag === "conference"));
  });

  test("monthly budget compares plan with actual spending, ignoring transfers", async () => {
    const [food] = await rows(OWNER, "insert into budget_categories (name) values ('Food') returning id");
    await rows(OWNER, "insert into monthly_budgets (category_id, month, amount) values ($1, '2026-10-01', 3000)", [food.id]);
    await rows(OWNER, `insert into transactions (kind, description, amount, category_id, occurred_on) values
      ('expense', 'ICA', 450.50, $1, '2026-10-03'), ('expense', 'Lunch', 120, $1, '2026-10-20'),
      ('expense', 'Next month', 99, $1, '2026-11-01')`, [food.id]);
    await rows(OWNER, "insert into transactions (kind, description, amount, occurred_on) values ('transfer', 'To savings', 5000, '2026-10-05')");
    const [r] = await rows(OWNER, "select category, budgeted::text, actual::text, remaining::text from budget_month('2026-10-01')");
    assert.deepEqual(r, { category: "Food", budgeted: "3000.00", actual: "570.50", remaining: "2429.50" });
    assert.match(String(await as(OWNER, "insert into transactions (kind, description, amount, category_id) values ('transfer', 'x', 1, $1)", [food.id])), /check constraint/);
  });

  test("habits need weekdays when not daily, and archiving keeps check-ins", async () => {
    assert.match(String(await as(OWNER, "insert into habits (name, frequency) values ('Gym', 'weekdays')")), /check constraint/);
    const [h] = await rows(OWNER, "insert into habits (name, frequency, weekdays) values ('Gym', 'weekdays', '{1,3,5}') returning id");
    await rows(OWNER, "insert into habit_checkins (habit_id, day) values ($1, '2026-10-26'), ($1, '2026-10-28')", [h.id]);
    assert.match(String(await as(OWNER, "insert into habit_checkins (habit_id, day) values ($1, '2026-10-26')", [h.id])), /duplicate key/);
    await rows(OWNER, "update habits set archived_at = now() where id = $1", [h.id]);
    assert.equal((await rows(OWNER, "select count(*)::int n from habit_checkins where habit_id = $1", [h.id]))[0].n, 2);
  });

  test("loans tables still work under the owner lock", async () => {
    const [c] = await rows(OWNER, "insert into contacts (name) values ('Anna') returning id");
    const [l] = await rows(OWNER, "insert into loans (contact_id, direction, amount) values ($1, 'lent', 500) returning id", [c.id]);
    await rows(OWNER, "insert into loan_payments (loan_id, amount) values ($1, 200)", [l.id]);
    assert.deepEqual(await rows(STRANGER, "select * from loans"), []);
    assert.match(String(await as(OWNER, "delete from contacts where id = $1", [c.id])), /foreign key/);
  });
});
