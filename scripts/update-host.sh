#!/bin/sh
set -eu
cd /opt/clickpe
mkdir -p .runtime certs
chmod 700 .runtime
trap 'rm -f /opt/clickpe/.runtime/credentials.json' EXIT
curl --fail --silent --show-error --location https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o certs/rds-ca.pem
docker compose stop relay runner
docker compose exec -T n8n n8n export:workflow --all --output=/home/node/.n8n/pre-deploy-workflows.json
docker compose cp n8n:/home/node/.n8n/pre-deploy-workflows.json .runtime/existing-workflows.json
docker compose stop n8n
COMPOSE_PARALLEL_LIMIT=1 docker compose build api relay
docker compose up -d --wait api
docker compose run --rm --no-deps -v /opt/clickpe/.runtime:/runtime -v /opt/clickpe/n8n/workflows:/seed/workflows:ro api python scripts/configure_n8n.py
chown -R 1000:1000 .runtime
docker compose run --rm --no-deps --entrypoint n8n -v /opt/clickpe/.runtime:/runtime n8n import:credentials --input=/runtime/credentials.json
docker compose run --rm --no-deps --entrypoint n8n -v /opt/clickpe/.runtime:/runtime n8n import:workflow --input=/runtime/workflows.json
while IFS= read -r workflow_id; do
  test -n "$workflow_id" || continue
  docker compose run --rm --no-deps --entrypoint n8n n8n publish:workflow --id="$workflow_id"
done < .runtime/publish.txt
docker compose up -d n8n runner
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:5678/healthz/readiness >/dev/null; then break; fi
  sleep 2
done
curl --fail --silent http://127.0.0.1:5678/healthz/readiness
docker compose up -d relay
docker compose ps --format '{{.Service}}: {{.State}} {{.Health}}'
