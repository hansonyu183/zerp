#!/bin/sh

verify_actions_check_run() (
  repository=$1
  check_json=$2
  expected_name=$3
  expected_sha=$4
  expected_event=$5
  expected_pull_number=${6:-}
  gh_command=${7:-gh}

  check_details=$(printf '%s' "${check_json}" | jq -r '.details_url // ""')
  actions_prefix="https://github.com/${repository}/actions/runs/"
  case "${check_details}" in
    "${actions_prefix}"*"/job/"*)
      run_job=${check_details#"${actions_prefix}"}
      run_id=${run_job%%/job/*}
      job_id=${run_job#*/job/}
      ;;
    *) return 1 ;;
  esac
  case "${run_id}:${job_id}" in
    *[!0-9:]* | :* | *:) return 1 ;;
  esac

  printf '%s' "${check_json}" | jq -e \
    --arg name "${expected_name}" '
      .name == $name and .status == "completed" and .conclusion == "success" and
      .app.slug == "github-actions"
    ' >/dev/null || return 1

  workflow_run=$("${gh_command}" api "repos/${repository}/actions/runs/${run_id}") || return 1
  workflow_job=$("${gh_command}" api "repos/${repository}/actions/jobs/${job_id}") || return 1
  expected_run_url="https://api.github.com/repos/${repository}/actions/runs/${run_id}"

  jq -en \
    --argjson run "${workflow_run}" --argjson job "${workflow_job}" \
    --arg repository "${repository}" --arg head_sha "${expected_sha}" \
    --arg event "${expected_event}" --arg pull_number "${expected_pull_number}" \
    --arg check_name "${expected_name}" --arg details_url "${check_details}" \
    --arg run_id "${run_id}" --arg job_id "${job_id}" \
    --arg run_url "${expected_run_url}" '
      ($run.id | tostring) == $run_id and
      $run.name == "Full-stack quality" and
      $run.path == ".github/workflows/quality.yml" and
      $run.event == $event and
      $run.status == "completed" and $run.conclusion == "success" and
      $run.head_sha == $head_sha and
      $run.head_repository.full_name == $repository and
      ($pull_number == "" or
        any($run.pull_requests[]?;
          (.number | tostring) == $pull_number and
          .base.ref == "main" and .head.sha == $head_sha)) and
      ($job.id | tostring) == $job_id and
      $job.name == $check_name and
      $job.status == "completed" and $job.conclusion == "success" and
      $job.head_sha == $head_sha and $job.html_url == $details_url and
      $job.workflow_name == "Full-stack quality" and $job.run_url == $run_url
    ' >/dev/null
)

verify_cloudflare_pages_check_run() (
  check_json=$1
  expected_sha=$2
  expected_project=$3

  printf '%s' "${check_json}" | jq -e \
    --arg head_sha "${expected_sha}" --arg project "${expected_project}" '
    .external_id as $deployment_id |
    .name == "Cloudflare Pages" and
    .status == "completed" and .conclusion == "success" and
    .head_sha == $head_sha and
    .app.id == 85455 and
    .app.slug == "cloudflare-workers-and-pages" and
    .app.name == "Cloudflare Workers and Pages" and
    .app.owner.login == "cloudflare" and
    ($deployment_id | type == "string" and
      test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")) and
    (.details_url | type == "string" and
      test("^https://dash\\.cloudflare\\.com/\\?to=/[^/]+/pages/view/" + $project + "/" + $deployment_id + "$"))
  ' >/dev/null
)

verify_cloudflare_pages_deployment() (
  deployment_json=$1
  expected_deployment_id=$2
  expected_sha=$3
  expected_project=$4
  expected_owner=$5
  expected_repository=$6
  expected_branch=$7

  printf '%s' "${deployment_json}" | jq -e \
    --arg deployment_id "${expected_deployment_id}" \
    --arg head_sha "${expected_sha}" --arg project "${expected_project}" \
    --arg owner "${expected_owner}" --arg repository "${expected_repository}" \
    --arg branch "${expected_branch}" '
      .success == true and
      .result.id == $deployment_id and
      .result.project_name == $project and
      .result.environment == "production" and
      .result.source.type == "github" and
      .result.source.config.owner == $owner and
      .result.source.config.repo_name == $repository and
      .result.source.config.production_branch == $branch and
      .result.deployment_trigger.type == "github:push" and
      .result.deployment_trigger.metadata.branch == $branch and
      .result.deployment_trigger.metadata.commit_hash == $head_sha and
      .result.deployment_trigger.metadata.commit_dirty == false and
      .result.latest_stage.name == "deploy" and
      .result.latest_stage.status == "success"
    ' >/dev/null
)

verify_cloudflare_pages_project() (
  project_json=$1
  expected_project=$2
  expected_owner=$3
  expected_repository=$4
  expected_branch=$5

  printf '%s' "${project_json}" | jq -e \
    --arg project "${expected_project}" --arg owner "${expected_owner}" \
    --arg repository "${expected_repository}" --arg branch "${expected_branch}" '
      .success == true and
      .result.name == $project and
      .result.source.type == "github" and
      .result.source.config.owner == $owner and
      .result.source.config.repo_name == $repository and
      .result.source.config.production_branch == $branch
    ' >/dev/null
)

load_cloudflare_pages_project() (
  account_file=$1
  token_file=$2
  project=$3

  test -r "${account_file}" && test -r "${token_file}" || return 1
  cloudflare_account=$(sed -n '1p' "${account_file}")
  cloudflare_token=$(sed -n '1p' "${token_file}")
  test -n "${cloudflare_account}" && test -n "${cloudflare_token}" || return 1
  curl --silent --show-error --fail --config - <<EOF
header = "Authorization: Bearer ${cloudflare_token}"
url = "https://api.cloudflare.com/client/v4/accounts/${cloudflare_account}/pages/projects/${project}"
EOF
)

load_cloudflare_pages_deployment() (
  account_file=$1
  token_file=$2
  project=$3
  deployment_id=$4

  test -r "${account_file}" && test -r "${token_file}" || return 1
  cloudflare_account=$(sed -n '1p' "${account_file}")
  cloudflare_token=$(sed -n '1p' "${token_file}")
  test -n "${cloudflare_account}" && test -n "${cloudflare_token}" || return 1
  curl --silent --show-error --fail --config - <<EOF
header = "Authorization: Bearer ${cloudflare_token}"
url = "https://api.cloudflare.com/client/v4/accounts/${cloudflare_account}/pages/projects/${project}/deployments/${deployment_id}"
EOF
)
