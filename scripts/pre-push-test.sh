#!/bin/sh
set -eu

test_root=$(mktemp -d)
cleanup() {
  rm -rf "${test_root}"
}
trap cleanup EXIT HUP INT TERM

remote="${test_root}/remote.git"
worktree="${test_root}/worktree"
gate_count="${test_root}/gate-count"

git init --bare --quiet "${remote}"
git init --quiet --initial-branch=main "${worktree}"
git -C "${worktree}" config user.email test@example.com
git -C "${worktree}" config user.name 'Pre-push Test'
mkdir -p "${worktree}/scripts"
cp "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/pre-push.sh" \
  "${worktree}/scripts/pre-push.sh"

cat >"${worktree}/scripts/change-gate.sh" <<'EOF'
#!/bin/sh
set -eu
[ "$#" -eq 1 ] && [ "$1" = origin/main ]
printf 'gate\n' >>"${MOCK_GATE_COUNT}"
EOF
chmod +x "${worktree}/scripts/change-gate.sh"

printf 'base\n' >"${worktree}/app.txt"
git -C "${worktree}" add .
git -C "${worktree}" commit --quiet -m base
git -C "${worktree}" remote add origin "${remote}"
git -C "${worktree}" push --quiet -u origin main
git -C "${worktree}" switch --quiet -c feature
printf 'candidate one\n' >>"${worktree}/app.txt"
git -C "${worktree}" commit --quiet -am 'candidate one'

: >"${gate_count}"
MOCK_GATE_COUNT="${gate_count}" "${worktree}/scripts/pre-push.sh"
[ "$(wc -l <"${gate_count}" | tr -d ' ')" = 1 ]
head_sha=$(git -C "${worktree}" rev-parse HEAD)
git_common_dir=$(git -C "${worktree}" rev-parse --path-format=absolute --git-common-dir)
evidence_file="${git_common_dir}/zerp/pre-push-gates/${head_sha}.json"
jq -e --arg head "${head_sha}" '.status == "passed" and .head == $head' \
  "${evidence_file}" >/dev/null

repeat_output=$(MOCK_GATE_COUNT="${gate_count}" "${worktree}/scripts/pre-push.sh")
printf '%s\n' "${repeat_output}" | grep -Fq "reusing final gate evidence for exact head ${head_sha}"
[ "$(wc -l <"${gate_count}" | tr -d ' ')" = 1 ]

printf 'candidate two\n' >>"${worktree}/app.txt"
git -C "${worktree}" commit --quiet -am 'candidate two'
MOCK_GATE_COUNT="${gate_count}" "${worktree}/scripts/pre-push.sh"
[ "$(wc -l <"${gate_count}" | tr -d ' ')" = 2 ]

echo 'pre-push tests passed'
