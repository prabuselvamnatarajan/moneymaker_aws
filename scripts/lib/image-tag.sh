#!/bin/sh
# Shared Docker tag check. Source from other scripts; do not execute directly.
#
# A tag may contain ASCII letters, digits, underscores, periods, and dashes.
# It must not start with a period or a dash, and it must be at most 128 characters.

validate_image_tag() {
  _tag="$1"
  _label="${2:-tag}"
  if ! printf '%s' "$_tag" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'; then
    echo "ERROR: invalid Docker $_label: $_tag" >&2
    echo "ERROR: use 1-128 characters from [A-Za-z0-9_.-], not starting with '.' or '-'" >&2
    return 1
  fi
}

# Moving tag for a git branch.
# main is the production tag. Every other branch gets a tag that cannot
# collide with a different branch name or with "latest", including names
# longer than Docker's 128-character limit.
branch_destination_tag() {
  _raw="$1"
  if [ "$_raw" = "main" ]; then
    printf '%s\n' "latest"
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    _hash=$(printf '%s' "$_raw" | sha256sum | awk '{print $1}' | cut -c1-12)
  else
    _hash=$(printf '%s' "$_raw" | shasum -a 256 | awk '{print $1}' | cut -c1-12)
  fi
  _san=$(printf '%s' "$_raw" | sed 's/[^a-zA-Z0-9._-]/-/g; s/^[.-]*//; s/[.-]*$//')
  if [ -z "$_san" ]; then
    _san="branch"
  fi
  # 115 + hyphen + 12 hex = 128
  if [ "${#_san}" -gt 115 ]; then
    _san=$(printf '%s' "$_san" | cut -c1-115 | sed 's/[.-]*$//')
    if [ -z "$_san" ]; then
      _san="branch"
    fi
  fi
  _dest="${_san}-${_hash}"
  if [ "$_dest" = "latest" ]; then
    _dest="branch-${_hash}"
  fi
  printf '%s\n' "$_dest"
}
