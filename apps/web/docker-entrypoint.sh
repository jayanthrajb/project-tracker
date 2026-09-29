#!/bin/sh
set -eu

: "${API_UPSTREAM:=http://api:4000}"
envsubst '${API_UPSTREAM}' < /etc/nginx/templates/nginx.conf.template > /tmp/nginx/nginx.conf

exec nginx -c /tmp/nginx/nginx.conf -g 'daemon off;'
