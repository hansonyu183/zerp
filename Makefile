SHELL := /bin/sh

BACKEND_ENV ?= .env.local
E2E_ENV ?= .env.e2e.local
COREPACK_VERSION ?= 0.35.0
PREVIEW_REF ?=
PREVIEW_PR ?=
PREVIEW_ACTOR ?=
PREVIEW_MERGE ?=
PRODUCTION_REF ?=
COMPOSE = docker compose --env-file backend/$(BACKEND_ENV)
DEV_COMPOSE = $(COMPOSE) -f compose.yaml -f compose.dev.yaml

.PHONY: bootstrap dev dev-down generate generate-check check check-common check-contracts check-frontend check-backend check-backend-fast check-containers check-release check-runtime check-shell release-check test e2e build compose-up compose-down vou-cutover-check pre-push pre-push-plan preview-up preview-deploy preview-down preview-reset preview-rollback preview-status preview-password preview-vou-cutover-check preview-touch preview-close preview-accept preview-promote preview-reap preview-gc preview-uninstall-agent production-status production-retry production-rollback production-vou-cutover-check

bootstrap:
	command -v corepack >/dev/null 2>&1 || npm install --global corepack@$(COREPACK_VERSION)
	corepack enable
	pnpm install --frozen-lockfile
	go -C backend mod download
	go -C backend/tools mod download

dev:
	./scripts/dev.sh

dev-down:
	$(DEV_COMPOSE) down

generate:
	pnpm generate:api
	$(MAKE) -C backend generate

generate-check:
	$(MAKE) generate
	git diff --exit-code

check:
	$(MAKE) check-common
	$(MAKE) check-contracts
	$(MAKE) check-frontend
	$(MAKE) check-runtime
	$(MAKE) check-backend BACKEND_SKIP_GENERATED=1

check-common:
	pnpm format:check
	pnpm docs:check
	git diff --check

check-contracts:
	$(MAKE) generate-check

check-frontend:
	pnpm --filter @zerp/frontend check:core

check-backend:
	@targets="quality-core"; \
	if [ "$(BACKEND_SKIP_GENERATED)" != "1" ]; then targets="quality-generated $$targets"; fi; \
	if [ "$(BACKEND_SKIP_IMAGE)" != "1" ]; then targets="$$targets quality-image"; fi; \
	$(MAKE) -C backend ENV_FILE=$(BACKEND_ENV) $$targets

check-backend-fast:
	$(MAKE) -C backend ENV_FILE=$(BACKEND_ENV) quality-fast

check-containers:
	$(COMPOSE) -f compose.yaml config --quiet
	docker compose --env-file backend/.env.e2e.example -p zerp-fullstack-e2e -f compose.yaml -f compose.e2e.yaml config --quiet
	ZERP_RELEASE_SHA=0000000000000000000000000000000000000000 \
	ZERP_API_IMAGE=zerp-production-api:config \
	ZERP_WEB_IMAGE=zerp-production-web:config \
	docker compose --env-file backend/.env.production.example \
		-p zerp-back -f compose.yaml -f compose.production.yaml config --quiet

check-release:
	$(MAKE) release-check
	$(MAKE) -C backend quality-actionlint

check-runtime:
	$(MAKE) check-containers
	$(MAKE) check-release

check-shell:
	@for script in scripts/*.sh backend/scripts/*.sh; do \
		case "$$(sed -n '1p' "$$script")" in \
			*bash) bash -n "$$script" ;; \
			*) sh -n "$$script" ;; \
		esac; \
	done
	shellcheck -x scripts/*.sh backend/scripts/*.sh

release-check:
	$(MAKE) check-shell
	./scripts/test-release-flow-transition.sh
	./scripts/preview-state-test.sh
	GITHUB_BASE_REF=main scripts/verify-pr-base.sh
	! GITHUB_BASE_REF=feature scripts/verify-pr-base.sh >/dev/null 2>&1
	GITHUB_BASE_REF=main ZERP_PR_BASE_SHA=HEAD^ ZERP_PR_HEAD_SHA=HEAD scripts/verify-pr-base.sh
	! GITHUB_BASE_REF=main ZERP_PR_BASE_SHA=HEAD ZERP_PR_HEAD_SHA=HEAD^ scripts/verify-pr-base.sh >/dev/null 2>&1

test:
	pnpm test:web
	$(MAKE) -C backend ENV_FILE=$(BACKEND_ENV) test

e2e:
	./scripts/e2e.sh

build:
	pnpm build:web
	$(MAKE) -C backend build
	$(COMPOSE) build web api migrate

compose-up:
	$(COMPOSE) up --build -d --wait

compose-down:
	$(COMPOSE) down

vou-cutover-check:
	$(MAKE) -C backend ENV_FILE=$(BACKEND_ENV) vou-cutover-check

pre-push:
	@./scripts/pre-push.sh

pre-push-plan:
	@./scripts/pre-push.sh --plan

preview-up:
	@./scripts/preview.sh up

preview-deploy:
	@test -n "$(PREVIEW_PR)" -a -n "$(PREVIEW_REF)" || { echo "usage: make preview-deploy PREVIEW_PR=<number> PREVIEW_REF=<pr-head-sha>" >&2; exit 2; }
	@PREVIEW_ACTOR="$(PREVIEW_ACTOR)" ./scripts/preview-deploy.sh "$(PREVIEW_PR)" "$(PREVIEW_REF)"

preview-down:
	@./scripts/preview.sh down

preview-reset:
	@./scripts/preview.sh reset

preview-rollback:
	@./scripts/preview.sh rollback

preview-status:
	@./scripts/preview.sh status

preview-password:
	@./scripts/preview.sh password

preview-vou-cutover-check:
	@./scripts/preview.sh vou-cutover-check

preview-touch:
	@PREVIEW_PR="$(PREVIEW_PR)" ./scripts/preview-state.sh touch

preview-close:
	@PREVIEW_PR="$(PREVIEW_PR)" ./scripts/preview.sh close

preview-accept:
	@PREVIEW_PR="$(PREVIEW_PR)" PREVIEW_ACTOR="$(PREVIEW_ACTOR)" ./scripts/preview.sh accept

preview-promote:
	@PREVIEW_PR="$(PREVIEW_PR)" PREVIEW_MERGE_SHA="$(PREVIEW_MERGE)" ./scripts/preview.sh promote

preview-reap:
	@./scripts/preview.sh reap

preview-gc:
	@./scripts/preview.sh gc

preview-uninstall-agent:
	@./scripts/uninstall-preview-agent.sh

production-status:
	@./scripts/production-status.sh

production-retry:
	@./scripts/production-retry.sh

production-rollback:
	@test -n "$(PRODUCTION_REF)" || { echo "usage: make production-rollback PRODUCTION_REF=<release-sha>" >&2; exit 2; }
	@./scripts/production-rollback.sh "$(PRODUCTION_REF)"

production-vou-cutover-check:
	@./scripts/production-vou-cutover-check.sh
