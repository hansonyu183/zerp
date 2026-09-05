SHELL := /bin/sh

COREPACK_VERSION ?= 0.35.0
TARGET_POSTGRES_PASSWORD ?= zerp-target-local
TARGET_POSTGRES_PORT ?= 55439
TARGET_API_PORT ?= 18082
TARGET_WEB_PORT ?= 18083
TARGET_DATABASE_URL = postgres://zerp_target:$(TARGET_POSTGRES_PASSWORD)@127.0.0.1:$(TARGET_POSTGRES_PORT)/zerp_target_test?sslmode=disable
TARGET_COMPOSE = TARGET_POSTGRES_PASSWORD=$(TARGET_POSTGRES_PASSWORD) TARGET_POSTGRES_PORT=$(TARGET_POSTGRES_PORT) TARGET_API_PORT=$(TARGET_API_PORT) TARGET_WEB_PORT=$(TARGET_WEB_PORT) docker compose -p zerp-target -f compose.target.yaml

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

check: check-common check-ci-workflow target-check

check-common:
	pnpm format:check
	pnpm docs:check
	git diff --check

check-ci-workflow:
	pnpm check:ci-workflow

test: target-test

e2e: target-e2e

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
	git diff --exit-code -- apps/api/src/generated apps/api/src/db/generated.ts

target-wfl-parity:
	pnpm --filter @zerp/wfl-starlark wasm:build
	pnpm --filter @zerp/wfl-starlark test:node
	pnpm --filter @zerp/wfl-starlark typecheck
	pnpm --filter @zerp/wfl-starlark test:browser

target-check: target-generate-check target-wfl-parity
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api check:catalog
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api validate:rpt
	pnpm --filter @zerp/api typecheck
	pnpm --filter @zerp/api-client typecheck
	pnpm --filter @zerp/model typecheck
	pnpm --filter @zerp/frontend typecheck
	pnpm --filter @zerp/frontend lint
	pnpm --filter @zerp/frontend format:check
	pnpm --filter @zerp/frontend build:target

target-test: target-check
	pnpm --filter @zerp/model test
	pnpm --filter @zerp/frontend test:unit
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_TEST_DATABASE_URL='$(TARGET_DATABASE_URL)' pnpm --filter @zerp/api test

target-e2e: target-test
	$(TARGET_COMPOSE) up -d --build --wait target-api target-web
	TARGET_DATABASE_URL='$(TARGET_DATABASE_URL)' TARGET_API_BASE_URL='http://127.0.0.1:$(TARGET_API_PORT)' TARGET_WEB_BASE_URL='http://127.0.0.1:$(TARGET_WEB_PORT)' pnpm --filter @zerp/api e2e

target-down:
	$(TARGET_COMPOSE) down --volumes --remove-orphans
