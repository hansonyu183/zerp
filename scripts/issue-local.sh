#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "${script_dir}/.." && pwd)
if [ -n "${ZERP_PRIMARY_ROOT:-}" ]; then
  primary_root=${ZERP_PRIMARY_ROOT}
else
  common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
  primary_root=$(dirname "${common_git_dir}")
fi
tracker_root=${ZERP_ISSUE_TRACKER_ROOT:-${primary_root}/.scratch}
runtime_root=${ZERP_ISSUE_LOCAL_RUNTIME_ROOT:-${primary_root}/backend/var/issue-delivery}
repo=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
codex_bin=${ZERP_CODEX_BIN:-codex}
gh_bin=${ZERP_GH_BIN:-gh}
preview_command=${ZERP_ISSUE_PREVIEW_COMMAND:-${script_dir}/issue-local-preview.sh}
production_command=${ZERP_ISSUE_PRODUCTION_COMMAND:-${script_dir}/issue-local-production.sh}
preview_close_command=${ZERP_ISSUE_PREVIEW_CLOSE_COMMAND:-${script_dir}/issue-local-preview.sh}
schema=${ZERP_ISSUE_RESULT_SCHEMA:-${repo_root}/.github/automation/schemas/local-implementation-output.json}
lock_dir="${runtime_root}/agent.lock"

usage() {
  echo "usage: $0 {run|status|retry <feature>|stop|start}" >&2
  exit 2
}

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }

write_value() {
  destination=$1
  value=$2
  printf '%s\n' "${value}" >"${destination}.new"
  mv "${destination}.new" "${destination}"
}

ticket_status() {
  sed -n 's/^\*\*Status:\*\*[[:space:]]*//p' "$1" | sed -n '1p'
}

set_ticket_status() {
  ticket=$1
  status=$2
  sed "s/^\*\*Status:\*\*.*/**Status:** ${status}/" "${ticket}" >"${ticket}.new"
  mv "${ticket}.new" "${ticket}"
}

complete_ticket() {
  ticket=$1
  sed \
    -e 's/^\*\*Status:\*\*.*/**Status:** done/' \
    -e 's/^- \[ \]/- [x]/' \
    "${ticket}" >"${ticket}.new"
  mv "${ticket}.new" "${ticket}"
}

feature_status() {
  issues_dir=$1
  found=0
  has_ready=0
  has_active=0
  has_blocked=0
  has_needs_input=0
  all_done=1
  for ticket in "${issues_dir}"/*.md; do
    [ -e "${ticket}" ] || continue
    found=1
    status=$(ticket_status "${ticket}")
    case "${status}" in
      ready-for-agent) has_ready=1; all_done=0 ;;
      in-progress) has_active=1; all_done=0 ;;
      blocked) has_blocked=1; all_done=0 ;;
      needs-input) has_needs_input=1; all_done=0 ;;
      done) ;;
      *) printf 'invalid'; return ;;
    esac
  done
  [ "${found}" = 1 ] || { printf 'empty'; return; }
  if [ "${all_done}" = 1 ]; then printf 'done'
  elif [ "${has_blocked}" = 1 ]; then printf 'blocked'
  elif [ "${has_needs_input}" = 1 ]; then printf 'needs-input'
  elif [ "${has_active}" = 1 ]; then printf 'in-progress'
  elif [ "${has_ready}" = 1 ]; then printf 'ready'
  else printf 'invalid'
  fi
}

feature_dirs() {
  [ -d "${tracker_root}" ] || return 0
  find "${tracker_root}" -mindepth 2 -maxdepth 2 -type d -name issues -print | LC_ALL=C sort
}

status_command() {
  feature_dirs | while IFS= read -r issues_dir; do
    feature=$(basename "$(dirname "${issues_dir}")")
    printf '%s: %s\n' "${feature}" "$(feature_status "${issues_dir}")"
  done
}

select_batch() {
  feature_dirs | while IFS= read -r issues_dir; do
    state=$(feature_status "${issues_dir}")
    case "${state}" in
      in-progress | ready)
        printf '%s\n' "${issues_dir}"
        break
        ;;
    esac
  done
}

claim_batch() {
  issues_dir=$1
  for ticket in "${issues_dir}"/*.md; do
    [ -e "${ticket}" ] || continue
    status=$(ticket_status "${ticket}")
    case "${status}" in
      ready-for-agent) set_ticket_status "${ticket}" in-progress ;;
      in-progress | done) ;;
      *) echo "ticket is not runnable: ${ticket} (${status})" >&2; return 1 ;;
    esac
  done
}

mark_batch() {
  issues_dir=$1
  status=$2
  for ticket in "${issues_dir}"/*.md; do
    [ -e "${ticket}" ] || continue
    [ "$(ticket_status "${ticket}")" = "done" ] || set_ticket_status "${ticket}" "${status}"
  done
}

acquire_lock() {
  mkdir -p "${runtime_root}"
  chmod 700 "${runtime_root}"
  if mkdir "${lock_dir}" 2>/dev/null; then
    printf '%s\n' "$$" >"${lock_dir}/pid"
    return
  fi
  lock_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
  if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then
    log "local Issue agent already runs as pid ${lock_pid}"
    exit 0
  fi
  rm -rf "${lock_dir}"
  mkdir "${lock_dir}"
  printf '%s\n' "$$" >"${lock_dir}/pid"
}

release_lock() {
  rm -f "${lock_dir}/pid"
  rmdir "${lock_dir}" >/dev/null 2>&1 || true
}

ticket_number() { basename "$1" | sed -n 's/^\([0-9][0-9]*\)-.*/\1/p'; }

ticket_title() {
  sed -n '1s/^# [0-9][0-9]* — //p' "$1"
}

ticket_build() {
  sed -n 's/^\*\*What to build:\*\*[[:space:]]*//p' "$1" | sed -n '1p'
}

ticket_blockers() {
  sed -n 's/^\*\*Blocked by:\*\*[[:space:]]*//p' "$1" | sed -n '1p'
}

ticket_acceptance() {
  sed -n 's/^- \[[ x]\][[:space:]]*/- [ ] /p' "$1"
}

validate_tickets() {
  issues_dir=$1
  previous_numbers=
  for ticket in "${issues_dir}"/*.md; do
    [ -e "${ticket}" ] || continue
    number=$(ticket_number "${ticket}")
    title=$(ticket_title "${ticket}")
    build=$(ticket_build "${ticket}")
    blockers=$(ticket_blockers "${ticket}")
    acceptance=$(ticket_acceptance "${ticket}")
    [ -n "${number}" ] && [ -n "${title}" ] && [ -n "${build}" ] && \
      [ -n "${blockers}" ] && [ -n "${acceptance}" ] || {
      echo "invalid local ticket: ${ticket}" >&2
      return 1
    }
    case "${blockers}" in
      None*) ;;
      *)
        blocker_numbers=$(printf '%s\n' "${blockers}" | grep -Eo '[0-9]+' || true)
        [ -n "${blocker_numbers}" ] || { echo "ticket blocker has no number: ${ticket}" >&2; return 1; }
        for blocker in ${blocker_numbers}; do
          case " ${previous_numbers} " in
            *" ${blocker} "*) ;;
            *) echo "ticket ${number} references a missing or later blocker ${blocker}" >&2; return 1 ;;
          esac
        done
        ;;
    esac
    previous_numbers="${previous_numbers} ${number}"
  done
}

prepare_worktree() {
  feature=$1
  issues_dir=$2
  batch_root=$3
  worktree=$4
  branch=$5
  base_file="${batch_root}/base-sha"
  mkdir -p "${batch_root}" "$(dirname "${worktree}")"
  if [ ! -f "${base_file}" ]; then
    base_sha=$(git -C "${primary_root}" rev-parse main)
    write_value "${base_file}" "${base_sha}"
  fi
  base_sha=$(cat "${base_file}")
  if [ ! -e "${worktree}/.git" ]; then
    git -C "${primary_root}" worktree prune
    if git -C "${primary_root}" show-ref --verify --quiet "refs/heads/${branch}"; then
      git -C "${primary_root}" worktree add "${worktree}" "${branch}"
    else
      git -C "${primary_root}" worktree add -b "${branch}" "${worktree}" "${base_sha}"
    fi
  fi
  mkdir -p "${worktree}/.scratch/${feature}"
  rm -rf "${worktree}/.scratch/${feature}/issues"
  cp -R "${issues_dir}" "${worktree}/.scratch/${feature}/issues"
}

run_implement() {
  feature=$1
  batch_root=$2
  worktree=$3
  base_sha=$4
  result_file="${batch_root}/implementation.json"
  evidence_file="${batch_root}/gate-evidence.json"
  failure_file="${batch_root}/failure.md"
  attempt=$(cat "${batch_root}/attempt" 2>/dev/null || printf 0)
  attempt=$((attempt + 1))
  write_value "${batch_root}/attempt" "${attempt}"
  rm -f "${result_file}" "${evidence_file}"
  {
    # shellcheck disable=SC2016 # prompt intentionally contains skill and Markdown literals
    printf 'Use $implement to implement the complete local ticket batch at `.scratch/%s/issues`.\n' "${feature}"
    # shellcheck disable=SC2016 # prompt intentionally contains Markdown literals
    printf 'Follow every `Blocked by` edge and satisfy every acceptance criterion in one branch and one PR.\n'
    # shellcheck disable=SC2016 # prompt intentionally contains Markdown literals
    printf 'The batch base commit is `%s`. Do not access GitHub, push, deploy, or read preview or production credentials.\n' "${base_sha}"
    printf 'Use TDD at the agreed repository seams. Run focused tests while working.\n'
    # shellcheck disable=SC2016 # prompt intentionally contains a literal command
    printf 'The single final repository gate is `ZERP_GATE_EVIDENCE_FILE=%s scripts/change-gate.sh %s`; run it once after code review and all fixes.\n' "${evidence_file}" "${base_sha}"
    printf 'Commit the completed batch to the current branch and return the required structured result.\n'
    if [ -r "${failure_file}" ]; then
      printf '\nRepair evidence from the previous attempt:\n'
      sed -n '1,240p' "${failure_file}"
    fi
  } | ZERP_ISSUE_BASE_SHA="${base_sha}" ZERP_GATE_EVIDENCE_FILE="${evidence_file}" \
    "${codex_bin}" exec --ephemeral --ignore-user-config \
      --sandbox workspace-write --ask-for-approval never \
      -c sandbox_workspace_write.network_access=false \
      -c web_search=disabled -c features.apps=false \
      -C "${worktree}" --output-schema "${schema}" -o "${result_file}" -
  [ -r "${result_file}" ] || { echo 'Codex did not return a structured result' >&2; return 1; }
  status=$(jq -r .status "${result_file}")
  case "${status}" in
    completed) ;;
    needs_input | blocked) return 3 ;;
    *) echo "invalid implementation result: ${status}" >&2; return 1 ;;
  esac
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  [ "${head_sha}" != "${base_sha}" ] || { echo 'implementation produced no commit' >&2; return 1; }
  [ -z "$(git -C "${worktree}" status --porcelain)" ] || { echo 'implementation left a dirty worktree' >&2; return 1; }
  jq -e --arg head "${head_sha}" --arg base "${base_sha}" '
    .status == "passed" and .head == $head and .base == $base and
    (.runtimeFingerprint | type == "string" and length > 0)
  ' "${evidence_file}" >/dev/null || { echo 'final gate evidence does not match the candidate commit' >&2; return 1; }
  jq -e --arg head "${head_sha}" '
    .status == "completed" and .commitSha == $head and
    .validation == "passed" and .review == "passed"
  ' "${result_file}" >/dev/null || { echo 'implementation completion evidence is incomplete' >&2; return 1; }
}

remote_for_number() {
  number=$1
  manifest=$2
  awk -F '\t' -v wanted="${number}" '$1 == wanted { print $2 "\t" $3; exit }' "${manifest}" 2>/dev/null
}

publish_issues() {
  feature=$1
  issues_dir=$2
  batch_root=$3
  manifest="${batch_root}/remote-issues.tsv"
  touch "${manifest}"
  for ticket in "${issues_dir}"/*.md; do
    number=$(ticket_number "${ticket}")
    existing=$(remote_for_number "${number}" "${manifest}")
    [ -z "${existing}" ] || continue
    title=$(ticket_title "${ticket}")
    build=$(ticket_build "${ticket}")
    blockers=$(ticket_blockers "${ticket}")
    acceptance=$(ticket_acceptance "${ticket}")
    ticket_hash=$(shasum -a 256 "${ticket}" | awk '{print $1}')
    ticket_marker="<!-- zerp-local-ticket feature=${feature} ticket=${number} hash=${ticket_hash} -->"
    issue_pages=$("${gh_bin}" api --paginate \
      "repos/${repo}/issues?state=all&per_page=100") || return 1
    recovered=$(printf '%s\n' "${issue_pages}" | jq -sc \
      --arg marker "${ticket_marker}" \
      '[.[][] | select(.pull_request == null and ((.body // "") | contains($marker)))] | last // empty')
    if [ -n "${recovered}" ]; then
      printf '%s\t%s\t%s\n' "${number}" \
        "$(printf '%s' "${recovered}" | jq -r .number)" \
        "$(printf '%s' "${recovered}" | jq -r .id)" >>"${manifest}"
      continue
    fi
    remote_blockers='None — can start immediately.'
    if ! printf '%s' "${blockers}" | grep -q '^None'; then
      remote_blockers=
      for blocker in $(printf '%s\n' "${blockers}" | grep -Eo '[0-9]+'); do
        mapped=$(remote_for_number "${blocker}" "${manifest}")
        remote_issue=$(printf '%s' "${mapped}" | cut -f1)
        [ -n "${remote_issue}" ] || { echo "remote blocker ${blocker} is missing" >&2; return 1; }
        remote_blockers="${remote_blockers}- #${remote_issue}\n"
      done
    fi
    body=$(printf '## What to build\n\n%s\n\n## Acceptance criteria\n\n%s\n\n## Blocked by\n\n%b\n<!-- zerp-local-ticket feature=%s ticket=%s hash=%s -->\n' \
      "${build}" "${acceptance}" "${remote_blockers}" "${feature}" "${number}" "${ticket_hash}")
    payload=$(jq -n --arg title "${title}" --arg body "${body}" '{title:$title,body:$body}')
    created=$(printf '%s' "${payload}" | "${gh_bin}" api --method POST "repos/${repo}/issues" --input -)
    remote_number=$(printf '%s' "${created}" | jq -r .number)
    remote_id=$(printf '%s' "${created}" | jq -r .id)
    printf '%s\t%s\t%s\n' "${number}" "${remote_number}" "${remote_id}" >>"${manifest}"
  done
  for ticket in "${issues_dir}"/*.md; do
    number=$(ticket_number "${ticket}")
    blockers=$(ticket_blockers "${ticket}")
    printf '%s' "${blockers}" | grep -q '^None' && continue
    target=$(remote_for_number "${number}" "${manifest}")
    target_number=$(printf '%s' "${target}" | cut -f1)
    for blocker in $(printf '%s\n' "${blockers}" | grep -Eo '[0-9]+'); do
      mapped=$(remote_for_number "${blocker}" "${manifest}")
      blocker_id=$(printf '%s' "${mapped}" | cut -f2)
      marker="${batch_root}/dependency-${number}-${blocker}"
      [ -f "${marker}" ] && continue
      if ! "${gh_bin}" api --method POST \
        "repos/${repo}/issues/${target_number}/dependencies/blocked_by" \
        -F "issue_id=${blocker_id}" >/dev/null; then
        dependencies=$("${gh_bin}" api --paginate \
          "repos/${repo}/issues/${target_number}/dependencies/blocked_by") || return 1
        printf '%s\n' "${dependencies}" | jq -se --argjson id "${blocker_id}" \
          'any(.[][]; .id == $id)' >/dev/null || return 1
      fi
      : >"${marker}"
    done
  done
}

publish_pr() {
  feature=$1
  batch_root=$2
  worktree=$3
  branch=$4
  preview_url=$5
  fingerprint=$6
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  manifest="${batch_root}/remote-issues.tsv"
  pr_file="${batch_root}/pr-number"
  if [ ! -f "${pr_file}" ]; then
    git -C "${worktree}" push -u origin "HEAD:refs/heads/${branch}" >/dev/null
    recovered_pr=$("${gh_bin}" pr list --repo "${repo}" --head "${branch}" --state all \
      --json number --jq '.[0].number // empty')
    if [ -n "${recovered_pr}" ]; then
      write_value "${pr_file}" "${recovered_pr}"
    fi
  fi
  if [ ! -f "${pr_file}" ]; then
    update_pr_body "${feature}" "${batch_root}" "${worktree}" "${preview_url}" "${fingerprint}"
    body_file="${batch_root}/pr-body.md"
    title=$(printf '%s' "${feature}" | tr '-' ' ')
    pr_url=$("${gh_bin}" pr create --repo "${repo}" --base main --head "${branch}" \
      --title "${title}" --body-file "${body_file}")
    pr=$(printf '%s' "${pr_url}" | sed -n 's#.*/pull/\([0-9][0-9]*\).*#\1#p')
    [ -n "${pr}" ] || { echo "could not parse PR number from ${pr_url}" >&2; return 1; }
    write_value "${pr_file}" "${pr}"
  fi
  pr=$(cat "${pr_file}")
  printf '%s\n' "${pr}"
}

close_remote_issues() {
  manifest=$1
  tab=$(printf '\t')
  while IFS="${tab}" read -r _ remote_number _; do
    "${gh_bin}" issue close "${remote_number}" --repo "${repo}" \
      --comment '批次 PR 已合并，生产发布与公网健康验证成功。' >/dev/null
  done <"${manifest}"
}

release_preview() {
  feature=$1
  "${preview_close_command}" close "${feature}" >/dev/null 2>&1 || true
}

deploy_preview() {
  feature=$1
  batch_root=$2
  worktree=$3
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  preview_output="${batch_root}/preview.env.new"
  if ! ZERP_ISSUE_WORKTREE="${worktree}" \
    "${preview_command}" "${feature}" "${head_sha}" >"${preview_output}"; then
    rm -f "${preview_output}"
    printf 'Public preview failed for candidate %s.\n' "${head_sha}" >"${batch_root}/failure.md"
    return 1
  fi
  preview_url=$(sed -n 's/^url=//p' "${preview_output}")
  fingerprint=$(sed -n 's/^fingerprint=//p' "${preview_output}")
  expected=$(jq -r .runtimeFingerprint "${batch_root}/gate-evidence.json")
  if [ -z "${preview_url}" ] || [ "${fingerprint}" != "${expected}" ]; then
    rm -f "${preview_output}"
    printf 'Preview evidence fingerprint %s does not match gate fingerprint %s.\n' \
      "${fingerprint:-missing}" "${expected}" >"${batch_root}/failure.md"
    return 1
  fi
  mv "${preview_output}" "${batch_root}/preview.env"
}

implement_and_preview() {
  feature=$1
  batch_root=$2
  worktree=$3
  base_sha=$4
  issues_dir=$5
  while [ "$(cat "${batch_root}/attempt" 2>/dev/null || printf 0)" -lt 3 ]; do
    if run_implement "${feature}" "${batch_root}" "${worktree}" "${base_sha}"; then
      if deploy_preview "${feature}" "${batch_root}" "${worktree}"; then
        rm -f "${batch_root}/failure.md"
        return 0
      fi
    else
      result=$?
      if [ "${result}" = 3 ] && [ -r "${batch_root}/implementation.json" ]; then
        status=$(jq -r .status "${batch_root}/implementation.json")
        case "${status}" in needs_input) status=needs-input ;; esac
        mark_batch "${issues_dir}" "${status}"
        return 1
      fi
      printf 'Implementation, review, or final gate failed on attempt %s.\n' \
        "$(cat "${batch_root}/attempt")" >"${batch_root}/failure.md"
    fi
  done
  mark_batch "${issues_dir}" blocked
  write_value "${batch_root}/state" blocked
  return 1
}

refresh_main() {
  feature=$1
  batch_root=$2
  worktree=$3
  issues_dir=$4
  base_sha=$(cat "${batch_root}/base-sha")
  git -C "${primary_root}" fetch origin main --prune
  current_main=$(git -C "${primary_root}" rev-parse origin/main)
  [ "${current_main}" != "${base_sha}" ] || return 0

  old_fingerprint=$(sed -n 's/^fingerprint=//p' "${batch_root}/preview.env")
  if git -C "${worktree}" rebase "${current_main}"; then
    write_value "${batch_root}/base-sha" "${current_main}"
    new_head=$(git -C "${worktree}" rev-parse HEAD)
    new_fingerprint=$(ZERP_FINGERPRINT_REPO_ROOT="${worktree}" \
      "${script_dir}/runtime-fingerprint.sh" "${new_head}")
    if [ "${new_fingerprint}" = "${old_fingerprint}" ]; then
      jq --arg head "${new_head}" --arg base "${current_main}" \
        '.head = $head | .base = $base' "${batch_root}/gate-evidence.json" \
        >"${batch_root}/gate-evidence.json.new"
      mv "${batch_root}/gate-evidence.json.new" "${batch_root}/gate-evidence.json"
      return 0
    fi
  else
    git -C "${worktree}" rebase --abort >/dev/null 2>&1 || true
    printf 'Rebase onto current origin/main %s conflicted. Resolve the rebase and revalidate the whole batch.\n' \
      "${current_main}" >"${batch_root}/failure.md"
  fi

  write_value "${batch_root}/base-sha" "${current_main}"
  rm -f "${batch_root}/preview.env"
  implement_and_preview "${feature}" "${batch_root}" "${worktree}" "${current_main}" "${issues_dir}"
}

update_pr_body() {
  feature=$1
  batch_root=$2
  worktree=$3
  preview_url=$4
  fingerprint=$5
  body_file="${batch_root}/pr-body.md"
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  {
    echo '## Tickets'
    echo
    tab=$(printf '\t')
    while IFS="${tab}" read -r _ remote_number _; do printf 'Refs #%s\n' "${remote_number}"; done \
      <"${batch_root}/remote-issues.tsv"
    echo
    echo '## Verified preview'
    echo
    printf '%s\n\n' "${preview_url}"
    # shellcheck disable=SC2016 # PR body intentionally contains Markdown literals
    printf 'Local preview commit: `%s`\n\n' "${head_sha}"
    printf '<!-- zerp-local-batch feature=%s head=%s fingerprint=%s -->\n' \
      "${feature}" "${head_sha}" "${fingerprint}"
  } >"${body_file}"
}

wait_checks_and_merge() {
  feature=$1
  batch_root=$2
  worktree=$3
  issues_dir=$4
  branch=$5
  pr=$6
  while :; do
    if "${gh_bin}" pr checks "${pr}" --repo "${repo}" --watch --required \
      >"${batch_root}/checks.log" 2>&1; then
      break
    fi
    if [ "$(cat "${batch_root}/attempt" 2>/dev/null || printf 0)" -ge 3 ]; then
      mark_batch "${issues_dir}" blocked
      write_value "${batch_root}/state" blocked
      release_preview "${feature}"
      return 1
    fi
    {
      printf 'GitHub required checks failed for PR #%s.\n\n' "${pr}"
      sed -n '1,240p' "${batch_root}/checks.log"
    } >"${batch_root}/failure.md"
    previous_head=$(git -C "${worktree}" rev-parse HEAD)
    if ! refresh_main "${feature}" "${batch_root}" "${worktree}" "${issues_dir}"; then
      release_preview "${feature}"
      return 1
    fi
    current_head=$(git -C "${worktree}" rev-parse HEAD)
    if [ "${current_head}" != "${previous_head}" ]; then
      preview_url=$(sed -n 's/^url=//p' "${batch_root}/preview.env")
      fingerprint=$(sed -n 's/^fingerprint=//p' "${batch_root}/preview.env")
      update_pr_body "${feature}" "${batch_root}" "${worktree}" "${preview_url}" "${fingerprint}"
      git -C "${worktree}" push origin "HEAD:refs/heads/${branch}" >/dev/null
      "${gh_bin}" pr edit "${pr}" --repo "${repo}" --body-file "${batch_root}/pr-body.md" >/dev/null
      continue
    fi
    base_sha=$(cat "${batch_root}/base-sha")
    if run_implement "${feature}" "${batch_root}" "${worktree}" "${base_sha}"; then
      :
    else
      result=$?
      if [ "${result}" = 3 ] && [ -r "${batch_root}/implementation.json" ]; then
        status=$(jq -r .status "${batch_root}/implementation.json")
        case "${status}" in needs_input) status=needs-input ;; esac
        mark_batch "${issues_dir}" "${status}"
        write_value "${batch_root}/state" "${status}"
        release_preview "${feature}"
        return 1
      fi
      continue
    fi
    old_fingerprint=$(sed -n 's/^fingerprint=//p' "${batch_root}/preview.env")
    new_fingerprint=$(jq -r .runtimeFingerprint "${batch_root}/gate-evidence.json")
    if [ "${new_fingerprint}" != "${old_fingerprint}" ]; then
      deploy_preview "${feature}" "${batch_root}" "${worktree}" || continue
    fi
    preview_url=$(sed -n 's/^url=//p' "${batch_root}/preview.env")
    update_pr_body "${feature}" "${batch_root}" "${worktree}" "${preview_url}" "${new_fingerprint}"
    git -C "${worktree}" push origin "HEAD:refs/heads/${branch}" >/dev/null
    "${gh_bin}" pr edit "${pr}" --repo "${repo}" --body-file "${batch_root}/pr-body.md" >/dev/null
  done
  "${gh_bin}" pr merge "${pr}" --repo "${repo}" --auto --squash --delete-branch >/dev/null || return 1
  attempts=${ZERP_ISSUE_MERGE_WAIT_ATTEMPTS:-120}
  delay=${ZERP_ISSUE_MERGE_WAIT_SECONDS:-5}
  while [ "${attempts}" -gt 0 ]; do
    pr_json=$("${gh_bin}" pr view "${pr}" --repo "${repo}" --json state,mergeCommit) || return 1
    merge_sha=$(printf '%s' "${pr_json}" | jq -r '.mergeCommit.oid // ""')
    if [ "$(printf '%s' "${pr_json}" | jq -r .state)" = MERGED ] && [ -n "${merge_sha}" ]; then
      printf '%s\n' "${merge_sha}"
      return 0
    fi
    sleep "${delay}"
    attempts=$((attempts - 1))
  done
  return 1
}

run_batch() {
  issues_dir=$1
  feature=$(basename "$(dirname "${issues_dir}")")
  batch_root="${runtime_root}/batches/${feature}"
  worktree="${runtime_root}/worktrees/${feature}"
  branch="automation/local-${feature}"
  mkdir -p "${batch_root}"
  validate_tickets "${issues_dir}"
  claim_batch "${issues_dir}"
  prepare_worktree "${feature}" "${issues_dir}" "${batch_root}" "${worktree}" "${branch}"
  base_sha=$(cat "${batch_root}/base-sha")

  if [ ! -f "${batch_root}/preview.env" ]; then
    if ! implement_and_preview "${feature}" "${batch_root}" "${worktree}" "${base_sha}" "${issues_dir}"; then
      release_preview "${feature}"
      return 1
    fi
  fi

  # Remote operations begin only after the complete local batch and public preview passed.
  preview_url=$(sed -n 's/^url=//p' "${batch_root}/preview.env")
  fingerprint=$(sed -n 's/^fingerprint=//p' "${batch_root}/preview.env")
  if ! refresh_main "${feature}" "${batch_root}" "${worktree}" "${issues_dir}"; then
    release_preview "${feature}"
    return 1
  fi
  preview_url=$(sed -n 's/^url=//p' "${batch_root}/preview.env")
  fingerprint=$(sed -n 's/^fingerprint=//p' "${batch_root}/preview.env")
  publish_issues "${feature}" "${issues_dir}" "${batch_root}"
  pr=$(publish_pr "${feature}" "${batch_root}" "${worktree}" "${branch}" "${preview_url}" "${fingerprint}")
  if ! merge_sha=$(wait_checks_and_merge "${feature}" "${batch_root}" "${worktree}" \
    "${issues_dir}" "${branch}" "${pr}"); then
    mark_batch "${issues_dir}" blocked
    write_value "${batch_root}/state" blocked
    return 1
  fi
  if ! "${production_command}" "${pr}" "${merge_sha}" >"${batch_root}/production.env"; then
    mark_batch "${issues_dir}" blocked
    write_value "${batch_root}/state" production-blocked
    : >"${runtime_root}/disabled"
    "${gh_bin}" pr comment "${pr}" --repo "${repo}" \
      --body "生产提交 \`${merge_sha}\` 验证失败；后续本地批次已暂停，未执行数据库回滚或恢复动作。" >/dev/null || true
    return 1
  fi
  close_remote_issues "${batch_root}/remote-issues.tsv"
  for ticket in "${issues_dir}"/*.md; do complete_ticket "${ticket}"; done
  write_value "${batch_root}/state" "done"
  release_preview "${feature}"
  log "local ticket batch ${feature} reached verified production through PR #${pr}"
}

run_command() {
  [ ! -f "${runtime_root}/disabled" ] || { log 'local Issue delivery is stopped'; return 0; }
  [ "$("${codex_bin}" login status 2>/dev/null || true)" = 'Logged in using ChatGPT' ] || {
    log 'Codex must be logged in with ChatGPT'
    return 0
  }
  acquire_lock
  trap release_lock EXIT HUP INT TERM
  issues_dir=$(select_batch)
  [ -n "${issues_dir}" ] || return 0
  run_batch "${issues_dir}"
}

retry_command() {
  feature=${1:?feature is required}
  issues_dir="${tracker_root}/${feature}/issues"
  [ -d "${issues_dir}" ] || { echo "unknown feature: ${feature}" >&2; exit 2; }
  [ ! -f "${runtime_root}/batches/${feature}/pr-number" ] || {
    echo "published batch ${feature} cannot be reset locally" >&2
    exit 1
  }
  mark_batch "${issues_dir}" ready-for-agent
  release_preview "${feature}"
  rm -f "${runtime_root}/batches/${feature}/failure.md" \
    "${runtime_root}/batches/${feature}/preview.env" \
    "${runtime_root}/batches/${feature}/attempt" \
    "${runtime_root}/batches/${feature}/implementation.json" \
    "${runtime_root}/batches/${feature}/gate-evidence.json" \
    "${runtime_root}/batches/${feature}/state"
}

mkdir -p "${runtime_root}"
case "${1:-}" in
  run) [ "$#" -eq 1 ] || usage; run_command ;;
  status) [ "$#" -eq 1 ] || usage; status_command ;;
  retry) [ "$#" -eq 2 ] || usage; retry_command "$2" ;;
  stop) [ "$#" -eq 1 ] || usage; : >"${runtime_root}/disabled" ;;
  start) [ "$#" -eq 1 ] || usage; rm -f "${runtime_root}/disabled" ;;
  *) usage ;;
esac
