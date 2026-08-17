#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-issue-local-notify-test.XXXXXX")
cleanup() {
  if [ "${KEEP_ISSUE_LOCAL_NOTIFY_TEST_TMP:-0}" = 1 ]; then
    echo "kept notification test workspace: ${tmp}" >&2
  else
    rm -rf "${tmp}"
  fi
}
trap cleanup EXIT HUP INT TERM

runtime="${tmp}/runtime"
batch="${runtime}/batches/inventory-query"
mkdir -p "${batch}" "${tmp}/bin"
printf '%s\n' 'issue-local-test@example.invalid' >"${runtime}/message-recipient"
printf '%s\n' 'implementing' >"${batch}/phase"
printf '%s\n' 'in-progress' >"${batch}/state"
printf '%s\n' '1111111111111111111111111111111111111111' >"${batch}/base-sha"
printf '%s\n' '{"version":2,"startedAtEpoch":900,"total":1,"consecutive":0,"nonProductEvents":[]}' \
  >"${batch}/repair-budget.json"

cat >"${tmp}/bin/osascript" <<'EOF'
#!/bin/sh
set -eu
case "${1:-}" in
  -)
    script=$(cat)
    if printf '%s' "${script}" | grep -Fq 'display notification'; then
      printf 'local-fallback\n' >>"${MOCK_MESSAGES}"
      exit 0
    fi
    case "${MOCK_OSASCRIPT_MODE:-success}" in
      success) printf '%s\n---\n' "${ZERP_ISSUE_MESSAGE_BODY}" >>"${MOCK_MESSAGES}" ;;
      fail) echo 'simulated send failure' >&2; exit 1 ;;
      denied) echo 'Not authorized to send Apple events. (-1743)' >&2; exit 1 ;;
      slow) sleep 2; printf '%s\n---\n' "${ZERP_ISSUE_MESSAGE_BODY}" >>"${MOCK_MESSAGES}" ;;
      *) exit 2 ;;
    esac
    ;;
  -e) exit 0 ;;
  *) exit 2 ;;
esac
EOF
chmod +x "${tmp}/bin/osascript"

cat >"${tmp}/bin/pgrep" <<'EOF'
#!/bin/sh
set -eu
test "$*" = '-x Messages'
exit 0
EOF
chmod +x "${tmp}/bin/pgrep"

notify() {
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${runtime}" \
  ZERP_OSASCRIPT_BIN="${tmp}/bin/osascript" \
  ZERP_PGREP_BIN="${tmp}/bin/pgrep" \
  MOCK_MESSAGES="${tmp}/messages" \
  MOCK_OSASCRIPT_MODE="${MOCK_OSASCRIPT_MODE:-success}" \
  ZERP_ISSUE_NOTIFICATION_NOW_EPOCH="${ZERP_ISSUE_NOTIFICATION_NOW_EPOCH:-1000}" \
  ZERP_ISSUE_MESSAGE_TIMEOUT_SECONDS="${ZERP_ISSUE_MESSAGE_TIMEOUT_SECONDS:-20}" \
    "${repo_root}/scripts/issue-local-notify.sh" "$@"
}

notify_in() {
  target_runtime=$1
  shift
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${target_runtime}" \
  ZERP_OSASCRIPT_BIN="${tmp}/bin/osascript" \
  ZERP_PGREP_BIN="${tmp}/bin/pgrep" \
  MOCK_MESSAGES="${tmp}/locked-messages" \
  MOCK_OSASCRIPT_MODE="${MOCK_OSASCRIPT_MODE:-success}" \
  ZERP_ISSUE_NOTIFICATION_NOW_EPOCH="${ZERP_ISSUE_NOTIFICATION_NOW_EPOCH:-5000}" \
  ZERP_ISSUE_MESSAGE_TIMEOUT_SECONDS=5 \
    "${repo_root}/scripts/issue-local-notify.sh" "$@"
}

notify emit "${batch}" implementing
test "$(find "${runtime}/notifications/pending" -type f -name '*.json' | wc -l | tr -d ' ')" = 1
notify drain
test "$(find "${runtime}/notifications/pending" -type f -name '*.json' | wc -l | tr -d ' ')" = 0
test "$(find "${runtime}/notifications/delivered" -type f -name '*.json' | wc -l | tr -d ' ')" = 1
grep -Fq '批次=inventory-query' "${tmp}/messages"
grep -Fq '事件=implementing' "${tmp}/messages"
grep -Fq '批次耗时=100秒' "${tmp}/messages"

printf '%s\n' 'fast-gate' >"${batch}/phase"
printf '%s\n' '{"version":2,"startedAtEpoch":900,"total":1,"consecutive":0,"nonProductEvents":[{"failureClass":"environment","stage":"fast-gate"}]}' \
  >"${batch}/repair-budget.json"
printf '%s\n' '{"failureClass":"environment","stage":"fast-gate","policyDecision":"RETRY_ENVIRONMENT","retryBudget":{"sameSignatureCount":1,"sameSignatureLimit":3,"stageCount":1,"stageLimit":5,"batchCount":1,"batchLimit":8,"elapsedSeconds":100,"deadlineSeconds":1200}}' \
  >"${batch}/failure.json"
notify emit "${batch}" fast-gate
MOCK_OSASCRIPT_MODE=fail notify drain
test "$(find "${runtime}/notifications/pending" -type f -name '*.json' | wc -l | tr -d ' ')" = 1
test "$(find "${runtime}/notifications/delivered" -type f -name '*.json' | wc -l | tr -d ' ')" = 1
pending=$(find "${runtime}/notifications/pending" -type f -name '*.json' -print | sed -n '1p')
jq -e '.attemptCount == 1 and .nextAttemptAt == 1060 and
  .lastError == "send-failed" and .localFallbackAt == 1000' "${pending}" >/dev/null
grep -Fq 'local-fallback' "${tmp}/messages"
notify status | grep -Fq 'notification=degraded pending=1 lastError=send-failed'

MOCK_OSASCRIPT_MODE=success ZERP_ISSUE_NOTIFICATION_NOW_EPOCH=1060 notify drain
test "$(find "${runtime}/notifications/pending" -type f -name '*.json' | wc -l | tr -d ' ')" = 0
test "$(find "${runtime}/notifications/delivered" -type f -name '*.json' | wc -l | tr -d ' ')" = 2
notify status | grep -Fq 'notification=healthy pending=0 lastError=-'
grep -Fq '非产品重试=1，当前同错=1/3，当前阶段=1/5，批次=1/8，决策=RETRY_ENVIRONMENT' \
  "${tmp}/messages"

printf '%s\n' 'validation-baseline' >"${batch}/phase"
ZERP_ISSUE_NOTIFICATION_NOW_EPOCH=2000 notify emit "${batch}" validation-baseline
MOCK_OSASCRIPT_MODE=slow ZERP_ISSUE_NOTIFICATION_NOW_EPOCH=2000 \
  ZERP_ISSUE_MESSAGE_TIMEOUT_SECONDS=1 notify drain
pending=$(find "${runtime}/notifications/pending" -type f -name '*.json' -print | sed -n '1p')
jq -e '.attemptCount == 1 and .lastError == "timeout"' "${pending}" >/dev/null

printf '%s\n' 'validation-reverify' >"${batch}/phase"
ZERP_ISSUE_NOTIFICATION_NOW_EPOCH=3000 notify emit "${batch}" validation-reverify
MOCK_OSASCRIPT_MODE=denied ZERP_ISSUE_NOTIFICATION_NOW_EPOCH=3000 notify drain
denied=$(find "${runtime}/notifications/pending" -type f -name '*.json' -print |
  while IFS= read -r event_file; do
    jq -e 'select(.event == "validation-reverify")' "${event_file}" >/dev/null && printf '%s\n' "${event_file}"
  done | sed -n '1p')
jq -e '.attemptCount == 1 and .lastError == "automation-denied"' "${denied}" >/dev/null

catchup_batch="${runtime}/batches/catchup-batch"
mkdir -p "${catchup_batch}"
printf '%s\n' 'in-progress' >"${catchup_batch}/state"
printf '%s\n' 'validation-reverify' >"${catchup_batch}/phase"
printf '%s\n' '2222222222222222222222222222222222222222' >"${catchup_batch}/base-sha"
printf '%s\n' '{"version":2,"total":3,"consecutive":1,"nonProductEvents":[]}' \
  >"${catchup_batch}/repair-budget.json"
ZERP_ISSUE_NOTIFICATION_NOW_EPOCH=4000 notify emit "${catchup_batch}" validation-reverify
ZERP_ISSUE_NOTIFICATION_NOW_EPOCH=4000 notify emit "${catchup_batch}" retry-REPAIR_CODE
MOCK_OSASCRIPT_MODE=fail ZERP_ISSUE_NOTIFICATION_NOW_EPOCH=4000 notify drain
printf '%s\n' 'done' >"${catchup_batch}/state"
printf '%s\n' 'done' >"${catchup_batch}/phase"
ZERP_ISSUE_NOTIFICATION_NOW_EPOCH=4001 notify emit "${catchup_batch}" 'done'
test "$(find "${runtime}/notifications/superseded" -type f -name '*.json' -exec \
  jq -r 'select(.feature == "catchup-batch") | .id' {} \; | wc -l | tr -d ' ')" = 2
terminal=$(find "${runtime}/notifications/pending" -type f -name '*.json' -exec \
  sh -c 'jq -e '\''select(.feature == "catchup-batch" and .event == "done")'\'' "$1" >/dev/null && printf "%s\n" "$1"' _ {} \; |
  sed -n '1p')
jq -e '.priority == "terminal" and .catchUpEvents == 2 and .catchUpRetries == 1' \
  "${terminal}" >/dev/null

locked_runtime="${tmp}/locked-runtime"
locked_batch="${locked_runtime}/batches/locked-batch"
mkdir -p "${locked_batch}"
printf '%s\n' 'issue-local-test@example.invalid' >"${locked_runtime}/message-recipient"
printf '%s\n' 'implementing' >"${locked_batch}/phase"
printf '%s\n' 'in-progress' >"${locked_batch}/state"
printf '%s\n' '3333333333333333333333333333333333333333' >"${locked_batch}/base-sha"
notify_in "${locked_runtime}" emit "${locked_batch}" implementing
MOCK_OSASCRIPT_MODE=slow notify_in "${locked_runtime}" drain &
first_drain=$!
sleep 1
MOCK_OSASCRIPT_MODE=slow notify_in "${locked_runtime}" drain
wait "${first_drain}"
test "$(grep -c '^批次=locked-batch$' "${tmp}/locked-messages")" = 1

test_runtime="${tmp}/test-runtime"
mkdir -p "${test_runtime}"
printf '%s\n' 'issue-local-test@example.invalid' >"${test_runtime}/message-recipient"
notify_in "${test_runtime}" test | grep -Fq 'notification test delivered'
test "$(find "${test_runtime}/notifications/delivered" -type f -name '*.json' | wc -l | tr -d ' ')" = 1
if MOCK_OSASCRIPT_MODE=denied ZERP_ISSUE_NOTIFICATION_NOW_EPOCH=5001 \
  notify_in "${test_runtime}" test >"${tmp}/denied-test.out" 2>&1; then
  echo 'denied notification test unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'notification test pending: automation-denied' "${tmp}/denied-test.out"
if grep -Fq 'issue-local-test@example.invalid' "${tmp}/denied-test.out"; then
  echo 'notification test leaked its recipient' >&2
  exit 1
fi

echo 'local issue notification tests passed'
