SHELL := /bin/sh

BACKEND_ENV ?= .env.local
E2E_ENV ?= .env.e2e.local
COMPOSE = docker compose --env-file backend/$(BACKEND_ENV)
DEV_COMPOSE = $(COMPOSE) -f compose.yaml -f compose.dev.yaml

.PHONY: bootstrap dev dev-down generate generate-check check test e2e build compose-up compose-down

bootstrap:
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
	$(MAKE) -C backend quality

test:
	pnpm test:web
	$(MAKE) -C backend test

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
