-- +goose Up
CREATE TABLE app_role_code_counters (
  counter_key text PRIMARY KEY,
  next_value integer NOT NULL CHECK (next_value BETWEEN 0 AND 9999)
);

INSERT INTO app_role_code_counters (counter_key, next_value)
VALUES (
  'default',
  COALESCE((
    SELECT max(substring(code FROM '^ROL-([0-9]{4})$')::integer)
    FROM app_roles
  ), 0)
);

-- +goose Down
DROP TABLE app_role_code_counters;
