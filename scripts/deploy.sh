#!/usr/bin/env bash
# Zero-surprise deploy with automatic rollback.  Usage: ./scripts/deploy.sh <image-tag>
set -euo pipefail
cd "$(dirname "$0")/.."
NEW_TAG="${1:?usage: deploy.sh <tag>}"
PREV_TAG="$(cat .last_good_tag 2>/dev/null || echo '')"

health() {  # wait up to ~60s for the gateway AND the api readiness probe
  for _ in $(seq 1 30); do
    if curl -fs http://127.0.0.1:8080/healthz >/dev/null && curl -fs http://127.0.0.1:8080/api/health >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
export TAG="$NEW_TAG"
echo "==> deploying $NEW_TAG (previous: ${PREV_TAG:-none})"
docker compose pull api audit gateway
docker compose up -d --no-build --remove-orphans
if health; then
  echo "$NEW_TAG" > .last_good_tag
  docker image prune -f >/dev/null
  echo "==> deploy OK"
else
  echo "!! health check failed"
  if [ -n "$PREV_TAG" ]; then
    echo "==> rolling back to $PREV_TAG"
    export TAG="$PREV_TAG"
    docker compose up -d --no-build
  fi
  exit 1
fi
