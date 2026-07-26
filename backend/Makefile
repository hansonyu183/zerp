ENV_FILE ?= .env.local
QUALITY_IMAGE_TAG ?= zerp-api:quality
ACTIONLINT_VERSION ?= v1.7.12
STATICCHECK_VERSION ?= v0.7.0
GOVULNCHECK_VERSION ?= v1.6.0
override E2E_ENV_FILE := .env.e2e.local
override E2E_PROJECT := zerp-api-e2e
TEST_PROJECT ?= zerp-api-test
TEST_COMPOSE = docker compose -p $(TEST_PROJECT) --env-file $(ENV_FILE)
E2E_CLEAN_ENV = env \
	-u APP_ENV \
	-u API_PORT \
	-u POSTGRES_PORT \
	-u POSTGRES_DB \
	-u POSTGRES_USER \
	-u POSTGRES_PASSWORD \
	-u CORS_ALLOWED_ORIGINS \
	-u DATABASE_CONNECT_TIMEOUT \
	-u DATABASE_HEALTH_TIMEOUT \
	-u HTTP_READ_HEADER_TIMEOUT \
	-u HTTP_READ_TIMEOUT \
	-u HTTP_WRITE_TIMEOUT \
	-u HTTP_IDLE_TIMEOUT \
	-u SHUTDOWN_TIMEOUT \
	-u APP_SESSION_COOKIE_NAME \
	-u APP_SESSION_COOKIE_SECURE \
	-u APP_SESSION_COOKIE_SAME_SITE \
	-u APP_SESSION_IDLE_TIMEOUT \
	-u APP_SESSION_ABSOLUTE_TIMEOUT \
	-u APP_SIGNIN_LOCK_THRESHOLD \
	-u APP_SIGNIN_LOCK_DURATION \
	-u APP_PASSWORD_MIN_LENGTH \
	-u ATTACHMENT_UPLOAD_TOKEN_TTL \
	-u ATTACHMENT_DOWNLOAD_TOKEN_TTL \
	-u FEEDBACK_ATTACHMENT_ORPHAN_TTL \
	-u FEEDBACK_GITHUB_ENABLED
E2E_COMPOSE = $(E2E_CLEAN_ENV) docker compose -p $(E2E_PROJECT) -f compose.e2e.yaml --env-file $(E2E_ENV_FILE)

ifneq (,$(wildcard ./$(ENV_FILE)))
include $(ENV_FILE)
export
endif

.PHONY: run build test test-unit test-db-prepare test-integration generate quality quality-generated quality-format quality-actionlint quality-compose quality-test quality-vet-build quality-race quality-staticcheck quality-vuln quality-image migrate-status migrate-up migrate-down bootstrap-admin seed-bob cleanup-attachments cleanup-vou-attachments compose-up compose-down e2e-env-init e2e-env-rotate e2e-guard e2e-up e2e-down e2e-reset e2e-status

run:
	go run ./cmd/server

build:
	go build ./...

test:
	@$(MAKE) test-unit
	@$(MAKE) test-integration

test-unit:
	go test ./...

test-db-prepare:
	@test -n "$(TEST_POSTGRES_DB)" || (echo "TEST_POSTGRES_DB is required" && exit 1)
	@test -n "$(TEST_DATABASE_URL)" || (echo "TEST_DATABASE_URL is required" && exit 1)
	@case "$(TEST_POSTGRES_DB)" in \
		*[!A-Za-z0-9_]*|"") echo "TEST_POSTGRES_DB must contain only letters, numbers, and underscores" >&2; exit 1 ;; \
		*_test) ;; \
		*) echo "TEST_POSTGRES_DB must end with _test" >&2; exit 1 ;; \
	esac
	@test "$(TEST_POSTGRES_DB)" != "$(POSTGRES_DB)" || (echo "TEST_POSTGRES_DB must differ from POSTGRES_DB" && exit 1)
	@$(TEST_COMPOSE) up -d --wait db
	@$(TEST_COMPOSE) exec -T -e TEST_POSTGRES_DB="$(TEST_POSTGRES_DB)" db sh -eu -c \
		'createdb -U "$$POSTGRES_USER" "$$TEST_POSTGRES_DB" 2>/dev/null || psql -U "$$POSTGRES_USER" -d "$$TEST_POSTGRES_DB" -Atqc "SELECT 1" >/dev/null'
	@go -C tools tool goose -dir ../db/migrations postgres "$(TEST_DATABASE_URL)" up

test-integration: test-db-prepare
	@TEST_POSTGRES_DB="$(TEST_POSTGRES_DB)" TEST_DATABASE_URL="$(TEST_DATABASE_URL)" \
		go test -p 1 -tags=integration ./internal/domains/app ./internal/domains/bob ./internal/domains/vou ./internal/domains/wfl ./internal/domains/led ./internal/seed/bobseed -run 'Integration|Database' -count=1 -v

generate:
	go -C tools tool sqlc generate -f ../sqlc.yaml

quality:
	@$(MAKE) quality-generated
	@$(MAKE) quality-format
	@$(MAKE) quality-actionlint
	@$(MAKE) quality-compose
	@$(MAKE) quality-test
	@$(MAKE) quality-vet-build
	@$(MAKE) quality-race
	@$(MAKE) quality-staticcheck
	@$(MAKE) quality-vuln
	@$(MAKE) quality-image

quality-generated:
	@before="$$(find internal/database/sqlc -type f -name '*.go' -print | LC_ALL=C sort | while IFS= read -r file; do printf '%s ' "$$file"; git hash-object "$$file"; done)"; \
		$(MAKE) generate; \
		after="$$(find internal/database/sqlc -type f -name '*.go' -print | LC_ALL=C sort | while IFS= read -r file; do printf '%s ' "$$file"; git hash-object "$$file"; done)"; \
		test "$$before" = "$$after" || { echo "sqlc generated files changed; review and stage them before rerunning quality" >&2; exit 1; }

quality-format:
	@test -z "$$(gofmt -l $$(git ls-files '*.go'))" || { gofmt -l $$(git ls-files '*.go'); exit 1; }
	go mod tidy -diff
	go -C tools mod tidy -diff
	go mod verify
	go -C tools mod verify
	git diff --check
	git diff --cached --check

quality-actionlint:
	go run github.com/rhysd/actionlint/cmd/actionlint@$(ACTIONLINT_VERSION) ../.github/workflows/*.yml

quality-compose:
	docker compose --env-file $(ENV_FILE) config --quiet

quality-test:
	@$(MAKE) test

quality-vet-build:
	go vet ./...
	go build ./...

quality-race:
	go test -race ./...

quality-staticcheck:
	go run honnef.co/go/tools/cmd/staticcheck@$(STATICCHECK_VERSION) $$(go list ./... | grep -v '/internal/api/generated$$')

quality-vuln:
	go run golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION) ./...

quality-image:
	docker build --tag $(QUALITY_IMAGE_TAG) .

migrate-status:
	@go -C tools tool goose -dir ../db/migrations postgres "$(DATABASE_URL)" status

migrate-up:
	@go -C tools tool goose -dir ../db/migrations postgres "$(DATABASE_URL)" up

migrate-down:
	@go -C tools tool goose -dir ../db/migrations postgres "$(DATABASE_URL)" down

bootstrap-admin:
	@go run ./cmd/bootstrap-admin \
		-username "$${APP_BOOTSTRAP_USERNAME:-admin}" \
		-display-name "$${APP_BOOTSTRAP_DISPLAY_NAME:-Administrator}"

seed-bob:
	@go run ./cmd/seed-bob

cleanup-attachments:
	@docker compose --env-file $(ENV_FILE) run --rm --no-deps \
		--entrypoint /usr/local/bin/zerp-cleanup-vou-attachments api

cleanup-vou-attachments: cleanup-attachments

compose-up:
	docker compose --env-file $(ENV_FILE) up --build -d

compose-down:
	docker compose --env-file $(ENV_FILE) down

e2e-env-init:
	@./scripts/init-e2e-env.sh

e2e-env-rotate: e2e-guard
	@./scripts/init-e2e-env.sh --rotate
	@$(MAKE) e2e-reset

e2e-guard:
	@test -f "$(E2E_ENV_FILE)" || (echo "$(E2E_ENV_FILE) is missing; run make e2e-env-init" >&2; exit 1)
	@set -a; . ./$(E2E_ENV_FILE); set +a; \
		test "$$APP_ENV" = "test" || (echo "E2E APP_ENV must be test" >&2; exit 1); \
		test "$$POSTGRES_DB" = "zerp_e2e" || (echo "E2E POSTGRES_DB must be zerp_e2e" >&2; exit 1); \
		test "$$POSTGRES_PORT" = "55435" || (echo "E2E POSTGRES_PORT must be 55435" >&2; exit 1); \
		test "$$API_PORT" = "18081" || (echo "E2E API_PORT must be 18081" >&2; exit 1); \
		test "$$APP_SESSION_COOKIE_NAME" = "zerp_e2e_session" || (echo "E2E cookie name must be zerp_e2e_session" >&2; exit 1); \
		test "$$FEEDBACK_GITHUB_ENABLED" = "false" || (echo "E2E feedback publishing must be disabled" >&2; exit 1); \
		case "$$DATABASE_URL" in \
			postgres://zerp_e2e:*@127.0.0.1:55435/zerp_e2e?sslmode=disable) ;; \
			*) echo "E2E DATABASE_URL must target 127.0.0.1:55435/zerp_e2e" >&2; exit 1 ;; \
		esac

e2e-up: e2e-guard
	@$(E2E_COMPOSE) up -d --wait db
	@$(MAKE) ENV_FILE=$(E2E_ENV_FILE) migrate-up
	@user_count="$$( $(E2E_COMPOSE) exec -T db sh -eu -c \
		'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -Atqc "SELECT count(*) FROM app_users"' )"; \
		if [ "$$user_count" = "0" ]; then \
			$(MAKE) ENV_FILE=$(E2E_ENV_FILE) bootstrap-admin; \
		else \
			echo "E2E administrator already initialized"; \
		fi
	@$(MAKE) ENV_FILE=$(E2E_ENV_FILE) seed-bob
	@$(E2E_COMPOSE) up --build -d --wait api
	@echo "E2E API ready at http://127.0.0.1:18081"

e2e-down: e2e-guard
	@$(E2E_COMPOSE) down

e2e-reset: e2e-guard
	@echo "Removing only $(E2E_PROJECT) containers and volumes"
	@$(E2E_COMPOSE) down --volumes --remove-orphans
	@$(MAKE) e2e-up

e2e-status: e2e-guard
	@$(E2E_COMPOSE) ps
	@$(MAKE) ENV_FILE=$(E2E_ENV_FILE) migrate-status
