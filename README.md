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
- Prisma/PostgreSQL backend with seed data and container deployment assets

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
3. Start a local PostgreSQL container for dev mode:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.db.yml up -d postgres
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
- Readiness check: http://localhost:4000/api/ready

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
| GET | `/api/health` | Process health check |
| GET | `/api/ready` | Database readiness check |
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
docker-compose.yml
docker-compose.db.yml
k8s/
README.md
```

## Architecture note

This repository is a **monorepo with two independently deployable services**, not a monolith:

- `apps/api` is the backend service that talks to PostgreSQL.
- `apps/web` is the frontend service that talks to the backend over HTTP.
- npm workspaces keep both services in one repository while still letting you build, run, and deploy them separately.

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

## Deployment

### Connecting to your own Postgres

This app does **not** require a bundled database. Set `DATABASE_URL` to your existing PostgreSQL instance and keep the required `?schema=public` suffix:

```env
DATABASE_URL="postgresql://db-user:db-password@db.example.com:5432/project_tracker?schema=public"
```

Important notes:

- The database itself must already exist, for example:
  ```sql
  CREATE DATABASE project_tracker;
  ```
- The application does **not** create tables on startup.
- `prisma migrate deploy` creates or updates the tables from `apps/api/prisma/migrations/`.
- If PostgreSQL runs on your host machine and the app runs in Docker containers, use `host.docker.internal` instead of `localhost` inside `DATABASE_URL`.
- On Linux, `docker-compose.yml` maps `host.docker.internal` to the host gateway for the API and migrate containers.

### Docker Compose

Copy the Docker-focused env template and set your connection details:

```bash
cp .env.docker.example .env
```

Build both images:

```bash
docker compose build
```

Run the app stack against your existing PostgreSQL database:

```bash
docker compose up -d
```

Run the app stack plus the optional local Postgres override:

```bash
docker compose -f docker-compose.yml -f docker-compose.db.yml up -d
```

Useful commands:

```bash
docker compose logs -f migrate
docker compose logs -f api web
docker compose up -d --build
docker compose down
```

The web container is served at <http://localhost:8080> and proxies browser API calls through `/api`, so container deployments avoid CORS entirely.

### Kubernetes

Kubernetes manifests live in [`k8s/`](k8s). The recommended deploy order is:

1. Build and push the API and web images.
2. Create the namespace.
3. Create the Secret with `DATABASE_URL` and `JWT_SECRET`.
4. Apply the ConfigMap.
5. Run the migration Job.
6. Apply the API and web Deployments.
7. Apply the Ingress.

Build, tag, and push examples:

```bash
export REGISTRY=ghcr.io/your-org
export IMAGE_TAG=latest

docker build -f apps/api/Dockerfile -t "$REGISTRY/project-tracker-api:$IMAGE_TAG" .
docker build --build-arg VITE_API_URL=/api -f apps/web/Dockerfile -t "$REGISTRY/project-tracker-web:$IMAGE_TAG" .
docker push "$REGISTRY/project-tracker-api:$IMAGE_TAG"
docker push "$REGISTRY/project-tracker-web:$IMAGE_TAG"
```

Deploy commands:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl create secret generic project-tracker-secrets \
  --namespace project-tracker \
  --from-literal=DATABASE_URL='postgresql://db-user:db-password@db.example.com:5432/project_tracker?schema=public' \
  --from-literal=JWT_SECRET='replace-with-a-long-random-secret'
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/migrate-job.yaml
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/web-deployment.yaml
kubectl apply -f k8s/ingress.yaml
```

Quick local cluster flow (kind or minikube):

```bash
kind create cluster --name project-tracker
# or: minikube start
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/postgres.yaml
kubectl rollout status statefulset/project-tracker-postgres -n project-tracker
kubectl create secret generic project-tracker-secrets \
  --namespace project-tracker \
  --from-literal=DATABASE_URL='postgresql://postgres:postgres@project-tracker-postgres:5432/project_tracker?schema=public' \
  --from-literal=JWT_SECRET='replace-with-a-long-random-secret'
# The Secret must exist before applying the base manifests.
kubectl apply -k k8s/
kubectl apply -f k8s/migrate-job.yaml
```

Verification commands:

```bash
kubectl get pods -n project-tracker
kubectl get svc -n project-tracker
kubectl logs -n project-tracker job/project-tracker-migrate
kubectl port-forward -n project-tracker svc/project-tracker-web 8080:8080
kubectl port-forward -n project-tracker svc/project-tracker-api 4000:4000
```

See [`k8s/README.md`](k8s/README.md) for more detail, including the optional demo Postgres manifest.

## Phase 2 / Phase 3 roadmap

Not implemented in this phase:

- Comments
- Activity log
- In-app notifications / notification bell
- Daily digest email
- Charts and reporting visuals
- File attachments
- Saved filters
