-- +goose Up

LOCK TABLE bob_objects, aux_objects, vou_documents IN ACCESS EXCLUSIVE MODE;

ALTER TABLE bob_customer_versions
    DROP CONSTRAINT bob_customer_versions_customer_type_check;

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (
            SELECT entity, count(*) AS total FROM bob_objects GROUP BY entity
            UNION ALL
            SELECT entity, count(*) AS total FROM aux_objects GROUP BY entity
        ) counts
        WHERE total > 9999
    ) THEN
        RAISE EXCEPTION 'object numbering supports at most 9999 objects per entity';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vou_documents
        GROUP BY entity, business_date
        HAVING count(*) > 9999
    ) THEN
        RAISE EXCEPTION 'document numbering supports at most 9999 documents per entity and business date';
    END IF;
END
$$;
-- +goose StatementEnd

CREATE TABLE identifier_object_renumber_history (
    domain varchar(3) NOT NULL CHECK (domain IN ('bob', 'aux')),
    object_id varchar(26) NOT NULL,
    entity varchar(32) NOT NULL,
    old_code varchar(64) NOT NULL,
    new_code varchar(8) NOT NULL CHECK (new_code ~ '^[A-Z]{3}-[0-9]{4}$'),
    PRIMARY KEY (domain, object_id),
    UNIQUE (domain, entity, new_code)
);

CREATE TABLE identifier_document_renumber_history (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL,
    business_date date NOT NULL,
    old_number varchar(32) NOT NULL UNIQUE,
    new_number varchar(17) NOT NULL UNIQUE
        CHECK (new_number ~ '^[A-Z]{3}-[0-9]{8}-[0-9]{4}$')
);

CREATE TABLE identifier_counter_renumber_history (
    entity varchar(32) NOT NULL,
    business_date date NOT NULL,
    last_value integer NOT NULL,
    PRIMARY KEY (entity, business_date)
);

INSERT INTO identifier_counter_renumber_history(entity, business_date, last_value)
SELECT entity, business_date, last_value
FROM vou_number_counters;

WITH ranked AS (
    SELECT
        o.*,
        row_number() OVER (
            PARTITION BY o.entity
            ORDER BY
                CASE o.id
                    WHEN '01JAVX00000000000000000001' THEN 1
                    WHEN '01JAVX00000000000000000003' THEN 2
                    WHEN '01JAVX00000000000000000005' THEN 1
                    WHEN '01JAVX00000000000000000007' THEN 2
                    WHEN '01JAVX00000000000000000009' THEN 3
                    WHEN '01JAVX00000000000000000011' THEN 1
                    WHEN '01JAVX00000000000000000013' THEN 2
                    WHEN '01JAVX00000000000000000015' THEN 3
                    WHEN '01JAVX00000000000000000017' THEN 4
                    WHEN '01JAVX00000000000000000025' THEN 5
                    WHEN '01JAVX00000000000000000027' THEN 6
                    ELSE 1000
                END,
                o.created_at,
                o.id
        ) AS sequence
    FROM aux_objects o
)
INSERT INTO identifier_object_renumber_history(domain, object_id, entity, old_code, new_code)
SELECT
    'aux',
    id,
    entity,
    code,
    CASE entity
        WHEN 'product-category' THEN 'PCT'
        WHEN 'product-type' THEN 'PTP'
        WHEN 'department' THEN 'DEP'
        WHEN 'position' THEN 'POS'
        WHEN 'settlement-method' THEN 'STM'
        WHEN 'dictionary-type' THEN 'DCT'
        WHEN 'dictionary-item' THEN 'DIT'
        WHEN 'measurement-unit' THEN 'UNT'
        WHEN 'income-expense-type' THEN 'IET'
        WHEN 'account-subject' THEN 'ACS'
    END || '-' || lpad(sequence::text, 4, '0')
FROM ranked;

INSERT INTO identifier_object_renumber_history(domain, object_id, entity, old_code, new_code)
SELECT 'bob', bob.id, bob.entity, bob.code, aux.new_code
FROM bob_objects bob
JOIN identifier_object_renumber_history aux
  ON aux.domain = 'aux' AND aux.object_id = bob.id;

WITH remaining AS (
    SELECT
        bob.*,
        row_number() OVER (PARTITION BY bob.entity ORDER BY bob.created_at, bob.id) AS local_sequence,
        CASE bob.entity
            WHEN 'category' THEN 'product-category'
            WHEN 'department' THEN 'department'
            WHEN 'position' THEN 'position'
            WHEN 'settlement-method' THEN 'settlement-method'
            ELSE NULL
        END AS aux_entity
    FROM bob_objects bob
    WHERE NOT EXISTS (
        SELECT 1
        FROM identifier_object_renumber_history history
        WHERE history.domain = 'bob' AND history.object_id = bob.id
    )
), numbered AS (
    SELECT
        remaining.*,
        local_sequence + COALESCE((
            SELECT max(right(history.new_code, 4)::integer)
            FROM identifier_object_renumber_history history
            WHERE history.domain = 'aux' AND history.entity = remaining.aux_entity
        ), 0) AS sequence
    FROM remaining
)
INSERT INTO identifier_object_renumber_history(domain, object_id, entity, old_code, new_code)
SELECT
    'bob',
    id,
    entity,
    code,
    CASE entity
        WHEN 'customer' THEN 'CUS'
        WHEN 'supplier' THEN 'SUP'
        WHEN 'employee' THEN 'EMP'
        WHEN 'product' THEN 'PRD'
        WHEN 'service' THEN 'SVC'
        WHEN 'warehouse' THEN 'WHS'
        WHEN 'vehicle' THEN 'VEH'
        WHEN 'fund-account' THEN 'FAC'
        WHEN 'category' THEN 'PCT'
        WHEN 'department' THEN 'DEP'
        WHEN 'position' THEN 'POS'
        WHEN 'settlement-method' THEN 'STM'
    END || '-' || lpad(sequence::text, 4, '0')
FROM numbered;

WITH ranked AS (
    SELECT
        document.*,
        row_number() OVER (
            PARTITION BY entity, business_date
            ORDER BY created_at, id
        ) AS sequence
    FROM vou_documents document
)
INSERT INTO identifier_document_renumber_history(
    document_id, entity, business_date, old_number, new_number
)
SELECT
    id,
    entity,
    business_date,
    document_no,
    CASE entity
        WHEN 'sale-order' THEN 'SOR'
        WHEN 'sale-outbound' THEN 'SOB'
        WHEN 'sale-delivery' THEN 'SDL'
        WHEN 'sale-signoff' THEN 'SSF'
        WHEN 'sale-return' THEN 'SRT'
        WHEN 'purchase-order' THEN 'POR'
        WHEN 'purchase-inbound' THEN 'PIN'
        WHEN 'purchase-return' THEN 'PRT'
        WHEN 'receipt' THEN 'REC'
        WHEN 'payment' THEN 'PAY'
        WHEN 'expense-reimbursement' THEN 'EXR'
        WHEN 'other-income' THEN 'OIN'
    END || '-' || to_char(business_date, 'YYYYMMDD') || '-' || lpad(sequence::text, 4, '0')
FROM ranked;

UPDATE aux_objects SET code = 'TMP-' || id;
UPDATE bob_objects SET code = 'TMP-' || id;
UPDATE vou_documents SET document_no = 'TMP-' || id;

UPDATE aux_objects object
SET code = history.new_code
FROM identifier_object_renumber_history history
WHERE history.domain = 'aux' AND history.object_id = object.id;

UPDATE bob_objects object
SET code = history.new_code
FROM identifier_object_renumber_history history
WHERE history.domain = 'bob' AND history.object_id = object.id;

UPDATE vou_documents document
SET document_no = history.new_number
FROM identifier_document_renumber_history history
WHERE history.document_id = document.id;

-- +goose StatementBegin
DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT code_column.table_name,
               code_column.column_name AS code_column,
               replace(code_column.column_name, '_code', '_object_id') AS id_column
        FROM information_schema.columns code_column
        JOIN information_schema.tables base_table
          ON base_table.table_schema = code_column.table_schema
         AND base_table.table_name = code_column.table_name
         AND base_table.table_type = 'BASE TABLE'
        WHERE code_column.table_schema = 'public'
          AND code_column.column_name LIKE '%\_code' ESCAPE '\'
          AND EXISTS (
              SELECT 1
              FROM information_schema.columns id_column
              WHERE id_column.table_schema = code_column.table_schema
                AND id_column.table_name = code_column.table_name
                AND id_column.column_name = replace(code_column.column_name, '_code', '_object_id')
          )
    LOOP
        EXECUTE format(
            'UPDATE %I target SET %I = mapping.new_code
             FROM (
                 SELECT object_id, min(new_code) AS new_code
                 FROM identifier_object_renumber_history
                 GROUP BY object_id
                 HAVING count(DISTINCT new_code) = 1
             ) mapping
             WHERE target.%I = mapping.object_id',
            target.table_name, target.code_column, target.id_column
        );
    END LOOP;
END
$$;
-- +goose StatementEnd

UPDATE bob_customer_versions detail
SET customer_type = history.new_code
FROM identifier_object_renumber_history history
WHERE history.domain = 'aux'
  AND history.entity = 'dictionary-item'
  AND detail.customer_type = history.old_code;

UPDATE bob_vehicle_versions detail
SET vehicle_type = history.new_code
FROM identifier_object_renumber_history history
WHERE history.domain = 'aux'
  AND history.entity = 'dictionary-item'
  AND detail.vehicle_type = history.old_code;

UPDATE aux_versions version
SET data = jsonb_set(version.data, '{dictionaryTypeCode}', to_jsonb(history.new_code), false)
FROM identifier_object_renumber_history history
WHERE version.entity = 'dictionary-item'
  AND history.domain = 'aux'
  AND history.entity = 'dictionary-type'
  AND version.data->>'dictionaryTypeCode' = history.old_code;

-- +goose StatementBegin
DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT number_column.table_name,
               number_column.column_name AS number_column,
               replace(number_column.column_name, '_no', '_id') AS id_column
        FROM information_schema.columns number_column
        JOIN information_schema.tables base_table
          ON base_table.table_schema = number_column.table_schema
         AND base_table.table_name = number_column.table_name
         AND base_table.table_type = 'BASE TABLE'
        WHERE number_column.table_schema = 'public'
          AND number_column.column_name IN ('document_no', 'source_document_no', 'root_document_no')
          AND number_column.table_name <> 'vou_documents'
          AND EXISTS (
              SELECT 1
              FROM information_schema.columns id_column
              WHERE id_column.table_schema = number_column.table_schema
                AND id_column.table_name = number_column.table_name
                AND id_column.column_name = replace(number_column.column_name, '_no', '_id')
          )
    LOOP
        EXECUTE format(
            'UPDATE %I target SET %I = history.new_number
             FROM identifier_document_renumber_history history
             WHERE target.%I = history.document_id',
            target.table_name, target.number_column, target.id_column
        );
    END LOOP;
END
$$;
-- +goose StatementEnd

UPDATE vou_audit_events event
SET child_no = history.new_number
FROM identifier_document_renumber_history history
WHERE event.child_id = history.document_id;

-- +goose StatementBegin
CREATE FUNCTION identifier_rewrite_jsonb(input jsonb, reverse_mapping boolean)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    scalar text;
    replacement text;
BEGIN
    CASE jsonb_typeof(input)
        WHEN 'object' THEN
            RETURN COALESCE((
                SELECT jsonb_object_agg(key, identifier_rewrite_jsonb(value, reverse_mapping))
                FROM jsonb_each(input)
            ), '{}'::jsonb);
        WHEN 'array' THEN
            RETURN COALESCE((
                SELECT jsonb_agg(identifier_rewrite_jsonb(value, reverse_mapping))
                FROM jsonb_array_elements(input)
            ), '[]'::jsonb);
        WHEN 'string' THEN
            scalar := input #>> '{}';
            IF reverse_mapping THEN
                SELECT old_code INTO replacement
                FROM identifier_object_renumber_history
                WHERE new_code = scalar
                LIMIT 1;
                IF replacement IS NULL THEN
                    SELECT old_number INTO replacement
                    FROM identifier_document_renumber_history
                    WHERE new_number = scalar;
                END IF;
            ELSE
                SELECT new_code INTO replacement
                FROM identifier_object_renumber_history
                WHERE old_code = scalar
                ORDER BY domain = 'aux' DESC
                LIMIT 1;
                IF replacement IS NULL THEN
                    SELECT new_number INTO replacement
                    FROM identifier_document_renumber_history
                    WHERE old_number = scalar;
                END IF;
            END IF;
            RETURN CASE WHEN replacement IS NULL THEN input ELSE to_jsonb(replacement) END;
        ELSE
            RETURN input;
    END CASE;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT column_meta.table_name, column_meta.column_name
        FROM information_schema.columns column_meta
        WHERE column_meta.table_schema = 'public'
          AND column_meta.data_type = 'jsonb'
          AND column_meta.column_name = 'summary'
          AND (
              column_meta.table_name LIKE 'bob\_%' ESCAPE '\'
              OR column_meta.table_name LIKE 'aux\_%' ESCAPE '\'
              OR column_meta.table_name LIKE 'vou\_%' ESCAPE '\'
              OR column_meta.table_name LIKE 'wfl\_%' ESCAPE '\'
              OR column_meta.table_name LIKE 'led\_%' ESCAPE '\'
          )
    LOOP
        EXECUTE format(
            'UPDATE %I SET %I = identifier_rewrite_jsonb(%I, false)',
            target.table_name, target.column_name, target.column_name
        );
    END LOOP;
END
$$;
-- +goose StatementEnd

DROP FUNCTION identifier_rewrite_jsonb(jsonb, boolean);

CREATE TABLE object_number_counters (
    domain varchar(3) NOT NULL CHECK (domain IN ('bob', 'aux')),
    entity varchar(32) NOT NULL,
    last_value integer NOT NULL CHECK (last_value BETWEEN 1 AND 9999),
    PRIMARY KEY (domain, entity)
);

INSERT INTO object_number_counters(domain, entity, last_value)
SELECT domain, entity, max(right(new_code, 4)::integer)
FROM identifier_object_renumber_history
GROUP BY domain, entity;

TRUNCATE vou_number_counters;
INSERT INTO vou_number_counters(entity, business_date, last_value)
SELECT entity, business_date, max(right(new_number, 4)::integer)
FROM identifier_document_renumber_history
GROUP BY entity, business_date;

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE bob_customer_versions
    ADD CONSTRAINT bob_customer_versions_customer_type_check
        CHECK (customer_type IN ('DIT-0001', 'DIT-0002'));

ALTER TABLE vou_number_counters
    DROP CONSTRAINT vou_number_counters_last_value_check,
    ADD CONSTRAINT vou_number_counters_last_value_check
        CHECK (last_value BETWEEN 1 AND 9999);

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_code_check,
    ADD CONSTRAINT bob_objects_code_check CHECK (code ~ '^[A-Z]{3}-[0-9]{4}$');

ALTER TABLE aux_objects
    DROP CONSTRAINT aux_objects_code_check,
    ADD CONSTRAINT aux_objects_code_check CHECK (code ~ '^[A-Z]{3}-[0-9]{4}$');

ALTER TABLE vou_documents
    ADD CONSTRAINT vou_documents_number_format_check
        CHECK (document_no ~ '^[A-Z]{3}-[0-9]{8}-[0-9]{4}$');

-- +goose Down

LOCK TABLE bob_objects, aux_objects, vou_documents IN ACCESS EXCLUSIVE MODE;

ALTER TABLE bob_customer_versions
    DROP CONSTRAINT bob_customer_versions_customer_type_check;

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_number_format_check;

ALTER TABLE aux_objects
    DROP CONSTRAINT aux_objects_code_check,
    ADD CONSTRAINT aux_objects_code_check CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]*$');

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_code_check,
    ADD CONSTRAINT bob_objects_code_check CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]*$');

ALTER TABLE vou_number_counters
    DROP CONSTRAINT vou_number_counters_last_value_check,
    ADD CONSTRAINT vou_number_counters_last_value_check
        CHECK (last_value BETWEEN 1 AND 999999);

-- +goose StatementBegin
CREATE FUNCTION identifier_rewrite_jsonb(input jsonb, reverse_mapping boolean)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    scalar text;
    replacement text;
BEGIN
    CASE jsonb_typeof(input)
        WHEN 'object' THEN
            RETURN COALESCE((
                SELECT jsonb_object_agg(key, identifier_rewrite_jsonb(value, reverse_mapping))
                FROM jsonb_each(input)
            ), '{}'::jsonb);
        WHEN 'array' THEN
            RETURN COALESCE((
                SELECT jsonb_agg(identifier_rewrite_jsonb(value, reverse_mapping))
                FROM jsonb_array_elements(input)
            ), '[]'::jsonb);
        WHEN 'string' THEN
            scalar := input #>> '{}';
            SELECT old_code INTO replacement
            FROM identifier_object_renumber_history
            WHERE new_code = scalar
            LIMIT 1;
            IF replacement IS NULL THEN
                SELECT old_number INTO replacement
                FROM identifier_document_renumber_history
                WHERE new_number = scalar;
            END IF;
            RETURN CASE WHEN replacement IS NULL THEN input ELSE to_jsonb(replacement) END;
        ELSE
            RETURN input;
    END CASE;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT column_meta.table_name, column_meta.column_name
        FROM information_schema.columns column_meta
        WHERE column_meta.table_schema = 'public'
          AND column_meta.data_type = 'jsonb'
          AND column_meta.column_name = 'summary'
          AND (
              column_meta.table_name LIKE 'bob\_%' ESCAPE '\'
              OR column_meta.table_name LIKE 'aux\_%' ESCAPE '\'
              OR column_meta.table_name LIKE 'vou\_%' ESCAPE '\'
              OR column_meta.table_name LIKE 'wfl\_%' ESCAPE '\'
              OR column_meta.table_name LIKE 'led\_%' ESCAPE '\'
          )
    LOOP
        EXECUTE format(
            'UPDATE %I SET %I = identifier_rewrite_jsonb(%I, true)',
            target.table_name, target.column_name, target.column_name
        );
    END LOOP;
END
$$;
-- +goose StatementEnd

DROP FUNCTION identifier_rewrite_jsonb(jsonb, boolean);

-- +goose StatementBegin
DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT code_column.table_name,
               code_column.column_name AS code_column,
               replace(code_column.column_name, '_code', '_object_id') AS id_column
        FROM information_schema.columns code_column
        JOIN information_schema.tables base_table
          ON base_table.table_schema = code_column.table_schema
         AND base_table.table_name = code_column.table_name
         AND base_table.table_type = 'BASE TABLE'
        WHERE code_column.table_schema = 'public'
          AND code_column.column_name LIKE '%\_code' ESCAPE '\'
          AND EXISTS (
              SELECT 1
              FROM information_schema.columns id_column
              WHERE id_column.table_schema = code_column.table_schema
                AND id_column.table_name = code_column.table_name
                AND id_column.column_name = replace(code_column.column_name, '_code', '_object_id')
          )
    LOOP
        EXECUTE format(
            'UPDATE %I target SET %I = mapping.old_code
             FROM (
                 SELECT object_id, min(old_code) AS old_code
                 FROM identifier_object_renumber_history
                 GROUP BY object_id
                 HAVING count(DISTINCT old_code) = 1
             ) mapping
             WHERE target.%I = mapping.object_id',
            target.table_name, target.code_column, target.id_column
        );
    END LOOP;
END
$$;
-- +goose StatementEnd

UPDATE bob_customer_versions detail
SET customer_type = history.old_code
FROM identifier_object_renumber_history history
WHERE history.domain = 'aux'
  AND history.entity = 'dictionary-item'
  AND detail.customer_type = history.new_code;

UPDATE bob_vehicle_versions detail
SET vehicle_type = history.old_code
FROM identifier_object_renumber_history history
WHERE history.domain = 'aux'
  AND history.entity = 'dictionary-item'
  AND detail.vehicle_type = history.new_code;

UPDATE aux_versions version
SET data = jsonb_set(version.data, '{dictionaryTypeCode}', to_jsonb(history.old_code), false)
FROM identifier_object_renumber_history history
WHERE version.entity = 'dictionary-item'
  AND history.domain = 'aux'
  AND history.entity = 'dictionary-type'
  AND version.data->>'dictionaryTypeCode' = history.new_code;

-- +goose StatementBegin
DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT number_column.table_name,
               number_column.column_name AS number_column,
               replace(number_column.column_name, '_no', '_id') AS id_column
        FROM information_schema.columns number_column
        JOIN information_schema.tables base_table
          ON base_table.table_schema = number_column.table_schema
         AND base_table.table_name = number_column.table_name
         AND base_table.table_type = 'BASE TABLE'
        WHERE number_column.table_schema = 'public'
          AND number_column.column_name IN ('document_no', 'source_document_no', 'root_document_no')
          AND number_column.table_name <> 'vou_documents'
          AND EXISTS (
              SELECT 1
              FROM information_schema.columns id_column
              WHERE id_column.table_schema = number_column.table_schema
                AND id_column.table_name = number_column.table_name
                AND id_column.column_name = replace(number_column.column_name, '_no', '_id')
          )
    LOOP
        EXECUTE format(
            'UPDATE %I target SET %I = history.old_number
             FROM identifier_document_renumber_history history
             WHERE target.%I = history.document_id',
            target.table_name, target.number_column, target.id_column
        );
    END LOOP;
END
$$;
-- +goose StatementEnd

UPDATE vou_audit_events event
SET child_no = history.old_number
FROM identifier_document_renumber_history history
WHERE event.child_id = history.document_id;

UPDATE aux_objects SET code = 'TMP-' || id
WHERE id IN (SELECT object_id FROM identifier_object_renumber_history WHERE domain = 'aux');
UPDATE bob_objects SET code = 'TMP-' || id
WHERE id IN (SELECT object_id FROM identifier_object_renumber_history WHERE domain = 'bob');
UPDATE vou_documents SET document_no = 'TMP-' || id
WHERE id IN (SELECT document_id FROM identifier_document_renumber_history);

UPDATE aux_objects object
SET code = history.old_code
FROM identifier_object_renumber_history history
WHERE history.domain = 'aux' AND history.object_id = object.id;

UPDATE bob_objects object
SET code = history.old_code
FROM identifier_object_renumber_history history
WHERE history.domain = 'bob' AND history.object_id = object.id;

UPDATE vou_documents document
SET document_no = history.old_number
FROM identifier_document_renumber_history history
WHERE history.document_id = document.id;

TRUNCATE vou_number_counters;
INSERT INTO vou_number_counters(entity, business_date, last_value)
SELECT entity, business_date, last_value
FROM identifier_counter_renumber_history;

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE bob_customer_versions
    ADD CONSTRAINT bob_customer_versions_customer_type_check
        CHECK (customer_type IN ('END_USER', 'DEALER'));

DROP TABLE object_number_counters;
DROP TABLE identifier_counter_renumber_history;
DROP TABLE identifier_document_renumber_history;
DROP TABLE identifier_object_renumber_history;
