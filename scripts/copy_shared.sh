#!/bin/sh
# Shared helpers for Docker builds that need redis_operations and utils copied in.
# Usage:
#   . ./scripts/copy_shared.sh
#   build_strategy ./kafka/services/Strategies/liquidity_sweep liquidity-sweep-strategy:latest
#   build_microservice ./MicroServices/Orders/placeOrders placeorder:latest placeorder

copy_shared() {
  target=$1
  cp -r ./shared/redis_operations "$target/redis_operations"
  cp -r ./shared/utils "$target/utils"
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

# appInit imports ../redis_operations from Init/*.js. Copy shared helpers
# into the build context, then remove them so the source tree stays clean.
build_appinit() {
  target=$1
  image_tag=$2
  cp -r ./shared/redis_operations "$target/redis_operations"
  docker build -t "$image_tag" "$target"
  rm -rf "$target/redis_operations"
}

build_strategy() {
  target=$1
  image_tag=$2
  copy_shared "$target"
  cp ./shared/Accounts/account_utils.js "$target/account_utils.js"
  docker build -t "$image_tag" "$target"
  clean_shared "$target"
  rm -f "$target/account_utils.js"
}

# Bake files that docker-compose bind-mounted into microservice containers.
# mode:
#   redis      — redis_operations only (upstock-login)
#   auth       — redis_operations + AuthoriseUpstoxClient.js
#   placeorder — redis_operations + AuthoriseUpstoxClient.js + account_utils.js
build_microservice() {
  target=$1
  image_tag=$2
  mode=${3:-auth}

  mkdir -p "$target/redis_utils_bake"
  cp -r ./shared/redis_operations "$target/redis_utils_bake/redis_operations"

  case "$mode" in
    redis)
      ;;
    auth)
      cp ./shared/AuthorisedUpstox/AuthoriseUpstoxClient.js \
        "$target/redis_utils_bake/AuthoriseUpstoxClient.js"
      ;;
    placeorder)
      cp ./shared/AuthorisedUpstox/AuthoriseUpstoxClient.js \
        "$target/redis_utils_bake/AuthoriseUpstoxClient.js"
      cp ./shared/Accounts/account_utils.js \
        "$target/redis_utils_bake/account_utils.js"
      ;;
    *)
      echo "ERROR: unknown microservice bake mode: $mode" >&2
      rm -rf "$target/redis_utils_bake"
      return 1
      ;;
  esac

  docker build -t "$image_tag" "$target"
  rm -rf "$target/redis_utils_bake"
}
