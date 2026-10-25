# justinseby.github.io

Personal academic website of Justin Seby, PhD student in AI for cancer medicine at Karolinska Institutet.

Live at https://justinseby.github.io

## Structure

| Path | What it is |
| --- | --- |
| `_config.yml` | Site name, profile links, navigation menu |
| `index.md` | About Me (home page) |
| `publications.md`, `education.md`, `work.md`, `blogs.md` | The other pages |
| `images/` | Profile photo (`profile.jpg`) and sidebar avatar (`avatar.jpg`) |
| `file/` | CV PDF |
| `_layouts/`, `_includes/`, `assets/` | Page template and styling |

## Run locally

```bash
gem install jekyll jekyll-feed jekyll-sitemap jekyll-seo-tag
jekyll serve
```

Then open http://localhost:4000

## Private dashboard

A private, single-owner workspace (projects, tasks, papers, notes, meetings, deadlines, budget,
habits, loans) lives in `dashboard-app/` and is published at https://justinseby.github.io/dashboard/.
Design, data model, security and backup approach: [docs/workspace-design.md](docs/workspace-design.md).

| Path | What it is |
| --- | --- |
| `dashboard-app/` | React + Vite app, one folder per module under `src/modules/` |
| `dashboard-app/test/` | Unit tests and database tests (every migration run in Postgres, security checked) |
| `supabase/migrations/` | Database tables, privacy rules and storage, run in order |
| `docs/` | Design and data model |
| `.github/workflows/deploy.yml` | Tests and builds the site and dashboard on every push to `main` |

### One-time setup

1. **Create a Supabase project** at https://supabase.com (region: Stockholm, `eu-north-1`). Save the database password somewhere safe.
2. **SQL Editor → New query:** paste and run each file in `supabase/migrations/` in order, `000` to `008`. Each says "Success. No rows returned".
3. **Authentication → Users → Add user → Create new user:** your email and a strong password, tick **Auto Confirm User**.
4. **Register yourself as the owner.** In SQL Editor, with your email:
   ```sql
   insert into private.app_owner (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
5. **Authentication → Sign In / Providers:** turn off **Allow new users to sign up**.
6. **Project Settings → API:** copy the **Project URL** and the **anon public** key.
   Never copy the `service_role` key anywhere in this repo.
7. **GitHub → repo Settings → Secrets and variables → Actions → Variables tab:** add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with those two values.
8. **GitHub → repo Settings → Pages → Source:** choose **GitHub Actions**.

### Run locally

```bash
cd dashboard-app
cp .env.example .env.local   # then fill in the two values
npm install
npm run dev
```

`npm test` runs the unit and database tests, `npm run check` runs the tests and the build (what CI runs).
