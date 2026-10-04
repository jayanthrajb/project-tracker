FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/web ./apps/web
COPY apps/api/src/routes/attachments.ts ./apps/api/src/routes/attachments.ts
RUN npm run build -w @project-tracker/web

FROM nginx:alpine AS runtime
RUN apk add --no-cache gettext \
  && mkdir -p /tmp/nginx /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp \
  && chown -R nginx:nginx /tmp/nginx /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp /usr/share/nginx/html

COPY --from=builder --chown=nginx:nginx /app/apps/web/dist /usr/share/nginx/html
COPY --chown=nginx:nginx apps/web/nginx.conf /etc/nginx/templates/nginx.conf.template
COPY --chown=nginx:nginx apps/web/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER nginx
ENV API_UPSTREAM=http://api:4000
EXPOSE 8080
ENTRYPOINT ["/docker-entrypoint.sh"]
