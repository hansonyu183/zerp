-- Canonical read-only facts covered by the first #366 transform slice.  The
-- inventory and transform commands hash this same JSON value so a status-only
-- match cannot conceal changes to users, approvals, or archived events.
SELECT jsonb_build_object(
  'users', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'username', username,
      'display_name', display_name,
      'password_hash', password_hash,
      'status', status,
      'failed_signin_count', failed_signin_count,
      'locked_until', locked_until,
      'password_changed_at', password_changed_at,
      'created_at', created_at,
      'created_by', created_by,
      'updated_at', updated_at,
      'updated_by', updated_by,
      'revision', revision,
      'password_change_required', password_change_required
    ) ORDER BY id)
    FROM public.app_users
  ), '[]'::jsonb),
  'approvals', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'domain', domain,
      'entity', entity,
      'subject_id', subject_id,
      'version_no', version_no,
      'status', status,
      'revision', revision,
      'created_by', created_by,
      'created_at', created_at,
      'updated_by', updated_by,
      'updated_at', updated_at,
      'submitted_by', submitted_by,
      'submitted_at', submitted_at,
      'approved_by', approved_by,
      'approved_at', approved_at,
      'rejected_by', to_jsonb(approval_entries) -> 'rejected_by',
      'rejected_at', to_jsonb(approval_entries) -> 'rejected_at',
      'rejection_reason', to_jsonb(approval_entries) -> 'rejection_reason'
    ) ORDER BY id)
    FROM public.approval_entries
  ), '[]'::jsonb),
  'events', COALESCE((
    SELECT jsonb_agg(to_jsonb(approval_events) ORDER BY created_at, id)
    FROM public.approval_events
  ), '[]'::jsonb)
)::text AS facts;
