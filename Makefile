ENV_FILE ?= .env.local
override E2E_ENV_FILE := .env.e2e.local
override E2E_PROJECT := zerp-back-e2e
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

.PHONY: run build test test-unit test-db-prepare test-integration generate migrate-status migrate-up migrate-down bootstrap-admin seed-bob cleanup-attachments cleanup-vou-attachments compose-up compose-down e2e-env-init e2e-env-rotate e2e-guard e2e-up e2e-down e2e-reset e2e-status

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
	@docker compose --env-file $(ENV_FILE) up -d --wait db
	@docker compose --env-file $(ENV_FILE) exec -T -e TEST_POSTGRES_DB="$(TEST_POSTGRES_DB)" db sh -eu -c \
		'createdb -U "$$POSTGRES_USER" "$$TEST_POSTGRES_DB" 2>/dev/null || psql -U "$$POSTGRES_USER" -d "$$TEST_POSTGRES_DB" -Atqc "SELECT 1" >/dev/null'
	@go -C tools tool goose -dir ../db/migrations postgres "$(TEST_DATABASE_URL)" up

test-integration: test-db-prepare
	@TEST_POSTGRES_DB="$(TEST_POSTGRES_DB)" TEST_DATABASE_URL="$(TEST_DATABASE_URL)" \
		go test -p 1 -tags=integration ./internal/domains/app ./internal/domains/bob ./internal/domains/vou ./internal/domains/wfl ./internal/domains/led ./internal/seed/bobseed -run 'Integration|Database' -count=1 -v

generate:
	go -C tools tool sqlc generate -f ../sqlc.yaml

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
		test "$$POSTGRES_PORT" = "55433" || (echo "E2E POSTGRES_PORT must be 55433" >&2; exit 1); \
		test "$$API_PORT" = "18080" || (echo "E2E API_PORT must be 18080" >&2; exit 1); \
		test "$$APP_SESSION_COOKIE_NAME" = "zerp_e2e_session" || (echo "E2E cookie name must be zerp_e2e_session" >&2; exit 1); \
		test "$$FEEDBACK_GITHUB_ENABLED" = "false" || (echo "E2E feedback publishing must be disabled" >&2; exit 1); \
		case "$$DATABASE_URL" in \
			postgres://zerp_e2e:*@127.0.0.1:55433/zerp_e2e?sslmode=disable) ;; \
			*) echo "E2E DATABASE_URL must target 127.0.0.1:55433/zerp_e2e" >&2; exit 1 ;; \
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
	@echo "E2E API ready at http://127.0.0.1:18080"

e2e-down: e2e-guard
	@$(E2E_COMPOSE) down

e2e-reset: e2e-guard
	@echo "Removing only $(E2E_PROJECT) containers and volumes"
	@$(E2E_COMPOSE) down --volumes --remove-orphans
	@$(MAKE) e2e-up

e2e-status: e2e-guard
	@$(E2E_COMPOSE) ps
	@$(MAKE) ENV_FILE=$(E2E_ENV_FILE) migrate-status
