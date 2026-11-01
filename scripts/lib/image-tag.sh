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
