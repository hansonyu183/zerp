ENV_FILE ?= .env.local
QUALITY_IMAGE_TAG ?= zerp-api:quality
STATICCHECK_VERSION ?= v0.7.0
GOVULNCHECK_VERSION ?= v1.6.0
BACKEND_COVERAGE_MIN ?= 10.5
override E2E_ENV_FILE := .env.e2e.local
override TEST_PROJECT := zerp-api-test
TEST_POSTGRES_PORT ?= 55434
TEST_INTEGRATION_JOBS ?= 3
TEST_DATABASE_URL_EFFECTIVE = postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@127.0.0.1:$(TEST_POSTGRES_PORT)/$(TEST_POSTGRES_DB)?sslmode=disable
TEST_COMPOSE = POSTGRES_PORT=$(TEST_POSTGRES_PORT) docker compose -p $(TEST_PROJECT) --env-file $(ENV_FILE)
ifneq (,$(wildcard ./$(ENV_FILE)))
include $(ENV_FILE)
export
endif

.PHONY: run build test test-unit test-db-prepare test-db-clean test-migration-upgrade test-integration generate quality quality-core quality-fast quality-generated quality-format quality-format-fast quality-modules quality-compose quality-test quality-vet-build quality-race quality-staticcheck quality-vuln quality-image migrate-status migrate-up migrate-down bootstrap-admin seed-bob seed-test cleanup-attachments cleanup-vou-attachments compose-up compose-down e2e-env-init e2e-env-rotate e2e-guard

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
	@test -n "$(POSTGRES_USER)" || (echo "POSTGRES_USER is required" && exit 1)
	@test -n "$(POSTGRES_PASSWORD)" || (echo "POSTGRES_PASSWORD is required" && exit 1)
	@test -n "$(TEST_POSTGRES_PORT)" || (echo "TEST_POSTGRES_PORT is required" && exit 1)
	@case "$(TEST_POSTGRES_DB)" in \
		*[!A-Za-z0-9_]*|"") echo "TEST_POSTGRES_DB must contain only letters, numbers, and underscores" >&2; exit 1 ;; \
		*_test) ;; \
		*) echo "TEST_POSTGRES_DB must end with _test" >&2; exit 1 ;; \
	esac
	@test "$(TEST_POSTGRES_DB)" != "$(POSTGRES_DB)" || (echo "TEST_POSTGRES_DB must differ from POSTGRES_DB" && exit 1)
	@test "$(TEST_POSTGRES_PORT)" != "$(POSTGRES_PORT)" || (echo "TEST_POSTGRES_PORT must differ from POSTGRES_PORT" && exit 1)
	@$(TEST_COMPOSE) up -d --wait db
	@$(TEST_COMPOSE) exec -T -e TEST_POSTGRES_DB="$(TEST_POSTGRES_DB)" db sh -eu -c \
		'dropdb -U "$$POSTGRES_USER" --if-exists --force "$$TEST_POSTGRES_DB" && createdb -U "$$POSTGRES_USER" "$$TEST_POSTGRES_DB"'

test-db-clean:
	@test "$(TEST_PROJECT)" = "zerp-api-test" || { echo "refusing to clean unexpected test project: $(TEST_PROJECT)" >&2; exit 1; }
	@$(TEST_COMPOSE) down --volumes --remove-orphans

test-migration-upgrade: test-db-prepare
	@latest_file="$$(find db/migrations -maxdepth 1 -type f -name '[0-9]*_*.sql' | LC_ALL=C sort | tail -n 1)"; \
		test -n "$$latest_file" || { echo "no migrations found" >&2; exit 1; }; \
		prefix="$$(basename "$$latest_file")"; prefix="$${prefix%%_*}"; \
		latest_version="$$(printf '%s' "$$prefix" | sed 's/^0*//')"; \
		previous_version="$$((latest_version - 1))"; \
		before_fixture="db/migration-tests/$${prefix}_before.sql"; \
		after_fixture="db/migration-tests/$${prefix}_after.sql"; \
		test -f "$$before_fixture" || { echo "missing migration upgrade fixture: $$before_fixture" >&2; exit 1; }; \
		test -f "$$after_fixture" || { echo "missing migration upgrade fixture: $$after_fixture" >&2; exit 1; }; \
		go -C tools tool goose -dir ../db/migrations postgres "$(TEST_DATABASE_URL_EFFECTIVE)" up-to "$$previous_version"; \
		$(TEST_COMPOSE) exec -T db psql -v ON_ERROR_STOP=1 -U "$(POSTGRES_USER)" -d "$(TEST_POSTGRES_DB)" < "$$before_fixture"; \
		go -C tools tool goose -dir ../db/migrations postgres "$(TEST_DATABASE_URL_EFFECTIVE)" up; \
		$(TEST_COMPOSE) exec -T db psql -v ON_ERROR_STOP=1 -U "$(POSTGRES_USER)" -d "$(TEST_POSTGRES_DB)" < "$$after_fixture"

test-integration:
	@ENV_FILE="$(ENV_FILE)" TEST_INTEGRATION_JOBS="$(TEST_INTEGRATION_JOBS)" \
		TEST_INTEGRATION_PACKAGES_FILE="$(TEST_INTEGRATION_PACKAGES_FILE)" \
		TEST_INTEGRATION_RESULT_FILE="$(TEST_INTEGRATION_RESULT_FILE)" \
		./scripts/run-integration-tests.sh

generate:
	go -C tools tool sqlc generate -f ../sqlc.yaml

quality:
	@$(MAKE) quality-generated
	@$(MAKE) quality-compose
	@$(MAKE) quality-core
	@$(MAKE) quality-image

quality-core:
	@$(MAKE) quality-format
	@$(MAKE) quality-test
	@$(MAKE) quality-vet-build
	@$(MAKE) quality-race
	@$(MAKE) quality-staticcheck
	@$(MAKE) quality-vuln

quality-fast:
	@$(MAKE) quality-format-fast
	@$(MAKE) test-unit
	@$(MAKE) quality-vet-build

quality-generated:
	@before="$$(find internal/database/sqlc -type f -name '*.go' -print | LC_ALL=C sort | while IFS= read -r file; do printf '%s ' "$$file"; git hash-object "$$file"; done)"; \
		$(MAKE) generate; \
		after="$$(find internal/database/sqlc -type f -name '*.go' -print | LC_ALL=C sort | while IFS= read -r file; do printf '%s ' "$$file"; git hash-object "$$file"; done)"; \
		test "$$before" = "$$after" || { echo "sqlc generated files changed; review and stage them before rerunning quality" >&2; exit 1; }

quality-format: quality-format-fast quality-modules

quality-format-fast:
	@test -z "$$(gofmt -l $$(git ls-files '*.go'))" || { gofmt -l $$(git ls-files '*.go'); exit 1; }
	@./scripts/check-rpt-migration-gate.sh
	git diff --check
	git diff --cached --check

quality-modules:
	go mod tidy -diff
	go -C tools mod tidy -diff
	go mod verify
	go -C tools mod verify

quality-compose:
	docker compose --env-file $(ENV_FILE) config --quiet

quality-test:
	@cleanup() { \
		status="$$?"; \
		trap - EXIT; \
		$(MAKE) test-db-clean || cleanup_status="$$?"; \
		if [ "$$status" -eq 0 ] && [ "$${cleanup_status:-0}" -ne 0 ]; then status="$$cleanup_status"; fi; \
		exit "$$status"; \
	}; \
	trap cleanup EXIT; \
	trap 'exit 129' HUP; \
	trap 'exit 130' INT; \
	trap 'exit 143' TERM; \
	$(MAKE) test-integration

quality-vet-build:
	go vet ./...
	go build ./...

quality-race:
	@mkdir -p var
	@cleanup() { rm -f var/coverage.unit.out; }; \
		trap cleanup EXIT HUP INT TERM; \
		go test -race -coverprofile=var/coverage.unit.out ./...; \
		coverage="$$(go tool cover -func=var/coverage.unit.out | awk '/^total:/ { value=$$3; sub(/%$$/, "", value); print value }')"; \
		awk -v actual="$$coverage" -v minimum="$(BACKEND_COVERAGE_MIN)" 'BEGIN { \
			if ((actual + 0) < (minimum + 0)) { \
				printf "backend unit coverage %.1f%% is below %.1f%%\n", actual, minimum > "/dev/stderr"; \
				exit 1; \
			} \
			printf "backend unit coverage %.1f%% (minimum %.1f%%)\n", actual, minimum; \
		}'

quality-staticcheck:
	go run honnef.co/go/tools/cmd/staticcheck@$(STATICCHECK_VERSION) $$(go list ./... | grep -v '/internal/api/generated$$')

quality-vuln:
	go run golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION) ./...

quality-image:
	docker build --tag $(QUALITY_IMAGE_TAG) .
	docker run --rm --entrypoint /bin/sh $(QUALITY_IMAGE_TAG) -c 'test -r /app/migrations/00001_initial.sql'

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

seed-test:
	@go run ./cmd/seed-test

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
