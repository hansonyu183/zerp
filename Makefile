SHELL := /bin/sh

BACKEND_ENV ?= .env.local
E2E_ENV ?= .env.e2e.local
COREPACK_VERSION ?= 0.35.0
COMPOSE = docker compose --env-file backend/$(BACKEND_ENV)
DEV_COMPOSE = $(COMPOSE) -f compose.yaml -f compose.dev.yaml

.PHONY: bootstrap dev dev-down generate generate-check check test e2e build compose-up compose-down

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
	$(MAKE) -C backend ENV_FILE=$(BACKEND_ENV) quality

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
