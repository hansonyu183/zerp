import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { findDatabaseBoundaryViolations } from './check-database-boundary.mjs'

test('current schema contains no custom routines or triggers', async () => {
  const schema = await readFile(
    new URL('../backend/db/schema.sql', import.meta.url),
    'utf8',
  )

  assert.deepEqual(findDatabaseBoundaryViolations(schema), [])
})

test('rejects custom routine and trigger declarations and registrations', () => {
  const forbidden = [
    'CREATE FUNCTION public.calculate_total() RETURNS bigint LANGUAGE sql AS $$ SELECT 1 $$;',
    'CREATE OR REPLACE PROCEDURE public.close_period() LANGUAGE sql AS $$ SELECT 1 $$;',
    'CREATE TRIGGER validate_row BEFORE INSERT ON facts EXECUTE FUNCTION public.validate_row();',
    'CREATE CONSTRAINT TRIGGER validate_commit AFTER INSERT ON facts DEFERRABLE EXECUTE PROCEDURE public.validate_commit();',
    'CREATE EVENT TRIGGER reject_ddl ON ddl_command_start EXECUTE FUNCTION public.reject_ddl();',
    'DROP FUNCTION public.old_rule();',
    'DROP PROCEDURE public.old_command();',
    'DROP TRIGGER old_rule ON facts;',
    'ALTER TABLE facts DISABLE TRIGGER USER;',
  ].join('\n')

  assert.deepEqual(
    findDatabaseBoundaryViolations(forbidden).map(({ kind }) => kind),
    [
      'custom function',
      'custom procedure',
      'trigger',
      'trigger routine registration',
      'trigger',
      'trigger routine registration',
      'trigger',
      'trigger routine registration',
      'custom function',
      'custom procedure',
      'trigger',
      'trigger control',
    ],
  )
})

test('allows built-in fact aggregation, CTEs, HAVING, and window functions', () => {
  const allowed = `
    WITH monthly AS (
      SELECT book_id, COUNT(*) AS line_count, SUM(amount_minor) AS amount_minor
      FROM acc_voucher_lines
      GROUP BY book_id
      HAVING SUM(amount_minor) <> 0
    )
    SELECT book_id, amount_minor,
      SUM(amount_minor) OVER (ORDER BY book_id) AS running_amount_minor
    FROM monthly;

    CREATE TABLE facts (
      code text CHECK (length(btrim(code)) > 0),
      created_at timestamptz DEFAULT now()
    );
  `

  assert.deepEqual(findDatabaseBoundaryViolations(allowed), [])
})

test('ignores forbidden words in SQL comments', () => {
  const comments = `
    -- CREATE FUNCTION public.old_rule() RETURNS void
    /* CREATE TRIGGER old_rule BEFORE INSERT ON facts */
    SELECT COUNT(*) FROM facts;
  `

  assert.deepEqual(findDatabaseBoundaryViolations(comments), [])
})
