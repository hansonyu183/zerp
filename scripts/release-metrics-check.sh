#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/zerp-release-metrics.XXXXXX")
trap 'rm -rf "${test_root}"' EXIT HUP INT TERM

cat >"${test_root}/pulls.json" <<'EOF'
[
  {"number":2,"created_at":"2026-01-02T00:00:00Z","merged_at":"2026-01-02T00:20:00Z","base":{"ref":"main"},"head":{"sha":"222","ref":"feature-two"}},
  {"number":1,"created_at":"2026-01-01T00:00:00Z","merged_at":"2026-01-01T00:10:00Z","base":{"ref":"dev"},"head":{"sha":"111","ref":"feature-one"}},
  {"number":3,"created_at":"2026-01-03T00:00:00Z","merged_at":null,"base":{"ref":"main"},"head":{"sha":"333","ref":"open"}}
]
EOF

cat >"${test_root}/runs.json" <<'EOF'
[
  {"name":"Full-stack quality","event":"pull_request","head_branch":"feature-one","conclusion":"success","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:02:00Z","pull_requests":[]},
  {"name":"Full-stack quality","event":"pull_request","head_branch":"feature-one","conclusion":"cancelled","created_at":"2026-01-01T00:03:00Z","updated_at":"2026-01-01T00:04:00Z","pull_requests":[]},
  {"name":"Full-stack quality","event":"pull_request","head_branch":"feature-one","conclusion":"success","created_at":"2026-01-01T00:05:00Z","updated_at":"2026-01-01T00:08:00Z","pull_requests":[]},
  {"name":"Full-stack quality","event":"pull_request","head_branch":"feature-two","conclusion":"success","created_at":"2026-01-02T00:00:00Z","updated_at":"2026-01-02T00:05:00Z","pull_requests":[{"number":2}]}
]
EOF

result=$(
  ZERP_RELEASE_METRICS_PULLS_FILE="${test_root}/pulls.json" \
    ZERP_RELEASE_METRICS_RUNS_FILE="${test_root}/runs.json" \
    ZERP_RELEASE_METRICS_LIMIT=20 \
    "${repo_root}/scripts/release-metrics.sh"
)

test "$(printf '%s' "${result}" | jq -r '.sample_size')" = 2
test "$(printf '%s' "${result}" | jq -r '.baseline.repeat_validations_total')" = 2
test "$(printf '%s' "${result}" | jq -r '.baseline.system_seconds_p50')" = 300
test "$(printf '%s' "${result}" | jq -r '.baseline.flow_seconds_p95')" = 1200
test "$(printf '%s' "${result}" | jq -r '.pull_requests[0].number')" = 2
test "$(printf '%s' "${result}" | jq -r '.pull_requests[1].system_seconds')" = 300
