SHELL := /bin/sh

BACKEND_ENV ?= .env.local
E2E_ENV ?= .env.e2e.local
COREPACK_VERSION ?= 0.35.0
COMPOSE = docker compose --env-file backend/$(BACKEND_ENV)
DEV_COMPOSE = $(COMPOSE) -f compose.yaml -f compose.dev.yaml

.PHONY: bootstrap dev dev-down generate generate-check check check-common check-contracts check-frontend check-frontend-fast check-e2e-constraints check-backend check-backend-fast check-containers check-runtime check-shell test e2e build compose-up compose-down

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
