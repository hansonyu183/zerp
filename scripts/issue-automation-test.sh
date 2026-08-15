#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-issue-automation-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM
mkdir -p "${tmp}/bin"

cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
case "$*" in
  *'/collaborators/maintainer/permission'*) printf 'write\n' ;;
  *'/collaborators/automation-bot[bot]/permission'*) printf 'write\n' ;;
  *'/dependencies/blocked_by'*) printf '%s\n' "${MOCK_DEPENDENCIES:-[]}" ;;
  *'/issues/17'*)
    if printf '%s' "$*" | grep -q -- '--method PATCH'; then
      cat >"${MOCK_PATCH_FILE}"
      printf '{}\n'
    else
      printf '{"labels":[{"name":"bug"},{"name":"automation:ready"},{"name":"priority:p1"}]}\n'
    fi
    ;;
  *) echo "unexpected gh call: $*" >&2; exit 2 ;;
esac
MOCK
chmod +x "${tmp}/bin/gh"

# shellcheck disable=SC2016 # backticks are literal Issue-markdown delimiters
body='### Outcome
用户得到明确结果

### Scope
实现一个完整切片

### Exclusions
无

### Acceptance criteria
- [ ] Given A When B Then C

### Risk level
Low

### Risks
低风险：不适用

### Recovery conditions
低风险：不适用

### Linked specifications
`docs/agents/issue-tracker.md`'

event() {
  actor=$1
  labels=$2
  event_body=$3
  jq -n --arg actor "${actor}" --arg body "${event_body}" --argjson labels "${labels}" '{action:"labeled",label:{name:"automation:ready"},sender:{login:$actor,type:"User"},issue:{number:17,title:"Authorized change",body:$body,state:"open",labels:[$labels[]|{name:.}]}}'
}

valid_event="${tmp}/valid.json"
event Maintainer '["automation:ready"]' "${body}" >"${valid_event}"
PATH="${tmp}/bin:${PATH}" ZERP_GH_BIN=gh GITHUB_REPOSITORY=example/zerp \
  ZERP_AUTOMATION_ENABLED=true ZERP_AUTOMATION_AUTHORIZERS=' other, MAINTAINER ' \
  ZERP_AUTOMATION_MAIN_SHA=1111111111111111111111111111111111111111 \
  ZERP_AUTHORIZED_AT=2026-08-15T00:00:00Z \
  "${repo_root}/scripts/issue-automation.sh" snapshot "${valid_event}" "${tmp}/snapshot.json"
jq -e '
  .issue == 17 and (.body_sha256 | length == 64) and
  .authorization.actor == "Maintainer" and .authorization.permission == "authorized" and
  .priority == "priority:p2" and
  .main_sha == "1111111111111111111111111111111111111111" and
  .linked_specs[0].path == "docs/agents/issue-tracker.md" and
  .open_dependencies == 0
' "${tmp}/snapshot.json" >/dev/null

event maintainer '["automation:ready","automation:blocked"]' "${body}" >"${tmp}/multiple.json"
if PATH="${tmp}/bin:${PATH}" ZERP_GH_BIN=gh GITHUB_REPOSITORY=example/zerp \
  ZERP_AUTOMATION_ENABLED=true ZERP_AUTOMATION_AUTHORIZERS=maintainer \
  ZERP_AUTOMATION_MAIN_SHA=1111111111111111111111111111111111111111 \
  "${repo_root}/scripts/issue-automation.sh" snapshot "${tmp}/multiple.json" "${tmp}/invalid.json" >/dev/null 2>&1; then
  echo "multiple automation states were accepted" >&2
  exit 1
fi

event 'automation-bot[bot]' '["automation:ready"]' "${body}" >"${tmp}/bot.json"
if PATH="${tmp}/bin:${PATH}" ZERP_GH_BIN=gh GITHUB_REPOSITORY=example/zerp \
  ZERP_AUTOMATION_ENABLED=true ZERP_AUTOMATION_AUTHORIZERS='automation-bot[bot]' \
  ZERP_AUTOMATION_MAIN_SHA=1111111111111111111111111111111111111111 \
  "${repo_root}/scripts/issue-automation.sh" snapshot "${tmp}/bot.json" "${tmp}/invalid.json" >/dev/null 2>&1; then
  echo "Bot authorization was accepted" >&2
  exit 1
fi

high_risk=$(printf '%s\n' "${body}" | sed 's/^Low$/High — authentication, migration, production config, or data repair/;s/^低风险：不适用$/_No response_/')
event maintainer '["automation:ready"]' "${high_risk}" >"${tmp}/high-risk.json"
if PATH="${tmp}/bin:${PATH}" ZERP_GH_BIN=gh GITHUB_REPOSITORY=example/zerp \
  ZERP_AUTOMATION_ENABLED=true ZERP_AUTOMATION_AUTHORIZERS=maintainer \
  ZERP_AUTOMATION_MAIN_SHA=1111111111111111111111111111111111111111 \
  "${repo_root}/scripts/issue-automation.sh" snapshot "${tmp}/high-risk.json" "${tmp}/invalid.json" >/dev/null 2>&1; then
  echo "incomplete high-risk authorization was accepted" >&2
  exit 1
fi

export MOCK_PATCH_FILE="${tmp}/patch.json"
PATH="${tmp}/bin:${PATH}" ZERP_GH_BIN=gh GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-automation.sh" set-state 17 automation:reviewing
jq -e '.labels == ["automation:reviewing","bug","priority:p1"]' "${tmp}/patch.json" >/dev/null

echo "issue automation tests passed"
