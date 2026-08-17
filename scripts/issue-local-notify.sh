#!/bin/sh
set -eu

runtime_root=${ZERP_ISSUE_LOCAL_RUNTIME_ROOT:-/Users/hansonyu/code/zerp/backend/var/issue-delivery}
notification_root="${runtime_root}/notifications"
pending_root="${notification_root}/pending"
delivered_root="${notification_root}/delivered"
superseded_root="${notification_root}/superseded"
worker_lock="${notification_root}/worker.lock"
osascript_bin=${ZERP_OSASCRIPT_BIN:-osascript}
pgrep_bin=${ZERP_PGREP_BIN:-pgrep}

now_epoch() { printf '%s\n' "${ZERP_ISSUE_NOTIFICATION_NOW_EPOCH:-$(date +%s)}"; }

usage() {
  echo "usage: $0 {emit <batch-root> <event>|drain|status|test}" >&2
  exit 2
}

init_notification_store() {
  mkdir -p "${notification_root}" "${pending_root}" "${delivered_root}" \
    "${superseded_root}"
  chmod 700 "${notification_root}" "${pending_root}" "${delivered_root}" \
    "${superseded_root}"
}

acquire_worker_lock() {
  if mkdir "${worker_lock}" 2>/dev/null; then
    printf '%s\n' "$$" >"${worker_lock}/pid"
    return 0
  fi
  lock_pid=$(cat "${worker_lock}/pid" 2>/dev/null || true)
  case "${lock_pid}" in '' | *[!0-9]*) lock_pid= ;; esac
  if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then
    return 1
  fi
  unlink "${worker_lock}/pid" 2>/dev/null || true
  rmdir "${worker_lock}" 2>/dev/null || return 1
  mkdir "${worker_lock}" 2>/dev/null || return 1
  printf '%s\n' "$$" >"${worker_lock}/pid"
}

release_worker_lock() {
  if [ "$(cat "${worker_lock}/pid" 2>/dev/null || true)" = "$$" ]; then
    unlink "${worker_lock}/pid" 2>/dev/null || true
    rmdir "${worker_lock}" 2>/dev/null || true
  fi
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

emit_event() {
  batch_root=$1
  event=$2
  feature=$(basename "${batch_root}")
  phase=$(cat "${batch_root}/phase" 2>/dev/null || printf '-')
  state=$(cat "${batch_root}/state" 2>/dev/null || printf '-')
  [ "${state}" != - ] || [ "${event}" != in-progress ] || state=in-progress
  worktree="${runtime_root}/worktrees/${feature}"
  head=$(git -C "${worktree}" rev-parse HEAD 2>/dev/null || \
    cat "${batch_root}/candidate-head" 2>/dev/null || \
    cat "${batch_root}/base-sha" 2>/dev/null || printf unknown)
  pr=$(cat "${batch_root}/pr-number" 2>/dev/null || printf '-')
  total=$(jq -r '.total // 0' "${batch_root}/repair-budget.json" 2>/dev/null || printf 0)
  consecutive=$(jq -r '.consecutive // 0' "${batch_root}/repair-budget.json" 2>/dev/null || printf 0)
  non_product_retries=$(jq -r '.nonProductEvents | length' \
    "${batch_root}/repair-budget.json" 2>/dev/null || printf 0)
  started_at=$(jq -r '.startedAtEpoch // 0' \
    "${batch_root}/repair-budget.json" 2>/dev/null || printf 0)
  failure_class=$(jq -r '.failureClass // "-"' "${batch_root}/failure.json" 2>/dev/null || printf '-')
  failure_stage=$(jq -r '.stage // "-"' "${batch_root}/failure.json" 2>/dev/null || printf '-')
  policy_decision=$(jq -r '.policyDecision // "-"' \
    "${batch_root}/failure.json" 2>/dev/null || printf '-')
  retry_budget=$(jq -c '.retryBudget // {}' \
    "${batch_root}/failure.json" 2>/dev/null || printf '{}')
  created_at=$(now_epoch)
  case "${started_at}" in '' | *[!0-9]*) started_at=0 ;; esac
  if [ "${started_at}" -gt 0 ] && [ "${created_at}" -ge "${started_at}" ]; then
    elapsed_seconds=$((created_at - started_at))
  else
    elapsed_seconds=0
  fi
  case "${event}" in
    done) priority=terminal ;;
    blocked | automation-blocked | environment-blocked | external-blocked | preview-blocked | production-blocked | needs-input)
      priority=attention
      ;;
    retry-*) priority=retry ;;
    test-*) priority='test' ;;
    *) priority=progress ;;
  esac
  catch_up_events=0
  catch_up_retries=0
  case "${priority}" in
    terminal | attention)
      for pending_file in "${pending_root}"/*.json; do
        [ -r "${pending_file}" ] || continue
        if jq -e --arg feature "${feature}" '
          select(.feature == $feature and (.priority == "progress" or .priority == "retry") and
            (.attemptCount // 0) > 0)
        ' "${pending_file}" >/dev/null; then
          catch_up_events=$((catch_up_events + 1))
          [ "$(jq -r .priority "${pending_file}")" != retry ] || \
            catch_up_retries=$((catch_up_retries + 1))
          mv "${pending_file}" "${superseded_root}/$(basename "${pending_file}")"
        fi
      done
      ;;
  esac
  event_id=$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "${feature}" "${event}" "${head}" "${pr}" "${total}" "${consecutive}" \
    "${failure_class}" "${failure_stage}" "${non_product_retries}" \
    "${policy_decision}" "${retry_budget}" | shasum -a 256 | awk '{print $1}')
  emitted_event_id=${event_id}
  [ ! -e "${pending_root}/${event_id}.json" ] || return 0
  [ ! -e "${delivered_root}/${event_id}.json" ] || return 0
  jq -n --arg id "${event_id}" --arg feature "${feature}" --arg event "${event}" \
    --arg phase "${phase}" --arg state "${state}" --arg head "${head}" --arg pr "${pr}" \
    --arg failureClass "${failure_class}" --arg failureStage "${failure_stage}" \
    --arg policyDecision "${policy_decision}" --arg priority "${priority}" \
    --argjson total "${total}" --argjson consecutive "${consecutive}" \
    --argjson nonProductRetries "${non_product_retries}" \
    --argjson retryBudget "${retry_budget}" --argjson elapsedSeconds "${elapsed_seconds}" \
    --argjson createdAt "${created_at}" --argjson catchUpEvents "${catch_up_events}" \
    --argjson catchUpRetries "${catch_up_retries}" \
    '{version:1,id:$id,feature:$feature,event:$event,phase:$phase,state:$state,
      head:$head,pr:$pr,codeAttempts:$total,consecutive:$consecutive,
      nonProductRetries:$nonProductRetries,elapsedSeconds:$elapsedSeconds,
      failureClass:$failureClass,failureStage:$failureStage,
      policyDecision:$policyDecision,retryBudget:$retryBudget,priority:$priority,
      catchUpEvents:$catchUpEvents,catchUpRetries:$catchUpRetries,createdAt:$createdAt,
      attemptCount:0,nextAttemptAt:0,lastError:null,localFallbackAt:null,deliveredAt:null}' \
    >"${pending_root}/${event_id}.json.new"
  chmod 600 "${pending_root}/${event_id}.json.new"
  mv "${pending_root}/${event_id}.json.new" "${pending_root}/${event_id}.json"
}

event_body() {
  event_file=$1
  jq -r '
    def title:
      if .event == "in-progress" then "批次开始执行"
      elif .event == "preview-passed" then "公网预览已通过"
      elif .event == "pr-open" then "PR 已创建，已进入 CI"
      elif .event == "ci-passed" then "CI 已通过"
      elif .event == "merged" then "PR 已合并"
      elif .event == "done" then "批次已完成"
      elif (.event | startswith("test-")) then "iMessage 通知自检"
      elif (.priority == "attention") then "需要关注：批次已阻塞"
      elif (.event | startswith("retry-")) then "自动恢复或修复重试"
      else "批次进度" end;
    "ZERP 本地 Issue 自动交付\n" +
    title + "\n" +
    "批次=" + .feature + "\n" +
    "事件=" + .event + "\n" +
    "状态=" + .state + "\n" +
    "阶段=" + .phase + "\n" +
    "失败分类=" + .failureClass + "\n" +
    "head=" + .head + "\n" +
    "PR=" + .pr + "\n" +
    "批次耗时=" + (.elapsedSeconds|tostring) + "秒\n" +
    "代码尝试=" + (.codeAttempts|tostring) + "/9，修复次数=" +
      ([.codeAttempts - 1, 0] | max | tostring) + "/8，连续同错=" + (.consecutive|tostring) + "\n" +
    "非产品重试=" + (.nonProductRetries|tostring) +
      (if ((.retryBudget.sameSignatureCount // null) != null) then
        "，当前同错=" + (.retryBudget.sameSignatureCount|tostring) + "/" +
          (.retryBudget.sameSignatureLimit|tostring) +
        "，当前阶段=" + (.retryBudget.stageCount|tostring) + "/" +
          (.retryBudget.stageLimit|tostring) +
        "，批次=" + (.retryBudget.batchCount|tostring) + "/" +
          (.retryBudget.batchLimit|tostring)
      else "" end) + "，决策=" + .policyDecision +
    (if (.catchUpEvents // 0) > 0 then
      "\n补发摘要=合并过期进度" + (.catchUpEvents|tostring) +
      "条，其中重试" + (.catchUpRetries|tostring) + "条"
    else "" end)
  ' "${event_file}"
}

wait_for_send_process() {
  process_pid=$1
  timeout_seconds=$2
  elapsed_seconds=0
  process_timed_out=0
  while kill -0 "${process_pid}" >/dev/null 2>&1; do
    if [ "${elapsed_seconds}" -ge "${timeout_seconds}" ]; then
      process_timed_out=1
      kill "${process_pid}" >/dev/null 2>&1 || true
      wait "${process_pid}" >/dev/null 2>&1 || true
      return 1
    fi
    sleep 1
    elapsed_seconds=$((elapsed_seconds + 1))
  done
  wait "${process_pid}" >/dev/null 2>&1
}

send_event() {
  event_file=$1
  event_id=$(jq -r .id "${event_file}")
  send_error_file="${notification_root}/send-${event_id}.stderr"
  send_body_file="${notification_root}/send-${event_id}.body"
  recipient=$(message_recipient)
  if ! valid_message_recipient "${recipient}"; then
    send_error='recipient-unresolved'
    return 1
  fi
  body=$(event_body "${event_file}")
  printf '%s' "${body}" >"${send_body_file}.new"
  chmod 600 "${send_body_file}.new"
  mv "${send_body_file}.new" "${send_body_file}"
  timeout_seconds=${ZERP_ISSUE_MESSAGE_TIMEOUT_SECONDS:-20}
  case "${timeout_seconds}" in '' | *[!0-9]*) timeout_seconds=20 ;; esac
  ZERP_ISSUE_MESSAGE_RECIPIENT="${recipient}" \
    ZERP_ISSUE_MESSAGE_BODY_FILE="${send_body_file}" \
    "${osascript_bin}" - >/dev/null 2>"${send_error_file}" <<'APPLESCRIPT' &
on run argv
  set recipient to system attribute "ZERP_ISSUE_MESSAGE_RECIPIENT"
  set bodyPath to system attribute "ZERP_ISSUE_MESSAGE_BODY_FILE"
  set messageBody to read POSIX file bodyPath as «class utf8»
  with timeout of 15 seconds
    tell application "Messages"
      set matchingServices to every service whose service type = iMessage
      if (count of matchingServices) is 0 then error "service-unavailable" number 1001
      set targetService to 1st service whose service type = iMessage
      try
        set targetBuddy to buddy recipient of targetService
      on error
        error "recipient-unresolved" number 1002
      end try
      send messageBody to targetBuddy
    end tell
  end timeout
end run
APPLESCRIPT
  send_pid=$!
  if wait_for_send_process "${send_pid}" "${timeout_seconds}"; then
    unlink "${send_body_file}" 2>/dev/null || true
    unlink "${send_error_file}" 2>/dev/null || true
    return 0
  fi
  unlink "${send_body_file}" 2>/dev/null || true
  if [ "${process_timed_out}" = 1 ]; then
    send_error='timeout'
  elif grep -Eiq -- '-1743|not authorized.*apple event' "${send_error_file}"; then
    send_error='automation-denied'
  elif grep -Fq 'service-unavailable' "${send_error_file}"; then
    send_error='service-unavailable'
  elif grep -Fq 'recipient-unresolved' "${send_error_file}"; then
    send_error='recipient-unresolved'
  elif grep -Eiq -- '-1712|timed out' "${send_error_file}"; then
    send_error='timeout'
  else
    send_error='send-failed'
  fi
  unlink "${send_error_file}" 2>/dev/null || true
  return 1
}

send_local_fallback() {
  event_file=$1
  event_id=$(jq -r .id "${event_file}")
  fallback_body_file="${notification_root}/fallback-${event_id}.body"
  fallback_title_file="${notification_root}/fallback-${event_id}.title"
  title=$(jq -r '"ZERP 通知待补发：" + .feature' "${event_file}")
  body=$(event_body "${event_file}")
  printf '%s' "${title}" >"${fallback_title_file}"
  printf '%s' "${body}" >"${fallback_body_file}"
  chmod 600 "${fallback_title_file}" "${fallback_body_file}"
  fallback_result=0
  ZERP_ISSUE_NOTIFICATION_TITLE_FILE="${fallback_title_file}" \
    ZERP_ISSUE_MESSAGE_BODY_FILE="${fallback_body_file}" \
    "${osascript_bin}" - >/dev/null 2>&1 <<'APPLESCRIPT' || fallback_result=1
on run argv
  set titlePath to system attribute "ZERP_ISSUE_NOTIFICATION_TITLE_FILE"
  set bodyPath to system attribute "ZERP_ISSUE_MESSAGE_BODY_FILE"
  set notificationTitle to read POSIX file titlePath as «class utf8»
  set messageBody to read POSIX file bodyPath as «class utf8»
  display notification messageBody with title notificationTitle
end run
APPLESCRIPT
  unlink "${fallback_title_file}" 2>/dev/null || true
  unlink "${fallback_body_file}" 2>/dev/null || true
  return "${fallback_result}"
}

retry_delay() {
  case "$1" in
    1) printf '60\n' ;;
    2) printf '120\n' ;;
    3) printf '300\n' ;;
    4) printf '600\n' ;;
    *) printf '900\n' ;;
  esac
}

record_send_failure() {
  event_file=$1
  error_code=$2
  current_time=$(now_epoch)
  previous_attempts=$(jq -r '.attemptCount // 0' "${event_file}")
  attempt_count=$((previous_attempts + 1))
  next_attempt_at=$((current_time + $(retry_delay "${attempt_count}")))
  fallback_at=$(jq -r '.localFallbackAt // empty' "${event_file}")
  if [ -z "${fallback_at}" ] && send_local_fallback "${event_file}"; then
    fallback_at=${current_time}
  fi
  jq --arg error "${error_code}" --argjson attemptCount "${attempt_count}" \
    --argjson nextAttemptAt "${next_attempt_at}" --arg fallbackAt "${fallback_at}" '
      .attemptCount=$attemptCount | .nextAttemptAt=$nextAttemptAt | .lastError=$error |
      .localFallbackAt=(if $fallbackAt == "" then null else ($fallbackAt|tonumber) end)
    ' "${event_file}" >"${event_file}.new"
  chmod 600 "${event_file}.new"
  mv "${event_file}.new" "${event_file}"
  echo "remote iMessage notification pending (feature=$(jq -r .feature "${event_file}") error=${error_code} attempt=${attempt_count})" >&2
}

drain_events() {
  init_notification_store
  messages_was_running=0
  "${pgrep_bin}" -x Messages >/dev/null 2>&1 && messages_was_running=1
  find "${pending_root}" -type f -name '*.json' -exec \
    jq -r '[(.createdAt // 0), .id, input_filename] | @tsv' {} \; | \
    LC_ALL=C sort -n -k1,1 -k2,2 | cut -f3- |
    while IFS= read -r event_file; do
      [ -r "${event_file}" ] || continue
      current_time=$(now_epoch)
      next_attempt_at=$(jq -r '.nextAttemptAt // 0' "${event_file}")
      [ "${current_time}" -ge "${next_attempt_at}" ] || continue
      if send_event "${event_file}"; then
        delivered_at=$(now_epoch)
        delivered_file="${delivered_root}/$(basename "${event_file}")"
        jq --argjson deliveredAt "${delivered_at}" '.deliveredAt=$deliveredAt' \
          "${event_file}" >"${delivered_file}.new"
        chmod 600 "${delivered_file}.new"
        mv "${delivered_file}.new" "${delivered_file}"
        unlink "${event_file}"
      else
        record_send_failure "${event_file}" "${send_error}"
      fi
    done
  if [ "${messages_was_running}" = 0 ] && "${pgrep_bin}" -x Messages >/dev/null 2>&1; then
    "${osascript_bin}" -e 'tell application "Messages" to quit' >/dev/null 2>&1 || true
  fi
}

notification_status() {
  init_notification_store
  pending_count=$(find "${pending_root}" -type f -name '*.json' -print | wc -l | tr -d ' ')
  if [ "${pending_count}" -eq 0 ]; then
    echo 'notification=healthy pending=0 lastError=-'
    return 0
  fi
  last_error=$(find "${pending_root}" -type f -name '*.json' -exec \
    jq -r '[(.createdAt // 0), .id, (.lastError // "pending")] | @tsv' {} \; | \
    LC_ALL=C sort -n -k1,1 -k2,2 | tail -n 1 | cut -f3-)
  echo "notification=degraded pending=${pending_count} lastError=${last_error}"
}

drain_with_lock() {
  if acquire_worker_lock; then
    trap release_worker_lock EXIT HUP INT TERM
    drain_events
    release_worker_lock
    trap - EXIT HUP INT TERM
  fi
}

notification_test() {
  test_root="${notification_root}/self-test"
  mkdir -p "${test_root}"
  chmod 700 "${test_root}"
  printf '%s\n' notification-test >"${test_root}/phase"
  printf '%s\n' test >"${test_root}/state"
  printf '%s\n' unknown >"${test_root}/base-sha"
  test_event="test-$(now_epoch)"
  emit_event "${test_root}" "${test_event}"
  test_event_id=${emitted_event_id}
  drain_with_lock
  if [ -r "${delivered_root}/${test_event_id}.json" ]; then
    echo 'notification test delivered'
    return 0
  fi
  if [ -r "${pending_root}/${test_event_id}.json" ]; then
    error_code=$(jq -r '.lastError // "pending"' "${pending_root}/${test_event_id}.json")
  else
    error_code=worker-unavailable
  fi
  echo "notification test pending: ${error_code}" >&2
  return 1
}

init_notification_store
case "${1:-}" in
  emit) [ "$#" -eq 3 ] || usage; emit_event "$2" "$3" ;;
  drain)
    [ "$#" -eq 1 ] || usage
    drain_with_lock
    ;;
  status) [ "$#" -eq 1 ] || usage; notification_status ;;
  test) [ "$#" -eq 1 ] || usage; notification_test ;;
  *) usage ;;
esac
