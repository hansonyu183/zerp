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
gate_command=${ZERP_ISSUE_GATE_COMMAND:-}
focused_e2e_command=${ZERP_ISSUE_FOCUSED_E2E_COMMAND:-}
focused_integration_command=${ZERP_ISSUE_FOCUSED_INTEGRATION_COMMAND:-}
osascript_bin=${ZERP_OSASCRIPT_BIN:-osascript}
pgrep_bin=${ZERP_PGREP_BIN:-pgrep}
schema=${ZERP_ISSUE_RESULT_SCHEMA:-${repo_root}/.github/automation/schemas/local-implementation-output.json}
lock_dir="${runtime_root}/agent.lock"
controller_path="${script_dir}/$(basename -- "$0")"

usage() {
  echo "usage: $0 {run|status|diagnose <feature>|retry <feature>|stop|start}" >&2
  exit 2
}

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }

write_value() {
  destination=$1
  value=$2
  printf '%s\n' "${value}" >"${destination}.new"
  mv "${destination}.new" "${destination}"
}

valid_failure_class() {
  case "${1:-}" in
    product | test-flake | environment | external | automation) return 0 ;;
    *) return 1 ;;
  esac
}

append_timeline() {
  batch_root=$1
  event=$2
  phase=$3
  failure_class=${4:-}
  stage=${5:-}
  head=${6:-}
  summary=${7:-}
  timeline_file="${batch_root}/timeline.jsonl"
  mkdir -p "${batch_root}"
  jq -nc \
    --arg at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --arg event "${event}" --arg phase "${phase}" \
    --arg class "${failure_class}" --arg stage "${stage}" \
    --arg head "${head}" --arg summary "${summary}" \
    '{at:$at,event:$event,phase:$phase} +
      (if $class == "" then {} else {failureClass:$class} end) +
      (if $stage == "" then {} else {stage:$stage} end) +
      (if $head == "" then {} else {head:$head} end) +
      (if $summary == "" then {} else {summary:$summary} end)' \
    >>"${timeline_file}"
  chmod 600 "${timeline_file}"
}

set_batch_phase() {
  batch_root=$1
  phase=$2
  write_value "${batch_root}/phase" "${phase}"
  append_timeline "${batch_root}" phase "${phase}"
}

stable_failure_signal() {
  failure_file=$1
  signal=$(grep -E '^(Failed stage:|Packages:|Target:)|FAIL|Error|error:|SC[0-9]{4}|expected|simulated' \
    "${failure_file}" 2>/dev/null | head -n 12 || true)
  if [ -z "${signal}" ]; then
    signal=$(sed -n '1,12p' "${failure_file}" 2>/dev/null || true)
  fi
  printf '%s\n' "${signal}" | sed -E \
    -e 's/[0-9a-f]{40}/<sha>/g' \
    -e 's#/[A-Za-z0-9._/-]*/backend/var/issue-delivery/#<runtime>/#g' \
    -e 's/[[:space:]][[:space:]]*/ /g' \
    -e 's/[0-9]+\.[0-9]+(ms|s)/<duration>/g' \
    -e 's/([Ff]ailure|[Aa]ttempt|[Rr]etry|stdout|line) [0-9]+/\1 <n>/g'
}

archive_failure() {
  batch_root=$1
  timeline_file="${batch_root}/timeline.jsonl"
  event_number=$(( $(wc -l <"${timeline_file}" 2>/dev/null || printf 0) + 1 ))
  attempt_dir=$(printf '%s/attempts/%03d' "${batch_root}" "${event_number}")
  mkdir -p "${attempt_dir}"
  cp "${batch_root}/failure.md" "${attempt_dir}/failure.md"
  cp "${batch_root}/failure.json" "${attempt_dir}/failure.json"
  chmod 700 "${batch_root}/attempts" "${attempt_dir}"
  chmod 600 "${attempt_dir}/failure.md" "${attempt_dir}/failure.json"
}

write_structured_failure() {
  batch_root=$1
  failure_class=$2
  stage=$3
  head=$4
  source=$5
  summary=$6
  valid_failure_class "${failure_class}" || return 1
  signal=$(stable_failure_signal "${batch_root}/failure.md")
  signature=$(printf 'class=%s\nstage=%s\nsignal=%s\n' \
    "${failure_class}" "${stage}" "${signal}" | shasum -a 256 | awk '{print $1}')
  jq -n --arg class "${failure_class}" --arg stage "${stage}" \
    --arg head "${head}" --arg source "${source}" --arg summary "${summary}" \
    --arg signature "${signature}" \
    '{version:1,failureClass:$class,stage:$stage,head:$head,source:$source,summary:$summary,signature:$signature}' \
    >"${batch_root}/failure.json.new"
  mv "${batch_root}/failure.json.new" "${batch_root}/failure.json"
  append_timeline "${batch_root}" failure "${source}" "${failure_class}" \
    "${stage}" "${head}" "${summary}"
  archive_failure "${batch_root}"
}

failure_field() {
  batch_root=$1
  field=$2
  jq -r --arg field "${field}" '.[$field] // empty' \
    "${batch_root}/failure.json" 2>/dev/null || true
}

message_recipient() {
  if [ "${ZERP_ISSUE_MESSAGE_RECIPIENT+x}" = x ]; then
    printf '%s' "${ZERP_ISSUE_MESSAGE_RECIPIENT}"
  elif [ -r "${runtime_root}/message-recipient" ]; then
    cat "${runtime_root}/message-recipient"
  fi
}

valid_message_recipient() {
  [ -n "${1:-}" ] || return 1
  case "$1" in *'
'*) return 1 ;; esac
  ! printf '%s' "$1" | LC_ALL=C grep -q '[[:cntrl:]]'
}

wait_for_notification_process() {
  process_pid=$1
  timeout_seconds=$2
  elapsed_seconds=0
  while kill -0 "${process_pid}" >/dev/null 2>&1; do
    if [ "${elapsed_seconds}" -ge "${timeout_seconds}" ]; then
      kill "${process_pid}" >/dev/null 2>&1 || true
      wait "${process_pid}" >/dev/null 2>&1 || true
      return 1
    fi
    sleep 1
    elapsed_seconds=$((elapsed_seconds + 1))
  done
  wait "${process_pid}" >/dev/null 2>&1
}

notify_batch_event() {
  batch_root=$1
  state=$2
  feature=$(basename "${batch_root}")
  worktree="${runtime_root}/worktrees/${feature}"
  recipient=$(message_recipient)
  valid_message_recipient "${recipient}" || return 0

  head=$(git -C "${worktree}" rev-parse HEAD 2>/dev/null || cat "${batch_root}/base-sha" 2>/dev/null || true)
  case "${head}" in '' | *[!0-9a-f]*) head=unknown ;; esac
  [ "${#head}" -eq 40 ] || head=unknown
  pr=$(cat "${batch_root}/pr-number" 2>/dev/null || printf '-')
  case "${pr}" in '' | *[!0-9]*) pr=- ;; esac
  budget_file=$(repair_budget_file "${batch_root}")
  total=$(jq -r '.total // 0' "${budget_file}" 2>/dev/null || printf 0)
  consecutive=$(jq -r '.consecutive // 0' "${budget_file}" 2>/dev/null || printf 0)
  failure_class=$(failure_field "${batch_root}" failureClass)
  failure_stage=$(failure_field "${batch_root}" stage)
  key=$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' \
    "${feature}" "${state}" "${head}" "${pr}" "${total}" "${consecutive}" \
    "${failure_class}" "${failure_stage}")
  notification_file="${runtime_root}/message-notifications.tsv"
  if [ -r "${notification_file}" ] && grep -Fqx "${key}" "${notification_file}"; then
    return 0
  fi

  case "${state}" in
    in-progress) title='批次开始执行' ;;
    pr-open) title='PR 已创建，已进入 CI' ;;
    blocked) title='需要关注：批次已阻塞' ;;
    automation-blocked) title='需要关注：自动化控制器已阻塞' ;;
    environment-blocked) title='需要关注：宿主环境已阻塞' ;;
    external-blocked) title='需要关注：外部服务已阻塞' ;;
    preview-blocked) title='需要关注：预览已阻塞' ;;
    production-blocked) title='需要关注：生产验证已阻塞' ;;
    needs-input) title='需要关注：需要人工输入' ;;
    done) title='批次已完成' ;;
    *) return 0 ;;
  esac
  repairs=$((total > 0 ? total - 1 : 0))
  body=$(printf 'ZERP 本地 Issue 自动交付\n%s\n批次=%s\n状态=%s\n阶段=%s\n失败分类=%s\nhead=%s\nPR=%s\n代码尝试=%s，修复次数=%s，连续同错=%s' \
    "${title}" "${feature}" "${state}" "${failure_stage:--}" \
    "${failure_class:--}" "${head}" "${pr}" "${total}" "${repairs}" "${consecutive}")
  messages_was_running=0
  if "${pgrep_bin}" -x Messages >/dev/null 2>&1; then
    messages_was_running=1
  fi
  notify_result=0
  timeout_seconds=${ZERP_ISSUE_MESSAGE_TIMEOUT_SECONDS:-10}
  case "${timeout_seconds}" in '' | *[!0-9]*) timeout_seconds=10 ;; esac
  ZERP_ISSUE_MESSAGE_RECIPIENT="${recipient}" \
    ZERP_ISSUE_MESSAGE_BODY="${body}" \
    "${osascript_bin}" - >/dev/null 2>&1 <<'APPLESCRIPT' &
on run argv
  set recipient to system attribute "ZERP_ISSUE_MESSAGE_RECIPIENT"
  set messageBody to system attribute "ZERP_ISSUE_MESSAGE_BODY"
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    send messageBody to buddy recipient of targetService
  end tell
end run
APPLESCRIPT
  osascript_pid=$!
  wait_for_notification_process "${osascript_pid}" "${timeout_seconds}" || notify_result=1
  if [ "${messages_was_running}" = 0 ] && "${pgrep_bin}" -x Messages >/dev/null 2>&1; then
    "${osascript_bin}" -e 'tell application "Messages" to quit' >/dev/null 2>&1 || true
  fi
  if [ "${notify_result}" -ne 0 ]; then
    ZERP_ISSUE_NOTIFICATION_TITLE="${title}" \
      ZERP_ISSUE_MESSAGE_BODY="${body}" \
      "${osascript_bin}" - >/dev/null 2>&1 <<'APPLESCRIPT' &
on run argv
  set notificationTitle to system attribute "ZERP_ISSUE_NOTIFICATION_TITLE"
  set messageBody to system attribute "ZERP_ISSUE_MESSAGE_BODY"
  display notification messageBody with title notificationTitle
end run
APPLESCRIPT
    fallback_pid=$!
    if wait_for_notification_process "${fallback_pid}" "${timeout_seconds}"; then
      log "local iMessage notification failed; macOS fallback delivered (feature=${feature} state=${state})"
    else
      log "local iMessage and macOS fallback notifications failed (feature=${feature} state=${state})"
      return 0
    fi
  fi
  mkdir -p "${runtime_root}"
  chmod 700 "${runtime_root}"
  printf '%s\n' "${key}" >>"${notification_file}"
  chmod 600 "${notification_file}"
}

reconcile_batch_notifications() {
  [ -d "${runtime_root}/batches" ] || return 0
  for state_file in "${runtime_root}"/batches/*/state; do
    [ -r "${state_file}" ] || continue
    state=$(cat "${state_file}")
    case "${state}" in
      blocked | automation-blocked | environment-blocked | external-blocked | preview-blocked | production-blocked | needs-input | done)
        notify_batch_event "$(dirname "${state_file}")" "${state}"
        ;;
    esac
  done
}

set_batch_state() {
  batch_root=$1
  state=$2
  write_value "${batch_root}/state" "${state}"
  write_value "${batch_root}/phase" "${state}"
  append_timeline "${batch_root}" state "${state}"
  notify_batch_event "${batch_root}" "${state}"
}

repair_budget_file() {
  printf '%s\n' "$1/repair-budget.json"
}

ensure_repair_budget() {
  batch_root=$1
  budget_file=$(repair_budget_file "${batch_root}")
  if [ ! -e "${budget_file}" ]; then
    jq -n --arg started_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
      --argjson started_at_epoch "$(date +%s)" \
      '{version: 2, startedAt: $started_at, startedAtEpoch: $started_at_epoch,
      total: 0, lastStage: null,
      lastFingerprint: null, consecutive: 0, events: [], recoveries: [],
      nonProductEvents: []}' \
      >"${budget_file}.new"
    mv "${budget_file}.new" "${budget_file}"
  fi
  if [ "$(jq -r '.version // empty' "${budget_file}" 2>/dev/null || true)" = 1 ]; then
    jq --arg started_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" '
      .version = 2 |
      .startedAt = (.startedAt // $started_at) |
      .startedAtEpoch = (.startedAtEpoch // (now | floor)) |
      .nonProductEvents = (.nonProductEvents // [])
    ' "${budget_file}" >"${budget_file}.new" || {
      rm -f "${budget_file}.new"
      return 1
    }
    mv "${budget_file}.new" "${budget_file}"
  fi
  jq -e '
    . as $budget |
    .version == 2 and
    (.startedAt | type == "string" and length > 0) and
    (.startedAtEpoch | type == "number" and floor == . and . >= 0) and
    (.total | type == "number" and floor == . and . >= 0) and
    ((.lastStage == null) or (.lastStage | type == "string")) and
    ((.lastFingerprint == null) or (.lastFingerprint | type == "string")) and
    (.consecutive | type == "number" and floor == . and . >= 0) and
    (.events | type == "array" and length == $budget.total) and
    all(.events[]; (
      (.sequence | type == "number" and floor == . and . >= 1) and
      (.stage | type == "string") and
      ((.candidateHead == null) or (.candidateHead | type == "string"))
    )) and
    (.nonProductEvents | type == "array") and
    all(.nonProductEvents[]; (
      (.failureClass == "test-flake" or .failureClass == "environment" or
        .failureClass == "external" or .failureClass == "automation") and
      (.stage | type == "string") and
      (.signature | type == "string" and length == 64) and
      ((.candidateHead == null) or (.candidateHead | type == "string"))
    )) and
    (.recoveries | type == "array") and
    all(.recoveries[]; (
      (.atTotal | type == "number" and floor == . and . >= 0) and
      ((.previousStage == null) or (.previousStage | type == "string")) and
      ((.previousFingerprint == null) or (.previousFingerprint | type == "string")) and
      (.previousConsecutive | type == "number" and floor == . and . >= 1) and
      ((.candidateHead == null) or (.candidateHead | type == "string")) and
      ((.consumed == null) or (.consumed | type == "boolean"))
    ))
  ' "${budget_file}" >/dev/null
}

acknowledge_manual_retry() {
  batch_root=$1
  candidate_head=$2
  ensure_repair_budget "${batch_root}" || return 1
  budget_file=$(repair_budget_file "${batch_root}")
  consecutive=$(jq -r .consecutive "${budget_file}")
  [ "${consecutive}" -gt 0 ] || return 0
  failed_head=$(jq -r '.events[-1].candidateHead // empty' "${budget_file}")
  case "${failed_head}" in '' | *[!0-9a-f]*) failed_head= ;; esac
  [ "${#failed_head}" -eq 40 ] || failed_head=
  case "${candidate_head}" in '' | *[!0-9a-f]*) candidate_head= ;; esac
  [ "${#candidate_head}" -eq 40 ] || candidate_head=
  [ -n "${failed_head}" ] && [ -n "${candidate_head}" ] &&
    [ "${failed_head}" != "${candidate_head}" ] || return 0
  jq --arg candidate_head "${candidate_head}" '
    .recoveries += [{
      atTotal: .total,
      previousStage: .lastStage,
      previousFingerprint: .lastFingerprint,
      previousConsecutive: .consecutive,
      candidateHead: (if $candidate_head == "" then null else $candidate_head end),
      consumed: false
    }] |
    .lastStage = null |
    .lastFingerprint = null |
    .consecutive = 0
  ' "${budget_file}" >"${budget_file}.new"
  mv "${budget_file}.new" "${budget_file}"
}

consume_repair_budget() {
  batch_root=$1
  stage=$2
  candidate_head=${3:-}
  case "${stage}" in code-review-gate | gate) ;; *) return 1 ;; esac
  ensure_repair_budget "${batch_root}" || return 1
  budget_file=$(repair_budget_file "${batch_root}")
  total=$(jq -r .total "${budget_file}")
  consecutive=$(jq -r .consecutive "${budget_file}")
  # One initial implementation attempt plus at most eight automatic repair
  # attempts. A clean manual commit acknowledged by an explicit retry unlocks
  # exactly one additional reviewed attempt and remains visible in the audit.
  manual_recovery=0
  if jq -e --arg candidate_head "${candidate_head}" '
    ((.recoveries | last) // {}) as $recovery |
    ($candidate_head | length) == 40 and
    $recovery.candidateHead == $candidate_head and
    ($recovery.consumed // false) == false
  ' "${budget_file}" >/dev/null; then
    manual_recovery=1
  fi
  [ "${total}" -lt 9 ] || [ "${manual_recovery}" = 1 ] || return 2
  [ "${consecutive}" -lt 2 ] || return 3
  jq --arg stage "${stage}" --arg candidate_head "${candidate_head}" \
    --argjson manual_recovery "${manual_recovery}" '
    (.total + 1) as $total |
    .total = $total |
    .events += [{sequence: $total, stage: $stage,
      candidateHead:(if $candidate_head == "" then null else $candidate_head end),
      manualRecovery:($manual_recovery == 1)}] |
    if $manual_recovery == 1 then
      .recoveries[-1].consumed = true
    else . end
  ' "${budget_file}" >"${budget_file}.new"
  mv "${budget_file}.new" "${budget_file}"
}

normalized_failure_fingerprint() {
  stage=$1
  failure_file=$2
  failure_json="$(dirname "${failure_file}")/failure.json"
  if [ -r "${failure_json}" ] &&
    [ "$(jq -r '.failureClass // empty' "${failure_json}" 2>/dev/null || true)" = product ]; then
    jq -r '.signature' "${failure_json}"
    return
  fi
  {
    printf 'stage=%s\n' "${stage}"
    sed \
      -e '/^Host final gate failed for candidate /d' \
      -e '/^Full log: /d' \
      -e '/^Focused error excerpt:/d' \
      -e 's/[[:space:]][[:space:]]*/ /g' \
      "${failure_file}"
  } | shasum -a 256 | awk '{print $1}'
}

cancel_repair_budget_reservation() {
  batch_root=$1
  ensure_repair_budget "${batch_root}" || return 1
  budget_file=$(repair_budget_file "${batch_root}")
  jq '
    if .total > 0 and ((.events[-1].failureFingerprint // null) == null) then
      if (.events[-1].manualRecovery // false) == true then
        .recoveries[-1].consumed = false
      else . end |
      .events = .events[:-1] |
      .total -= 1
    else error("latest code attempt is already finalized") end
  ' "${budget_file}" >"${budget_file}.new" || {
    rm -f "${budget_file}.new"
    return 1
  }
  mv "${budget_file}.new" "${budget_file}"
}

non_product_retry_limit() {
  case "$1" in
    test-flake) printf '%s\n' "${ZERP_ISSUE_FLAKE_RETRY_LIMIT:-2}" ;;
    environment) printf '%s\n' "${ZERP_ISSUE_ENVIRONMENT_RETRY_LIMIT:-3}" ;;
    external) printf '%s\n' "${ZERP_ISSUE_EXTERNAL_RETRY_LIMIT:-6}" ;;
    automation) printf '%s\n' "${ZERP_ISSUE_AUTOMATION_RETRY_LIMIT:-2}" ;;
    *) return 1 ;;
  esac
}

record_non_product_failure() {
  batch_root=$1
  failure_class=$2
  stage=$3
  candidate_head=${4:-}
  valid_failure_class "${failure_class}" || return 1
  [ "${failure_class}" != product ] || return 1
  ensure_repair_budget "${batch_root}" || return 1
  signature=$(failure_field "${batch_root}" signature)
  [ "${#signature}" -eq 64 ] || return 1
  limit=$(non_product_retry_limit "${failure_class}") || return 1
  case "${limit}" in '' | *[!0-9]*) return 1 ;; esac
  [ "${limit}" -gt 0 ] || return 1
  stage_limit=${ZERP_ISSUE_NON_PRODUCT_STAGE_RETRY_LIMIT:-8}
  batch_limit=${ZERP_ISSUE_NON_PRODUCT_BATCH_RETRY_LIMIT:-15}
  deadline_seconds=${ZERP_ISSUE_BATCH_DEADLINE_SECONDS:-1200}
  for numeric_limit in "${stage_limit}" "${batch_limit}" "${deadline_seconds}"; do
    case "${numeric_limit}" in '' | *[!0-9]*) return 1 ;; esac
  done
  [ "${stage_limit}" -gt 0 ] && [ "${batch_limit}" -gt 0 ] || return 1
  budget_file=$(repair_budget_file "${batch_root}")
  now_epoch=$(date +%s)
  jq --arg class "${failure_class}" --arg stage "${stage}" \
    --arg signature "${signature}" --arg candidate_head "${candidate_head}" \
    --argjson at_epoch "${now_epoch}" '
    .nonProductEvents += [{
      failureClass:$class,
      stage:$stage,
      signature:$signature,
      candidateHead:(if $candidate_head == "" then null else $candidate_head end),
      atEpoch:$at_epoch
    }]
  ' "${budget_file}" >"${budget_file}.new"
  mv "${budget_file}.new" "${budget_file}"
  count=$(jq -r --arg class "${failure_class}" --arg signature "${signature}" \
    '[.nonProductEvents[] | select(.failureClass == $class and .signature == $signature)] | length' \
    "${budget_file}")
  stage_count=$(jq -r --arg stage "${stage}" \
    '[.nonProductEvents[] | select(.stage == $stage)] | length' "${budget_file}")
  batch_count=$(jq -r '.nonProductEvents | length' "${budget_file}")
  started_at_epoch=$(jq -r .startedAtEpoch "${budget_file}")
  elapsed_seconds=$((now_epoch - started_at_epoch))
  exhausted=
  if [ "${count}" -ge "${limit}" ]; then exhausted='same-signature'
  elif [ "${stage_count}" -ge "${stage_limit}" ]; then exhausted='stage-total'
  elif [ "${batch_count}" -ge "${batch_limit}" ]; then exhausted='batch-total'
  elif [ "${elapsed_seconds}" -ge "${deadline_seconds}" ]; then exhausted='deadline'
  fi
  jq --argjson signature_count "${count}" --argjson signature_limit "${limit}" \
    --argjson stage_count "${stage_count}" --argjson stage_limit "${stage_limit}" \
    --argjson batch_count "${batch_count}" --argjson batch_limit "${batch_limit}" \
    --argjson elapsed "${elapsed_seconds}" --argjson deadline "${deadline_seconds}" \
    --arg exhausted "${exhausted}" '
    .retryBudget = {
      sameSignatureCount:$signature_count,sameSignatureLimit:$signature_limit,
      stageCount:$stage_count,stageLimit:$stage_limit,
      batchCount:$batch_count,batchLimit:$batch_limit,
      elapsedSeconds:$elapsed,deadlineSeconds:$deadline,
      exhausted:(if $exhausted == "" then null else $exhausted end)
    }
  ' "${batch_root}/failure.json" >"${batch_root}/failure.json.new" || return 1
  mv "${batch_root}/failure.json.new" "${batch_root}/failure.json"
  if [ -n "${exhausted}" ]; then
    append_timeline "${batch_root}" retry-budget-exhausted "${stage}" \
      "${failure_class}" "${stage}" "${candidate_head}" "${exhausted}"
    return 1
  fi
}

write_failure_policy_decision() {
  batch_root=$1
  decision=$2
  jq --arg decision "${decision}" '.policyDecision = $decision' \
    "${batch_root}/failure.json" >"${batch_root}/failure.json.new" || return 1
  mv "${batch_root}/failure.json.new" "${batch_root}/failure.json"
}

failure_policy_decide() {
  batch_root=$1
  failure_class=$2
  stage=$3
  candidate_head=${4:-}
  valid_failure_class "${failure_class}" || return 1
  if [ "${failure_class}" = product ]; then
    decision=REPAIR_CODE
  elif record_non_product_failure "${batch_root}" "${failure_class}" \
    "${stage}" "${candidate_head}"; then
    case "${failure_class}" in
      test-flake | automation) decision=RETRY_SAME_HEAD ;;
      environment) decision=RETRY_ENVIRONMENT ;;
      external) decision=RETRY_EXTERNAL ;;
    esac
  else
    case "${failure_class}" in
      automation) decision=BLOCK_AUTOMATION ;;
      external) decision=BLOCK_EXTERNAL ;;
      environment | test-flake) decision=BLOCK_ENVIRONMENT ;;
    esac
  fi
  write_failure_policy_decision "${batch_root}" "${decision}" || return 1
  printf '%s\n' "${decision}"
}

failure_policy_block_state() {
  batch_root=$1
  decision=$(failure_field "${batch_root}" policyDecision)
  case "${decision}" in
    BLOCK_AUTOMATION) printf 'automation-blocked\n' ;;
    BLOCK_EXTERNAL) printf 'external-blocked\n' ;;
    BLOCK_ENVIRONMENT) printf 'environment-blocked\n' ;;
    BLOCK_PRODUCT) printf 'blocked\n' ;;
    *) return 1 ;;
  esac
}

record_repair_failure() {
  batch_root=$1
  stage=$2
  candidate_head=$3
  failure_file="${batch_root}/failure.md"
  ensure_repair_budget "${batch_root}" || return 1
  [ -r "${failure_file}" ] || return 1
  fingerprint=$(normalized_failure_fingerprint "${stage}" "${failure_file}")
  budget_file=$(repair_budget_file "${batch_root}")
  jq --arg stage "${stage}" --arg fingerprint "${fingerprint}" --arg candidate_head "${candidate_head}" '
    if .lastStage == $stage and .lastFingerprint == $fingerprint then
      .consecutive += 1
    else
      .lastStage = $stage | .lastFingerprint = $fingerprint | .consecutive = 1
    end |
    .consecutive as $consecutive |
    .events |= (
      .[:-1] + [(.[-1] + {
        failureStage: $stage,
        failureFingerprint: $fingerprint,
        candidateHead: (if $candidate_head == "" then null else $candidate_head end),
        consecutive: $consecutive
      })]
    )
  ' "${budget_file}" >"${budget_file}.new"
  mv "${budget_file}.new" "${budget_file}"
  consecutive=$(jq -r .consecutive "${budget_file}")
  [ "${consecutive}" -lt 2 ] || return 2
}

block_for_repair_budget() {
  batch_root=$1
  reason=$2
  failure_file="${batch_root}/failure.md"
  budget_file=$(repair_budget_file "${batch_root}")
  total=$(jq -r '.total // "unknown"' "${budget_file}" 2>/dev/null || printf unknown)
  consecutive=$(jq -r '.consecutive // "unknown"' "${budget_file}" 2>/dev/null || printf unknown)
  manual_recoveries=$(jq -r '[.recoveries[] | select(.consumed == true)] | length' \
    "${budget_file}" 2>/dev/null || printf unknown)
  {
    [ -r "${failure_file}" ] && cat "${failure_file}"
    automatic_attempts=$((total - manual_recoveries))
    automatic_repairs=$((automatic_attempts > 0 ? automatic_attempts - 1 : 0))
    printf '\nRepair budget exhausted: %s (automaticAttempts=%s/9, automaticRepairs=%s/8, manualRecoveries=%s, consecutive=%s).\n' \
      "${reason}" "${automatic_attempts}" "${automatic_repairs}" "${manual_recoveries}" "${consecutive}"
  } >"${failure_file}.new"
  mv "${failure_file}.new" "${failure_file}"
}

apply_product_failure_policy() {
  batch_root=$1
  issues_dir=$2
  worktree=$3
  stage=$(cat "${batch_root}/repair-stage" 2>/dev/null || printf code-review-gate)
  case "${stage}" in code-review-gate | gate) ;; *) stage=code-review-gate ;; esac
  candidate_head=$(git -C "${worktree}" rev-parse HEAD 2>/dev/null || true)
  case "${candidate_head}" in '' | *[!0-9a-f]*) candidate_head= ;; esac
  [ "${#candidate_head}" -eq 40 ] || candidate_head=
  if [ "$(failure_field "${batch_root}" failureClass)" != product ]; then
    write_structured_failure "${batch_root}" product "${stage}" "${candidate_head}" \
      controller 'Code, review, or deterministic validation failed'
  fi
  if record_repair_failure "${batch_root}" "${stage}" "${candidate_head}"; then
    write_failure_policy_decision "${batch_root}" REPAIR_CODE
    return 0
  else
    record_result=$?
  fi
  case "${record_result}" in
    2) block_for_repair_budget "${batch_root}" 'the same normalized failure fingerprint recurred twice' ;;
    *) block_for_repair_budget "${batch_root}" 'the cumulative repair audit is invalid or unavailable' ;;
  esac
  write_failure_policy_decision "${batch_root}" BLOCK_PRODUCT
  mark_batch "${issues_dir}" blocked
  set_batch_state "${batch_root}" blocked
  return 1
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
    ticket_state=$(feature_status "${issues_dir}")
    batch_root="${runtime_root}/batches/${feature}"
    state=$(cat "${batch_root}/state" 2>/dev/null || printf '%s' "${ticket_state}")
    phase=$(cat "${batch_root}/phase" 2>/dev/null || true)
    failure_class=$(failure_field "${batch_root}" failureClass)
    failure_stage=$(failure_field "${batch_root}" stage)
    policy_decision=$(failure_field "${batch_root}" policyDecision)
    total=$(jq -r '.total // 0' "${batch_root}/repair-budget.json" 2>/dev/null || printf 0)
    non_product=$(jq -r '.nonProductEvents | length' \
      "${batch_root}/repair-budget.json" 2>/dev/null || printf 0)
    if [ "${state}" = "done" ]; then
      printf '%s: done\n' "${feature}"
    else
      printf '%s: %s phase=%s codeAttempts=%s/9 nonProductRetries=%s failure=%s stage=%s decision=%s\n' \
        "${feature}" "${state}" "${phase:--}" "${total}" "${non_product}" \
        "${failure_class:--}" "${failure_stage:--}" "${policy_decision:--}"
    fi
  done
}

diagnose_command() {
  feature=$1
  issues_dir="${tracker_root}/${feature}/issues"
  [ -d "${issues_dir}" ] || { echo "unknown feature: ${feature}" >&2; exit 2; }
  batch_root="${runtime_root}/batches/${feature}"
  state=$(cat "${batch_root}/state" 2>/dev/null || feature_status "${issues_dir}")
  phase=$(cat "${batch_root}/phase" 2>/dev/null || printf '-')
  head=$(git -C "${runtime_root}/worktrees/${feature}" rev-parse HEAD 2>/dev/null || \
    cat "${batch_root}/base-sha" 2>/dev/null || printf unknown)
  printf 'feature=%s\nstate=%s\nphase=%s\nhead=%s\n' \
    "${feature}" "${state}" "${phase}" "${head}"
  if [ -r "${batch_root}/repair-budget.json" ]; then
    jq '{codeAttempts:.total,codeConsecutive:.consecutive,
      nonProductRetries:(.nonProductEvents | group_by(.failureClass) |
        map({key:.[0].failureClass,value:length}) | from_entries)}' \
      "${batch_root}/repair-budget.json"
  fi
  if [ -r "${batch_root}/failure.json" ]; then
    jq '{failureClass,stage,source,summary,signature,policyDecision}' "${batch_root}/failure.json"
  fi
  if [ -r "${batch_root}/validation-evidence.json" ]; then
    jq '{validation:{mode,status,head,stages:[.stages[] |
      {id,status,verifiedHead,blockedBy,retained}]}}' \
      "${batch_root}/validation-evidence.json"
  fi
  if [ -r "${batch_root}/timeline.jsonl" ]; then
    echo 'recentTimeline='
    tail -n 10 "${batch_root}/timeline.jsonl"
  fi
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
    write_controller_identity
    return
  fi
  if lock_identity=$(verified_controller_identity 2>/dev/null); then
    lock_pid=$(printf '%s\n' "${lock_identity}" | cut -f1)
    log "local Issue agent already runs as pid ${lock_pid}"
    exit 0
  fi
  lock_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
  if valid_pid "${lock_pid}" && kill -0 "${lock_pid}" 2>/dev/null; then
    echo "refusing to replace unverifiable active controller lock for pid ${lock_pid}" >&2
    return 1
  fi
  rm -rf "${lock_dir}"
  mkdir "${lock_dir}"
  write_controller_identity
}

release_lock() {
  [ "$(cat "${lock_dir}/pid" 2>/dev/null || true)" = "$$" ] || return 0
  rm -f "${lock_dir}/pid" "${lock_dir}/pgid" "${lock_dir}/started" \
    "${lock_dir}/command" "${lock_dir}/script"
  rmdir "${lock_dir}" >/dev/null 2>&1 || true
}

valid_pid() {
  case "${1:-}" in '' | *[!0-9]*) return 1 ;; esac
  [ "$1" -gt 1 ]
}

process_group() { ps -o pgid= -p "$1" 2>/dev/null | tr -d ' '; }
process_start() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^[[:space:]]*//'; }
process_command() { ps -o command= -p "$1" 2>/dev/null | sed 's/^[[:space:]]*//'; }

write_controller_identity() {
  controller_pgid=$(process_group "$$")
  [ "${controller_pgid}" = "$$" ] || {
    echo 'local Issue controller must own its process group' >&2
    return 1
  }
  chmod 700 "${lock_dir}"
  printf '%s\n' "$$" >"${lock_dir}/pid"
  printf '%s\n' "${controller_pgid}" >"${lock_dir}/pgid"
  process_start "$$" >"${lock_dir}/started"
  process_command "$$" >"${lock_dir}/command"
  printf '%s\n' "${controller_path}" >"${lock_dir}/script"
  chmod 600 "${lock_dir}"/*
}

verified_controller_identity() {
  controller_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
  controller_pgid=$(cat "${lock_dir}/pgid" 2>/dev/null || true)
  recorded_start=$(cat "${lock_dir}/started" 2>/dev/null || true)
  recorded_command=$(cat "${lock_dir}/command" 2>/dev/null || true)
  recorded_script=$(cat "${lock_dir}/script" 2>/dev/null || true)
  valid_pid "${controller_pid}" || return 1
  valid_pid "${controller_pgid}" || return 1
  [ "${controller_pid}" = "${controller_pgid}" ] || return 1
  [ "${recorded_script}" = "${controller_path}" ] || return 1
  kill -0 "${controller_pid}" 2>/dev/null || return 1
  actual_pgid=$(process_group "${controller_pid}")
  actual_start=$(process_start "${controller_pid}")
  actual_command=$(process_command "${controller_pid}")
  [ "${actual_pgid}" = "${controller_pgid}" ] || return 1
  [ -n "${recorded_start}" ] && [ "${actual_start}" = "${recorded_start}" ] || return 1
  [ -n "${recorded_command}" ] && [ "${actual_command}" = "${recorded_command}" ] || return 1
  case "${actual_command}" in *"${controller_path} run"*) ;; *) return 1 ;; esac
  printf '%s\t%s\n' "${controller_pid}" "${controller_pgid}"
}

live_controller_pid() {
  identity=$(verified_controller_identity) || return 1
  printf '%s\n' "${identity}" | cut -f1
}

ensure_dedicated_controller_group() {
  current_pgid=$(process_group "$$")
  if [ "${current_pgid}" = "$$" ]; then return 0; fi
  [ "${ZERP_ISSUE_DEDICATED_GROUP:-0}" != 1 ] || {
    echo 'failed to create a dedicated local Issue controller process group' >&2
    exit 1
  }
  ZERP_ISSUE_DEDICATED_GROUP=1 node - "${controller_path}" <<'NODE'
const {spawnSync} = require('child_process');
const child = spawnSync('/bin/sh', [process.argv[2], 'run'], {
  detached: true,
  stdio: 'inherit',
  env: process.env,
});
if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}
process.exit(child.status === null ? 1 : child.status);
NODE
  exit $?
}

process_group_alive() {
  ps -axo pgid=,stat= | awk -v expected_group="$1" '
    $1 == expected_group && $2 !~ /^Z/ { found = 1 }
    END { exit(found ? 0 : 1) }
  '
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
    if [ -z "${number}" ] || [ -z "${title}" ] || [ -z "${build}" ] || \
      [ -z "${blockers}" ] || [ -z "${acceptance}" ]; then
      echo "invalid local ticket: ${ticket}" >&2
      return 1
    fi
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

write_batch_risk() {
  issues_dir=$1
  batch_root=$2
  ticket_count=$(find "${issues_dir}" -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' ')
  acceptance_count=$(awk '/^- \[[ x]\]/{count++} END{print count+0}' "${issues_dir}"/*.md)
  cross_stack=0
  if grep -Eiq 'OpenAPI|契约|前端|后端|迁移|migration|E2E|preview' "${issues_dir}"/*.md; then
    cross_stack=1
  fi
  large=0
  if [ "${ticket_count}" -ge 5 ] || [ "${acceptance_count}" -ge 20 ]; then large=1; fi
  jq -n --argjson tickets "${ticket_count}" --argjson acceptance "${acceptance_count}" \
    --argjson cross_stack "${cross_stack}" --argjson large "${large}" \
    '{version:1,tickets:$tickets,acceptanceCriteria:$acceptance,crossStack:($cross_stack == 1),largeBatch:($large == 1)}' \
    >"${batch_root}/risk.json.new"
  mv "${batch_root}/risk.json.new" "${batch_root}/risk.json"
}

prepare_worktree() {
  feature=$1
  issues_dir=$2
  batch_root=$3
  worktree=$4
  branch=$5
  base_file="${batch_root}/base-sha"
  mkdir -p "${batch_root}" "$(dirname "${worktree}")"
  set_batch_phase "${batch_root}" preparing-worktree
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
  worktree_environment_ensure "${worktree}" || return $?
}

_worktree_environment_clean_residue() {
  worktree=$1
  rm -rf "${worktree}/.pnpm-store" \
    "${worktree}/frontend/node_modules/.pnpm-store" \
    "${worktree}/frontend/node_modules/.vite" \
    "${worktree}/frontend/node_modules/.vite-temp"
}

# worktree_environment_ensure returns 1 for environment, 2 for product, and 3
# for automation failures so Failure Policy remains the only decision maker.
_worktree_environment_failure_class() {
  case "$1" in
    2) printf 'product\n' ;;
    3) printf 'automation\n' ;;
    *) printf 'environment\n' ;;
  esac
}

remove_managed_host_env() {
  worktree=$1
  candidate_env="${worktree}/backend/.env.local"
  primary_env="${primary_root}/backend/.env.local"
  if [ -L "${candidate_env}" ] &&
    [ "$(readlink "${candidate_env}")" = "${primary_env}" ]; then
    rm -f "${candidate_env}"
  fi
}

stage_host_gate_env() {
  worktree=$1
  candidate_env="${worktree}/backend/.env.local"
  primary_env="${primary_root}/backend/.env.local"
  [ -f "${primary_env}" ] || {
    echo 'host final gate cannot find primary backend/.env.local' >&2
    return 1
  }
  remove_managed_host_env "${worktree}"
  if [ -e "${candidate_env}" ] || [ -L "${candidate_env}" ]; then
    echo 'host final gate refuses an unmanaged candidate backend/.env.local' >&2
    return 1
  fi
  ln -s "${primary_env}" "${candidate_env}"
}

ensure_primary_e2e_env() {
  primary_e2e_env="${primary_root}/backend/.env.e2e.local"
  if [ ! -f "${primary_e2e_env}" ]; then
    "${primary_root}/backend/scripts/init-e2e-env.sh"
  fi
  [ -f "${primary_e2e_env}" ] || {
    echo 'host final gate cannot prepare primary backend/.env.e2e.local' >&2
    return 1
  }
  printf '%s\n' "${primary_e2e_env}"
}

_worktree_environment_prepare_pnpm() {
  worktree=$1
  package_json="${worktree}/package.json"
  pnpm_store=${ZERP_PNPM_STORE_PATH:-${HOME}/Library/pnpm/store}
  [ -r "${package_json}" ] || {
    echo 'offline dependency preparation blocked: candidate package.json is missing' >&2
    return 2
  }
  package_manager=$(jq -r '.packageManager // empty' "${package_json}")
  case "${package_manager}" in
    pnpm@[0-9]*.[0-9]*.[0-9]*) pnpm_version=${package_manager#pnpm@} ;;
    *) echo 'offline dependency preparation blocked: candidate packageManager must pin an exact pnpm version' >&2; return 2 ;;
  esac
  printf '%s\n' "${pnpm_version}" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || {
    echo 'offline dependency preparation blocked: candidate packageManager must pin an exact pnpm version' >&2
    return 2
  }
  [ -d "${pnpm_store}" ] || {
    echo "offline dependency preparation blocked: local pnpm store is unavailable for pnpm@${pnpm_version}" >&2
    return 1
  }
  cached_entries=$(find "${pnpm_store}" -type f \
    -path "*/@/pnpm/${pnpm_version}/*/node_modules/pnpm/bin/pnpm.cjs" -print 2>/dev/null | LC_ALL=C sort)
  cached_count=$(printf '%s\n' "${cached_entries}" | sed '/^$/d' | wc -l | tr -d ' ')
  [ "${cached_count}" = 1 ] || {
    echo "offline dependency preparation blocked: expected one cached pnpm@${pnpm_version}, found ${cached_count}" >&2
    return 1
  }
  cached_entry=$(printf '%s\n' "${cached_entries}" | sed -n '1p')
  cached_package="$(dirname "$(dirname "${cached_entry}")")/package.json"
  [ "$(jq -r '.version // empty' "${cached_package}" 2>/dev/null || true)" = "${pnpm_version}" ] || {
    echo "offline dependency preparation blocked: cached pnpm entry does not match pnpm@${pnpm_version}" >&2
    return 1
  }
  wrapper_dir="${worktree}/.scratch/.issue-local-bin"
  mkdir -p "${wrapper_dir}"
  {
    echo '#!/bin/sh'
    printf 'exec node "%s" "$@"\n' "${cached_entry}"
  } >"${wrapper_dir}/pnpm.new"
  chmod 700 "${wrapper_dir}/pnpm.new"
  mv "${wrapper_dir}/pnpm.new" "${wrapper_dir}/pnpm"
}

_worktree_environment_verify_ignored() {
  worktree=$1
  git -C "${worktree}" check-ignore -q -- node_modules || {
    echo 'offline dependency preparation blocked: candidate node_modules is not ignored by Git' >&2
    return 2
  }
  git -C "${worktree}" check-ignore -q -- frontend/node_modules/.issue-local-probe || {
    echo 'offline dependency preparation blocked: candidate frontend/node_modules is not ignored by Git' >&2
    return 2
  }
}

worktree_environment_ensure() {
  worktree=$1
  candidate_lockfile="${worktree}/pnpm-lock.yaml"
  candidate_modules="${worktree}/node_modules"
  candidate_frontend_modules="${worktree}/frontend/node_modules"
  pnpm_store=${ZERP_PNPM_STORE_PATH:-${HOME}/Library/pnpm/store}
  wrapper="${worktree}/.scratch/.issue-local-bin/pnpm"
  install_log="${worktree}/.scratch/.issue-local-deps-install.log"

  remove_managed_host_env "${worktree}"
  if [ -e "${worktree}/backend/.env.local" ] || [ -L "${worktree}/backend/.env.local" ]; then
    echo 'offline dependency preparation blocked: candidate backend/.env.local must be absent before Codex starts' >&2
    return 3
  fi
  if [ -e "${worktree}/backend/.env.e2e.local" ] ||
    [ -L "${worktree}/backend/.env.e2e.local" ]; then
    echo 'offline dependency preparation blocked: candidate backend/.env.e2e.local must be absent before Codex starts' >&2
    return 3
  fi

  [ -f "${candidate_lockfile}" ] || {
    echo 'offline dependency preparation blocked: candidate pnpm-lock.yaml is missing' >&2
    return 2
  }
  _worktree_environment_prepare_pnpm "${worktree}" || return $?
  _worktree_environment_verify_ignored "${worktree}" || return $?
  if [ -L "${candidate_modules}" ]; then
    if [ "$(readlink "${candidate_modules}")" = "${primary_root}/node_modules" ]; then
      rm -f "${candidate_modules}"
    else
      echo 'offline dependency preparation blocked: candidate node_modules is an unmanaged symlink' >&2
      return 3
    fi
  fi
  if {
    [ -e "${candidate_modules}" ] && [ ! -d "${candidate_modules}" ]
  }; then
    echo 'offline dependency preparation blocked: candidate node_modules must be an owned directory' >&2
    return 3
  fi
  if [ -L "${candidate_frontend_modules}" ] || {
    [ -e "${candidate_frontend_modules}" ] && [ ! -d "${candidate_frontend_modules}" ]
  }; then
    echo 'offline dependency preparation blocked: candidate frontend/node_modules must be an owned directory' >&2
    return 3
  fi
  _worktree_environment_clean_residue "${worktree}"
  if ! (
    cd "${worktree}"
    CI=true COREPACK_ROOT=1 "${wrapper}" install --offline --frozen-lockfile \
      --store-dir "${pnpm_store}"
  ) >"${install_log}" 2>&1; then
    cat "${install_log}" >&2
    if grep -Eiq 'ERR_PNPM_(OUTDATED_LOCKFILE|LOCKFILE_MISSING_DEPENDENCY|BROKEN_LOCKFILE|INVALID_WORKSPACE_CONFIGURATION|NO_MATCHING_VERSION_INSIDE_WORKSPACE|JSON_PARSE)|frozen-lockfile.*(not up to date|outdated)|not up to date with .*package[.]json|package[.]json.*(invalid|parse)' \
      "${install_log}"; then
      echo 'offline dependency preparation blocked: candidate dependency manifests are inconsistent' >&2
      return 2
    fi
    echo 'offline dependency preparation blocked: candidate install failed' >&2
    return 1
  fi
  cat "${install_log}"
  rm -f "${install_log}"
  _worktree_environment_clean_residue "${worktree}"
  if ! { [ -d "${candidate_modules}" ] && [ ! -L "${candidate_modules}" ] &&
    [ -d "${candidate_modules}/.pnpm" ] && [ -f "${candidate_modules}/.modules.yaml" ] &&
    [ -d "${candidate_modules}/.bin" ]; }; then
    echo 'offline dependency preparation blocked: candidate root node_modules is incomplete' >&2
    return 3
  fi
  if ! { [ -d "${candidate_frontend_modules}" ] &&
    [ ! -L "${candidate_frontend_modules}" ] &&
    [ -d "${candidate_frontend_modules}/.bin" ] &&
    [ -x "${candidate_frontend_modules}/.bin/vite" ] &&
    [ -e "${candidate_frontend_modules}/vite" ]; }; then
    echo 'offline dependency preparation blocked: candidate frontend node_modules is incomplete' >&2
    return 3
  fi
  mkdir -p "${candidate_frontend_modules}/.tmp"
  if [ -e "${worktree}/.pnpm-store" ] ||
    [ -e "${candidate_frontend_modules}/.pnpm-store" ]; then
    echo 'offline dependency preparation blocked: candidate pnpm store cleanup failed' >&2
    return 3
  fi
}

ensure_worktree_environment_resilient() {
  batch_root=$1
  worktree=$2
  head_sha=$3
  stage=$4
  environment_log=$5
  while :; do
    ensure_result=0
    worktree_environment_ensure "${worktree}" >>"${environment_log}" 2>&1 || ensure_result=$?
    if [ "${ensure_result}" = 0 ]; then
      return 0
    fi
    failure_class=$(_worktree_environment_failure_class "${ensure_result}")
    {
      printf 'Worktree environment preparation failed for candidate %s.\n\n' "${head_sha}"
      tail -n 120 "${environment_log}"
    } >"${batch_root}/failure.md"
    write_structured_failure "${batch_root}" "${failure_class}" "${stage}" \
      "${head_sha}" controller 'Candidate dependency environment preparation failed'
    decision=$(failure_policy_decide "${batch_root}" "${failure_class}" "${stage}" "${head_sha}") || \
      return 8
    case "${decision}" in
      RETRY_ENVIRONMENT | RETRY_SAME_HEAD) ;;
      REPAIR_CODE) return 4 ;;
      *) return 8 ;;
    esac
    retry_delay=${ZERP_ISSUE_ENVIRONMENT_RETRY_WAIT_SECONDS:-5}
    case "${retry_delay}" in '' | *[!0-9]*) retry_delay=5 ;; esac
    [ "${retry_delay}" -eq 0 ] || sleep "${retry_delay}"
  done
}

verify_worktree_git_metadata() {
  worktree=$1
  git_dir=$(git -C "${worktree}" rev-parse --path-format=absolute --git-dir)
  common_git_dir=$(git -C "${worktree}" rev-parse --path-format=absolute --git-common-dir)
  [ -d "${git_dir}" ] || { echo "worktree Git directory is unavailable: ${git_dir}" >&2; return 1; }
  [ -d "${common_git_dir}" ] || { echo "shared Git directory is unavailable: ${common_git_dir}" >&2; return 1; }

  # Linked worktrees keep their index under git_dir and refs/objects under
  # common_git_dir. Exercise both locations before asking Codex to do work.
  (
    probe_index="${git_dir}/issue-local-index-probe-$$"
    probe_ref="refs/issue-local-probe/$$"
    cleanup_probe() {
      rm -f "${probe_index}" "${probe_index}.lock"
      git -C "${worktree}" update-ref -d "${probe_ref}" >/dev/null 2>&1 || true
    }
    trap cleanup_probe EXIT HUP INT TERM
    GIT_INDEX_FILE="${probe_index}" git -C "${worktree}" read-tree HEAD
    [ -f "${probe_index}" ] || { echo "cannot write linked-worktree Git index" >&2; exit 1; }
    git -C "${worktree}" update-ref "${probe_ref}" HEAD
    cleanup_probe
    trap - EXIT HUP INT TERM
  ) || { echo "linked-worktree Git metadata is not writable" >&2; return 1; }

  printf '%s\t%s\n' "${git_dir}" "${common_git_dir}"
}

capture_failed_e2e() {
  batch_root=$1
  gate_log=$2
  failed_head=$3
  repair_file="${batch_root}/repair-e2e.env"
  stage=$(grep '^==> ' "${gate_log}" 2>/dev/null | tail -n 1 | sed 's/^==> //' || true)
  [ "${stage}" = 'isolated full-stack E2E' ] || {
    rm -f "${repair_file}"
    return 0
  }
  failure_line=$(grep -E '\[[^]]+\].*tests/e2e/[^:]+\.spec\.ts:' "${gate_log}" |
    tail -n 1 || true)
  project=$(printf '%s\n' "${failure_line}" |
    sed -E 's/.*\[([^]]+)\].*/\1/')
  spec=$(printf '%s\n' "${failure_line}" |
    sed -E 's@.*› (tests/e2e/[^:]+\.spec\.ts):.*@\1@')
  case "${project}" in '' | *[!a-z0-9-]*) rm -f "${repair_file}"; return 0 ;; esac
  case "${spec}" in
    tests/e2e/*.spec.ts) ;;
    *) rm -f "${repair_file}"; return 0 ;;
  esac
  case "${spec}" in *..*) rm -f "${repair_file}"; return 0 ;; esac
  {
    printf 'failed_head=%s\n' "${failed_head}"
    printf 'project=%s\n' "${project}"
    printf 'spec=%s\n' "${spec}"
  } >"${repair_file}.new"
  mv "${repair_file}.new" "${repair_file}"
}

capture_failed_integration() {
  batch_root=$1
  result_file=$2
  failed_head=$3
  repair_file="${batch_root}/repair-integration.json"
  if ! jq -e --arg head "${failed_head}" '
    . as $result |
    select(
      .version == 1 and .status == "failed" and
      (.packages | type == "array" and length > 0) and
      all(.packages[];
        (.package | type == "string" and test("^[A-Za-z0-9._/-]+$") and (contains("..") | not) and startswith("/") == false) and
        (.status == "passed" or .status == "failed") and
        (.exitCode | type == "number" and floor == .)) and
      any(.packages[]; .status == "failed")
    ) |
    {version:1, failedHead:$head, packages:[$result.packages[] | select(.status == "failed") | .package]}
  ' "${result_file}" >"${repair_file}.new" 2>/dev/null; then
    rm -f "${repair_file}.new"
    return 1
  fi
  mv "${repair_file}.new" "${repair_file}"
}

write_gate_failure() {
  batch_root=$1
  head_sha=$2
  gate_log=$3
  failure_file="${batch_root}/failure.md"
  integration_result="${batch_root}/integration-result.json"
  failed_packages=$(jq -r '.packages[]? | select(.status == "failed") | .package' \
    "${integration_result}" 2>/dev/null || true)
  if [ -n "${failed_packages}" ]; then
    stage="integration packages: $(printf '%s\n' "${failed_packages}" | paste -sd, -)"
  else
    stage=$(grep '^==> ' "${gate_log}" 2>/dev/null | tail -n 1 | sed 's/^==> //' || true)
  fi
  rm -f "${batch_root}/failure.json"
  {
    printf 'Host final gate failed for candidate %s. A repair must create a new commit before another gate attempt.\n' "${head_sha}"
    printf 'Failed stage: %s\n' "${stage:-unknown}"
    printf 'Full log: %s\n\nFocused error excerpt:\n\n' "${gate_log}"
    tail -n 140 "${gate_log}" | sed '/^dist\/assets\//d'
  } >"${failure_file}"
  rm -f "${batch_root}/repair-integration.json"
  capture_failed_integration "${batch_root}" "${integration_result}" "${head_sha}" || true
  capture_failed_e2e "${batch_root}" "${gate_log}" "${head_sha}"
  if [ -r "${batch_root}/repair-integration.json" ] || [ -r "${batch_root}/repair-e2e.env" ]; then
    failure_class=test-flake
    summary='A focused test must distinguish a product defect from a transient test failure'
  elif grep -Eiq 'cannot connect to (the )?docker|docker daemon|connection refused|no space left|temporary failure|TLS handshake|network is unreachable|timed? out|port is already allocated' \
    "${gate_log}"; then
    failure_class=environment
    summary='Host validation environment failed before code correctness was established'
  else
    failure_class=product
    summary='Deterministic host validation failed'
  fi
  write_structured_failure "${batch_root}" "${failure_class}" "${stage:-unknown}" \
    "${head_sha}" gate "${summary}"
}

run_integration_repair_preflight() {
  batch_root=$1
  worktree=$2
  mode=${3:-repair}
  marker="${batch_root}/repair-integration.json"
  [ -r "${marker}" ] || return 0
  write_value "${batch_root}/repair-stage" gate
  failed_head=$(jq -r '.failedHead // empty' "${marker}")
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  case "${mode}" in
    repair)
      [ "${head_sha}" != "${failed_head}" ] || {
        echo 'focused integration repair requires a new candidate commit' >&2
        return 4
      }
      git -C "${worktree}" merge-base --is-ancestor "${failed_head}" "${head_sha}" || {
        echo 'focused integration repair candidate does not descend from the failed head' >&2
        return 4
      }
      ;;
    verify-flake) [ "${head_sha}" = "${failed_head}" ] || return 4 ;;
    *) return 4 ;;
  esac
  packages_file="${batch_root}/repair-integration-packages"
  result_file="${batch_root}/repair-integration-result.json"
  repair_log="${batch_root}/repair-integration.log"
  jq -er '.packages[]' "${marker}" >"${packages_file}.new" || return 4
  mv "${packages_file}.new" "${packages_file}"
  rm -f "${result_file}"
  if ! (
    stage_host_gate_env "${worktree}"
    trap 'remove_managed_host_env "${worktree}"' EXIT HUP INT TERM
    cd "${worktree}"
    if [ -n "${focused_integration_command}" ]; then
      "${focused_integration_command}" "${packages_file}" "${result_file}"
    else
      make -C backend test-integration \
        ENV_FILE=.env.local \
        TEST_INTEGRATION_PACKAGES_FILE="${packages_file}" \
        TEST_INTEGRATION_RESULT_FILE="${result_file}"
    fi
  ) >"${repair_log}" 2>&1; then
    capture_failed_integration "${batch_root}" "${result_file}" "${head_sha}" || true
    {
      printf 'Focused integration repair check failed for candidate %s.\n' "${head_sha}"
      printf 'Packages: %s\n' "$(paste -sd, "${packages_file}")"
      printf 'Full log: %s\n\nFocused error excerpt:\n\n' "${repair_log}"
      tail -n 140 "${repair_log}" | sed '/^dist\/assets\//d'
    } >"${batch_root}/failure.md"
    return 4
  fi
  jq -e '.version == 1 and .status == "passed" and all(.packages[]; .status == "passed")' \
    "${result_file}" >/dev/null || {
      echo 'focused integration repair returned invalid evidence' >&2
      return 4
    }
  rm -f "${marker}" "${packages_file}" "${result_file}"
}

run_repair_preflight() {
  batch_root=$1
  worktree=$2
  run_integration_repair_preflight "${batch_root}" "${worktree}" repair || return $?
  marker="${batch_root}/repair-e2e.env"
  [ -r "${marker}" ] || return 0
  write_value "${batch_root}/repair-stage" gate
  failed_head=$(sed -n 's/^failed_head=//p' "${marker}")
  project=$(sed -n 's/^project=//p' "${marker}")
  spec=$(sed -n 's/^spec=//p' "${marker}")
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  [ "${head_sha}" != "${failed_head}" ] || {
    echo 'focused E2E repair requires a new candidate commit' >&2
    return 4
  }
  git -C "${worktree}" merge-base --is-ancestor "${failed_head}" "${head_sha}" || {
    echo 'focused E2E repair candidate does not descend from the failed head' >&2
    return 4
  }
  command_path=${focused_e2e_command:-${primary_root}/scripts/e2e.sh}
  e2e_env_file=$(ensure_primary_e2e_env) || return 4
  pnpm_wrapper_dir="${worktree}/.scratch/.issue-local-bin"
  repair_log="${batch_root}/repair-e2e.log"
  if ! (
    stage_host_gate_env "${worktree}"
    trap 'remove_managed_host_env "${worktree}"' EXIT HUP INT TERM
    cd "${worktree}"
    PATH="${pnpm_wrapper_dir}:${PATH}" COREPACK_ROOT=1 \
      ZERP_E2E_REPO_ROOT="${worktree}" ZERP_E2E_ENV_FILE="${e2e_env_file}" \
      "${command_path}" "${spec}" "--project=${project}" --no-deps
  ) >"${repair_log}" 2>&1; then
    {
      printf 'Focused E2E repair check failed for candidate %s.\n' "${head_sha}"
      printf 'Target: %s [%s]\n' "${spec}" "${project}"
      printf 'Full log: %s\n\nFocused error excerpt:\n\n' "${repair_log}"
      tail -n 140 "${repair_log}" | sed '/^dist\/assets\//d'
    } >"${batch_root}/failure.md"
    return 4
  fi
  rm -f "${marker}"
}

verify_same_head_flake() {
  batch_root=$1
  worktree=$2
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  if [ -r "${batch_root}/repair-integration.json" ]; then
    if run_integration_repair_preflight "${batch_root}" "${worktree}" verify-flake; then
      return 0
    fi
    stage=$(failure_field "${batch_root}" stage)
    write_structured_failure "${batch_root}" product "${stage:-integration}" "${head_sha}" \
      gate 'Focused integration test reproduced the failure on the same commit'
    return 1
  fi
  marker="${batch_root}/repair-e2e.env"
  [ -r "${marker}" ] || return 1
  failed_head=$(sed -n 's/^failed_head=//p' "${marker}")
  project=$(sed -n 's/^project=//p' "${marker}")
  spec=$(sed -n 's/^spec=//p' "${marker}")
  [ "${head_sha}" = "${failed_head}" ] || return 1
  command_path=${focused_e2e_command:-${primary_root}/scripts/e2e.sh}
  e2e_env_file=$(ensure_primary_e2e_env) || return 1
  pnpm_wrapper_dir="${worktree}/.scratch/.issue-local-bin"
  repair_log="${batch_root}/repair-e2e.log"
  if (
    stage_host_gate_env "${worktree}"
    trap 'remove_managed_host_env "${worktree}"' EXIT HUP INT TERM
    cd "${worktree}"
    PATH="${pnpm_wrapper_dir}:${PATH}" COREPACK_ROOT=1 \
      ZERP_E2E_REPO_ROOT="${worktree}" ZERP_E2E_ENV_FILE="${e2e_env_file}" \
      "${command_path}" "${spec}" "--project=${project}" --no-deps
  ) >"${repair_log}" 2>&1; then
    rm -f "${marker}"
    return 0
  fi
  {
    printf 'Focused E2E reproduced the failure for candidate %s.\n' "${head_sha}"
    printf 'Target: %s [%s]\n\nFocused error excerpt:\n\n' "${spec}" "${project}"
    tail -n 140 "${repair_log}" | sed '/^dist\/assets\//d'
  } >"${batch_root}/failure.md"
  write_structured_failure "${batch_root}" product "isolated full-stack E2E" \
    "${head_sha}" gate 'Focused E2E reproduced the failure on the same commit'
  return 1
}

run_final_gate() {
  batch_root=$1
  worktree=$2
  base_sha=$3
  head_sha=$4
  evidence_file="${batch_root}/gate-evidence.json"
  gate_log="${batch_root}/gate.log"
  failure_file="${batch_root}/failure.md"
  marker_file="${batch_root}/gate-attempted-head"
  integration_result="${batch_root}/integration-result.json"
  write_value "${batch_root}/repair-stage" gate
  command_path=${gate_command:-${worktree}/scripts/change-gate.sh}
  e2e_env_file=$(ensure_primary_e2e_env) || return 4
  pnpm_wrapper_dir="${worktree}/.scratch/.issue-local-bin"
  [ -x "${pnpm_wrapper_dir}/pnpm" ] || {
    echo 'host final gate cannot find the prepared exact pnpm wrapper' >&2
    return 4
  }

  rm -f "${evidence_file}" "${integration_result}"
  write_value "${marker_file}" "${head_sha}"
  if ! (
    stage_host_gate_env "${worktree}"
    trap 'remove_managed_host_env "${worktree}"' EXIT HUP INT TERM
    cd "${worktree}"
    PATH="${pnpm_wrapper_dir}:${PATH}" COREPACK_ROOT=1 \
      ZERP_E2E_ENV_FILE="${e2e_env_file}" ZERP_GATE_EVIDENCE_FILE="${evidence_file}" \
      TEST_INTEGRATION_RESULT_FILE="${integration_result}" \
      "${command_path}" --release "${base_sha}"
  ) >"${gate_log}" 2>&1; then
    write_gate_failure "${batch_root}" "${head_sha}" "${gate_log}"
    return 4
  fi
  jq -e --arg head "${head_sha}" --arg base "${base_sha}" '
    .status == "passed" and .head == $head and .base == $base and
    (.runtimeFingerprint | type == "string" and length > 0)
  ' "${evidence_file}" >/dev/null || {
    {
      printf 'Host final gate returned invalid evidence for candidate %s.\n\n' "${head_sha}"
      tail -n 140 "${gate_log}" | sed '/^dist\/assets\//d'
    } >"${failure_file}"
    write_structured_failure "${batch_root}" automation final-gate-evidence \
      "${head_sha}" gate 'Host final gate returned invalid completion evidence'
    return 4
  }
  rm -f "${batch_root}/repair-integration.json" "${integration_result}"
}

write_incremental_validation_failure() {
  batch_root=$1
  head_sha=$2
  mode=$3
  evidence_file=$4
  validation_log=$5
  integration_result="${batch_root}/integration-result.json"
  failed_stages=$(jq -r '[.stages[] | select(.status == "failed") | .id] | join(",")' \
    "${evidence_file}" 2>/dev/null || true)
  blocked_stages=$(jq -r '[.stages[] | select(.status == "blocked") |
    (.id + "<-" + ((.blockedBy // []) | join("+")))] | join(",")' \
    "${evidence_file}" 2>/dev/null || true)
  {
    printf 'Validation %s collected failures for candidate %s.\n' "${mode}" "${head_sha}"
    printf 'Failed stages: %s\n' "${failed_stages:-none}"
    printf 'Blocked stages: %s\n\n' "${blocked_stages:-none}"
    printf 'Stage evidence:\n'
    jq -r '.stages[] | "- \(.id): \(.status)" +
      (if .blockedBy then " (blocked by " + (.blockedBy | join(",")) + ")" else "" end)' \
      "${evidence_file}" 2>/dev/null || true
    printf '\nFocused error excerpt:\n\n'
    tail -n 180 "${validation_log}" | sed '/^dist\/assets\//d'
  } >"${batch_root}/failure.md"
  rm -f "${batch_root}/repair-integration.json"
  capture_failed_integration "${batch_root}" "${integration_result}" "${head_sha}" || true
  capture_failed_e2e "${batch_root}" "${validation_log}" "${head_sha}"
  if grep -Eiq 'cannot connect to (the )?docker|docker daemon|connection refused|no space left|temporary failure|TLS handshake|network is unreachable|timed? out|port is already allocated' \
    "${validation_log}"; then
    failure_class=environment
    summary='Incremental validation environment failed'
  elif { [ "${failed_stages}" = backend ] && \
      [ -r "${batch_root}/repair-integration.json" ]; } || \
    { [ "${failed_stages}" = e2e ] && \
      [ -r "${batch_root}/repair-e2e.env" ]; }; then
    failure_class=test-flake
    summary='A focused test must distinguish a product defect from a transient test failure'
  else
    failure_class=product
    summary="Validation ${mode} found deterministic failures: ${failed_stages:-unknown}"
  fi
  write_structured_failure "${batch_root}" "${failure_class}" \
    "validation:${failed_stages:-unknown}" "${head_sha}" validation "${summary}"
}

run_incremental_validation() {
  mode=$1
  batch_root=$2
  worktree=$3
  base_sha=$4
  head_sha=$5
  evidence_file="${batch_root}/validation-evidence.json"
  validation_log="${batch_root}/validation-${mode}.log"
  marker_file="${batch_root}/gate-attempted-head"
  integration_result="${batch_root}/integration-result.json"
  command_path=${gate_command:-${worktree}/scripts/change-gate.sh}
  e2e_env_file=$(ensure_primary_e2e_env) || return 4
  pnpm_wrapper_dir="${worktree}/.scratch/.issue-local-bin"
  [ -x "${pnpm_wrapper_dir}/pnpm" ] || return 4
  write_value "${batch_root}/repair-stage" gate
  write_value "${marker_file}" "${head_sha}"
  [ "${mode}" != baseline ] || rm -f "${evidence_file}"
  rm -f "${integration_result}"
  if [ "${mode}" = baseline ]; then
    set -- --baseline "${base_sha}"
  else
    set -- --reverify "${evidence_file}" "${base_sha}"
  fi
  validation_result=0
  (
    stage_host_gate_env "${worktree}"
    trap 'remove_managed_host_env "${worktree}"' EXIT HUP INT TERM
    cd "${worktree}"
    PATH="${pnpm_wrapper_dir}:${PATH}" COREPACK_ROOT=1 \
      ZERP_E2E_ENV_FILE="${e2e_env_file}" ZERP_GATE_EVIDENCE_FILE="${evidence_file}" \
      TEST_INTEGRATION_RESULT_FILE="${integration_result}" \
      "${command_path}" "$@"
  ) >"${validation_log}" 2>&1 || validation_result=$?
  if ! jq -e --arg mode "${mode}" --arg head "${head_sha}" --arg base "${base_sha}" '
    .version == 1 and .mode == $mode and .head == $head and .base == $base and
    (.status == "passed" or .status == "failed") and
    (.stages | type == "array" and length > 0) and
    all(.stages[]; .status == "passed" or .status == "failed" or .status == "blocked")
  ' "${evidence_file}" >/dev/null 2>&1; then
    {
      printf 'Host validation %s returned invalid evidence for candidate %s.\n\n' \
        "${mode}" "${head_sha}"
      tail -n 160 "${validation_log}" | sed '/^dist\/assets\//d'
    } >"${batch_root}/failure.md"
    write_structured_failure "${batch_root}" automation "validation-${mode}-evidence" \
      "${head_sha}" validation 'Host validation returned invalid exact-head stage evidence'
    return 4
  fi
  evidence_status=$(jq -r .status "${evidence_file}")
  if [ "${validation_result}" -ne 0 ] || [ "${evidence_status}" != passed ]; then
    write_incremental_validation_failure "${batch_root}" "${head_sha}" "${mode}" \
      "${evidence_file}" "${validation_log}"
    return 4
  fi
  rm -f "${batch_root}/repair-integration.json" "${integration_result}"
  append_timeline "${batch_root}" validation-passed "${mode}" '' '' "${head_sha}" \
    "Validation ${mode} passed"
}

run_incremental_validation_resilient() {
  validation_loop_mode=$1
  validation_loop_batch_root=$2
  validation_loop_worktree=$3
  validation_loop_base_sha=$4
  validation_loop_head_sha=$5
  while :; do
    set_batch_phase "${validation_loop_batch_root}" "validation-${validation_loop_mode}"
    if run_incremental_validation "${validation_loop_mode}" "${validation_loop_batch_root}" \
      "${validation_loop_worktree}" "${validation_loop_base_sha}" \
      "${validation_loop_head_sha}"; then
      return 0
    fi
    policy_class=$(failure_field "${validation_loop_batch_root}" failureClass)
    if [ "${policy_class}" = test-flake ]; then
      set_batch_phase "${validation_loop_batch_root}" verifying-test-flake
      if ! verify_same_head_flake "${validation_loop_batch_root}" \
        "${validation_loop_worktree}"; then
        return 4
      fi
    fi
    policy_class=$(failure_field "${validation_loop_batch_root}" failureClass)
    policy_stage=$(failure_field "${validation_loop_batch_root}" stage)
    decision=$(failure_policy_decide "${validation_loop_batch_root}" "${policy_class}" \
      "${policy_stage:-validation-${validation_loop_mode}}" \
      "${validation_loop_head_sha}") || return 8
    case "${decision}" in
      RETRY_SAME_HEAD) ;;
      RETRY_ENVIRONMENT)
        worktree_environment_ensure "${validation_loop_worktree}" \
          >>"${validation_loop_batch_root}/validation-${validation_loop_mode}.log" 2>&1 || true
        retry_delay=${ZERP_ISSUE_ENVIRONMENT_RETRY_WAIT_SECONDS:-5}
        case "${retry_delay}" in '' | *[!0-9]*) retry_delay=5 ;; esac
        [ "${retry_delay}" -eq 0 ] || sleep "${retry_delay}"
        ;;
      REPAIR_CODE) return 4 ;;
      BLOCK_AUTOMATION | BLOCK_ENVIRONMENT | BLOCK_EXTERNAL) return 8 ;;
      *) return 8 ;;
    esac
  done
}

validation_baseline() {
  run_incremental_validation_resilient baseline "$@" || return $?
  batch_root=$1
  worktree=$2
  base_sha=$3
  head_sha=$4
  if [ -n "$(git -C "${worktree}" status --porcelain)" ]; then
    append_timeline "${batch_root}" validation-dirty baseline automation '' "${head_sha}" \
      'Baseline passed but modified the candidate; running release instead of promoting evidence'
    validation_release "${batch_root}" "${worktree}" "${base_sha}" "${head_sha}"
    return $?
  fi
  jq '.mode = "release" | .promotedFrom = "baseline"' \
    "${batch_root}/validation-evidence.json" >"${batch_root}/gate-evidence.json.new"
  mv "${batch_root}/gate-evidence.json.new" "${batch_root}/gate-evidence.json"
  append_timeline "${batch_root}" gate-passed release '' '' "${head_sha}" \
    'Baseline full validation passed unchanged and became release evidence'
}

validation_reverify() {
  run_incremental_validation_resilient reverify "$@"
}

validation_release() {
  run_final_gate_resilient "$@"
}

run_fast_gate_resilient() {
  batch_root=$1
  worktree=$2
  base_sha=$3
  head_sha=$4
  evidence_file="${batch_root}/fast-gate-evidence.json"
  fast_log="${batch_root}/fast-gate.log"
  command_path=${gate_command:-${worktree}/scripts/change-gate.sh}
  e2e_env_file=$(ensure_primary_e2e_env) || return 8
  pnpm_wrapper_dir="${worktree}/.scratch/.issue-local-bin"
  while :; do
    set_batch_phase "${batch_root}" fast-gate
    rm -f "${evidence_file}"
    if ! (
      stage_host_gate_env "${worktree}"
      trap 'remove_managed_host_env "${worktree}"' EXIT HUP INT TERM
      cd "${worktree}"
      PATH="${pnpm_wrapper_dir}:${PATH}" COREPACK_ROOT=1 \
        ZERP_E2E_ENV_FILE="${e2e_env_file}" ZERP_GATE_EVIDENCE_FILE="${evidence_file}" \
        "${command_path}" --fast "${base_sha}"
    ) >"${fast_log}" 2>&1; then
      {
        printf 'Host fast gate failed for candidate %s.\n\nFocused error excerpt:\n\n' "${head_sha}"
        tail -n 140 "${fast_log}" | sed '/^dist\/assets\//d'
      } >"${batch_root}/failure.md"
      if grep -Eiq 'cannot connect to (the )?docker|docker daemon|connection refused|no space left|temporary failure|TLS handshake|network is unreachable|timed? out|port is already allocated' \
        "${fast_log}"; then
        write_structured_failure "${batch_root}" environment fast-gate "${head_sha}" \
          gate 'Host fast-gate environment failed'
        decision=$(failure_policy_decide "${batch_root}" environment fast-gate "${head_sha}") || return 8
        if [ "${decision}" != RETRY_ENVIRONMENT ]; then
          return 8
        fi
        worktree_environment_ensure "${worktree}" >>"${fast_log}" 2>&1 || true
        retry_delay=${ZERP_ISSUE_ENVIRONMENT_RETRY_WAIT_SECONDS:-5}
        case "${retry_delay}" in '' | *[!0-9]*) retry_delay=5 ;; esac
        [ "${retry_delay}" -eq 0 ] || sleep "${retry_delay}"
        continue
      fi
      write_structured_failure "${batch_root}" product fast-gate "${head_sha}" \
        gate 'Deterministic host fast gate failed'
      return 4
    fi
    if jq -e --arg head "${head_sha}" --arg base "${base_sha}" '
      .version == 1 and .status == "passed" and .mode == "fast" and
      .head == $head and .base == $base
    ' "${evidence_file}" >/dev/null 2>&1; then
      append_timeline "${batch_root}" gate-passed fast-gate '' '' "${head_sha}" \
        'Host fast gate passed with exact-head evidence'
      return 0
    fi
    {
      printf 'Host fast gate returned invalid evidence for candidate %s.\n\n' "${head_sha}"
      tail -n 140 "${fast_log}" | sed '/^dist\/assets\//d'
    } >"${batch_root}/failure.md"
    write_structured_failure "${batch_root}" automation fast-gate-evidence "${head_sha}" \
      gate 'Host fast gate returned invalid exact-head evidence'
    decision=$(failure_policy_decide "${batch_root}" automation \
      fast-gate-evidence "${head_sha}") || return 8
    if [ "${decision}" != RETRY_SAME_HEAD ]; then
      return 8
    fi
    retry_delay=${ZERP_ISSUE_AUTOMATION_RETRY_WAIT_SECONDS:-2}
    case "${retry_delay}" in '' | *[!0-9]*) retry_delay=2 ;; esac
    [ "${retry_delay}" -eq 0 ] || sleep "${retry_delay}"
  done
}

run_final_gate_resilient() {
  batch_root=$1
  worktree=$2
  base_sha=$3
  head_sha=$4
  while :; do
    set_batch_phase "${batch_root}" final-gate
    if run_final_gate "${batch_root}" "${worktree}" "${base_sha}" "${head_sha}"; then
      append_timeline "${batch_root}" gate-passed final-gate '' '' "${head_sha}" \
        'Complete host validation passed'
      return 0
    fi
    policy_class=$(failure_field "${batch_root}" failureClass)
    if [ "${policy_class}" = test-flake ]; then
      set_batch_phase "${batch_root}" verifying-test-flake
      if ! verify_same_head_flake "${batch_root}" "${worktree}"; then
        return 4
      fi
    fi
    policy_class=$(failure_field "${batch_root}" failureClass)
    policy_stage=$(failure_field "${batch_root}" stage)
    decision=$(failure_policy_decide "${batch_root}" "${policy_class}" \
      "${policy_stage:-final-gate}" "${head_sha}") || {
      write_structured_failure "${batch_root}" automation "${policy_stage:-final-gate}" \
        "${head_sha}" controller 'Final gate did not produce a valid failure-policy decision'
      return 8
    }
    case "${decision}" in
      RETRY_SAME_HEAD) ;;
      RETRY_ENVIRONMENT)
        set_batch_phase "${batch_root}" recovering-environment
        worktree_environment_ensure "${worktree}" >>"${batch_root}/gate.log" 2>&1 || true
        retry_delay=${ZERP_ISSUE_ENVIRONMENT_RETRY_WAIT_SECONDS:-5}
        case "${retry_delay}" in '' | *[!0-9]*) retry_delay=5 ;; esac
        [ "${retry_delay}" -eq 0 ] || sleep "${retry_delay}"
        ;;
      REPAIR_CODE) return 4 ;;
      BLOCK_AUTOMATION | BLOCK_ENVIRONMENT | BLOCK_EXTERNAL) return 8 ;;
      *) return 8 ;;
    esac
  done
}

reviewed_candidate_head() {
  batch_root=$1
  worktree=$2
  base_sha=$3
  result_file="${batch_root}/implementation.json"
  marker_file="${batch_root}/gate-attempted-head"
  [ -r "${result_file}" ] || return 1
  [ -z "$(git -C "${worktree}" status --porcelain)" ] || return 1
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  [ "${head_sha}" != "${base_sha}" ] || return 1
  marker_head=$(cat "${marker_file}" 2>/dev/null || true)
  [ "${marker_head}" != "${head_sha}" ] || return 1
  jq -e --arg head "${head_sha}" '
    (.status == "completed" or .status == "blocked") and
    .commitSha == $head and .review == "passed"
  ' "${result_file}" >/dev/null || return 1
  printf '%s\n' "${head_sha}"
}

verified_gate_candidate_head() {
  batch_root=$1
  worktree=$2
  base_sha=$3
  result_file="${batch_root}/implementation.json"
  evidence_file="${batch_root}/gate-evidence.json"
  marker_file="${batch_root}/gate-attempted-head"
  [ -r "${result_file}" ] && [ -r "${evidence_file}" ] || return 1
  [ -z "$(git -C "${worktree}" status --porcelain)" ] || return 1
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  [ "${head_sha}" != "${base_sha}" ] || return 1
  [ "$(cat "${marker_file}" 2>/dev/null || true)" = "${head_sha}" ] || return 1
  jq -e --arg head "${head_sha}" '
    (.status == "completed" or .status == "blocked") and
    .commitSha == $head and .review == "passed"
  ' "${result_file}" >/dev/null || return 1
  jq -e --arg head "${head_sha}" --arg base "${base_sha}" '
    .status == "passed" and .head == $head and .base == $base and
    (.runtimeFingerprint | type == "string" and length > 0)
  ' "${evidence_file}" >/dev/null || return 1
  printf '%s\n' "${head_sha}"
}

record_automation_failure() {
  batch_root=$1
  worktree=$2
  previous_head=$3
  stage=$4
  summary=$5
  log_file=${6:-}
  current_head=$(git -C "${worktree}" rev-parse HEAD 2>/dev/null || printf '%s' "${previous_head}")
  dirty=0
  [ -z "$(git -C "${worktree}" status --porcelain 2>/dev/null || true)" ] || dirty=1
  failure_stage=${stage}
  failure_head=${previous_head}
  if [ "${current_head}" != "${previous_head}" ] || [ "${dirty}" = 1 ]; then
    failure_stage=automation-after-code-change
    failure_head=${current_head}
    summary="${summary}; candidate code changed before automation failed"
  fi
  {
    printf '%s\n' "${summary}"
    if [ -n "${log_file}" ] && [ -r "${log_file}" ]; then
      printf '\nFocused error excerpt:\n\n'
      tail -n 80 "${log_file}"
    fi
  } >"${batch_root}/failure.md"
  write_structured_failure "${batch_root}" automation "${failure_stage}" "${failure_head}" \
    controller "${summary}"
  if [ "${current_head}" = "${previous_head}" ] && [ "${dirty}" = 0 ]; then
    cancel_repair_budget_reservation "${batch_root}" || return 8
  else
    budget_file=$(repair_budget_file "${batch_root}")
    jq --arg current_head "${current_head}" '
      if .total > 0 and ((.events[-1].failureFingerprint // null) == null) then
        .events[-1].candidateHead = $current_head |
        .events[-1].automationAfterCodeChange = true
      else error("latest code attempt cannot record an automation code change") end
    ' "${budget_file}" >"${budget_file}.new" || {
      rm -f "${budget_file}.new"
      return 8
    }
    mv "${budget_file}.new" "${budget_file}"
  fi
  if [ "${dirty}" = 1 ]; then
    return 8
  fi
  if [ "${current_head}" != "${previous_head}" ]; then
    git -C "${worktree}" merge-base --is-ancestor "${previous_head}" "${current_head}" || return 8
    write_value "${batch_root}/reviewed-head" "${previous_head}"
    write_value "${batch_root}/automation-review-base" "${previous_head}"
  fi
  decision=$(failure_policy_decide "${batch_root}" automation \
    "${failure_stage}" "${failure_head}") || return 8
  if [ "${decision}" = RETRY_SAME_HEAD ]; then
    return 6
  fi
  return 8
}

run_implement() {
  feature=$1
  batch_root=$2
  worktree=$3
  base_sha=$4
  git_metadata=$(verify_worktree_git_metadata "${worktree}") || return 1
  worktree_git_dir=$(printf '%s' "${git_metadata}" | cut -f1)
  common_git_dir=$(printf '%s' "${git_metadata}" | cut -f2)
  pnpm_wrapper_dir="${worktree}/.scratch/.issue-local-bin"
  [ -x "${pnpm_wrapper_dir}/pnpm" ] || { echo 'implementation cannot find the prepared exact pnpm wrapper' >&2; return 1; }
  previous_head=$(git -C "${worktree}" rev-parse HEAD)
  result_file="${batch_root}/implementation.json"
  evidence_file="${batch_root}/gate-evidence.json"
  failure_file="${batch_root}/failure.md"
  reviewed_head_file="${batch_root}/reviewed-head"
  review_base=$(cat "${reviewed_head_file}" 2>/dev/null || true)
  case "${review_base}" in '' | *[!0-9a-f]*) review_base= ;; esac
  if [ -n "${review_base}" ] && [ "${#review_base}" -ne 40 ]; then review_base=; fi
  if [ -n "${review_base}" ]; then
    git -C "${worktree}" merge-base --is-ancestor "${review_base}" "${previous_head}" || review_base=
  fi
  preexisting_review_delta=0
  if [ -n "${review_base}" ] && [ "${previous_head}" != "${review_base}" ]; then
    preexisting_review_delta=1
  fi
  write_value "${batch_root}/repair-stage" code-review-gate
  set_batch_phase "${batch_root}" implementing
  if consume_repair_budget "${batch_root}" code-review-gate "${previous_head}"; then
    :
  else
    budget_result=$?
    case "${budget_result}" in
      2) block_for_repair_budget "${batch_root}" 'the cumulative code/review/gate repair limit was reached' ;;
      3) block_for_repair_budget "${batch_root}" 'the same normalized failure fingerprint already recurred twice' ;;
      *) block_for_repair_budget "${batch_root}" 'the cumulative repair audit is invalid or unavailable' ;;
    esac
    return 5
  fi
  rm -f "${result_file}" "${evidence_file}"
  attempt_number=$(jq -r .total "$(repair_budget_file "${batch_root}")")
  attempt_dir=$(printf '%s/code-attempts/%03d' "${batch_root}" "${attempt_number}")
  mkdir -p "${attempt_dir}"
  chmod 700 "${batch_root}/code-attempts" "${attempt_dir}"
  codex_log="${attempt_dir}/codex.log"
  if ! {
    # shellcheck disable=SC2016 # prompt intentionally contains skill and Markdown literals
    printf 'Use $implement to implement the complete local ticket batch at `.scratch/%s/issues`.\n' "${feature}"
    # shellcheck disable=SC2016 # prompt intentionally contains Markdown literals
    printf 'Follow every `Blocked by` edge and satisfy every acceptance criterion in one branch and one PR.\n'
    # shellcheck disable=SC2016 # prompt intentionally contains Markdown literals
    printf 'The batch base commit is `%s`. Do not access GitHub, push, deploy, or read preview or production credentials.\n' "${base_sha}"
    printf 'Before editing, inventory every user-visible wire value affected by the batch, including statuses, enums, type or entity identifiers, and backend business errors; identify the shared Chinese frontend mapping for each.\n'
    printf 'Start implementation only after every known value has a Chinese business label or is explicitly confirmed not user-visible; implement each required mapping in the same end-to-end slice and derive selectable options from that mapping.\n'
    printf 'Use TDD at the agreed repository seams. Run focused tests while working.\n'
    if jq -e '.largeBatch == true' "${batch_root}/risk.json" >/dev/null 2>&1; then
      printf 'This is a large batch. Implement it in Blocked-by dependency order, commit coherent dependency layers, and run focused checks after each layer so defects are found before the final review.\n'
    fi
    printf 'On a repair attempt, trust the recorded root failure: do not rerun unaffected stages already shown as passed; run only tests focused on the failure and your changes.\n'
    if [ -n "${review_base}" ]; then
      # shellcheck disable=SC2016 # prompt intentionally contains Markdown delimiters
      printf 'The complete batch already passed two-axis review through `%s`. Use that SHA as the fixed point and review only the repair delta from it to the final head; preserve the earlier review evidence and do not reread or re-review unchanged history.\n' "${review_base}"
      if [ "${preexisting_review_delta}" = 1 ]; then
        if [ "$(cat "${batch_root}/automation-review-base" 2>/dev/null || true)" = "${review_base}" ]; then
          printf 'The current clean head contains an unreviewed automated commit created before the previous controller failure. Review that delta as-is and create another commit only if the delta needs changes.\n'
        else
          printf 'The current clean head already contains an unreviewed manual repair after that fixed point. Review it as-is and create another commit only if the delta needs changes.\n'
        fi
      fi
    fi
    # shellcheck disable=SC2016 # prompt intentionally contains shell and Markdown literals
    printf 'For every pnpm command, prepend `PATH="%s:$PATH"` and invoke `%s/pnpm`; login shells reset PATH and package scripts invoke pnpm recursively.\n' "${pnpm_wrapper_dir}" "${pnpm_wrapper_dir}"
    # shellcheck disable=SC2016 # prompt intentionally contains Markdown code delimiters
    printf 'Do not run `scripts/change-gate.sh` in the sandbox. The host Validation module runs fast, baseline, delta reverify, and final release checks after your clean commit.\n'
    if [ "${preexisting_review_delta}" = 1 ]; then
      printf 'Return the current clean reviewed head with status=completed, validation=not_run, review=passed, and its commitSha. Commit only if review finds changes are required.\n'
    else
      printf 'Commit the completed batch to the current branch and return status=completed, validation=not_run, review=passed, and commitSha for that commit.\n'
    fi
    if [ -r "${failure_file}" ]; then
      printf '\nRepair evidence from the previous attempt:\n'
      sed -n '1,240p' "${failure_file}"
    fi
  } | PATH="${pnpm_wrapper_dir}:${PATH}" COREPACK_ROOT=1 ZERP_ISSUE_BASE_SHA="${base_sha}" ZERP_GATE_EVIDENCE_FILE="${evidence_file}" \
    "${codex_bin}" --ask-for-approval never exec --ephemeral --ignore-user-config \
      --model gpt-5.6-sol -c model_reasoning_effort=high \
      --sandbox workspace-write \
      -c sandbox_workspace_write.network_access=false \
      -c web_search=disabled -c features.apps=false \
      -C "${worktree}" \
      --add-dir "${worktree_git_dir}" \
      --add-dir "${common_git_dir}" \
      --output-schema "${schema}" -o "${result_file}" - \
      >"${codex_log}" 2>&1; then
    worktree_environment_ensure "${worktree}" >>"${codex_log}" 2>&1 || true
    record_automation_failure "${batch_root}" "${worktree}" "${previous_head}" \
      code-review-gate 'Codex implementation or review process failed' "${codex_log}"
    return $?
  fi
  head_sha=$(git -C "${worktree}" rev-parse HEAD 2>/dev/null || printf '%s' "${previous_head}")
  ensure_worktree_environment_resilient "${batch_root}" "${worktree}" \
    "${head_sha}" worktree-environment "${codex_log}" || return $?
  [ -r "${result_file}" ] || {
    record_automation_failure "${batch_root}" "${worktree}" "${previous_head}" \
      code-review-gate 'Codex did not return a structured result' "${codex_log}"
    return $?
  }
  status=$(jq -r .status "${result_file}")
  case "${status}" in
    completed) ;;
    needs_input | blocked) return 3 ;;
    *)
      record_automation_failure "${batch_root}" "${worktree}" "${previous_head}" \
        code-review-gate "Codex returned invalid implementation status: ${status}" "${codex_log}"
      return $?
      ;;
  esac
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  if [ "${head_sha}" = "${previous_head}" ] && [ "${preexisting_review_delta}" != 1 ]; then
    record_automation_failure "${batch_root}" "${worktree}" "${previous_head}" \
      code-review-gate 'Implementation repair produced no new commit' "${codex_log}"
    return $?
  fi
  [ -z "$(git -C "${worktree}" status --porcelain)" ] || {
    record_automation_failure "${batch_root}" "${worktree}" "${previous_head}" \
      code-review-gate 'Implementation left a dirty worktree' "${codex_log}"
    return $?
  }
  jq -e --arg head "${head_sha}" '
    .status == "completed" and .commitSha == $head and
    (.validation == "not_run" or .validation == "passed") and .review == "passed"
  ' "${result_file}" >/dev/null || {
    record_automation_failure "${batch_root}" "${worktree}" "${previous_head}" \
      code-review-gate 'Implementation completion evidence is incomplete' "${codex_log}"
    return $?
  }
  run_fast_gate_resilient "${batch_root}" "${worktree}" "${base_sha}" "${head_sha}" || return $?
  rm -f "${batch_root}/automation-review-base"
  write_value "${reviewed_head_file}" "${head_sha}"
  append_timeline "${batch_root}" code-reviewed review '' '' "${head_sha}" \
    'Implementation and two-axis review completed'
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
    created=$(printf '%s' "${payload}" | "${gh_bin}" api --method POST \
      "repos/${repo}/issues" --input -) || return 1
    remote_number=$(printf '%s' "${created}" | jq -er \
      '.number | select(type == "number")') || return 1
    remote_id=$(printf '%s' "${created}" | jq -er \
      '.id | select(type == "number")') || return 1
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
  existing_pr=0
  [ ! -f "${pr_file}" ] || existing_pr=1
  if [ ! -f "${pr_file}" ]; then
    git -C "${worktree}" push -u origin "HEAD:refs/heads/${branch}" >/dev/null || return 1
    recovered_pr=$("${gh_bin}" pr list --repo "${repo}" --head "${branch}" --state all \
      --json number --jq '.[0].number // empty') || return 1
    if [ -n "${recovered_pr}" ]; then
      write_value "${pr_file}" "${recovered_pr}"
      existing_pr=1
    fi
  fi
  if [ ! -f "${pr_file}" ]; then
    update_pr_body "${feature}" "${batch_root}" "${worktree}" "${preview_url}" "${fingerprint}"
    body_file="${batch_root}/pr-body.md"
    title=$(printf '%s' "${feature}" | tr '-' ' ')
    pr_url=$("${gh_bin}" pr create --repo "${repo}" --base main --head "${branch}" \
      --title "${title}" --body-file "${body_file}") || return 1
    pr=$(printf '%s' "${pr_url}" | sed -n 's#.*/pull/\([0-9][0-9]*\).*#\1#p')
    [ -n "${pr}" ] || { echo "could not parse PR number from ${pr_url}" >&2; return 1; }
    write_value "${pr_file}" "${pr}"
  fi
  pr=$(cat "${pr_file}")
  if [ "${existing_pr}" = 1 ]; then
    pr_json=$("${gh_bin}" pr view "${pr}" --repo "${repo}" \
      --json state,headRefName,headRefOid,baseRefName,body) || return 1
    state=$(printf '%s' "${pr_json}" | jq -r .state)
    remote_branch=$(printf '%s' "${pr_json}" | jq -r .headRefName)
    remote_head=$(printf '%s' "${pr_json}" | jq -r .headRefOid)
    base_branch=$(printf '%s' "${pr_json}" | jq -r .baseRefName)
    if [ "${state}" != OPEN ] || [ "${remote_branch}" != "${branch}" ] || \
      [ "${base_branch}" != main ] || ! printf '%s' "${remote_head}" | grep -Eq '^[0-9a-f]{40}$'; then
      echo "existing PR #${pr} does not match open ${branch} -> main" >&2
      return 1
    fi
    update_pr_body "${feature}" "${batch_root}" "${worktree}" "${preview_url}" "${fingerprint}"
    expected_marker="<!-- zerp-local-batch feature=${feature} head=${head_sha} fingerprint=${fingerprint} -->"
    body_matches=0
    printf '%s' "${pr_json}" | jq -r .body | grep -Fqx "${expected_marker}" && body_matches=1
    body_updated=0
    previous_body="${batch_root}/pr-body.previous.md"
    rm -f "${previous_body}"
    if [ "${body_matches}" != 1 ]; then
      printf '%s' "${pr_json}" | jq -r .body >"${previous_body}"
      "${gh_bin}" pr edit "${pr}" --repo "${repo}" \
        --body-file "${batch_root}/pr-body.md" >/dev/null || return 1
      body_updated=1
    fi
    if [ "${remote_head}" != "${head_sha}" ]; then
      if ! git -C "${worktree}" push \
        --force-with-lease="refs/heads/${branch}:${remote_head}" \
        origin "HEAD:refs/heads/${branch}" >/dev/null; then
        if [ "${body_updated}" = 1 ]; then
          "${gh_bin}" pr edit "${pr}" --repo "${repo}" \
            --body-file "${previous_body}" >/dev/null || \
            log "failed to restore PR #${pr} body after rejected head update"
        fi
        rm -f "${previous_body}"
        return 1
      fi
    fi
    rm -f "${previous_body}"
  fi
  printf '%s\n' "${pr}"
}

close_remote_issues() {
  manifest=$1
  tab=$(printf '\t')
  while IFS="${tab}" read -r _ remote_number _; do
    "${gh_bin}" issue close "${remote_number}" --repo "${repo}" \
      --comment '批次 PR 已合并，生产发布与公网健康验证成功。' >/dev/null || return 1
  done <"${manifest}"
}

release_preview() {
  feature=$1
  "${preview_close_command}" close "${feature}" >/dev/null 2>&1 || true
}

cleanup_completed_candidate() {
  worktree=$1
  branch=$2
  [ -d "${worktree}" ] || return 0
  [ "$(git -C "${worktree}" branch --show-current)" = "${branch}" ] || {
    log "completed candidate cleanup skipped: ${worktree} is not on ${branch}"
    return 1
  }
  [ -z "$(git -C "${worktree}" status --porcelain)" ] || {
    log "completed candidate cleanup skipped: ${worktree} is not clean"
    return 1
  }
  remove_managed_host_env "${worktree}"
  rm -rf "${worktree}/.pnpm-store" "${worktree}/node_modules" \
    "${worktree}/frontend/node_modules" \
    "${worktree}/.scratch/.issue-local-bin"
  if ! git -C "${primary_root}" worktree remove "${worktree}"; then
    log "failed to remove completed candidate worktree ${worktree}"
    return 1
  fi
  if git -C "${primary_root}" show-ref --verify --quiet "refs/heads/${branch}" &&
    ! git -C "${primary_root}" branch -D "${branch}" >/dev/null; then
    log "failed to remove completed candidate branch ${branch}"
    return 1
  fi
}

deploy_preview() {
  feature=$1
  batch_root=$2
  worktree=$3
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  preview_output="${batch_root}/preview.env.new"
  preview_log="${batch_root}/preview.log"
  while :; do
    set_batch_phase "${batch_root}" public-preview
    preview_result=0
    ZERP_ISSUE_WORKTREE="${worktree}" \
      "${preview_command}" "${feature}" "${head_sha}" \
      >"${preview_output}" 2>"${preview_log}" || preview_result=$?
    preview_environment_result=0
    ensure_worktree_environment_resilient "${batch_root}" "${worktree}" \
      "${head_sha}" preview-environment "${preview_log}" || preview_environment_result=$?
    if [ "${preview_environment_result}" -ne 0 ]; then
      rm -f "${preview_output}"
      [ "${preview_environment_result}" = 4 ] && return 9
      return 8
    fi
    if [ "${preview_result}" -ne 0 ]; then
      if [ -s "${preview_output}" ]; then
        {
          printf '\nPreview stdout before failure:\n\n'
          cat "${preview_output}"
        } >>"${preview_log}"
      fi
      rm -f "${preview_output}"
      {
        printf 'Public preview failed for candidate %s.\n\nPreview log:\n\n' "${head_sha}"
        cat "${preview_log}"
      } >"${batch_root}/failure.md"
      if grep -Eiq 'exact (SHA|marker).*mismatch|fingerprint.*mismatch|mismatch.*fingerprint' \
        "${preview_log}"; then
        write_structured_failure "${batch_root}" automation preview-identity \
          "${head_sha}" preview 'Preview identity did not match the requested candidate'
        decision=$(failure_policy_decide "${batch_root}" automation \
          preview-identity "${head_sha}") || return 8
        if [ "${decision}" != RETRY_SAME_HEAD ]; then
          return 8
        fi
        continue
      fi
      if grep -Eiq 'AssertionError|expect\(|locator|business assertion' "${preview_log}"; then
        write_structured_failure "${batch_root}" product public-preview "${head_sha}" \
          preview 'Public browser acceptance found a product behavior mismatch'
        return 9
      fi
      write_structured_failure "${batch_root}" environment public-preview "${head_sha}" \
        preview 'Public preview infrastructure failed'
      decision=$(failure_policy_decide "${batch_root}" environment \
        public-preview "${head_sha}") || return 4
      if [ "${decision}" != RETRY_ENVIRONMENT ]; then
        return 4
      fi
      retry_delay=${ZERP_ISSUE_ENVIRONMENT_RETRY_WAIT_SECONDS:-5}
      case "${retry_delay}" in '' | *[!0-9]*) retry_delay=5 ;; esac
      [ "${retry_delay}" -eq 0 ] || sleep "${retry_delay}"
      continue
    fi
    preview_url=$(sed -n 's/^url=//p' "${preview_output}")
    fingerprint=$(sed -n 's/^fingerprint=//p' "${preview_output}")
    expected=$(jq -r .runtimeFingerprint "${batch_root}/gate-evidence.json")
    evidence_lines=$(wc -l <"${preview_output}" | tr -d ' ')
    valid_lines=$(grep -Ec '^(url|fingerprint)=' "${preview_output}" || true)
    if [ "${evidence_lines}" != 2 ] || [ "${valid_lines}" != 2 ] ||
      [ -z "${preview_url}" ] || [ "${fingerprint}" != "${expected}" ]; then
      {
        printf '\nInvalid preview stdout evidence:\n\n'
        cat "${preview_output}"
      } >>"${preview_log}"
      rm -f "${preview_output}"
      {
        printf 'Preview evidence is invalid or fingerprint %s does not match gate fingerprint %s.\n' \
          "${fingerprint:-missing}" "${expected}"
        printf 'Full log: %s\n' "${preview_log}"
      } >"${batch_root}/failure.md"
      write_structured_failure "${batch_root}" automation preview-evidence "${head_sha}" \
        preview 'Preview command returned invalid exact-SHA evidence'
      decision=$(failure_policy_decide "${batch_root}" automation \
        preview-evidence "${head_sha}") || return 8
      if [ "${decision}" != RETRY_SAME_HEAD ]; then
        return 8
      fi
      continue
    fi
    mv "${preview_output}" "${batch_root}/preview.env"
    append_timeline "${batch_root}" preview-passed public-preview '' '' "${head_sha}" \
      'Exact-SHA public preview passed'
    return 0
  done
}

validation_evidence_head() {
  batch_root=$1
  worktree=$2
  base_sha=$3
  evidence_file="${batch_root}/validation-evidence.json"
  [ -r "${evidence_file}" ] || return 1
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  evidence_head=$(jq -r --arg base "${base_sha}" '
    select(.version == 1 and (.mode == "baseline" or .mode == "reverify") and
      .base == $base and (.head | type == "string" and length == 40) and
      (.stages | type == "array" and length > 0)) | .head
  ' "${evidence_file}" 2>/dev/null || true)
  [ "${#evidence_head}" -eq 40 ] || return 1
  git -C "${worktree}" merge-base --is-ancestor "${evidence_head}" "${head_sha}" || return 1
  printf '%s\n' "${evidence_head}"
}

validate_candidate() {
  batch_root=$1
  worktree=$2
  base_sha=$3
  head_sha=$4
  if verified_gate_candidate_head "${batch_root}" "${worktree}" "${base_sha}" >/dev/null; then
    return 0
  fi
  if evidence_head=$(validation_evidence_head "${batch_root}" "${worktree}" "${base_sha}"); then
    if [ "${evidence_head}" = "${head_sha}" ] && \
      jq -e '.status == "passed"' "${batch_root}/validation-evidence.json" >/dev/null; then
      validation_release "${batch_root}" "${worktree}" "${base_sha}" "${head_sha}"
      return $?
    fi
    if [ "${evidence_head}" != "${head_sha}" ]; then
      run_repair_preflight "${batch_root}" "${worktree}" || return $?
      validation_reverify "${batch_root}" "${worktree}" "${base_sha}" "${head_sha}" || return $?
      validation_release "${batch_root}" "${worktree}" "${base_sha}" "${head_sha}"
      return $?
    fi
  fi
  validation_baseline "${batch_root}" "${worktree}" "${base_sha}" "${head_sha}"
}

implement_and_preview() {
  feature=$1
  batch_root=$2
  worktree=$3
  base_sha=$4
  issues_dir=$5
  if verified_gate_candidate_head "${batch_root}" "${worktree}" "${base_sha}" >/dev/null; then
    if deploy_preview "${feature}" "${batch_root}" "${worktree}"; then
      rm -f "${batch_root}/failure.md" "${batch_root}/failure.json"
      return 0
    else
      preview_result=$?
      if [ "${preview_result}" = 4 ]; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" preview-blocked
        return 1
      fi
      if [ "${preview_result}" = 8 ]; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" automation-blocked
        return 1
      fi
    fi
  fi
  if resumed_head=$(reviewed_candidate_head "${batch_root}" "${worktree}" "${base_sha}"); then
    write_value "${batch_root}/reviewed-head" "${resumed_head}"
    if consume_repair_budget "${batch_root}" gate "${resumed_head}"; then
      gate_result=0
      validate_candidate "${batch_root}" "${worktree}" "${base_sha}" "${resumed_head}" || gate_result=$?
      if [ "${gate_result}" = 0 ]; then
        if deploy_preview "${feature}" "${batch_root}" "${worktree}"; then
          rm -f "${batch_root}/failure.md" "${batch_root}/failure.json"
          return 0
        else
          preview_result=$?
          if [ "${preview_result}" = 4 ]; then
            mark_batch "${issues_dir}" blocked
            set_batch_state "${batch_root}" preview-blocked
            return 1
          fi
          if [ "${preview_result}" = 8 ]; then
            mark_batch "${issues_dir}" blocked
            set_batch_state "${batch_root}" automation-blocked
            return 1
          fi
        fi
      elif [ "${gate_result}" = 8 ]; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" "$(failure_policy_block_state "${batch_root}")"
        return 1
      elif ! apply_product_failure_policy "${batch_root}" "${issues_dir}" "${worktree}"; then
        return 1
      fi
    else
      budget_result=$?
      if [ "${budget_result}" = 2 ]; then
        block_for_repair_budget "${batch_root}" 'the cumulative code/review/gate repair limit was reached'
      elif [ "${budget_result}" = 3 ]; then
        block_for_repair_budget "${batch_root}" 'the same normalized failure fingerprint already recurred twice'
      else
        block_for_repair_budget "${batch_root}" 'the cumulative repair audit is invalid or unavailable'
      fi
      mark_batch "${issues_dir}" blocked
      set_batch_state "${batch_root}" blocked
      return 1
    fi
  fi
  while :; do
    if run_implement "${feature}" "${batch_root}" "${worktree}" "${base_sha}"; then
      candidate_head=$(git -C "${worktree}" rev-parse HEAD)
      validation_result=0
      validate_candidate "${batch_root}" "${worktree}" "${base_sha}" "${candidate_head}" || \
        validation_result=$?
      if [ "${validation_result}" = 0 ]; then
        if deploy_preview "${feature}" "${batch_root}" "${worktree}"; then
          rm -f "${batch_root}/failure.md" "${batch_root}/failure.json"
          return 0
        else
          preview_result=$?
          if [ "${preview_result}" = 4 ]; then
            mark_batch "${issues_dir}" blocked
            set_batch_state "${batch_root}" preview-blocked
            return 1
          fi
          if [ "${preview_result}" = 8 ]; then
            mark_batch "${issues_dir}" blocked
            set_batch_state "${batch_root}" automation-blocked
            return 1
          fi
        fi
      elif [ "${validation_result}" = 8 ]; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" "$(failure_policy_block_state "${batch_root}")"
        return 1
      elif ! apply_product_failure_policy "${batch_root}" "${issues_dir}" "${worktree}"; then
        return 1
      fi
    else
      result=$?
      if [ "${result}" = 3 ] && [ -r "${batch_root}/implementation.json" ]; then
        status=$(jq -r .status "${batch_root}/implementation.json")
        case "${status}" in needs_input) status=needs-input ;; esac
        mark_batch "${issues_dir}" "${status}"
        set_batch_state "${batch_root}" "${status}"
        return 1
      fi
      if [ "${result}" = 5 ]; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" blocked
        return 1
      fi
      if [ "${result}" = 6 ]; then
        continue
      fi
      if [ "${result}" = 8 ]; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" "$(failure_policy_block_state "${batch_root}")"
        return 1
      fi
      if [ "${result}" != 4 ]; then
        printf 'Implementation, review, or final gate repair failed.\n' >"${batch_root}/failure.md"
      fi
      if ! apply_product_failure_policy "${batch_root}" "${issues_dir}" "${worktree}"; then
        return 1
      fi
    fi
  done
}

run_external_step() {
  external_batch_root=$1
  external_stage=$2
  external_head_sha=$3
  shift 3
  external_step_log="${external_batch_root}/${external_stage}.log"
  while :; do
    set_batch_phase "${external_batch_root}" "${external_stage}"
    if "$@" >"${external_step_log}" 2>&1; then
      cat "${external_step_log}"
      append_timeline "${external_batch_root}" external-step-passed "${external_stage}" '' '' \
        "${external_head_sha}" "${external_stage} completed"
      return 0
    fi
    {
      printf 'External step %s failed for candidate %s.\n\nFocused error excerpt:\n\n' \
        "${external_stage}" "${external_head_sha}"
      tail -n 120 "${external_step_log}"
    } >"${external_batch_root}/failure.md"
    write_structured_failure "${external_batch_root}" external "${external_stage}" \
      "${external_head_sha}" controller "${external_stage} failed"
    decision=$(failure_policy_decide "${external_batch_root}" external \
      "${external_stage}" "${external_head_sha}") || return 1
    if [ "${decision}" != RETRY_EXTERNAL ]; then
      return 1
    fi
    retry_delay=${ZERP_ISSUE_EXTERNAL_RETRY_WAIT_SECONDS:-5}
    case "${retry_delay}" in '' | *[!0-9]*) retry_delay=5 ;; esac
    [ "${retry_delay}" -eq 0 ] || sleep "${retry_delay}"
  done
}

refresh_main() {
  feature=$1
  batch_root=$2
  worktree=$3
  issues_dir=$4
  base_sha=$(cat "${batch_root}/base-sha")
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  run_external_step "${batch_root}" fetch-main "${head_sha}" \
    git -C "${primary_root}" fetch origin main --prune || return 8
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

read_required_check_evidence() {
  batch_root=$1
  worktree=$2
  pr=$3
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  pr_evidence="${batch_root}/required-check-pr.json"
  checks_evidence="${batch_root}/required-checks.json"
  api_evidence="${batch_root}/required-check-runs.json"
  result_evidence="${batch_root}/required-check-evidence.json"
  logs_evidence="${batch_root}/required-check-failures.log"
  "${gh_bin}" pr view "${pr}" --repo "${repo}" \
    --json number,headRefOid,url >"${pr_evidence}" || return 1
  "${gh_bin}" pr checks "${pr}" --repo "${repo}" --required \
    --json name,state,link,bucket,workflow >"${checks_evidence}" 2>"${batch_root}/required-checks.err" || true
  "${gh_bin}" api "repos/${repo}/commits/${head_sha}/check-runs?filter=latest&per_page=100" \
    >"${api_evidence}" || return 1
  jq -n --slurpfile pr "${pr_evidence}" --slurpfile checks "${checks_evidence}" \
    --slurpfile api "${api_evidence}" --arg head "${head_sha}" \
    --argjson pr_number "${pr}" --arg repo "${repo}" '
    ($checks[0] | map(select(
      .bucket == "fail" or
      (.state == "FAILURE" or .state == "CANCELLED" or .state == "TIMED_OUT" or
       .state == "ACTION_REQUIRED" or .state == "STARTUP_FAILURE" or .state == "STALE")
    ))) as $failed |
    ($api[0].check_runs // []) as $runs |
    select($pr[0].number == $pr_number and $pr[0].headRefOid == $head and
      $pr[0].url == ("https://github.com/" + $repo + "/pull/" + ($pr_number | tostring))) |
    select(($failed | length) > 0) |
    select(all($failed[]; . as $failure |
      any($runs[];
        .name == $failure.name and .details_url == $failure.link and
        .head_sha == $head and .app.slug == "github-actions" and
        (.status == "completed") and
        (.conclusion != null and .conclusion != "success" and
         .conclusion != "neutral" and .conclusion != "skipped") and
        (.details_url | test("^https://github[.]com/" + $repo +
          "/actions/runs/[0-9]+/job/[0-9]+$"))
      )
    )) |
    {version:1,head:$head,pr:$pr_number,prUrl:$pr[0].url,
      failures:[$failed[] as $failure |
        $runs[] | select(.name == $failure.name and .details_url == $failure.link) |
        {name:.name,workflow:$failure.workflow,state:$failure.state,
         conclusion:.conclusion,link:.details_url,provider:.app.slug}]}
  ' >"${result_evidence}.new" || {
    rm -f "${result_evidence}.new"
    return 1
  }
  mv "${result_evidence}.new" "${result_evidence}"
  : >"${logs_evidence}"
  jq -r '.failures[] | [.name,.link] | @tsv' "${result_evidence}" |
    while IFS="$(printf '\t')" read -r check_name check_link; do
      run_id=$(printf '%s\n' "${check_link}" | sed -n 's#.*/actions/runs/\([0-9][0-9]*\)/job/[0-9][0-9]*$#\1#p')
      job_id=$(printf '%s\n' "${check_link}" | sed -n 's#.*/job/\([0-9][0-9]*\)$#\1#p')
      [ -n "${run_id}" ] && [ -n "${job_id}" ] || exit 1
      printf '==> %s run=%s job=%s\n' "${check_name}" "${run_id}" "${job_id}" \
        >>"${logs_evidence}"
      "${gh_bin}" run view "${run_id}" --repo "${repo}" --job "${job_id}" \
        --log-failed >>"${logs_evidence}" 2>&1 || exit 1
    done || return 1
}

required_check_evidence_signature() {
  jq -cS '{head,failures:(.failures | sort_by(.name,.link) |
    map({name,workflow,state,conclusion,link,provider}))}' "$1" |
    shasum -a 256 | awk '{print $1}'
}

classify_required_check_failure() {
  evidence_file=$1
  log_file=$2
  if grep -Eiq 'hosted runner.*lost connection|runner.*(offline|shutdown)|Docker.*(pull|registry)|TLS|timed? out|network|connection reset|no space left|package registry' \
    "${log_file}"; then
    printf 'environment\n'
  elif jq -e 'any(.failures[]; (.name | test("e2e|playwright"; "i")))' \
    "${evidence_file}" >/dev/null || \
    grep -Eiq 'Playwright|browser process.*(exit|crash)|flaky test' "${log_file}"; then
    printf 'test-flake\n'
  elif jq -e 'all(.failures[];
    (.name | test("^(contracts|frontend|backend|containers)$")))' \
    "${evidence_file}" >/dev/null; then
    printf 'product\n'
  else
    printf 'automation\n'
  fi
}

wait_checks_and_merge() {
  feature=$1
  batch_root=$2
  worktree=$3
  issues_dir=$4
  branch=$5
  pr=$6
  registration_attempts=${ZERP_ISSUE_CHECK_REGISTRATION_ATTEMPTS:-60}
  registration_delay=${ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS:-5}
  while :; do
    set_batch_phase "${batch_root}" github-checks
    if "${gh_bin}" pr checks "${pr}" --repo "${repo}" --watch --required \
      >"${batch_root}/checks.log" 2>&1; then
      rm -f "${batch_root}/required-check-confirmation.json" \
        "${batch_root}/failure.md" "${batch_root}/failure.json"
      break
    fi
    if grep -Eq 'no (required )?checks reported' "${batch_root}/checks.log"; then
      if [ "${registration_attempts}" -le 0 ]; then
        head_sha=$(git -C "${worktree}" rev-parse HEAD)
        printf 'GitHub did not register required checks for PR #%s within the wait budget.\n' \
          "${pr}" >"${batch_root}/failure.md"
        write_structured_failure "${batch_root}" external github-check-registration \
          "${head_sha}" github 'Required checks were not registered in time'
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" external-blocked
        release_preview "${feature}"
        return 1
      fi
      registration_attempts=$((registration_attempts - 1))
      [ "${registration_delay}" -eq 0 ] || sleep "${registration_delay}"
      continue
    fi
    head_sha=$(git -C "${worktree}" rev-parse HEAD)
    if grep -Eiq 'TLS handshake|HTTP (429|5[0-9][0-9])|timed? out|temporary failure|network is unreachable|connection reset|could not resolve' \
      "${batch_root}/checks.log"; then
      {
        printf 'GitHub required-check query failed for PR #%s.\n\n' "${pr}"
        sed -n '1,120p' "${batch_root}/checks.log"
      } >"${batch_root}/failure.md"
      write_structured_failure "${batch_root}" external github-checks "${head_sha}" \
        github 'GitHub check status was temporarily unavailable'
      decision=$(failure_policy_decide "${batch_root}" external \
        github-checks "${head_sha}") || decision=BLOCK_EXTERNAL
      if [ "${decision}" = RETRY_EXTERNAL ]; then
        [ "${registration_delay}" -eq 0 ] || sleep "${registration_delay}"
        continue
      fi
      mark_batch "${issues_dir}" blocked
      set_batch_state "${batch_root}" external-blocked
      release_preview "${feature}"
      return 1
    fi
    evidence_file="${batch_root}/required-check-evidence.json"
    evidence_log="${batch_root}/required-check-failures.log"
    confirmation_file="${batch_root}/required-check-confirmation.json"
    if ! read_required_check_evidence "${batch_root}" "${worktree}" "${pr}"; then
      {
        printf 'GitHub required-check evidence could not be verified for PR #%s at %s.\n\n' \
          "${pr}" "${head_sha}"
        sed -n '1,120p' "${batch_root}/checks.log"
      } >"${batch_root}/failure.md"
      write_structured_failure "${batch_root}" external github-check-evidence "${head_sha}" \
        github 'Required-check source or exact-head evidence was unavailable'
      decision=$(failure_policy_decide "${batch_root}" external \
        github-check-evidence "${head_sha}") || decision=BLOCK_EXTERNAL
      if [ "${decision}" = RETRY_EXTERNAL ]; then
        [ "${registration_delay}" -eq 0 ] || sleep "${registration_delay}"
        continue
      fi
      mark_batch "${issues_dir}" blocked
      set_batch_state "${batch_root}" external-blocked
      release_preview "${feature}"
      return 1
    fi
    evidence_signature=$(required_check_evidence_signature "${evidence_file}")
    confirmed_signature=$(jq -r --arg head "${head_sha}" '
      select(.head == $head) | .signature // empty
    ' "${confirmation_file}" 2>/dev/null || true)
    if [ "${confirmed_signature}" != "${evidence_signature}" ]; then
      {
        printf 'GitHub required checks need same-SHA confirmation for PR #%s at %s.\n\n' \
          "${pr}" "${head_sha}"
        cat "${evidence_file}"
        printf '\nFailed job excerpts:\n\n'
        sed -n '1,160p' "${evidence_log}"
      } >"${batch_root}/failure.md"
      write_structured_failure "${batch_root}" external github-check-confirmation \
        "${head_sha}" github 'Required-check failure is awaiting same-SHA confirmation'
      decision=$(failure_policy_decide "${batch_root}" external \
        github-check-confirmation "${head_sha}") || decision=BLOCK_EXTERNAL
      if [ "${decision}" != RETRY_EXTERNAL ]; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" "$(failure_policy_block_state "${batch_root}")"
        release_preview "${feature}"
        return 1
      fi
      jq -n --arg head "${head_sha}" --arg signature "${evidence_signature}" \
        '{version:1,head:$head,signature:$signature}' >"${confirmation_file}.new"
      mv "${confirmation_file}.new" "${confirmation_file}"
      [ "${registration_delay}" -eq 0 ] || sleep "${registration_delay}"
      continue
    fi
    failure_class=$(classify_required_check_failure "${evidence_file}" "${evidence_log}")
    failure_names=$(jq -r '[.failures[].name] | unique | join(",")' "${evidence_file}")
    {
      printf 'GitHub required checks failed twice on the same SHA for PR #%s.\n' "${pr}"
      printf 'Verified failed checks: %s\n\n' "${failure_names}"
      cat "${evidence_file}"
      printf '\nFailed job excerpts:\n\n'
      sed -n '1,200p' "${evidence_log}"
    } >"${batch_root}/failure.md"
    write_structured_failure "${batch_root}" "${failure_class}" \
      "github-required-checks:${failure_names}" "${head_sha}" github \
      'A verified required check failed twice on the same commit'
    decision=$(failure_policy_decide "${batch_root}" "${failure_class}" \
      "github-required-checks:${failure_names}" "${head_sha}") || decision=BLOCK_AUTOMATION
    case "${decision}" in
      RETRY_SAME_HEAD | RETRY_ENVIRONMENT | RETRY_EXTERNAL)
        [ "${registration_delay}" -eq 0 ] || sleep "${registration_delay}"
        continue
        ;;
      BLOCK_AUTOMATION | BLOCK_ENVIRONMENT | BLOCK_EXTERNAL)
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" "$(failure_policy_block_state "${batch_root}")"
        release_preview "${feature}"
        return 1
        ;;
      REPAIR_CODE) ;;
      *)
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" automation-blocked
        release_preview "${feature}"
        return 1
        ;;
    esac
    write_value "${batch_root}/repair-stage" gate
    if ! apply_product_failure_policy "${batch_root}" "${issues_dir}" "${worktree}"; then
      release_preview "${feature}"
      return 1
    fi
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
      if ! run_external_step "${batch_root}" publish-repaired-head "${current_head}" \
        git -C "${worktree}" push \
        --force-with-lease="refs/heads/${branch}:${previous_head}" \
        origin "HEAD:refs/heads/${branch}" >/dev/null; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" external-blocked
        release_preview "${feature}"
        return 1
      fi
      if ! run_external_step "${batch_root}" update-pr-body "${current_head}" \
        "${gh_bin}" pr edit "${pr}" --repo "${repo}" \
          --body-file "${batch_root}/pr-body.md" >/dev/null; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" external-blocked
        release_preview "${feature}"
        return 1
      fi
      continue
    fi
    base_sha=$(cat "${batch_root}/base-sha")
    if run_implement "${feature}" "${batch_root}" "${worktree}" "${base_sha}"; then
      candidate_head=$(git -C "${worktree}" rev-parse HEAD)
      validation_result=0
      validate_candidate "${batch_root}" "${worktree}" "${base_sha}" "${candidate_head}" || \
        validation_result=$?
      if [ "${validation_result}" = 8 ]; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" "$(failure_policy_block_state "${batch_root}")"
        release_preview "${feature}"
        return 1
      fi
      if [ "${validation_result}" != 0 ]; then
        if ! apply_product_failure_policy "${batch_root}" "${issues_dir}" "${worktree}"; then
          release_preview "${feature}"
          return 1
        fi
        continue
      fi
    else
      result=$?
      if [ "${result}" = 3 ] && [ -r "${batch_root}/implementation.json" ]; then
        status=$(jq -r .status "${batch_root}/implementation.json")
        case "${status}" in needs_input) status=needs-input ;; esac
        mark_batch "${issues_dir}" "${status}"
        set_batch_state "${batch_root}" "${status}"
        release_preview "${feature}"
        return 1
      fi
      if [ "${result}" = 5 ]; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" blocked
        release_preview "${feature}"
        return 1
      fi
      if [ "${result}" = 6 ]; then
        continue
      fi
      if [ "${result}" = 8 ]; then
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" "$(failure_policy_block_state "${batch_root}")"
        release_preview "${feature}"
        return 1
      fi
      if [ "${result}" != 4 ]; then
        printf 'Implementation or review repair failed.\n' >"${batch_root}/failure.md"
      fi
      if ! apply_product_failure_policy "${batch_root}" "${issues_dir}" "${worktree}"; then
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
    repaired_head=$(git -C "${worktree}" rev-parse HEAD)
    if ! run_external_step "${batch_root}" publish-repaired-head "${repaired_head}" \
      git -C "${worktree}" push origin "HEAD:refs/heads/${branch}" >/dev/null; then
      mark_batch "${issues_dir}" blocked
      set_batch_state "${batch_root}" external-blocked
      release_preview "${feature}"
      return 1
    fi
    if ! run_external_step "${batch_root}" update-pr-body "${repaired_head}" \
      "${gh_bin}" pr edit "${pr}" --repo "${repo}" \
        --body-file "${batch_root}/pr-body.md" >/dev/null; then
      mark_batch "${issues_dir}" blocked
      set_batch_state "${batch_root}" external-blocked
      release_preview "${feature}"
      return 1
    fi
  done
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  if ! run_external_step "${batch_root}" request-auto-merge "${head_sha}" \
    "${gh_bin}" pr merge "${pr}" --repo "${repo}" --auto --squash --delete-branch \
    >/dev/null; then
    mark_batch "${issues_dir}" blocked
    set_batch_state "${batch_root}" external-blocked
    release_preview "${feature}"
    return 1
  fi
  attempts=${ZERP_ISSUE_MERGE_WAIT_ATTEMPTS:-120}
  delay=${ZERP_ISSUE_MERGE_WAIT_SECONDS:-5}
  while [ "${attempts}" -gt 0 ]; do
    if ! pr_json=$(run_external_step "${batch_root}" wait-merge "${head_sha}" \
      "${gh_bin}" pr view "${pr}" --repo "${repo}" --json state,mergeCommit); then
      mark_batch "${issues_dir}" blocked
      set_batch_state "${batch_root}" external-blocked
      release_preview "${feature}"
      return 1
    fi
    merge_sha=$(printf '%s' "${pr_json}" | jq -r '.mergeCommit.oid // ""')
    if [ "$(printf '%s' "${pr_json}" | jq -r .state)" = MERGED ] && [ -n "${merge_sha}" ]; then
      printf '%s\n' "${merge_sha}"
      return 0
    fi
    sleep "${delay}"
    attempts=$((attempts - 1))
  done
  printf 'PR #%s did not merge within the wait budget.\n' "${pr}" >"${batch_root}/failure.md"
  write_structured_failure "${batch_root}" external wait-merge "${head_sha}" github \
    'Auto-merge did not complete in time'
  mark_batch "${issues_dir}" blocked
  set_batch_state "${batch_root}" external-blocked
  release_preview "${feature}"
  return 1
}

run_batch() {
  issues_dir=$1
  feature=$(basename "$(dirname "${issues_dir}")")
  batch_root="${runtime_root}/batches/${feature}"
  worktree="${runtime_root}/worktrees/${feature}"
  branch="automation/local-${feature}"
  mkdir -p "${batch_root}"
  write_batch_risk "${issues_dir}" "${batch_root}"
  validate_tickets "${issues_dir}"
  claim_batch "${issues_dir}"
  prepare_result=0
  prepare_worktree "${feature}" "${issues_dir}" "${batch_root}" "${worktree}" "${branch}" \
    >"${batch_root}/prepare.log" 2>&1 || prepare_result=$?
  while [ "${prepare_result}" -ne 0 ]; do
    failure_class=$(_worktree_environment_failure_class "${prepare_result}")
    {
      printf 'Controller environment preparation failed before Codex started.\n\n'
      tail -n 120 "${batch_root}/prepare.log"
    } >"${batch_root}/failure.md"
    head_sha=$(git -C "${worktree}" rev-parse HEAD 2>/dev/null || \
      cat "${batch_root}/base-sha" 2>/dev/null || true)
    write_structured_failure "${batch_root}" "${failure_class}" preparing-worktree \
      "${head_sha}" controller 'Candidate environment preparation failed'
    decision=$(failure_policy_decide "${batch_root}" "${failure_class}" preparing-worktree \
      "${head_sha}") || decision=BLOCK_ENVIRONMENT
    case "${decision}" in
      RETRY_ENVIRONMENT | RETRY_SAME_HEAD)
        retry_delay=${ZERP_ISSUE_ENVIRONMENT_RETRY_WAIT_SECONDS:-5}
        case "${retry_delay}" in '' | *[!0-9]*) retry_delay=5 ;; esac
        [ "${retry_delay}" -eq 0 ] || sleep "${retry_delay}"
        prepare_result=0
        prepare_worktree "${feature}" "${issues_dir}" "${batch_root}" "${worktree}" "${branch}" \
          >"${batch_root}/prepare.log" 2>&1 || prepare_result=$?
        ;;
      REPAIR_CODE) break ;;
      *)
        mark_batch "${issues_dir}" blocked
        set_batch_state "${batch_root}" "$(failure_policy_block_state "${batch_root}")"
        return 1
        ;;
    esac
  done
  base_sha=$(cat "${batch_root}/base-sha")
  set_batch_phase "${batch_root}" claimed
  notify_batch_event "${batch_root}" in-progress

  if [ ! -f "${batch_root}/preview.env" ]; then
    if ! implement_and_preview "${feature}" "${batch_root}" "${worktree}" "${base_sha}" "${issues_dir}"; then
      release_preview "${feature}"
      return 1
    fi
  fi

  # Remote operations begin only after the complete local batch and public preview passed.
  preview_url=$(sed -n 's/^url=//p' "${batch_root}/preview.env")
  fingerprint=$(sed -n 's/^fingerprint=//p' "${batch_root}/preview.env")
  set_batch_phase "${batch_root}" refreshing-main
  if ! refresh_main "${feature}" "${batch_root}" "${worktree}" "${issues_dir}"; then
    if [ ! -r "${batch_root}/state" ]; then
      mark_batch "${issues_dir}" blocked
      set_batch_state "${batch_root}" "$(failure_policy_block_state "${batch_root}")"
    fi
    release_preview "${feature}"
    return 1
  fi
  preview_url=$(sed -n 's/^url=//p' "${batch_root}/preview.env")
  fingerprint=$(sed -n 's/^fingerprint=//p' "${batch_root}/preview.env")
  head_sha=$(git -C "${worktree}" rev-parse HEAD)
  if ! run_external_step "${batch_root}" publish-issues "${head_sha}" \
    publish_issues "${feature}" "${issues_dir}" "${batch_root}" >/dev/null; then
    mark_batch "${issues_dir}" blocked
    set_batch_state "${batch_root}" external-blocked
    release_preview "${feature}"
    return 1
  fi
  set_batch_phase "${batch_root}" publishing-pr
  if ! pr=$(run_external_step "${batch_root}" publish-pr "${head_sha}" \
    publish_pr "${feature}" "${batch_root}" "${worktree}" "${branch}" \
      "${preview_url}" "${fingerprint}"); then
    mark_batch "${issues_dir}" blocked
    set_batch_state "${batch_root}" external-blocked
    release_preview "${feature}"
    return 1
  fi
  notify_batch_event "${batch_root}" pr-open
  if ! merge_sha=$(wait_checks_and_merge "${feature}" "${batch_root}" "${worktree}" \
    "${issues_dir}" "${branch}" "${pr}"); then
    if [ ! -r "${batch_root}/state" ]; then
      mark_batch "${issues_dir}" blocked
      set_batch_state "${batch_root}" blocked
    fi
    return 1
  fi
  set_batch_phase "${batch_root}" production
  if ! ZERP_ISSUE_WORKTREE="${worktree}" \
    "${production_command}" "${pr}" "${merge_sha}" \
      >"${batch_root}/production.env" 2>"${batch_root}/production.log"; then
    {
      printf 'Production verification failed for merge commit %s.\n\n' "${merge_sha}"
      tail -n 120 "${batch_root}/production.log"
    } >"${batch_root}/failure.md"
    write_structured_failure "${batch_root}" environment production "${merge_sha}" \
      production 'Production deployment or verification failed'
    mark_batch "${issues_dir}" blocked
    set_batch_state "${batch_root}" production-blocked
    : >"${runtime_root}/disabled"
    "${gh_bin}" pr comment "${pr}" --repo "${repo}" \
      --body "生产提交 \`${merge_sha}\` 验证失败；后续本地批次已暂停，未执行数据库回滚或恢复动作。" >/dev/null || true
    return 1
  fi
  if ! run_external_step "${batch_root}" close-issues "${merge_sha}" \
    close_remote_issues "${batch_root}/remote-issues.tsv" >/dev/null; then
    log "verified batch ${feature} completed, but remote Issue cleanup needs attention"
    append_timeline "${batch_root}" cleanup-warning close-issues external close-issues \
      "${merge_sha}" 'Production is verified but remote Issue cleanup failed'
  fi
  for ticket in "${issues_dir}"/*.md; do complete_ticket "${ticket}"; done
  set_batch_state "${batch_root}" "done"
  release_preview "${feature}"
  cleanup_completed_candidate "${worktree}" "${branch}" ||
    log "verified batch ${feature} completed, but candidate cleanup needs attention"
  log "local ticket batch ${feature} reached verified production through PR #${pr}"
}

run_command() {
  acquire_lock
  controller_signal() {
    result=$1
    trap - EXIT HUP INT TERM
    exit "${result}"
  }
  trap release_lock EXIT
  trap 'controller_signal 129' HUP
  trap 'controller_signal 130' INT
  trap 'controller_signal 143' TERM
  reconcile_batch_notifications
  [ ! -f "${runtime_root}/disabled" ] || { log 'local Issue delivery is stopped'; return 0; }
  [ "$("${codex_bin}" login status 2>&1 || true)" = 'Logged in using ChatGPT' ] || {
    log 'Codex must be logged in with ChatGPT'
    return 0
  }
  while :; do
    issues_dir=$(select_batch)
    [ -n "${issues_dir}" ] || return 0
    run_batch "${issues_dir}"
  done
}

stop_command() {
  : >"${runtime_root}/disabled"
  identity=$(verified_controller_identity 2>/dev/null || true)
  if [ -z "${identity}" ]; then
    controller_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
    if valid_pid "${controller_pid}" && kill -0 "${controller_pid}" 2>/dev/null; then
      echo "refusing to signal unverifiable controller pid ${controller_pid}" >&2
      return 1
    fi
    rm -rf "${lock_dir}"
    return 0
  fi
  controller_pid=$(printf '%s\n' "${identity}" | cut -f1)
  controller_pgid=$(printf '%s\n' "${identity}" | cut -f2)
  self_pgid=$(ps -o pgid= -p "$$" | tr -d ' ')
  if [ "${controller_pgid}" = "${self_pgid}" ] || [ "${controller_pgid}" -le 1 ]; then
    echo 'refusing to signal the caller process group' >&2
    return 1
  fi
  /bin/kill -TERM -- "-${controller_pgid}" 2>/dev/null || true
  remaining=${ZERP_ISSUE_STOP_GRACE_SECONDS:-120}
  case "${remaining}" in '' | *[!0-9]*) echo 'invalid stop grace period' >&2; return 1 ;; esac
  while process_group_alive "${controller_pgid}" && [ "${remaining}" -gt 0 ]; do
    sleep 1
    remaining=$((remaining - 1))
  done
  if process_group_alive "${controller_pgid}"; then
    /bin/kill -KILL -- "-${controller_pgid}" 2>/dev/null || true
    kill_remaining=${ZERP_ISSUE_STOP_KILL_SECONDS:-5}
    case "${kill_remaining}" in '' | *[!0-9]*) echo 'invalid stop kill period' >&2; return 1 ;; esac
    while process_group_alive "${controller_pgid}" && [ "${kill_remaining}" -gt 0 ]; do
      sleep 1
      kill_remaining=$((kill_remaining - 1))
    done
  fi
  if process_group_alive "${controller_pgid}"; then
    echo "failed to stop local Issue controller process group ${controller_pgid}" >&2
    return 1
  fi
  if [ "$(cat "${lock_dir}/pid" 2>/dev/null || true)" = "${controller_pid}" ]; then
    rm -rf "${lock_dir}"
  fi
}

retry_command() {
  feature=${1:?feature is required}
  issues_dir="${tracker_root}/${feature}/issues"
  [ -d "${issues_dir}" ] || { echo "unknown feature: ${feature}" >&2; exit 2; }
  [ ! -f "${runtime_root}/batches/${feature}/pr-number" ] || {
    echo "published batch ${feature} cannot be reset locally" >&2
    exit 1
  }
  if controller_pid=$(live_controller_pid 2>/dev/null); then
    echo "local Issue controller pid ${controller_pid} is active; run stop before retry" >&2
    exit 1
  fi
  lock_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
  if valid_pid "${lock_pid}" && kill -0 "${lock_pid}" 2>/dev/null; then
    echo "unverifiable local Issue controller pid ${lock_pid} may be active; refusing retry" >&2
    exit 1
  fi
  batch_root="${runtime_root}/batches/${feature}"
  worktree="${runtime_root}/worktrees/${feature}"
  base_sha=$(cat "${batch_root}/base-sha" 2>/dev/null || true)
  current_head=
  if [ -d "${worktree}" ]; then
    current_head=$(git -C "${worktree}" rev-parse HEAD 2>/dev/null || true)
  fi
  acknowledge_manual_retry "${batch_root}" "${current_head}" || {
    echo "invalid repair budget for batch ${feature}; refusing retry" >&2
    exit 1
  }
  if [ -r "${batch_root}/implementation.json" ] && [ -d "${worktree}" ]; then
    prior_reviewed=$(jq -r 'select(.review == "passed") | .commitSha // empty' \
      "${batch_root}/implementation.json" 2>/dev/null || true)
    case "${prior_reviewed}" in '' | *[!0-9a-f]*) prior_reviewed= ;; esac
    if [ -n "${prior_reviewed}" ] && [ "${#prior_reviewed}" -eq 40 ] &&
    git -C "${worktree}" merge-base --is-ancestor "${prior_reviewed}" "${current_head}" 2>/dev/null; then
      write_value "${batch_root}/reviewed-head" "${prior_reviewed}"
    fi
  fi
  preserve_gate_evidence=0
  if [ -n "${base_sha}" ] &&
    verified_gate_candidate_head "${batch_root}" "${worktree}" "${base_sha}" >/dev/null; then
    preserve_gate_evidence=1
  fi
  if [ "${preserve_gate_evidence}" = 1 ]; then
    rm -f "${batch_root}/repair-e2e.env" "${batch_root}/repair-integration.json"
  else
    failed_head=$(cat "${batch_root}/gate-attempted-head" 2>/dev/null || true)
    case "${failed_head}" in '' | *[!0-9a-f]*) failed_head= ;; esac
    if [ -n "${failed_head}" ] && [ "${#failed_head}" -eq 40 ] &&
      [ -n "${current_head}" ] &&
      git -C "${worktree}" merge-base --is-ancestor "${failed_head}" "${current_head}" 2>/dev/null; then
      write_value "${batch_root}/reviewed-head" "${failed_head}"
    fi
    if [ -n "${failed_head}" ] && [ -r "${batch_root}/gate.log" ]; then
      capture_failed_integration "${batch_root}" "${batch_root}/integration-result.json" "${failed_head}" || true
      capture_failed_e2e "${batch_root}" "${batch_root}/gate.log" "${failed_head}"
    fi
  fi
  if [ -r "${batch_root}/preview.env" ] ||
    [ "$(cat "${batch_root}/state" 2>/dev/null || true)" = preview-blocked ]; then
    release_preview "${feature}"
  fi
  rm -f "${batch_root}/preview.env" "${batch_root}/state"
  if [ "${preserve_gate_evidence}" = 1 ]; then
    mark_batch "${issues_dir}" ready-for-agent
    return 0
  fi
  rm -f "${batch_root}/gate-evidence.json"
  if [ -n "${base_sha}" ] && reviewed_candidate_head "${batch_root}" "${worktree}" "${base_sha}" >/dev/null; then
    head_sha=$(git -C "${worktree}" rev-parse HEAD)
    write_value "${batch_root}/reviewed-head" "${head_sha}"
    rm -f "${batch_root}/gate-attempted-head"
    mark_batch "${issues_dir}" ready-for-agent
    return 0
  fi
  if [ -r "${batch_root}/implementation.json" ] && [ -d "${worktree}" ] && [ -n "${base_sha}" ]; then
    head_sha=$(git -C "${worktree}" rev-parse HEAD)
    if [ -z "$(git -C "${worktree}" status --porcelain)" ] && [ "${head_sha}" != "${base_sha}" ] &&
      jq -e --arg head "${head_sha}" '
      (.status == "completed" or .status == "blocked") and
      .commitSha == $head and .review == "passed"
    ' "${batch_root}/implementation.json" >/dev/null 2>&1; then
      rm -f "${batch_root}/gate-attempted-head"
      write_value "${batch_root}/reviewed-head" "${head_sha}"
      mark_batch "${issues_dir}" ready-for-agent
      return 0
    fi
  fi
  rm -f "${batch_root}/implementation.json" "${batch_root}/gate-attempted-head"
  mark_batch "${issues_dir}" ready-for-agent
}

mkdir -p "${runtime_root}"
case "${1:-}" in
  run) [ "$#" -eq 1 ] || usage; ensure_dedicated_controller_group; run_command ;;
  status) [ "$#" -eq 1 ] || usage; status_command ;;
  diagnose) [ "$#" -eq 2 ] || usage; diagnose_command "$2" ;;
  retry) [ "$#" -eq 2 ] || usage; retry_command "$2" ;;
  stop) [ "$#" -eq 1 ] || usage; stop_command ;;
  start) [ "$#" -eq 1 ] || usage; rm -f "${runtime_root}/disabled" ;;
  *) usage ;;
esac
