#!/usr/bin/env bash
# Print a fresh PROD_APP_SECRETS value with random passwords.
# Run on your own machine and paste the output into the GitHub secret
# PROD_APP_SECRETS (Settings > Secrets and variables > Actions).
#
#   ./scripts/aws/generate-prod-secrets.sh > prod-secrets.env   # keep it safe, never commit
#
# Hex values only, so nothing needs escaping inside the connection URIs.
set -euo pipefail

rand() { openssl rand -hex "$1"; }

MONGO_USER="${MONGO_USER:-root}"
MONGO_PASS="$(rand 24)"
REDIS_PASS="$(rand 24)"
MONGO_HOSTS="mongo1:27017,mongo2:27017,mongo3:27017"
MONGO_URI="mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOSTS}/?replicaSet=rs0&authSource=admin"

cat <<OUT
MONGO_ROOT_USERNAME=${MONGO_USER}
MONGO_ROOT_PASSWORD=${MONGO_PASS}
MONGO_URI=${MONGO_URI}
MONGODB_URI=${MONGO_URI}
REDIS_PASSWORD=${REDIS_PASS}
REDIS_URL=redis://:${REDIS_PASS}@redis:6379
JWT_ACCESS_SECRET=$(rand 32)
JWT_REFRESH_SECRET=$(rand 32)
BACKTEST_SERVICE_TOKEN=$(rand 32)
ME_CONFIG_MONGODB_ADMINUSERNAME=${MONGO_USER}
ME_CONFIG_MONGODB_ADMINPASSWORD=${MONGO_PASS}
ME_CONFIG_MONGODB_URL=${MONGO_URI}
OUT
