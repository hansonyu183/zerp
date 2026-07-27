SHELL := /bin/sh

BACKEND_ENV ?= .env.local
E2E_ENV ?= .env.e2e.local
COREPACK_VERSION ?= 0.35.0
PREVIEW_REF ?= HEAD
PRODUCTION_REF ?=
COMPOSE = docker compose --env-file backend/$(BACKEND_ENV)
DEV_COMPOSE = $(COMPOSE) -f compose.yaml -f compose.dev.yaml

.PHONY: bootstrap dev dev-down generate generate-check check release-check test e2e build compose-up compose-down pre-push preview-up preview-deploy preview-down preview-reset preview-status preview-password production-status production-retry production-rollback

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
	pnpm format:check
	pnpm check:web
	$(COMPOSE) -f compose.yaml config --quiet
	docker compose --env-file backend/.env.e2e.example -p zerp-fullstack-e2e -f compose.yaml -f compose.e2e.yaml config --quiet
	$(MAKE) release-check
	$(MAKE) -C backend ENV_FILE=$(BACKEND_ENV) quality

release-check:
	sh -n scripts/pre-push.sh scripts/verify-pr-base.sh scripts/verify-merged-pr.sh scripts/preview.sh scripts/preview-deploy.sh
	sh -n scripts/production-lib.sh scripts/production-deploy.sh scripts/production-watch.sh
	sh -n scripts/production-status.sh scripts/production-retry.sh scripts/production-rollback.sh scripts/install-production-agent.sh
	GITHUB_BASE_REF=main scripts/verify-pr-base.sh
	! GITHUB_BASE_REF=feature scripts/verify-pr-base.sh >/dev/null 2>&1
	GITHUB_BASE_REF=main ZERP_PR_BASE_SHA=HEAD^ ZERP_PR_HEAD_SHA=HEAD scripts/verify-pr-base.sh
	! GITHUB_BASE_REF=main ZERP_PR_BASE_SHA=HEAD ZERP_PR_HEAD_SHA=HEAD^ scripts/verify-pr-base.sh >/dev/null 2>&1
	ZERP_RELEASE_SHA=0000000000000000000000000000000000000000 \
	ZERP_API_IMAGE=zerp-production-api:config \
	ZERP_WEB_IMAGE=zerp-production-web:config \
	docker compose --env-file backend/.env.production.example \
		-p zerp-back -f compose.yaml -f compose.production.yaml config --quiet

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

pre-push:
	@./scripts/pre-push.sh

preview-up:
	@./scripts/preview.sh up

preview-deploy:
	@./scripts/preview-deploy.sh "$(PREVIEW_REF)"

preview-down:
	@./scripts/preview.sh down

preview-reset:
	@./scripts/preview.sh reset

preview-status:
	@./scripts/preview.sh status

preview-password:
	@./scripts/preview.sh password

production-status:
	@./scripts/production-status.sh

production-retry:
	@./scripts/production-retry.sh

production-rollback:
	@test -n "$(PRODUCTION_REF)" || { echo "usage: make production-rollback PRODUCTION_REF=<release-sha>" >&2; exit 2; }
	@./scripts/production-rollback.sh "$(PRODUCTION_REF)"
