// Full workspace backup and restore. A backup is one JSON document with every table (ids and
// links preserved), optionally zipped together with the uploaded files.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { BUCKET, currentUserId, downloadFile, emitChange, sb } from "./db.ts";

export const BACKUP_FORMAT = "justin-workspace-backup";
export const BACKUP_VERSION = 1;

/** Every table, in an order where each row's references are restored before it. */
export const TABLES: [table: string, conflictKey: string][] = [
  ["settings", "user_id"],
  ["contacts", "id"],
  ["projects", "id"],
  ["papers", "id"],
  ["project_papers", "project_id,paper_id"],
  ["notes", "id"],
  ["meetings", "id"],
  ["meeting_projects", "meeting_id,project_id"],
  ["meeting_participants", "meeting_id,contact_id"],
  ["deadlines", "id"],
  ["tasks", "id"],
  ["meeting_action_items", "id"],
  ["loans", "id"],
  ["loan_payments", "id"],
  ["budget_categories", "id"],
  ["transactions", "id"],
  ["monthly_budgets", "id"],
  ["habits", "id"],
  ["habit_checkins", "habit_id,day"],
  ["attachments", "id"],
];

type Row = Record<string, unknown>;
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  counts: Record<string, number>;
  tables: Record<string, Row[]>;
}

async function fetchAll(table: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb().from(table).select("*").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as Row[]));
    if (data.length < 1000) return out;
  }
}

export async function buildBackup(onProgress?: (msg: string) => void): Promise<Backup> {
  const tables: Record<string, Row[]> = {};
  for (const [t] of TABLES) {
    onProgress?.(`Reading ${t}…`);
    tables[t] = await fetchAll(t);
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(tables).map(([t, r]) => [t, r.length])),
    tables,
  };
}

/** Zip with backup.json plus every uploaded file under files/<storage path>. */
export async function buildBackupZip(onProgress?: (msg: string) => void): Promise<{ zip: Uint8Array; missing: string[] }> {
  const backup = await buildBackup(onProgress);
  const files: Record<string, Uint8Array> = { "backup.json": strToU8(JSON.stringify(backup, null, 2)) };
  const missing: string[] = [];
  const atts = backup.tables.attachments as { storage_path: string }[];
  for (const [i, a] of atts.entries()) {
    onProgress?.(`Downloading file ${i + 1} of ${atts.length}…`);
    try {
      files[`files/${a.storage_path}`] = new Uint8Array(await (await downloadFile(a.storage_path)).arrayBuffer());
    } catch {
      missing.push(a.storage_path);
    }
  }
  onProgress?.("Compressing…");
  return { zip: zipSync(files, { level: 6 }), missing };
}

export function parseBackup(bytes: Uint8Array, filename: string): { backup: Backup; files: Record<string, Uint8Array> } {
  let json: string;
  let files: Record<string, Uint8Array> = {};
  if (filename.toLowerCase().endsWith(".zip")) {
    const entries = unzipSync(bytes);
    if (!entries["backup.json"]) throw new Error("This zip has no backup.json");
    json = strFromU8(entries["backup.json"]);
    files = Object.fromEntries(Object.entries(entries).filter(([k]) => k.startsWith("files/")).map(([k, v]) => [k.slice(6), v]));
  } else {
    json = strFromU8(bytes);
  }
  const backup = JSON.parse(json) as Backup;
  if (backup.format !== BACKUP_FORMAT) throw new Error("This file is not a workspace backup");
  if (backup.version > BACKUP_VERSION) throw new Error("This backup was made by a newer version of the dashboard");
  return { backup, files };
}

/**
 * Restore rows by upserting them in dependency order. Existing rows with the same ids are
 * overwritten; nothing is deleted. Rows are re-owned by the signed-in account, and file paths
 * are moved under its folder, so a backup can be restored into a fresh Supabase project.
 */
export async function restoreBackup(backup: Backup, files: Record<string, Uint8Array>, onProgress?: (msg: string) => void): Promise<{ restored: Record<string, number>; filesUploaded: number; filesMissing: number }> {
  const uid = await currentUserId();
  const restored: Record<string, number> = {};
  const movePath = (p: string) => `${uid}/${p.split("/").slice(1).join("/")}`;

  // Upload files first so attachment rows never point at nothing.
  let filesUploaded = 0;
  let filesMissing = 0;
  for (const a of (backup.tables.attachments ?? []) as { storage_path: string; mime_type: string | null }[]) {
    const data = files[a.storage_path];
    if (!data) {
      filesMissing++;
      continue;
    }
    onProgress?.(`Uploading file ${filesUploaded + 1}…`);
    const { error } = await sb().storage.from(BUCKET).upload(movePath(a.storage_path), data, { upsert: true, contentType: a.mime_type ?? undefined });
    if (error) throw new Error(`File ${a.storage_path}: ${error.message}`);
    filesUploaded++;
  }

  for (const [table, key] of TABLES) {
    let rows = (backup.tables[table] ?? []).map(({ user_id: _u, ...rest }) => rest as Row);
    if (table === "settings") rows = rows.slice(0, 1).map((r) => ({ ...r, user_id: uid }));
    if (table === "attachments") {
      // keep a file record only if its file was restored, or it already lives in this account
      rows = rows
        .filter((r) => !!files[r.storage_path as string] || (r.storage_path as string).startsWith(`${uid}/`))
        .map((r) => ({ ...r, storage_path: movePath(r.storage_path as string) }));
    }
    // tasks point at earlier occurrences; insert without that link first, then add it
    const previous = table === "tasks" ? rows.filter((r) => r.previous_id).map((r) => ({ id: r.id, previous_id: r.previous_id })) : [];
    if (table === "tasks") rows = rows.map((r) => ({ ...r, previous_id: null }));
    onProgress?.(`Restoring ${table} (${rows.length})…`);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb().from(table).upsert(rows.slice(i, i + 500), { onConflict: key });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
    for (const p of previous) {
      const { error } = await sb().from("tasks").update({ previous_id: p.previous_id }).eq("id", p.id as string);
      if (error) throw new Error(`tasks: ${error.message}`);
    }
    restored[table] = rows.length;
  }
  emitChange();
  return { restored, filesUploaded, filesMissing };
}
