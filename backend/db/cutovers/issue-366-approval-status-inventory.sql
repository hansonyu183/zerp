-- Read-only input to the #366 operator CLI.  It intentionally runs against the
-- frozen legacy database; do not apply it to the target schema or invoke it at
-- runtime.
SELECT status, count(*)::text
FROM public.approval_entries
GROUP BY status
ORDER BY status;
