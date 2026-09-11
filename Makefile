SHELL := /bin/sh

COREPACK_VERSION ?= 0.35.0
TARGET_POSTGRES_PASSWORD ?= zerp-target-local
TARGET_POSTGRES_PORT ?= 55439
TARGET_API_PORT ?= 18082
TARGET_WEB_PORT ?= 18083
TARGET_DATABASE_URL = postgres://zerp_target:$(TARGET_POSTGRES_PASSWORD)@127.0.0.1:$(TARGET_POSTGRES_PORT)/zerp_target_test?sslmode=disable
TARGET_COMPOSE = TARGET_POSTGRES_PASSWORD=$(TARGET_POSTGRES_PASSWORD) TARGET_POSTGRES_PORT=$(TARGET_POSTGRES_PORT) TARGET_API_PORT=$(TARGET_API_PORT) TARGET_WEB_PORT=$(TARGET_WEB_PORT) docker compose -p zerp-target -f compose.target.yaml

.NOTPARALLEL:

.PHONY: check-static target-static test-unit test-component test-integration
.PHONY: bootstrap dev dev-down generate generate-check check check-common check-ci-workflow test e2e build compose-up compose-down target-db target-generate target-generate-check target-wfl-parity target-check target-test target-e2e target-down

bootstrap:
	@if ! command -v pnpm >/dev/null 2>&1; then \
		command -v corepack >/dev/null 2>&1 || npm install --global corepack@$(COREPACK_VERSION); \
		corepack enable; \
	fi
	pnpm install --frozen-lockfile

dev: target-db
	$(TARGET_COMPOSE) up -d --build --wait target-api
	pnpm --filter @zerp/frontend dev:target

dev-down: target-down

generate: target-generate

generate-check: target-generate-check

check: check-static check-ci-workflow

check-static: check-common target-static

check-common:
	pnpm format:check
	pnpm docs:check
	git diff --check

check-ci-workflow:
	pnpm check:ci-workflow

test: test-unit test-component

test-unit:
	pnpm --filter @zerp/model test
	pnpm --filter @zerp/api test:unit
	pnpm --filter @zerp/frontend test:pure

test-component:
	pnpm --filter @zerp/frontend test:component

test-integration:
	pnpm --filter @zerp/api test:integration

e2e: check-common check-ci-workflow target-e2e

build:
	pnpm --filter @zerp/frontend build:target
	$(TARGET_COMPOSE) build target-api target-web

compose-up:
	$(TARGET_COMPOSE) up --build -d --wait

compose-down: target-down

target-db:
	$(TARGET_COMPOSE) down --volumes --remove-orphans
	$(TARGET_COMPOSE) up -d --wait target-db
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api sync:catalog

target-generate:
	pnpm --filter @zerp/api generate:artifacts
	$(MAKE) target-db
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api generate:db

target-generate-check: target-generate
	node scripts/check-generated.mjs

target-wfl-parity:
	pnpm --filter @zerp/wfl-starlark wasm:build
	pnpm --filter @zerp/wfl-starlark test:node
	pnpm --filter @zerp/wfl-starlark test:browser

# Static validation never creates a database or builds WASM/browser assets.
target-static:
	pnpm --filter @zerp/frontend check:architecture
	pnpm --filter @zerp/api test:artifacts
	pnpm --filter @zerp/api typecheck
	pnpm --filter @zerp/api-client typecheck
	pnpm --filter @zerp/model typecheck
	pnpm --filter @zerp/wfl-starlark typecheck
	pnpm --filter @zerp/frontend typecheck
	pnpm --filter @zerp/frontend lint
	pnpm --filter @zerp/frontend format:check

target-check: target-generate-check target-wfl-parity target-static
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api check:catalog
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api validate:rpt

target-test: target-check test-unit test-component
	pnpm check:validation
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_TEST_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_DATABASE_SCOPE=isolated $(MAKE) test-integration

target-e2e: target-test
	$(TARGET_COMPOSE) up -d --build --wait target-api target-web
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_API_BASE_URL='http://127.0.0.1:$(TARGET_API_PORT)' TARGET_WEB_BASE_URL='http://127.0.0.1:$(TARGET_WEB_PORT)' pnpm --filter @zerp/api e2e

	$(MAKE) target-db
	$(TARGET_COMPOSE) up -d --wait target-api target-web
	TARGET_TEST_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_DATABASE_SCOPE=isolated TARGET_API_BASE_URL='http://127.0.0.1:$(TARGET_API_PORT)' TARGET_WEB_BASE_URL='http://127.0.0.1:$(TARGET_WEB_PORT)' pnpm --filter @zerp/api e2e:wfl
	$(MAKE) target-db
	$(TARGET_COMPOSE) up -d --wait target-api target-web
	TARGET_TEST_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_DATABASE_SCOPE=isolated TARGET_API_BASE_URL='http://127.0.0.1:$(TARGET_API_PORT)' TARGET_WEB_BASE_URL='http://127.0.0.1:$(TARGET_WEB_PORT)' pnpm --filter @zerp/api e2e:vou-catalog
	$(MAKE) target-db
	$(TARGET_COMPOSE) up -d --wait target-api target-web
	TARGET_TEST_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_DATABASE_SCOPE=isolated TARGET_API_BASE_URL='http://127.0.0.1:$(TARGET_API_PORT)' TARGET_WEB_BASE_URL='http://127.0.0.1:$(TARGET_WEB_PORT)' pnpm --filter @zerp/api e2e:vou-opening
	$(MAKE) target-db
	$(TARGET_COMPOSE) up -d --wait target-api target-web
	TARGET_TEST_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_DATABASE_SCOPE=isolated TARGET_API_BASE_URL='http://127.0.0.1:$(TARGET_API_PORT)' TARGET_WEB_BASE_URL='http://127.0.0.1:$(TARGET_WEB_PORT)' pnpm --filter @zerp/api e2e:vou-entry

target-down:
	$(TARGET_COMPOSE) down --volumes --remove-orphans
