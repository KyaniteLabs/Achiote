#!/bin/bash
# deploy-achiote.sh — Deploy Achiote landing page updates to Hostinger VPS
# Run this on the VPS host (187.124.238.235) as root or a user with docker access

set -euo pipefail

# Configuration
CONTAINER_NAME="achiote-app"  # adjust if your container has a different name
IMAGE_NAME="achiote:latest"
REPO_DIR="/root/member-berries"  # adjust to where you clone the repo
BRANCH="master"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[LOG]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# 1. Pull latest code
log "Pulling latest code from git@github.com:Pastorsimon1798/achiote.git branch $BRANCH"
cd "$REPO_DIR"
git fetch origin
git reset --hard origin/$BRANCH
git log -1 --oneline

# 2. Build Docker image
log "Building Docker image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" .

# 3. Stop and remove old container
log "Stopping and removing old container: $CONTAINER_NAME"
docker stop "$CONTAINER_NAME" || true
docker rm "$CONTAINER_NAME" || true

# 4. Run new container
log "Running new container"
docker run -d \
  --name "$CONTAINER_NAME" \
  -p 3000:3000 \
  --restart unless-stopped \
  --env-file "$REPO_DIR/.env" \
  "$IMAGE_NAME"

log "Deploy complete. Container $(docker ps -qf "name=$CONTAINER_NAME") is running."

# 5. Optional: health check
log "Waiting 10 seconds for container to start..."
sleep 10
log "Checking health endpoint..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  log "Health check passed (HTTP 200)"
else
  warn "Health check failed (HTTP $HTTP_CODE). Check logs: docker logs $CONTAINER_NAME"
fi