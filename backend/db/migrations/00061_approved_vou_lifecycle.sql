-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vou_documents WHERE status = 'FINALIZED')
       OR EXISTS (SELECT 1 FROM wfl_process_instances
                  WHERE status NOT IN ('DRAFT', 'CHECKED', 'APPROVED'))
       OR EXISTS (SELECT 1 FROM wfl_definition_instances WHERE status <> 'ACTIVE')
       OR EXISTS (
           SELECT 1 FROM vou_audit_events
           WHERE event_type NOT IN (
                   'CREATED', 'SAVED', 'DELETED', 'CHECKED', 'UNCHECKED',
                   'APPROVED', 'UNAPPROVED', 'ATTACHMENT_INITIATED',
                   'ATTACHMENT_UPLOADED', 'ATTACHMENT_REMOVED'
               )
              OR (from_status IS NOT NULL
                  AND from_status NOT IN ('DRAFT', 'CHECKED', 'APPROVED'))
              OR to_status NOT IN ('DRAFT', 'CHECKED', 'APPROVED')
       )
       OR EXISTS (SELECT 1 FROM vou_sale_order_details
                  WHERE fulfillment_status NOT IN ('OPEN', 'FULFILLED'))
       OR EXISTS (SELECT 1 FROM vou_purchase_order_details
                  WHERE fulfillment_status NOT IN ('OPEN', 'FULFILLED')) THEN
        RAISE EXCEPTION
            'migration 00061 requires rebuilding legacy lifecycle data before upgrade';
    END IF;
END
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain = 'wfl'
      AND action IN (
          'short-close-request', 'short-close-cancel',
          'short-close-confirm', 'short-close-unconfirm'
      )
);

DELETE FROM app_permissions
WHERE domain = 'wfl'
  AND action IN (
      'short-close-request', 'short-close-cancel',
      'short-close-confirm', 'short-close-unconfirm'
  );

DROP INDEX vou_documents_posted_replay_idx;

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_posting_audit_ck,
    DROP CONSTRAINT vou_documents_status_audit_ck,
    DROP CONSTRAINT vou_documents_status_ck,
    DROP COLUMN executed_at,
    DROP COLUMN executed_by,
    DROP COLUMN completed_at,
    ADD CONSTRAINT vou_documents_status_ck CHECK (
        status IN ('DRAFT', 'CHECKED', 'APPROVED')
    ),
    ADD CONSTRAINT vou_documents_status_audit_ck CHECK (
        (status = 'DRAFT'
            AND reviewed_at IS NULL AND reviewed_by IS NULL
            AND approved_at IS NULL AND approved_by IS NULL)
        OR (status = 'CHECKED'
            AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
            AND approved_at IS NULL AND approved_by IS NULL)
        OR (status = 'APPROVED'
            AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
            AND approved_at IS NOT NULL AND approved_by IS NOT NULL)
    ),
    ADD CONSTRAINT vou_documents_posting_audit_ck CHECK (
        (status IN ('DRAFT', 'CHECKED')
            AND posted_at IS NULL AND posted_by IS NULL)
        OR (status = 'APPROVED'
            AND posted_at IS NOT NULL AND posted_by IS NOT NULL)
    );

CREATE INDEX vou_documents_posted_replay_idx
    ON vou_documents(posted_at, id)
    WHERE status = 'APPROVED';

ALTER TABLE vou_audit_events
    ADD CONSTRAINT vou_audit_events_event_type_check CHECK (
        event_type IN (
            'CREATED', 'SAVED', 'DELETED', 'CHECKED', 'UNCHECKED',
            'APPROVED', 'UNAPPROVED', 'ATTACHMENT_INITIATED',
            'ATTACHMENT_UPLOADED', 'ATTACHMENT_REMOVED'
        )
    ),
    ADD CONSTRAINT vou_audit_events_from_status_check CHECK (
        from_status IS NULL OR from_status IN ('DRAFT', 'CHECKED', 'APPROVED')
    ),
    ADD CONSTRAINT vou_audit_events_to_status_check CHECK (
        to_status IN ('DRAFT', 'CHECKED', 'APPROVED')
    );

ALTER TABLE vou_sale_order_details
    DROP CONSTRAINT vou_sale_order_short_close_ck,
    DROP CONSTRAINT vou_sale_order_details_fulfillment_status_check,
    DROP COLUMN short_close_requested_by,
    DROP COLUMN short_close_reason,
    ADD CONSTRAINT vou_sale_order_fulfillment_status_ck CHECK (
        fulfillment_status IN ('OPEN', 'FULFILLED')
    );

ALTER TABLE vou_purchase_order_details
    DROP CONSTRAINT vou_purchase_order_short_close_ck,
    DROP CONSTRAINT vou_purchase_order_details_fulfillment_status_check,
    DROP COLUMN short_close_requested_by,
    DROP COLUMN short_close_reason,
    ADD CONSTRAINT vou_purchase_order_fulfillment_status_ck CHECK (
        fulfillment_status IN ('OPEN', 'FULFILLED')
    );

ALTER TABLE wfl_process_instances
    DROP CONSTRAINT wfl_process_instances_status_check,
    DROP COLUMN completed_at,
    ADD CONSTRAINT wfl_process_instances_status_check CHECK (
        status IN ('DRAFT', 'CHECKED', 'APPROVED')
    );

DROP INDEX wfl_definition_instances_query_idx;

ALTER TABLE wfl_definition_instances
    DROP COLUMN status,
    DROP COLUMN completed_at;

CREATE INDEX wfl_definition_instances_query_idx
    ON wfl_definition_instances(updated_at DESC, id DESC);

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION
        'migration 00061 is irreversible; restore the database and previous image';
END
$$;
-- +goose StatementEnd
