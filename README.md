# Project Tracker

A lightweight, attention-first project and task tracking app for managers who need a simple web tool instead of spreadsheets. It highlights overdue, due-soon, blocked, stale, and unassigned work so nothing slips through the cracks.

## What Phase 1 includes

- Email/password auth with roles: `ADMIN`, `MANAGER`, `DEVELOPER`
- Project management with member assignment
- Item tracking for tasks, bugs, risks, and enhancements
- Attention-first dashboard with overdue, due soon, blocked, and needs-attention buckets
- Project table view with inline quick edits
- Project board view with drag-and-drop status changes
- My Items view sorted by derived score
- CSV import/export with preview, mapping, and per-row validation
- Prisma/PostgreSQL backend with seed data and Docker Compose for local development

## Screenshots

_Add screenshots here after the first local run._

## Prerequisites

- Node.js 22+
- npm 10+
- Docker + Docker Compose

## Local setup

1. Clone the repository.
2. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
3. Start PostgreSQL:
   ```bash
   docker compose up -d
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Run migrations:
   ```bash
   npm run db:migrate
   ```
6. Seed demo data:
   ```bash
   npm run db:seed
   ```
7. Start both apps:
   ```bash
   npm run dev
   ```

## Local URLs

- Web: http://localhost:5173
- API: http://localhost:4000/api
- Health check: http://localhost:4000/api/health

## Seeded credentials

All seeded users share the same password: `Password123!`

| Role | Email |
|---|---|
| Admin | `alice.admin@example.com` |
| Manager | `sara.manager@example.com` |
| Developer | `ava@example.com` |
| Developer | `noah@example.com` |
| Developer | `mia@example.com` |
| Developer | `liam@example.com` |

## Root scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Run API and web apps concurrently |
| `npm run build` | Build both workspaces |
| `npm run lint` | Lint both workspaces |
| `npm run typecheck` | Type-check both workspaces |
| `npm run test` | Run both workspace test suites |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed demo data |
| `npm run db:reset` | Reset the database and reseed |

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a user |
| POST | `/api/auth/login` | Login and set JWT cookie |
| POST | `/api/auth/logout` | Clear auth cookie |
| GET | `/api/auth/me` | Current session user |
| GET | `/api/projects` | List projects and active users |
| POST | `/api/projects` | Create a project (`MANAGER` / `ADMIN`) |
| GET | `/api/projects/:id` | Get project detail |
| PATCH | `/api/projects/:id` | Update project metadata (`MANAGER` / `ADMIN`) |
| PATCH | `/api/projects/:id/members` | Replace project members (`MANAGER` / `ADMIN`) |
| DELETE | `/api/projects/:id` | Delete a project (`MANAGER` / `ADMIN`) |
| GET | `/api/items` | List/filter items |
| POST | `/api/items` | Create an item (developers must be project members, report as themselves, and only self-assign or leave unassigned) |
| PATCH | `/api/items/:id` | Update an item (developers only for items assigned to them or reported by them) |
| DELETE | `/api/items/:id` | Delete an item (developers only for items assigned to them or reported by them) |
| POST | `/api/items/import` | Import CSV items |
| GET | `/api/items/export` | Export filtered items to CSV |
| GET | `/api/dashboard` | Dashboard buckets and summary counts |

### Item list filters

`GET /api/items` supports:

- `projectId`
- `assigneeId`
- `status` (comma-separated or repeated)
- `type`
- `priority`
- `risk`
- `search`
- `dueBefore`
- `sort`
- `page`
- `pageSize`

## Project structure

```text
apps/
  api/        Express + Prisma backend
  web/        React + Vite frontend
.github/
  workflows/  CI workflow
sample-items.csv
README.md
docker-compose.yml
.env.example
```

## Ranking score

The default backlog ordering is score descending. The score is derived, not stored:

```text
priorityWeight: P0=10, P1=6, P2=3, P3=1
riskWeight:     HIGH=5, MEDIUM=3, LOW=1
score = priorityWeight*3 + riskWeight*2 + max(0, overdueDays) + (ageDays/7) + (status===BLOCKED ? 8 : 0)
```

Done items always score `0`.

## CSV import

- Use the included `sample-items.csv` file for a quick import trial.
- Upload a CSV on the Import / Export screen.
- Preview the parsed rows.
- Adjust column mapping if needed.
- Commit the import and review any per-row validation errors.

## Phase 2 / Phase 3 roadmap

Not implemented in this phase:

- Comments
- Activity log
- In-app notifications / notification bell
- Daily digest email
- Charts and reporting visuals
- File attachments
- Saved filters
