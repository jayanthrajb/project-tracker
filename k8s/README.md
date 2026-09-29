# Kubernetes deployment

These manifests deploy the Project Tracker monorepo as two services:

- `project-tracker-api` — the Express + Prisma backend
- `project-tracker-web` — the React UI served by nginx

Use your existing PostgreSQL database whenever possible. The optional `postgres.yaml` manifest is only for demos or local clusters.

## Build and push images

```bash
export REGISTRY=ghcr.io/your-org
export IMAGE_TAG=latest

docker build -f apps/api/Dockerfile -t "$REGISTRY/project-tracker-api:$IMAGE_TAG" .
docker build --build-arg VITE_API_URL=/api -f apps/web/Dockerfile -t "$REGISTRY/project-tracker-web:$IMAGE_TAG" .

docker push "$REGISTRY/project-tracker-api:$IMAGE_TAG"
docker push "$REGISTRY/project-tracker-web:$IMAGE_TAG"
```

Update the image references before deploying, for example with `kustomize edit set image` or by editing `k8s/api-deployment.yaml` and `k8s/web-deployment.yaml`.

## Deploy order

1. Create the namespace:
   ```bash
   kubectl apply -f k8s/namespace.yaml
   ```
2. Create the Secret with your real `DATABASE_URL` and `JWT_SECRET`:
   ```bash
   kubectl create secret generic project-tracker-secrets \
     --namespace project-tracker \
     --from-literal=DATABASE_URL='postgresql://db-user:db-password@db.example.com:5432/project_tracker?schema=public' \
     --from-literal=JWT_SECRET='replace-with-a-long-random-secret'
   ```
3. Apply the non-secret config:
   ```bash
   kubectl apply -f k8s/configmap.yaml
   ```
4. Run migrations:
   ```bash
   kubectl apply -f k8s/migrate-job.yaml
   kubectl logs -n project-tracker job/project-tracker-migrate --follow
   ```
5. Deploy the API and web services:
   ```bash
   kubectl apply -f k8s/api-deployment.yaml
   kubectl apply -f k8s/web-deployment.yaml
   ```
6. Apply the ingress:
   ```bash
   kubectl apply -f k8s/ingress.yaml
   ```

After the namespace and Secret exist, you can apply the long-lived resources in one pass with:

```bash
kubectl apply -k k8s/
```

Then run the migration Job separately:

```bash
kubectl apply -f k8s/migrate-job.yaml
kubectl logs -n project-tracker job/project-tracker-migrate --follow
```

## kind / minikube quickstart

For a quick local cluster test:

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

## Verification commands

```bash
kubectl get pods -n project-tracker
kubectl get svc -n project-tracker
kubectl logs -n project-tracker job/project-tracker-migrate
kubectl port-forward -n project-tracker svc/project-tracker-web 8080:8080
kubectl port-forward -n project-tracker svc/project-tracker-api 4000:4000
```

Open <http://localhost:8080> after port-forwarding the web service.
