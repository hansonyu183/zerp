ENV_FILE ?= .env.local

ifneq (,$(wildcard ./$(ENV_FILE)))
include $(ENV_FILE)
export
endif

.PHONY: run build test test-unit test-db-prepare test-integration generate migrate-status migrate-up migrate-down bootstrap-admin seed-bob cleanup-attachments cleanup-vou-attachments compose-up compose-down

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
	@go run ./cmd/bootstrap-admin

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
