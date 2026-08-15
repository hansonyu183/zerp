#!/bin/sh
set -eu

app_id=${1:-}
private_key=${2:-}
owner=${3:-}
repository=${4:-}
if [ -z "${app_id}" ] || [ ! -r "${private_key}" ] || [ -z "${owner}" ] || [ -z "${repository}" ]; then
  echo "usage: $0 <app-id> <private-key-file> <owner> <repository>" >&2
  exit 2
fi

base64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

now=$(date +%s)
issued_at=$((now - 60))
expires_at=$((now + 540))
header=$(printf '%s' '{"alg":"RS256","typ":"JWT"}' | base64url)
payload=$(jq -nc --argjson iat "${issued_at}" --argjson exp "${expires_at}" --arg iss "${app_id}" '{iat:$iat,exp:$exp,iss:$iss}' | base64url)
unsigned="${header}.${payload}"
signature=$(printf '%s' "${unsigned}" | openssl dgst -sha256 -sign "${private_key}" | base64url)
jwt="${unsigned}.${signature}"

installations=$(curl --silent --show-error --fail \
  -H "Authorization: Bearer ${jwt}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/app/installations?per_page=100")
installation_id=$(printf '%s' "${installations}" | jq -r --arg owner "${owner}" '[.[] | select((.account.login | ascii_downcase) == ($owner | ascii_downcase))] | if length == 1 then .[0].id else empty end')
[ -n "${installation_id}" ] || { echo "release GitHub App installation is missing or ambiguous" >&2; exit 1; }

request=$(jq -nc --arg repository "${repository}" '{repositories:[$repository]}')
printf '%s' "${request}" | curl --silent --show-error --fail \
  -H "Authorization: Bearer ${jwt}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "https://api.github.com/app/installations/${installation_id}/access_tokens" |
  jq -er .token
