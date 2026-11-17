#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Libre AI contributors
# SPDX-License-Identifier: Apache-2.0
#
# Shell lint: shellcheck at `--severity=error` over every tracked `*.sh` of the
# repository it is run in. One file run by
# .github/workflows/reusable-shell-lint.yml, so the workflow holds no logic and
# the logic has a test (tools/quality/check-shell-lint.test.ts).
#
# One tool, one threshold, no parameter: an error-severity finding is red; a
# warning, an info or a style note is not. There is no exclusion list.
#
# Environment:
#   SHELLCHECK_IMAGE  required. `<repository>@sha256:<64 hex>`. A tag is
#                     refused: the verdict of a tagged image changes with time.
#   SHELLCHECK_BIN    optional. One executable run in place of the container,
#                     with the same arguments (`--severity=error -- <files>`).
#                     It exists for the tests; the image is validated anyway.
#
# Exit codes:
#   0  every tracked shell file passes, or there is none (said explicitly)
#   1  shellcheck reports at least one error-severity finding
#   2  usage or prerequisite: image absent or not pinned by digest, launcher
#      not found, tracked file missing or unreadable, launcher failure
#
# Scope is the tracked tree (`git ls-files`): a file must be added to be judged.
set -euo pipefail

image="${SHELLCHECK_IMAGE:-}"
if [[ ! "$image" =~ ^[a-z0-9]([a-z0-9._/:-]*[a-z0-9])?@sha256:[0-9a-f]{64}$ ]]; then
  echo "check-shell-lint: SHELLCHECK_IMAGE must be <repository>@sha256:<64 hex>, got '${image}'" >&2
  exit 2
fi

launcher="${SHELLCHECK_BIN:-docker}"
if ! command -v -- "$launcher" >/dev/null 2>&1; then
  echo "check-shell-lint: launcher not found: ${launcher}" >&2
  exit 2
fi

if ! root="$(git rev-parse --show-toplevel)"; then
  echo "check-shell-lint: not inside a git work tree" >&2
  exit 2
fi
cd "$root"

# Reads the NUL-separated tracked paths on stdin, lints them, and returns the
# verdict. It runs as the last stage of a pipe so that a failing `git ls-files`
# stays visible in PIPESTATUS instead of reading as an empty repository.
lint_tracked() {
  local files=() unreadable=0 file rc=0
  while IFS= read -r -d '' file; do
    files+=("$file")
  done

  echo "shell files tracked: ${#files[@]}"
  if [ "${#files[@]}" -eq 0 ]; then
    echo "shell files checked: 0"
    echo "no tracked shell file: nothing to lint"
    return 0
  fi

  # A tracked file that cannot be read is a failure, never a file with no
  # finding: shellcheck would be handed fewer files than the count printed.
  for file in "${files[@]}"; do
    if [ ! -f "$file" ] || [ ! -r "$file" ]; then
      echo "check-shell-lint: tracked shell file missing or unreadable: ${file}" >&2
      unreadable=$((unreadable + 1))
    fi
  done
  if [ "$unreadable" -ne 0 ]; then
    echo "check-shell-lint: ${unreadable} of ${#files[@]} tracked shell file(s) cannot be read" >&2
    return 2
  fi

  if [ -n "${SHELLCHECK_BIN:-}" ]; then
    "$SHELLCHECK_BIN" --severity=error -- "${files[@]}" || rc=$?
  else
    docker run --rm --network none --volume "${root}:/mnt:ro" --workdir /mnt \
      "$image" --severity=error -- "${files[@]}" || rc=$?
  fi

  case "$rc" in
    0)
      echo "shell files checked: ${#files[@]}"
      echo "severity: error"
      echo "image: ${image}"
      return 0
      ;;
    1)
      echo "check-shell-lint: shellcheck reported at least one error-severity finding" >&2
      return 1
      ;;
    *)
      echo "check-shell-lint: launcher failed with exit code ${rc}; no verdict" >&2
      return 2
      ;;
  esac
}

set +e
git ls-files -z -- '*.sh' | lint_tracked
status=("${PIPESTATUS[@]}")
set -e

if [ "${status[0]}" -ne 0 ]; then
  echo "check-shell-lint: git ls-files failed with exit code ${status[0]}; no verdict" >&2
  exit 2
fi
exit "${status[1]}"
