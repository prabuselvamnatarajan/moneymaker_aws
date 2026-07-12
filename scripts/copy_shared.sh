#!/bin/sh
# Shared helpers for Docker builds that need redis_operations and utils copied in.
# Usage:
#   . ./scripts/copy_shared.sh
#   build_strategy ./kafka/services/Strategies/liquidity_sweep liquidity-sweep-strategy:latest

copy_shared() {
  target=$1
  cp -r ./appInit/redis_operations "$target/redis_operations"
  cp -r ./MicroServices/Shared/utils "$target/utils"
}

clean_shared() {
  target=$1
  rm -rf "$target/redis_operations"
  rm -rf "$target/utils"
}

build_kafka_service() {
  target=$1
  image_tag=$2
  copy_shared "$target"
  docker build -t "$image_tag" "$target"
  clean_shared "$target"
}

build_strategy() {
  target=$1
  image_tag=$2
  copy_shared "$target"
  cp ./MicroServices/Shared/Accounts/account_utils.js "$target/account_utils.js"
  docker build -t "$image_tag" "$target"
  clean_shared "$target"
  rm -f "$target/account_utils.js"
}
