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
2. Create the Secret with your real `DATABASE_URL` and `JWT_SECRET`. S3 credentials are required only when using `STORAGE_DRIVER=s3`:
   ```bash
   kubectl create secret generic project-tracker-secrets \
     --namespace project-tracker \
     --from-literal=DATABASE_URL='postgresql://db-user:db-password@db.example.com:5432/project_tracker?schema=public' \
     --from-literal=JWT_SECRET='replace-with-a-long-random-secret' \
     --from-literal=S3_ACCESS_KEY_ID='replace-with-minio-access-key' \
     --from-literal=S3_SECRET_ACCESS_KEY='replace-with-minio-secret-key'
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

## S3-compatible storage

The example ConfigMap defaults to `STORAGE_DRIVER=local`. For centralized MinIO, set `STORAGE_DRIVER=s3`, replace `S3_ENDPOINT` with its reachable S3 API endpoint, configure the region and bucket, and provide `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` through the Secret. Keep `S3_USE_PRESIGNED_URLS=false` to serve downloads through the authenticated API route.

With `STORAGE_DRIVER=s3`, the uploads PVC is not used. Remove `uploads-pvc.yaml` from `k8s/kustomization.yaml` and remove the `uploads` volume and mount from `k8s/api-deployment.yaml` for an S3 deployment. This removes the `ReadWriteMany` requirement that applies when multiple API replicas share local disk storage.
