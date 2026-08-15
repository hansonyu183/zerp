#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=scripts/check-run-provenance.sh
. "${script_dir}/check-run-provenance.sh"

repo=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
pr=${1:-${PREVIEW_PR:-}}
head=${2:-${PREVIEW_REF:-}}
actor=${PREVIEW_ACTOR:-${GITHUB_ACTOR:-}}
gh_bin=${ZERP_GH_BIN:-gh}

case "${pr}" in
  '' | *[!0-9]*)
    echo "PR number is invalid" >&2
    exit 2
    ;;
esac
case "${head}" in
  *[!0-9a-f]*)
    echo "head must be a full lowercase SHA" >&2
    exit 2
    ;;
esac
test "$(printf '%s' "${head}" | wc -c | tr -d ' ')" = 40 || {
  echo "head must be a full lowercase SHA" >&2
  exit 2
}

command -v "${gh_bin}" >/dev/null 2>&1 || {
  echo "gh is required" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "jq is required" >&2
  exit 1
}

verify_pr_json() {
  printf '%s' "$1" |
    jq -e --arg head "${head}" '
      .state == "open" and
      .draft == false and
      .base.ref == "main" and
      .head.sha == $head
    ' >/dev/null
}

pr_json=$("${gh_bin}" api "repos/${repo}/pulls/${pr}")
verify_pr_json "${pr_json}" || {
  echo "PR #${pr} is not Ready, main-based, open, or at exact head" >&2
  exit 1
}

if [ -n "${ZERP_PREVIEW_MAIN_SHA:-}" ]; then
  main_sha=${ZERP_PREVIEW_MAIN_SHA}
else
  git fetch origin main --prune >/dev/null
  main_sha=$(git rev-parse 'origin/main^{commit}')
fi
if ! git cat-file -e "${head}^{commit}" 2>/dev/null; then
  git fetch origin \
    "refs/pull/${pr}/head:refs/remotes/origin/preview/${pr}" --prune >/dev/null
fi
git cat-file -e "${head}^{commit}" 2>/dev/null || {
  echo "exact PR head is unavailable locally" >&2
  exit 1
}
git merge-base --is-ancestor "${main_sha}" "${head}" || {
  echo "PR head does not include current origin/main" >&2
  exit 1
}

checks=$("${gh_bin}" api "repos/${repo}/commits/${head}/check-runs?per_page=100")
validation_check=$(
  printf '%s' "${checks}" |
    jq -c '
      [.check_runs[] | select(.name == "preview-required")]
      | sort_by(.started_at)
      | if length == 0 then null else last end
    '
)
validation_state=$(printf '%s' "${validation_check}" | jq -r 'if . == null then "missing" else (.status + ":" + (.conclusion // "")) end')
test "${validation_state}" = completed:success || {
  echo "Ready preview evidence on ${head} is ${validation_state}" >&2
  exit 1
}
verify_actions_check_run "${repo}" "${validation_check}" \
  preview-required "${head}" pull_request "${pr}" "${gh_bin}" || {
  echo "Ready preview evidence on ${head} is not a trusted GitHub Actions run" >&2
  exit 1
}

authenticated_actor=$("${gh_bin}" api user --jq .login 2>/dev/null || true)
test -n "${authenticated_actor}" || {
  echo "authenticated GitHub actor is required" >&2
  exit 1
}
if [ -n "${actor}" ] &&
  [ "$(printf '%s' "${actor}" | tr '[:upper:]' '[:lower:]')" != \
    "$(printf '%s' "${authenticated_actor}" | tr '[:upper:]' '[:lower:]')" ]; then
  echo "actor ${actor} does not match authenticated GitHub actor ${authenticated_actor}" >&2
  exit 1
fi
actor=${authenticated_actor}
actor_key=$(printf '%s' "${actor}" | tr '[:upper:]' '[:lower:]')
expected_verifier=${ZERP_RELEASE_VERIFIER_ACTOR:-}
test -n "${expected_verifier}" || {
  echo "ZERP_RELEASE_VERIFIER_ACTOR is required" >&2
  exit 1
}
expected_verifier_key=$(printf '%s' "${expected_verifier}" | tr '[:upper:]' '[:lower:]')
test "${actor_key}" = "${expected_verifier_key}" || {
  echo "actor ${actor} is not the configured release verifier" >&2
  exit 1
}
case "${actor_key}" in
  *'[bot]') ;;
  *) echo "release verifier must be a dedicated GitHub App Bot" >&2; exit 1 ;;
esac
permission=$(
  "${gh_bin}" api "repos/${repo}/collaborators/${actor}/permission" \
    --jq .permission 2>/dev/null || printf none
)
case "${permission}" in
  write | maintain | admin) ;;
  *)
    echo "actor ${actor} lacks collaborator write permission" >&2
    exit 1
    ;;
esac

# Read the PR again after all external and local evidence checks. Callers invoke
# this verifier both before and after the secret-free build.
verify_pr_json "$("${gh_bin}" api "repos/${repo}/pulls/${pr}")" || {
  echo "PR head changed during validation" >&2
  exit 1
}

printf 'preview PR #%s head=%s verifier=%s preview-required=success\n' \
  "${pr}" "${head}" "${actor}"
