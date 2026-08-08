#!/bin/sh
set -eu
repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
common_git_dir=$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || printf '%s/.git' "$repo_root")
primary_root=$(dirname "$common_git_dir")
runtime_root=${ZERP_PREVIEW_RUNTIME_ROOT:-${ZERP_PREVIEW_STATE_ROOT:-${primary_root}/backend/var/preview-native}}
state_root=${ZERP_PREVIEW_STATE_ROOT:-${runtime_root}/state}
baseline_root="$state_root/baselines"; pr_root="$state_root/prs"; failure_root="$state_root/failures"; lock_root="$state_root/lock"
current_file="$state_root/current"; active_file="$state_root/active"; now=${ZERP_PREVIEW_NOW:-$(date +%s)}
db_user=${POSTGRES_USER:-zerp_preview}; db_host=${POSTGRES_HOST:-127.0.0.1}; db_port=${POSTGRES_PORT:-55436}; createdb_bin=${ZERP_CREATEDB:-createdb}; dropdb_bin=${ZERP_DROPDB:-dropdb}; gh_bin=${ZERP_GH_BIN:-gh}; repo=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
usage(){ echo "usage: $0 {init|claim|touch|reap|close|accept|promote|fail|gc|status}" >&2; exit 2; }
safe_number(){ case "$1" in ''|*[!0-9]*) return 1;; esac; }
safe_sha(){ case "$1" in ????????*) case "$1" in *[!0-9a-f]*) return 1;; esac; [ "$(printf %s "$1" | wc -c | tr -d ' ')" = 40 ];; *) return 1;; esac; }
mkdir_state(){ mkdir -p "$baseline_root" "$pr_root" "$failure_root"; chmod 700 "$state_root" "$baseline_root" "$pr_root" "$failure_root"; }
read_field(){ key=$1; file=$2; sed -n "s/^${key}=//p" "$file" 2>/dev/null | sed -n '1p'; }
write_record(){ file=$1; shift; tmp="${file}.new.$$"; : >"$tmp"; chmod 600 "$tmp"; while [ "$#" -gt 1 ]; do printf '%s=%s\n' "$1" "$2" >>"$tmp"; shift 2; done; mv -f "$tmp" "$file"; }
atomic_current(){ tmp="${current_file}.new.$$"; cat >"$tmp" <<EOT
kind=$1
id=$2
sha=$3
db=$4
attachments=$5
generation=$6
EOT
 chmod 600 "$tmp"; mv -f "$tmp" "$current_file"; }
db_exists(){ command -v psql >/dev/null 2>&1 || return 1; PGPASSWORD=${POSTGRES_PASSWORD:-} psql -h "$db_host" -p "$db_port" -U "$db_user" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$1'" 2>/dev/null | grep -qx 1; }
clone_db(){ base=$1; target=$2; db_exists "$target" && return 0; "$createdb_bin" -h "$db_host" -p "$db_port" -U "$db_user" --template="$base" "$target"; }
copy_attachments(){ src=$1; dst=$2; mkdir -p "$dst"; chmod 700 "$dst"; if [ -d "$src" ] && [ "$src" != "$dst" ]; then cp -Rp "$src/." "$dst/"; fi; }
baseline_sha(){ if [ -f "$current_file" ] && [ "$(read_field kind "$current_file")" = baseline ]; then read_field sha "$current_file"; else printf '%s\n' "${ZERP_BASELINE_SHA:-$(git -C "$repo_root" rev-parse origin/main 2>/dev/null || printf unknown)}"; fi; }
init_state(){ mkdir_state; [ -f "$current_file" ] && return; sha=$(baseline_sha); safe_sha "$sha" || sha=legacy; db=${POSTGRES_DB:-zerp_preview}; att=${ZERP_PREVIEW_ATTACHMENT_ROOT:-${runtime_root}/attachments}; mkdir -p "$att"; chmod 700 "$att"; rec="$baseline_root/${sha}.state"; write_record "$rec" kind baseline id "$sha" sha "$sha" db "$db" attachments "$att" generation 0 status accepted accepted_at "$now"; atomic_current baseline "$sha" "$sha" "$db" "$att" 0; }
lock_owner(){ [ -f "$lock_root/owner" ] && cat "$lock_root/owner" || true; }
release_lock(){ rm -rf "$lock_root"; }
acquire_lock(){ pr=$1; head=$2; actor=$3; if mkdir "$lock_root" 2>/dev/null; then chmod 700 "$lock_root"; printf '%s\n' "$pr" >"$lock_root/owner"; printf '%s\n' "$head" >"$lock_root/head"; printf '%s\n' "$actor" >"$lock_root/actor"; printf '%s\n' "$now" >"$lock_root/last_activity"; printf '%s\n' "$$" >"$lock_root/pid"; chmod 600 "$lock_root"/*; return; fi; owner=$(lock_owner); last=$(cat "$lock_root/last_activity" 2>/dev/null || printf 0); if [ "$owner" != "$pr" ] && [ $((now-last)) -lt 86400 ]; then echo "preview slot is held by PR #${owner}" >&2; return 1; fi; if [ "$owner" != "$pr" ]; then release_lock; acquire_lock "$pr" "$head" "$actor"; fi; }
claim() (
  pr=${PREVIEW_PR:?PREVIEW_PR is required}; head=${PREVIEW_REF:?PREVIEW_REF is required}; actor=${PREVIEW_ACTOR:-${GITHUB_ACTOR:-unknown}}
  if ! safe_number "$pr" || ! safe_sha "$head"; then echo "invalid PR or head" >&2; return 2; fi
  [ "${PREVIEW_VERIFIED:-}" = 1 ] || { echo "exact validated PR head is required" >&2; return 1; }
  init_state
  reap
  active_pr=$(cat "$active_file" 2>/dev/null || true)
  if [ -n "$active_pr" ] && [ "$active_pr" != "$pr" ]; then echo "preview slot is active for PR #${active_pr}" >&2; return 1; fi

  transaction=$(mktemp -d "$state_root/.claim.XXXXXX")
  claim_ok=0; lock_acquired=0; pr_existed=0; db_preexisting=0
  cp -p "$current_file" "$transaction/current"
  [ ! -f "$active_file" ] || cp -p "$active_file" "$transaction/active"
  pr_record="$pr_root/${pr}.state"; pr_db="zerp_preview_pr_${pr}"; pr_att="$pr_root/${pr}/attachments"
  if [ -f "$pr_record" ]; then pr_existed=1; cp -p "$pr_record" "$transaction/pr"; fi
  [ ! -d "$lock_root" ] || cp -Rp "$lock_root" "$transaction/lock"

  # shellcheck disable=SC2329 # invoked by the trap below
  rollback_claim() {
    result=$?
    trap - EXIT HUP INT TERM
    if [ "$claim_ok" != 1 ] && [ "$lock_acquired" = 1 ]; then
      rm -rf "$lock_root"
      [ ! -d "$transaction/lock" ] || cp -Rp "$transaction/lock" "$lock_root"
      cp -p "$transaction/current" "$current_file"
      if [ -f "$transaction/active" ]; then cp -p "$transaction/active" "$active_file"; else rm -f "$active_file"; fi
      if [ "$pr_existed" = 1 ]; then
        cp -p "$transaction/pr" "$pr_record"
      else
        rm -f "$pr_record"; rm -rf "$pr_root/${pr:?}"
        if [ "$db_preexisting" = 0 ]; then "$dropdb_bin" -h "$db_host" -p "$db_port" -U "$db_user" --if-exists --force "$pr_db" >/dev/null 2>&1 || true; fi
      fi
      rm -f "${pr_record}.new.$$" "${current_file}.new.$$"
    fi
    rm -rf "$transaction"
    exit "$result"
  }
  trap rollback_claim EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  acquire_lock "$pr" "$head" "$actor"
  lock_acquired=1
  if [ "$pr_existed" = 1 ]; then base_sha=$(read_field baseline "$pr_record"); else base_sha=$(baseline_sha); fi
  base_record="$baseline_root/${base_sha}.state"
  [ -f "$base_record" ] || { echo "preview baseline ${base_sha} is missing" >&2; return 1; }
  base_db=$(read_field db "$base_record"); base_att=$(read_field attachments "$base_record")
  if [ "$pr_existed" = 0 ]; then
    db_exists "$pr_db" && db_preexisting=1
    clone_db "$base_db" "$pr_db"
    copy_attachments "$base_att" "$pr_att"
    generation=1
  else
    generation=$(( $(read_field generation "$pr_record") + 1 ))
  fi
  write_record "$pr_record" kind pr id "$pr" pr "$pr" sha "$head" db "$pr_db" attachments "$pr_att" generation "$generation" status active baseline "$base_sha" last_activity "$now" actor "$actor"
  printf '%s\n' "$pr" >"$active_file"; chmod 600 "$active_file"
  printf '%s\n' "$now" >"$lock_root/last_activity"
  atomic_current pr "$pr" "$head" "$pr_db" "$pr_att" "$generation"
  claim_ok=1
)
touch_state(){ pr=${PREVIEW_PR:?PREVIEW_PR is required}; [ "$(cat "$active_file" 2>/dev/null || true)" = "$pr" ] || { echo "PR is not active" >&2; return 1; }; printf '%s\n' "$now" >"$lock_root/last_activity"; sed "s/^last_activity=.*/last_activity=$now/" "$pr_root/${pr}.state" >"$pr_root/${pr}.state.new"; mv -f "$pr_root/${pr}.state.new" "$pr_root/${pr}.state"; }
restore_baseline(){ pr=$(cat "$active_file" 2>/dev/null || true); if [ -n "$pr" ] && [ -f "$pr_root/${pr}.state" ]; then sha=$(read_field baseline "$pr_root/${pr}.state"); else sha=$(baseline_sha); fi; rec="$baseline_root/${sha}.state"; [ -f "$rec" ] || { echo "preview baseline ${sha} is missing" >&2; return 1; }; atomic_current baseline "$sha" "$sha" "$(read_field db "$rec")" "$(read_field attachments "$rec")" "$(read_field generation "$rec")"; }
deactivate(){ status=$1; pr=$(cat "$active_file" 2>/dev/null || true); if [ -n "$pr" ] && [ -f "$pr_root/${pr}.state" ]; then (sed "s/^status=.*/status=$status/" "$pr_root/${pr}.state"; printf "closed_at=%s\n" "$now") >"$pr_root/${pr}.state.new"; mv -f "$pr_root/${pr}.state.new" "$pr_root/${pr}.state"; fi; restore_baseline; rm -f "$active_file"; release_lock; }
reap()( [ -f "$lock_root/last_activity" ] || return 0; pr=$(cat "$active_file" 2>/dev/null || true); if [ -n "$pr" ] && command -v "$gh_bin" >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then pr_json=$($gh_bin api "repos/${repo}/pulls/${pr}" 2>/dev/null || true); if [ -n "$pr_json" ] && printf '%s' "$pr_json" | jq -e '.number != null' >/dev/null 2>&1; then merged=$(printf '%s' "$pr_json" | jq -r '.merged // false'); merge_sha=$(printf '%s' "$pr_json" | jq -r '.merge_commit_sha // ""'); state=$(printf '%s' "$pr_json" | jq -r '.state'); draft=$(printf '%s' "$pr_json" | jq -r '.draft // false'); remote_head=$(printf '%s' "$pr_json" | jq -r '.head.sha // ""'); local_head=$(read_field sha "$pr_root/${pr}.state"); if [ "$merged" = true ] && [ -n "$merge_sha" ] && [ "$(read_field status "$pr_root/${pr}.state")" = accepted ]; then PREVIEW_PR="$pr" PREVIEW_MERGE_SHA="$merge_sha" promote && return 0 || true; elif [ "$state" != open ]; then deactivate closed; return 0; elif [ "$draft" = true ] || [ "$remote_head" != "$local_head" ]; then deactivate invalidated; return 0; fi; fi; fi; last=$(cat "$lock_root/last_activity"); if [ $((now-last)) -ge 86400 ]; then deactivate expired; fi; )
close_state(){ pr=${PREVIEW_PR:?PREVIEW_PR is required}; [ "$(cat "$active_file" 2>/dev/null || true)" = "$pr" ] || { echo "PR is not active" >&2; return 1; }; deactivate closed; }
accept_state(){
  pr=${PREVIEW_PR:?PREVIEW_PR is required}; actor=${PREVIEW_ACTOR:-${GITHUB_ACTOR:-}}
  [ "$(cat "$active_file" 2>/dev/null || true)" = "$pr" ] || { echo "PR is not active" >&2; return 1; }
  rec="$pr_root/${pr}.state"; head=$(read_field sha "$rec"); generation=$(read_field generation "$rec")
  command -v "$gh_bin" >/dev/null 2>&1 || { echo 'gh is required' >&2; return 1; }
  if [ -z "$actor" ]; then actor=$($gh_bin api user --jq .login); fi
  PREVIEW_ACTOR="$actor" "${repo_root}/scripts/verify-preview-pr.sh" "$pr" "$head" >/dev/null
  description="preview PR #$pr generation $generation actor $actor"
  deployment=$($gh_bin api "repos/${repo}/deployments?sha=${head}&environment=preview&per_page=100" --jq ".[] | select(.description == \"$description\") | .id" | sed -n '1p')
  if [ -z "$deployment" ]; then
    payload=$(jq -n --arg ref "$head" --arg desc "$description" --arg pr "$pr" --arg generation "$generation" --arg actor "$actor" '{ref:$ref,environment:"preview",description:$desc,auto_merge:false,required_contexts:[],payload:{pr:$pr,generation:$generation,actor:$actor}}')
    deployment=$($gh_bin api --method POST "repos/${repo}/deployments" --input - --jq .id <<EOF
$payload
EOF
)
  fi
  jq -n --arg url "https://zerp-preview.bytesucceed.com" --arg desc "accepted PR #$pr head $head generation $generation actor $actor" '{state:"success",environment_url:$url,description:$desc}' | $gh_bin api --method POST "repos/${repo}/deployments/${deployment}/statuses" --input - >/dev/null
  jq -n --arg state success --arg context full-validation --arg description "accepted preview PR #$pr generation $generation by $actor" --arg target_url "https://zerp-preview.bytesucceed.com" '{state:$state,context:$context,description:$description,target_url:$target_url}' | $gh_bin api --method POST "repos/${repo}/statuses/${head}" --input - >/dev/null
  write_record "$rec" kind pr id "$pr" pr "$pr" sha "$head" db "$(read_field db "$rec")" attachments "$(read_field attachments "$rec")" generation "$generation" status accepted baseline "$(read_field baseline "$rec")" last_activity "$now" actor "$(read_field actor "$rec")" accepted_at "$now" accepted_actor "$actor" deployment_id "$deployment"
}

promote(){ pr=${PREVIEW_PR:?PREVIEW_PR is required}; merge=${PREVIEW_MERGE_SHA:?PREVIEW_MERGE_SHA is required}; safe_sha "$merge" || return 2; [ "$(cat "$active_file" 2>/dev/null || true)" = "$pr" ] || { echo "PR is not active" >&2; return 1; }; src="$pr_root/${pr}.state"; [ "$(read_field status "$src")" = accepted ] || { echo "preview acceptance is required before promotion" >&2; return 1; }; GITHUB_REPOSITORY="$repo" GITHUB_SHA="$merge" "${repo_root}/scripts/verify-merged-pr.sh" >/dev/null; db=$(read_field db "$src"); att=$(read_field attachments "$src"); write_record "$baseline_root/${merge}.state" kind baseline id "$merge" sha "$merge" db "$db" attachments "$att" generation "$(read_field generation "$src")" status accepted accepted_at "$now"; atomic_current baseline "$merge" "$merge" "$db" "$att" "$(read_field generation "$src")"; sed "s/^status=.*/status=promoted/" "$src" >"${src}.new"; mv -f "${src}.new" "$src"; rm -f "$active_file"; release_lock; }
fail_state(){ pr=${PREVIEW_PR:?PREVIEW_PR is required}; reason=${PREVIEW_FAILURE_REASON:-failed}; mkdir_state; write_record "$failure_root/${pr}-${now}.state" pr "$pr" reason "$reason" failed_at "$now" expires_at "$((now+604800))"; if [ -f "$pr_root/${pr}.state" ]; then (sed "s/^status=.*/status=failed/" "$pr_root/${pr}.state"; printf "failed_at=%s\n" "$now") >"$pr_root/${pr}.state.new"; mv -f "$pr_root/${pr}.state.new" "$pr_root/${pr}.state"; fi; restore_baseline; rm -f "$active_file"; release_lock; }
canonical_record(){ directory=$(dirname "$1"); printf '%s/%s\n' "$(CDPATH='' cd -- "$directory" && pwd -P)" "$(basename "$1")"; }
resource_referenced()( field=$1; value=$2; excluded=$(canonical_record "$3"); for candidate in "$baseline_root"/*.state "$pr_root"/*.state; do [ -e "$candidate" ] || continue; [ "$(canonical_record "$candidate")" = "$excluded" ] && continue; [ "$(read_field "$field" "$candidate")" = "$value" ] && return 0; done; return 1; )
delete_record()( record=$1; db=$(read_field db "$record"); attachments=$(read_field attachments "$record"); if [ -n "$db" ] && ! resource_referenced db "$db" "$record"; then case "$db" in zerp_preview_pr_*) "$dropdb_bin" -h "$db_host" -p "$db_port" -U "$db_user" --if-exists --force "$db";; *) echo "Refusing to drop unmanaged preview database: $db" >&2; return 1;; esac; fi; if [ -n "$attachments" ] && ! resource_referenced attachments "$attachments" "$record"; then case "$attachments" in "$pr_root"/*/attachments) rm -rf "$attachments";; *) echo "Refusing to delete unmanaged preview attachments: $attachments" >&2; return 1;; esac; fi; rm -f "$record"; )
gc(){
  mkdir_state
  current_sha=$(read_field sha "$current_file" 2>/dev/null || true)
  active_pr=$(cat "$active_file" 2>/dev/null || true)
  active_baseline=
  if [ -n "$active_pr" ] && [ -f "$pr_root/${active_pr}.state" ]; then active_baseline=$(read_field baseline "$pr_root/${active_pr}.state"); fi
  keep=" $current_sha $active_baseline "
  count=0
  for f in $(ls -1t "$baseline_root"/*.state 2>/dev/null || true); do
    sha=$(read_field sha "$f"); case "$keep" in *" $sha "*) continue;; esac
    if [ "$count" -lt 3 ]; then keep="$keep$sha "; count=$((count+1)); continue; fi
    delete_record "$f"
  done
  for f in "$failure_root"/*.state; do [ -e "$f" ] || continue; [ "$(read_field expires_at "$f")" -gt "$now" ] || rm -f "$f"; done
  for f in "$pr_root"/*.state; do [ -e "$f" ] || continue; status=$(read_field status "$f"); closed=$(read_field closed_at "$f"); failed=$(read_field failed_at "$f"); if { [ "$status" = closed ] || [ "$status" = expired ] || [ "$status" = invalidated ]; } && [ -n "$closed" ] && [ $((now-closed)) -ge 604800 ]; then delete_record "$f"; elif [ "$status" = failed ] && [ -n "$failed" ] && [ $((now-failed)) -ge 604800 ]; then delete_record "$f"; fi; done
}
status(){ init_state; printf 'current=%s\n' "$(read_field sha "$current_file")"; printf 'active=%s\n' "$(cat "$active_file" 2>/dev/null || true)"; printf 'lock=%s\n' "$(lock_owner)"; }
mkdir_state
case "${1:-}" in init) init_state;; claim) claim;; touch) touch_state;; reap) reap;; close) close_state;; accept) accept_state;; promote) promote;; fail) fail_state;; gc) gc;; status) status;; *) usage;; esac
