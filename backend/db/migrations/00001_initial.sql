-- +goose Up
-- This baseline intentionally creates no business tables. Domain schemas are
-- introduced by reviewed migrations together with their API implementation.
SELECT 1;

-- +goose Down
SELECT 1;
