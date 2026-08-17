#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-change-gate-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM

test_repo="${tmp}/repo"
mkdir -p "${test_repo}/scripts" "${test_repo}/frontend" "${test_repo}/backend" "${tmp}/bin"
cp "${repo_root}/scripts/change-gate.sh" "${test_repo}/scripts/change-gate.sh"
chmod +x "${test_repo}/scripts/change-gate.sh"

cat >"${test_repo}/scripts/change-impact.sh" <<'EOF'
#!/bin/sh
set -eu
if [ "${MOCK_DELTA:-all}" = frontend ]; then
  cat <<'MATRIX'
impact=application
contracts=0
frontend=1
frontend_audit=0
frontend_full=0
backend=0
backend_full=0
backend_deps=0
containers=0
api_image=0
web_image=0
e2e=0
local_e2e=0
preview=1
MATRIX
elif [ "${MOCK_DELTA:-all}" = backend ]; then
  cat <<'MATRIX'
impact=application
contracts=0
frontend=0
frontend_audit=0
frontend_full=0
backend=1
backend_full=0
backend_deps=0
containers=0
api_image=0
web_image=0
e2e=1
local_e2e=1
preview=1
MATRIX
else
  cat <<'MATRIX'
impact=application
contracts=1
frontend=1
frontend_audit=1
frontend_full=1
backend=1
backend_full=1
backend_deps=1
containers=1
api_image=1
web_image=1
e2e=1
local_e2e=1
preview=1
MATRIX
fi
EOF
cat >"${test_repo}/scripts/runtime-fingerprint.sh" <<'EOF'
#!/bin/sh
printf 'runtime-test\n'
EOF
chmod +x "${test_repo}/scripts/change-impact.sh" "${test_repo}/scripts/runtime-fingerprint.sh"

cat >"${tmp}/bin/make" <<'EOF'
#!/bin/sh
set -eu
target=$1
printf '%s\n' "${target}" >>"${MOCK_MAKE_LOG}"
if [ "${target}" = "${MOCK_DIRTY_TARGET:-}" ]; then
  printf 'generated\n' >generated.tmp
fi
case " ${MOCK_FAIL_TARGETS:-} " in
  *" ${target} "*) exit 1 ;;
esac
EOF
chmod +x "${tmp}/bin/make"

git -C "${test_repo}" init -b main >/dev/null
git -C "${test_repo}" config user.name 'Validation Test'
git -C "${test_repo}" config user.email validation@example.com
printf 'base\n' >"${test_repo}/README.md"
git -C "${test_repo}" add .
git -C "${test_repo}" commit -m base >/dev/null
base_sha=$(git -C "${test_repo}" rev-parse HEAD)
printf 'frontend \n' >"${test_repo}/frontend/value.txt"
printf 'backend\n' >"${test_repo}/backend/value.txt"
git -C "${test_repo}" add frontend/value.txt backend/value.txt
git -C "${test_repo}" commit -m candidate >/dev/null
baseline_head=$(git -C "${test_repo}" rev-parse HEAD)

evidence="${tmp}/validation-evidence.json"
make_log="${tmp}/make.log"
: >"${make_log}"
if PATH="${tmp}/bin:${PATH}" MOCK_MAKE_LOG="${make_log}" \
  MOCK_FAIL_TARGETS='check-frontend check-backend' \
  ZERP_GATE_EVIDENCE_FILE="${evidence}" \
  "${test_repo}/scripts/change-gate.sh" --baseline "${base_sha}" >/dev/null 2>&1; then
  echo 'baseline accepted failed independent stages' >&2
  exit 1
fi
jq -e --arg head "${baseline_head}" '
  .mode == "baseline" and .status == "failed" and .head == $head and
  any(.stages[]; .id == "diff" and .status == "failed") and
  any(.stages[]; .id == "frontend" and .status == "failed") and
  any(.stages[]; .id == "backend" and .status == "failed") and
  any(.stages[]; .id == "e2e" and .status == "blocked" and
    .blockedBy == ["frontend","backend"])
' "${evidence}" >/dev/null
grep -Fxq check-runtime "${make_log}"
if grep -Fxq e2e "${make_log}"; then
  echo 'baseline ran E2E after build prerequisites failed' >&2
  exit 1
fi

printf 'frontend repaired\n' >"${test_repo}/frontend/value.txt"
git -C "${test_repo}" add frontend/value.txt
git -C "${test_repo}" commit -m repair >/dev/null
repair_head=$(git -C "${test_repo}" rev-parse HEAD)
: >"${make_log}"
PATH="${tmp}/bin:${PATH}" MOCK_MAKE_LOG="${make_log}" MOCK_DELTA=frontend \
  ZERP_GATE_EVIDENCE_FILE="${evidence}" \
  "${test_repo}/scripts/change-gate.sh" --reverify "${evidence}" "${base_sha}" >/dev/null
jq -e --arg head "${repair_head}" --arg retained_head "${baseline_head}" '
  .mode == "reverify" and .status == "passed" and .head == $head and
  all(.stages[]; .status == "passed") and
  any(.stages[]; .id == "contracts" and .retained == true and
    .verifiedHead == $retained_head) and
  any(.stages[]; .id == "runtime" and .retained == true and
    .verifiedHead == $retained_head)
' "${evidence}" >/dev/null
grep -Fxq check-common "${make_log}"
grep -Fxq check-frontend-fast "${make_log}"
grep -Fxq check-backend-fast "${make_log}"
grep -Fxq e2e "${make_log}"
if grep -Eq '^(check-contracts|check-runtime)$' "${make_log}"; then
  echo 'reverify reran an unaffected passing stage' >&2
  exit 1
fi

release_evidence="${tmp}/release-evidence.json"
: >"${make_log}"
PATH="${tmp}/bin:${PATH}" MOCK_MAKE_LOG="${make_log}" \
  ZERP_GATE_EVIDENCE_FILE="${release_evidence}" \
  "${test_repo}/scripts/change-gate.sh" --release "${base_sha}" >/dev/null
jq -e --arg head "${repair_head}" '
  .version == 1 and .mode == "release" and .status == "passed" and
  .head == $head and .runtimeFingerprint == "runtime-test"
' "${release_evidence}" >/dev/null

missing_stage_evidence="${tmp}/missing-stage-evidence.json"
jq -n --arg head "${repair_head}" --arg base "${base_sha}" '
  {version:1,status:"passed",mode:"baseline",head:$head,base:$base,stages:[
    {id:"diff",status:"passed",verifiedHead:$head},
    {id:"common",status:"passed",verifiedHead:$head},
    {id:"frontend",status:"passed",verifiedHead:$head}
  ]}' >"${missing_stage_evidence}"
printf 'backend repair\n' >>"${test_repo}/backend/value.txt"
git -C "${test_repo}" add backend/value.txt
git -C "${test_repo}" commit -m backend-repair >/dev/null
backend_repair_head=$(git -C "${test_repo}" rev-parse HEAD)
: >"${make_log}"
PATH="${tmp}/bin:${PATH}" MOCK_MAKE_LOG="${make_log}" MOCK_DELTA=backend \
  ZERP_GATE_EVIDENCE_FILE="${missing_stage_evidence}" \
  "${test_repo}/scripts/change-gate.sh" --reverify "${missing_stage_evidence}" \
    "${base_sha}" >/dev/null
jq -e --arg head "${backend_repair_head}" '
  .mode == "reverify" and .status == "passed" and .head == $head and
  any(.stages[]; .id == "backend" and .status == "passed" and
    .verifiedHead == $head) and
  any(.stages[]; .id == "e2e" and .status == "passed" and
    .verifiedHead == $head)
' "${missing_stage_evidence}" >/dev/null
grep -Fxq check-backend-fast "${make_log}"
grep -Fxq e2e "${make_log}"

dirty_evidence="${tmp}/dirty-evidence.json"
: >"${make_log}"
if PATH="${tmp}/bin:${PATH}" MOCK_MAKE_LOG="${make_log}" \
  MOCK_DELTA=backend MOCK_DIRTY_TARGET=check-common \
  ZERP_GATE_EVIDENCE_FILE="${dirty_evidence}" \
  "${test_repo}/scripts/change-gate.sh" --baseline "${base_sha}" >/dev/null 2>&1; then
  echo 'baseline accepted a stage-generated dirty worktree' >&2
  exit 1
fi
jq -e '
  .mode == "baseline" and .status == "failed" and
  any(.stages[]; .id == "worktree" and .status == "failed")
' "${dirty_evidence}" >/dev/null
rm -f "${test_repo}/generated.tmp"

echo 'change gate validation lifecycle tests passed'
