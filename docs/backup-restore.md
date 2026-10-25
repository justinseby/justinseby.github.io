# Backup and restore

A PDF export is a readable copy of a meeting or project. **It is not a backup.** Use the steps
below for backups.

## What a backup contains

**Dashboard → Settings → Backup** offers three downloads:

| Download | Contains | Use it for |
| --- | --- | --- |
| **Full backup with files (.zip)** | `backup.json` (every record in every table) plus `files/…` (every uploaded PDF and attachment) | The real backup. Make one regularly (e.g. monthly) and keep it outside Supabase: your laptop, an external drive or cloud storage |
| **Data only (.json)** | Every record, with no files | Quick, small snapshots |
| **Notes as markdown** | One `.md` file per note, with front matter (type, tags, project, paper) | Reading or moving notes to another tool (Obsidian etc.) |

`backup.json` stores every table under `tables`. Each table is a list of rows exactly as they are
in the database, so ids and links are preserved: project ↔ paper, meeting ↔ project, task →
meeting / deadline / previous occurrence, loan → person, and so on. It covers settings, contacts,
projects, papers, project_papers, notes, meetings (with projects, participants and action items),
deadlines, tasks, loans, loan payments, budget categories, transactions, monthly budgets, habits,
habit check-ins and attachments.

## Restoring

**Dashboard → Settings → Restore → Choose backup file…**, then **Restore**.

- Records are **added or overwritten by id**. Nothing in the workspace is deleted.
- Tables are restored in dependency order (people and projects before the things that link to them).
- Every restored row is owned by the account you're signed in with, and file paths move into that
  account's folder. This means a backup can be restored into a brand-new Supabase project.
- With a `.zip`, files are uploaded before the records that point at them. With a `.json` backup,
  file records are only kept when the files are already in this account.

### Restoring into a new Supabase project (disaster recovery)

1. Create the project and follow **One-time setup** in the [README](../README.md): run the
   migrations, create your user, register it as owner, and turn off sign-ups.
2. Point the dashboard at the new project (the GitHub Variables, or `.env.local` when running locally).
3. Sign in, go to **Settings → Restore**, choose your latest `.zip` backup and restore it.

## Extra safety: database-level backups

- Supabase's paid plans include automatic daily backups (Project Settings → Database → Backups).
- On the free plan, you can also take a full SQL dump with the Supabase CLI:
  ```bash
  supabase db dump --db-url "postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres" -f backup.sql --data-only
  ```
  The connection string is under Project Settings → Database. Keep this file private: it contains all your data.
