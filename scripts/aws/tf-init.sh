#!/usr/bin/env bash
# terraform init for terraform/prod against the S3 state bucket from
# terraform/bootstrap. Used by the infra-apply and infra-destroy workflows;
# works the same by hand:
#   TF_STATE_BUCKET=my-bucket AWS_REGION=ap-south-1 ./scripts/aws/tf-init.sh
set -euo pipefail

: "${TF_STATE_BUCKET:?TF_STATE_BUCKET is required (terraform/bootstrap output state_bucket)}"
: "${AWS_REGION:?AWS_REGION is required}"
TF_STATE_KEY="${TF_STATE_KEY:-moneymaker/prod/terraform.tfstate}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/terraform/prod"

terraform init -input=false \
  -backend-config="bucket=${TF_STATE_BUCKET}" \
  -backend-config="key=${TF_STATE_KEY}" \
  -backend-config="region=${AWS_REGION}" \
  -backend-config="use_lockfile=true" \
  -backend-config="encrypt=true"
