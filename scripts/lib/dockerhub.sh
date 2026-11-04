#!/bin/sh
# Docker Hub helpers. Source from other scripts; do not execute directly.
#
# New repositories inherit the account default visibility. On Personal plans
# that default is often private (1 private repo allowed). CI expects images
# to be publicly pullable, so callers must mark pushed repos public before
# or immediately after the first push.

# Login to Docker Hub's HTTP API and print a JWT. Uses DOCKERHUB_TOKEN.
# Args: username
dockerhub_api_token() {
  _user="$1"
  if [ -z "${DOCKERHUB_TOKEN:-}" ]; then
    echo "ERROR: DOCKERHUB_TOKEN is required to manage Docker Hub repository visibility" >&2
    return 1
  fi
  if [ -z "$_user" ]; then
    echo "ERROR: dockerhub_api_token requires a username" >&2
    return 1
  fi
  _jwt=$(DOCKERHUB_USER="$_user" python3 - <<'PY'
import json, os, urllib.error, urllib.request
payload = json.dumps({
    "username": os.environ["DOCKERHUB_USER"],
    "password": os.environ["DOCKERHUB_TOKEN"],
}).encode()
req = urllib.request.Request(
    "https://hub.docker.com/v2/users/login/",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.load(resp)
except urllib.error.HTTPError as exc:
    err = exc.read().decode("utf-8", "replace")
    raise SystemExit(f"Docker Hub login failed (HTTP {exc.code}): {err}") from exc
token = body.get("token") or ""
if not token:
    raise SystemExit("Docker Hub login did not return a token")
print(token)
PY
) || return 1
  printf '%s\n' "$_jwt"
}

# Ensure namespace/name is a public repository (patch existing or create).
# Args: namespace repository jwt
dockerhub_ensure_public() {
  _ns="$1"
  _name="$2"
  _jwt="$3"
  if [ -z "$_ns" ] || [ -z "$_name" ] || [ -z "$_jwt" ]; then
    echo "ERROR: dockerhub_ensure_public requires namespace, repository, and jwt" >&2
    return 1
  fi
  _body=$(mktemp "${TMPDIR:-/tmp}/mm-dh-body.XXXXXX")
  _url="https://hub.docker.com/v2/repositories/${_ns}/${_name}/"
  _code=$(curl -sS -o "$_body" -w '%{http_code}' -X PATCH "$_url" \
    -H "Authorization: JWT $_jwt" \
    -H 'Content-Type: application/json' \
    -d '{"is_private":false}') || { rm -f "$_body"; return 1; }
  if [ "$_code" = "200" ] || [ "$_code" = "202" ]; then
    rm -f "$_body"
    return 0
  fi
  if [ "$_code" = "404" ]; then
    _create=$(curl -sS -o "$_body" -w '%{http_code}' -X POST \
      https://hub.docker.com/v2/repositories/ \
      -H "Authorization: JWT $_jwt" \
      -H 'Content-Type: application/json' \
      -d "{\"namespace\":\"$_ns\",\"name\":\"$_name\",\"is_private\":false,\"description\":\"MoneyMaker image\"}") || { rm -f "$_body"; return 1; }
    if [ "$_create" = "201" ] || [ "$_create" = "200" ]; then
      rm -f "$_body"
      return 0
    fi
    echo "ERROR: failed to create public Docker Hub repo $_ns/$_name (HTTP $_create)" >&2
    cat "$_body" >&2 || true
    rm -f "$_body"
    return 1
  fi
  echo "ERROR: failed to set $_ns/$_name public (HTTP $_code)" >&2
  cat "$_body" >&2 || true
  rm -f "$_body"
  return 1
}

# Mark every repository named in a push-list directory as public.
# Each file's basename is the image repository name under $1 (namespace).
# Args: namespace push_dir
dockerhub_ensure_push_dir_public() {
  _ns="$1"
  _dir="$2"
  if [ -z "$_ns" ] || [ -z "$_dir" ] || [ ! -d "$_dir" ]; then
    echo "ERROR: dockerhub_ensure_push_dir_public requires namespace and push_dir" >&2
    return 1
  fi
  _jwt=$(dockerhub_api_token "$_ns") || return 1
  _fail=0
  for _f in "$_dir"/*; do
    [ -f "$_f" ] || continue
    _name=$(basename "$_f")
    [ -n "$_name" ] || continue
    if ! dockerhub_ensure_public "$_ns" "$_name" "$_jwt"; then
      _fail=1
    else
      printf '[build-images] Docker Hub repo %s/%s is public\n' "$_ns" "$_name"
    fi
  done
  [ "$_fail" -eq 0 ]
}
