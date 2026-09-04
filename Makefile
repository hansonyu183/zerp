SHELL := /bin/sh

BACKEND_ENV ?= .env.local
E2E_ENV ?= .env.e2e.local
COREPACK_VERSION ?= 0.35.0
COMPOSE = docker compose --env-file backend/$(BACKEND_ENV)
DEV_COMPOSE = $(COMPOSE) -f compose.yaml -f compose.dev.yaml
TARGET_POSTGRES_PASSWORD ?= zerp-target-local
TARGET_POSTGRES_PORT ?= 55439
TARGET_API_PORT ?= 18082
TARGET_WEB_PORT ?= 18083
TARGET_DATABASE_URL = postgres://zerp_target:$(TARGET_POSTGRES_PASSWORD)@127.0.0.1:$(TARGET_POSTGRES_PORT)/zerp_target_test?sslmode=disable
TARGET_COMPOSE = TARGET_POSTGRES_PASSWORD=$(TARGET_POSTGRES_PASSWORD) TARGET_POSTGRES_PORT=$(TARGET_POSTGRES_PORT) TARGET_API_PORT=$(TARGET_API_PORT) TARGET_WEB_PORT=$(TARGET_WEB_PORT) docker compose -p zerp-target -f compose.target.yaml

.PHONY: bootstrap dev dev-down generate generate-check check check-common check-ci-workflow check-contracts check-openapi-generated check-sqlc-generated check-frontend check-frontend-fast check-e2e-constraints check-backend check-backend-fast check-containers check-runtime check-shell test e2e build compose-up compose-down target-db target-generate target-generate-check target-wfl-parity target-check target-test target-e2e target-down

bootstrap:
	@if ! command -v pnpm >/dev/null 2>&1; then \
		command -v corepack >/dev/null 2>&1 || npm install --global corepack@$(COREPACK_VERSION); \
		corepack enable; \
	fi
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
	$(MAKE) check-ci-workflow
	$(MAKE) check-contracts
	$(MAKE) check-frontend
	$(MAKE) check-runtime
	$(MAKE) check-backend BACKEND_SKIP_GENERATED=1

check-common:
	pnpm format:check
	pnpm docs:check
	pnpm check:database-boundary
	git diff --check

check-ci-workflow:
	pnpm check:ci-workflow

check-contracts:
	$(MAKE) check-openapi-generated
	pnpm contracts:test-dcl-approval
	pnpm contracts:test-vou-approval
	pnpm contracts:test-acc-approval
	pnpm contracts:test-customer-aggregate
	pnpm contracts:test-typed-business-archives
	pnpm contracts:test-typed-archive-references
	$(MAKE) check-sqlc-generated

check-openapi-generated:
	pnpm generate:api
	git diff --exit-code -- contracts/openapi/dist backend/internal/api/generated frontend/src/api/generated

check-sqlc-generated:
	$(MAKE) -C backend quality-generated

check-frontend: check-e2e-constraints
	pnpm --filter @zerp/frontend check:core

check-frontend-fast: check-e2e-constraints
	pnpm --filter @zerp/frontend lint
	pnpm --filter @zerp/frontend format:check
	pnpm --filter @zerp/frontend typecheck

check-e2e-constraints:
	pnpm --dir frontend exec node --test scripts/check-e2e-constraints.test.mjs
	pnpm --dir frontend exec node scripts/check-e2e-constraints.mjs

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
	docker compose --env-file backend/.env.production.example \
		-p zerp-back -f compose.yaml -f compose.production.yaml config --quiet

check-runtime:
	$(MAKE) check-containers

target-db:
	$(TARGET_COMPOSE) down --volumes --remove-orphans
	$(TARGET_COMPOSE) up -d --wait target-db
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api sync:catalog

target-generate:
	pnpm --filter @zerp/api generate:artifacts
	$(MAKE) target-db
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api generate:db

target-generate-check: target-generate
	git diff --exit-code -- apps/api/src/generated apps/api/src/db/generated.ts

target-wfl-parity:
	go -C backend test ./internal/domains/wfl -run '^TestTargetWflSharedCorpus$$'
	pnpm --filter @zerp/wfl-starlark wasm:build
	pnpm --filter @zerp/wfl-starlark test:node
	pnpm --filter @zerp/wfl-starlark typecheck
	pnpm --filter @zerp/wfl-starlark test:browser

target-check: target-generate-check target-wfl-parity
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api check:catalog
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api validate:rpt
	pnpm --filter @zerp/api typecheck
	pnpm --filter @zerp/api-client typecheck
	pnpm --filter @zerp/frontend build:target

target-test: target-check
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_TEST_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api test

target-e2e: target-test
	$(TARGET_COMPOSE) up -d --build --wait target-api target-web
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_API_BASE_URL='http://127.0.0.1:$(TARGET_API_PORT)' TARGET_WEB_BASE_URL='http://127.0.0.1:$(TARGET_WEB_PORT)' pnpm --filter @zerp/api e2e

target-down:
	$(TARGET_COMPOSE) down --volumes --remove-orphans

check-shell:
	@for script in scripts/*.sh backend/scripts/*.sh; do \
		case "$$(sed -n '1p' "$$script")" in \
			*bash) bash -n "$$script" ;; \
			*) sh -n "$$script" ;; \
		esac; \
	done
	shellcheck -x scripts/*.sh backend/scripts/*.sh

test:
	pnpm test:web
	$(MAKE) -C backend ENV_FILE=$(BACKEND_ENV) test

e2e: check-e2e-constraints
	./scripts/e2e.sh

build:
	pnpm build:web
	$(MAKE) -C backend build
	$(COMPOSE) build api

compose-up:
	$(COMPOSE) up --build -d --wait

compose-down:
	$(COMPOSE) down
