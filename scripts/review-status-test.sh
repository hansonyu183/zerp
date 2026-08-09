#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-review-status.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM
mkdir -p "${tmp}/bin"

cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
case "$*" in
  *'repos/example/zerp/pulls/7/reviews?per_page=100'*)
    if [ "${MOCK_SCENARIO}" = comment ]; then
      printf '[[]]\n'
      exit 0
    fi
    reviewed=1111111111111111111111111111111111111111
    [ "${MOCK_SCENARIO}" != stale ] || reviewed=2222222222222222222222222222222222222222
    printf '[[{"user":{"login":"chatgpt-codex-connector[bot]"},"submitted_at":"2026-08-09T00:00:00Z","commit_id":"%s"}]]\n' "${reviewed}"
    ;;
  *'repos/example/zerp/issues/7/comments?per_page=100'*)
    if [ "${MOCK_SCENARIO}" = comment ]; then
      printf '[[{"user":{"login":"chatgpt-codex-connector"},"created_at":"2026-08-09T00:00:00Z","body":"Codex Review: no issues.\\n\\n**Reviewed commit:** `1111111111`"}]]\n'
    else
      printf '[[]]\n'
    fi
    ;;
  *'repos/example/zerp/pulls/7')
    printf '{"state":"open","base":{"ref":"main"},"head":{"sha":"1111111111111111111111111111111111111111"}}\n'
    ;;
  *'api graphql'*)
    resolved=true
    [ "${MOCK_SCENARIO}" != unresolved ] || resolved=false
    printf '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[{"isResolved":%s}]}}}}}\n' "${resolved}"
    ;;
  *) exit 2 ;;
esac
MOCK
chmod +x "${tmp}/bin/gh"

assert_status() {
  scenario=$1
  expected=$2
  output=${tmp}/${scenario}
  if PATH="${tmp}/bin:${PATH}" ZERP_GITHUB_REPOSITORY=example/zerp \
    MOCK_SCENARIO="${scenario}" "${repo_root}/scripts/review-status.sh" 7 >"${output}"; then
    actual=ready
  else
    actual=$(sed -n 's/^status=//p' "${output}")
  fi
  test "${actual}" = "${expected}" || {
    echo "review status ${scenario}: expected ${expected}, got ${actual:-missing}" >&2
    exit 1
  }
}

assert_status ready ready
assert_status comment ready
assert_status stale stale
assert_status unresolved pending
