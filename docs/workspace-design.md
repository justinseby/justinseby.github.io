# Private workspace — design

The private dashboard at `/dashboard/` is a single-owner workspace backed by Supabase.
This document is the reference for how data is shaped, secured, backed up and built.

## Principles

- **Projects are the hub**, but every record also lives in its own global view.
- **Store once, link many.** A paper, meeting or deadline exists once; projects link to it.
- **Private by default.** Every table and file is locked to one owner account.
- **Reliable over clever.** Plain tables, plain SQL, logic that matters (recurrence,
  action-item → task) runs in the database so it is atomic and testable.

## Data model

```
                    ┌──────────── project_papers ───────────┐
                    │                                       ▼
  contacts ◄── loans ◄── loan_payments                    papers ◄── notes (paper_id)
     ▲                                                      ▲
     │ meeting_participants                                 │
  meetings ── meeting_projects ──► projects ◄── notes (project_id)
     │                               ▲  ▲
     └─ meeting_action_items ──► tasks ┘  └── deadlines ◄── tasks (deadline_id)
                                   (series_id / previous_id for recurrence)

  budget_categories ◄── transactions        habits ◄── habit_checkins
          ▲
          └── monthly_budgets               attachments → any one of: project, paper,
                                            note, meeting, deadline (files in Storage)
  settings (currency, timezone)             tags: text[] on each record, shared vocabulary
```

| Module | Tables | Notes |
| --- | --- | --- |
| Foundation | `settings`, `private.app_owner` | Owner lock, defaults (currency, timezone) |
| Loans | `contacts`, `loans`, `loan_payments` | Unchanged from phase 1. `contacts` doubles as meeting participants |
| Projects | `projects` | Status, area, dates, tags, links |
| Tasks | `tasks` | Optional project, meeting (source), deadline (preparation). Recurrence rule |
| Papers | `papers`, `project_papers` | Unique DOI / arXiv / PMID per owner prevents duplicates; structured notes |
| Notes | `notes` | Markdown; optional project and/or paper; typed |
| Meetings | `meetings`, `meeting_projects`, `meeting_participants`, `meeting_action_items` | Free date/time; action items convert to linked tasks |
| Deadlines | `deadlines` | Category, status, optional project; tasks link via `deadline_id` |
| Budget | `budget_categories`, `transactions`, `monthly_budgets` | Income / expense / transfer; per-month category budgets |
| Habits | `habits`, `habit_checkins` | Daily or chosen weekdays; archiving keeps check-ins |
| Files | `attachments` + Storage bucket `workspace-files` | Metadata row per file, linked to one record |
| Search | `search_workspace(q)` function | Full-text over projects, tasks, papers, notes, meetings, deadlines |

### Statuses and categories

| Field | Values |
| --- | --- |
| Project status | idea, planned, active, paused, completed, archived |
| Project area | research, personal, teaching, administration, career, other |
| Task status | todo, in_progress, done, cancelled |
| Priority (tasks, papers, deadlines) | low, medium, high, urgent (papers: low/medium/high) |
| Paper status | to_read, reading, read, to_cite, archived |
| Note type | research_idea, literature, daily_log, lab_notebook, meeting_prep, general, personal |
| Meeting type | supervisor, lab, research_discussion, collaboration, administration, other |
| Deadline category | conference, abstract_submission, paper_submission, course, credits, isp, half_time_review, dissertation, administration, personal, other |
| Deadline status | upcoming, in_progress, done, missed, cancelled |
| Transaction kind | income, expense, transfer |
| Habit frequency | daily, weekdays (with chosen ISO weekdays 1 = Mon … 7 = Sun) |

Values are `text` with `check` constraints (easy to extend later), not Postgres enums.

### Task views (derived, no extra columns)

| View | Rule |
| --- | --- |
| Inbox | open, no project, no due date |
| Today | open, due today |
| Upcoming | open, due after today |
| Overdue | open, due before today |
| Completed | status done |
| By project | open, grouped by `project_id` |

### Recurring tasks

`tasks.recurrence` is a small JSON rule, e.g.
`{"freq":"weekly","interval":1,"weekdays":[2]}` (every Tuesday) or
`{"freq":"monthly","interval":1,"until":"2027-06-30"}`.
When a recurring task is marked **done**, a database trigger inserts the next occurrence
(same `series_id`, `previous_id` → the completed task). The completed task stays as history.
Re-completing the same task never creates a second copy.

### Meeting action items → tasks

`convert_action_item(item_id, due_date, project_id)` creates a task with `meeting_id` set,
links the action item to it (`task_id`), and returns the task id. Converting twice returns
the existing task. Defaults the task's project to the meeting's project when it has exactly one.

## Security

1. **Login required.** Email + password via Supabase Auth; public sign-ups disabled.
2. **Owner lock.** `private.app_owner` holds exactly one user id. Every policy requires
   `user_id = auth.uid()` **and** `private.is_owner()`. Even if sign-ups were re-enabled by
   mistake, a new account would see nothing and could write nothing.
3. **Row Level Security on every table**, applied by one helper (`private.secure_table`) so no
   table can be missed. The `anon` role has no table privileges at all.
4. **Files.** Bucket `workspace-files` is private. Objects must live under
   `<owner-uid>/…` and are only readable/writable by the owner. Downloads use short-lived
   signed URLs.
5. **No secrets in the frontend.** The browser only gets the project URL and anon key, which
   are public by design. Service-role keys and API keys (AI, etc.) live only in Supabase
   secrets for Edge Functions.
6. **Tested.** `supabase/tests/` runs every migration in a real Postgres engine and checks that
   anonymous users and non-owner accounts are refused, on tables and on storage.

## Export and backup

| Need | How |
| --- | --- |
| Meeting / project PDF | Print-optimised page per meeting, project or date range → browser "Save as PDF". Multi-page, selectable text, no server |
| Notes | Download as `.md` (single or zip) |
| Full backup | "Download backup" builds one JSON file containing every table (ids and links preserved) plus a manifest of attachments; optional zip including the files themselves |
| Restore | Documented script that loads the JSON back in dependency order into a fresh project |
| Belt and braces | Supabase's own daily backups (paid plans) or a scheduled `pg_dump`, documented in setup |

A PDF is a readable copy, never the backup.

## Build order

All steps below are built.


| Step | Scope |
| --- | --- |
| 1–3 | Inspect, data model, auth + RLS + storage (this document, `supabase/migrations/`) |
| 4 | Projects, tasks (with recurrence), papers library (DOI / arXiv / PubMed lookup, PDF upload) |
| 5 | Notes (markdown, autosave), meetings (action items → tasks, PDF export) |
| 6 | Deadlines and milestones (calendar view, preparation tasks) |
| 7 | Loans integrated into the new navigation; budget; habits |
| 8 | Dashboard overview + quick actions, global search, exports, backup/restore, final testing |
