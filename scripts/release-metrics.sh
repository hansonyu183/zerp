#!/bin/sh
set -eu

repo=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
limit=${ZERP_RELEASE_METRICS_LIMIT:-20}

command -v jq >/dev/null 2>&1 || {
  echo "jq is required" >&2
  exit 1
}

case "${limit}" in
  '' | *[!0-9]* | 0)
    echo "ZERP_RELEASE_METRICS_LIMIT must be a positive integer" >&2
    exit 2
    ;;
esac

temp_root=$(mktemp -d "${TMPDIR:-/tmp}/zerp-release-metrics-data.XXXXXX")
trap 'rm -rf "${temp_root}"' EXIT HUP INT TERM

if [ -n "${ZERP_RELEASE_METRICS_PULLS_FILE:-}" ]; then
  pulls_file=${ZERP_RELEASE_METRICS_PULLS_FILE}
else
  command -v gh >/dev/null 2>&1 || {
    echo "gh is required" >&2
    exit 1
  }
  pulls_file=${temp_root}/pulls.json
  gh api --paginate --slurp \
    "repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100" |
    jq -c 'add' >"${pulls_file}"
fi

if [ -n "${ZERP_RELEASE_METRICS_RUNS_FILE:-}" ]; then
  runs_file=${ZERP_RELEASE_METRICS_RUNS_FILE}
else
  runs_file=${temp_root}/runs.json
  gh api --paginate --slurp \
    "repos/${repo}/actions/runs?event=pull_request&per_page=100" |
    jq -c '[.[].workflow_runs[]]' >"${runs_file}"
fi

jq -n \
  --arg repo "${repo}" \
  --argjson limit "${limit}" \
  --slurpfile pulls_data "${pulls_file}" \
  --slurpfile runs_data "${runs_file}" '
  def percentile($values; $fraction):
    ($values | sort) as $sorted |
    if ($sorted | length) == 0 then null
    else $sorted[((($sorted | length) * $fraction | ceil) - 1)]
    end;
  def duration_seconds:
    ((.updated_at | fromdateiso8601) - (.created_at | fromdateiso8601));
  [
    $pulls_data[0][]
    | select(.merged_at != null)
  ]
  | sort_by(.merged_at)
  | reverse
  | .[:$limit]
  | map(
      . as $pull
      | [
          $runs_data[0][]
          | select(
              .name == "Full-stack quality"
              and .event == "pull_request"
              and (
                any(.pull_requests[]?; .number == $pull.number)
                or (
                  .head_branch == $pull.head.ref
                  and (.created_at | fromdateiso8601) >= ($pull.created_at | fromdateiso8601)
                  and (.created_at | fromdateiso8601) <= ($pull.merged_at | fromdateiso8601)
                )
              )
            )
        ] as $quality_runs
      | {
          number: $pull.number,
          base: $pull.base.ref,
          head_sha: $pull.head.sha,
          merged_at: $pull.merged_at,
          validation_runs: ($quality_runs | length),
          repeat_validations: ([($quality_runs | length) - 1, 0] | max),
          system_seconds: (
            [$quality_runs[] | select(.conclusion != "cancelled") | duration_seconds]
            | add // 0
          ),
          flow_seconds: (
            ($pull.merged_at | fromdateiso8601) -
            ($pull.created_at | fromdateiso8601)
          )
        }
    ) as $rows
  | {
      repository: $repo,
      sample_size: ($rows | length),
      targets: {
        repeat_validations_reduction_percent: 50,
        system_p50_reduction_percent: 30,
        flow_p95_reduction_percent: 20
      },
      baseline: {
        repeat_validations_total: ([$rows[].repeat_validations] | add // 0),
        system_seconds_p50: percentile([$rows[].system_seconds]; 0.50),
        system_seconds_p95: percentile([$rows[].system_seconds]; 0.95),
        flow_seconds_p50: percentile([$rows[].flow_seconds]; 0.50),
        flow_seconds_p95: percentile([$rows[].flow_seconds]; 0.95)
      },
      pull_requests: $rows
    }
  '
