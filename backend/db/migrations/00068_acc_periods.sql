-- +goose Up

CREATE TABLE acc_periods (
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    period_month date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
    state varchar(8) NOT NULL CHECK (state IN ('UNLOCKED', 'LOCKED')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    locked_at timestamptz,
    locked_by varchar(26) REFERENCES app_users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    PRIMARY KEY (book_id, period_month),
    CHECK (
        (state = 'LOCKED' AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
        OR (state = 'UNLOCKED' AND locked_at IS NULL AND locked_by IS NULL)
    )
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION reject_locked_vou_period() RETURNS trigger AS $$
DECLARE
    target_date date;
BEGIN
    target_date := CASE WHEN TG_OP = 'DELETE' THEN OLD.business_date ELSE NEW.business_date END;
    IF EXISTS (
        SELECT 1 FROM acc_periods
        WHERE state = 'LOCKED'
          AND period_month = date_trunc('month', target_date)::date
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'accounting period is locked';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER vou_documents_locked_period_guard
BEFORE INSERT OR UPDATE OR DELETE ON vou_documents
FOR EACH ROW EXECUTE FUNCTION reject_locked_vou_period();

INSERT INTO app_permissions (
    id, path, domain, entity, action, description, status, menu_order
) VALUES
    ('01JACC00000000000000000117', '/acc/period/query', 'acc', 'period', 'query', '查询会计期间', 'ENABLED', 50),
    ('01JACC00000000000000000118', '/acc/period/lock', 'acc', 'period', 'lock', '锁定会计期间', 'ENABLED', NULL),
    ('01JACC00000000000000000119', '/acc/period/unlock', 'acc', 'period', 'unlock', '解锁会计期间', 'ENABLED', NULL);

-- +goose Down

DELETE FROM app_permissions WHERE domain = 'acc' AND entity = 'period';
DROP TRIGGER vou_documents_locked_period_guard ON vou_documents;
DROP FUNCTION reject_locked_vou_period();
DROP TABLE acc_periods;
