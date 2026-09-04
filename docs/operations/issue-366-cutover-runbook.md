# #366 one-time production cutover runbook

## Scope and hard stop

This runbook changes production ownership exactly once: old frontend and Go API
to target frontend and Hono API. There is one complete runtime and one write
path before the maintenance window, and one complete runtime and one write path
after it. Do not introduce request forwarding, traffic splitting, parallel
writes, old-schema reads, or a second lifecycle during this procedure.

The currently checked-in operator tool is intentionally an inventory gate, not
a data writer:

```sh
pnpm --filter @zerp/api cutover:inventory -- \
  --database-url "$CUTOVER_DATABASE_URL" \
  --writer-freeze-evidence /secure/cutover/freeze.json \
  --database-snapshot /secure/cutover/database-snapshot.json \
  --attachment-snapshot /secure/cutover/attachment-snapshot.json \
  --output /secure/cutover/inventory.json
```

It runs the read-only queries in
[`issue-366-approval-status-inventory.sql`](../../backend/db/cutovers/issue-366-approval-status-inventory.sql)
and
[`issue-366-mapped-facts-inventory.sql`](../../backend/db/cutovers/issue-366-mapped-facts-inventory.sql).
It writes a report before returning `2` for a blocked gate. A zero exit only
means the freeze evidence and paired snapshots are syntactically complete and
the source has no `DRAFT` or unsupported Approval status. The report binds the
writer-freeze proof and both snapshot manifests into `evidenceChecksum`, and
binds canonical `app_users`, `approval_entries`, and `approval_events` facts
into `mappedFactsChecksum`; `sourceChecksum` covers all three inputs.
It does not authorize a write.

Do not run an expanded transform yet. The legacy schema provides attachment metadata <!-- docs-check: legacy-exception=release-cutover ref=ADR-0051 -->
(`storage_key`, declared digest and size), but neither schema supplies a total,
reviewed mapping from every legacy DCL/VOU/ACC/WFL/RPT business snapshot and <!-- docs-check: legacy-exception=release-cutover ref=ADR-0051 -->
attachment ownership relation to a target Submission. <!-- docs-check: legacy-exception=release-cutover ref=ADR-0051 --> An
operator must first approve a mapping dossier that gives, for every source
table and every attachment, its target table, stable ID rule, field-by-field
normalization, archive destination, row-count reconciliation and checksum
method. The dossier must also name what happens to pending work; browser-local
Drafts must never be fabricated from a server record. Without that evidence,
the inventory result is the required fail-closed end state.

## Preconditions and freeze evidence

1. Record the exact approved merge SHA and the old frontend/API image IDs.
   Confirm the target SHA has passed its isolated test and RPT evidence, but do
   not expose it to production traffic.
2. Schedule a maintenance window. Disable ingress for business writes and put
   the UI in a maintenance response before stopping processes.
3. Freeze each writer and capture a time-stamped, operator-readable proof:

   - old API: all business mutation endpoints and attachment upload/finalize
     endpoints reject new work;
   - WFL: no instance starts, actions, retries or timer-driven writes;
   - schedulers/workers: every queue consumer, cron job, outbox/event publisher
     and reconciliation task is paused and drained;
   - operator path: seed, admin SQL, import/export write commands and manual
     attachment maintenance are disabled for everyone except the named cutover
     operator.

4. Store the proof as `freeze.json`, without credentials, using this shape:

```json
{
  "id": "freeze-YYYYMMDD-sequence",
  "observedAt": "2026-09-05T00:00:00.000Z",
  "writers": {
    "api": { "frozen": true, "evidenceId": "...", "observedAt": "..." },
    "wfl": { "frozen": true, "evidenceId": "...", "observedAt": "..." },
    "scheduler": { "frozen": true, "evidenceId": "...", "observedAt": "..." },
    "operator": { "frozen": true, "evidenceId": "...", "observedAt": "..." }
  }
}
```

5. Stop both old and target API processes before snapshots. Confirm no worker,
   scheduler, port listener or attachment uploader remains. Query database
   activity and the attachment store audit stream to establish zero business
   writes after the freeze time. Keep writes closed until acceptance or a
   verified rollback completes.

Physical attachment orphan scans use `AttachmentStore.cleanupOrphans` and
`cleanupStagingOrphans` only under this all-writers-frozen condition. Runtime
cleanup endpoints remove expired database metadata but never perform a global
filesystem sweep while upload or promotion transactions can still be in flight.

## Paired snapshots and inventory

1. Capture a PostgreSQL snapshot and an attachment-store snapshot while writes
   remain closed. They are one pair only when both refer to the same
   `freezeEvidenceId` and their capture times fall inside the zero-write window.
   Preserve both immutable originals.
2. Compute SHA-256 on each finished snapshot. Record identifiers, UTC capture
   times, checksum and the common freeze ID in separate JSON manifests:

```json
{
  "identifier": "provider-or-backup-id",
  "capturedAt": "2026-09-05T00:05:00.000Z",
  "checksum": "64-lowercase-hex-characters",
  "freezeEvidenceId": "freeze-YYYYMMDD-sequence"
}
```

3. Run `cutover:inventory` with the manifests. Archive `inventory.json` with
   the snapshot evidence. Any nonzero exit, nonempty `gateFailures`, nonzero
   `unresolvedCount` (including `unresolvedDraftCount`), unsupported status,
   manifest mismatch, missing writer proof, or write activity is a stop. Do
   not repair or reinterpret facts inside this window; resolve them through
   authorized business handling, then recapture the complete paired snapshot.

## Required transform rehearsal and cutover (blocked pending mapping dossier)

`pnpm --filter @zerp/api cutover:transform` is the checked-in fixture/copy
operator command. It accepts source and target database URLs, an accepted
inventory report, an exclusive archive output path and a report output path.
It takes the target transaction at serializable isolation and an advisory lock;
its only currently explicit data mappings are `app_users` and legacy <!-- docs-check: legacy-exception=release-cutover ref=ADR-0051 -->
`approval_entries` into the target three-state `approval_entries` shape. It writes ordered legacy <!-- docs-check: legacy-exception=release-cutover ref=ADR-0051 -->
`approval_events` to a new, mode-0600 archive bundle rather than extending the
target lifecycle. Before writing it recomputes the canonical mapped-fact hash
and verifies the inventory's evidence-bound source hash. A transaction failure
removes a newly created archive; an identical existing archive is accepted for
retry, while different contents fail closed. It has no runtime entrypoint.

Before any target write it exact-counts every source public base table. Any
nonempty table other than those two explicitly mapped Approval tables causes a
`UNMAPPED_NONEMPTY_LEGACY_TABLES` report and exit `2`; it lists every table and
count. `REJECTED` is a target state: its fixture/source mapping requires
explicit rejection actor, time and reason facts. Consequently this command is
safe for a minimal reviewed fixture but will correctly refuse the current
production-shaped source until the mapping dossier covers every nonempty
business table and attachments.

After the mapping dossier is approved, independently review each new mapping
before authorizing this section. The completed one-time transform must retain
one frozen, serializable PostgreSQL transaction with its lock held for the
complete target read, transform and validation sequence.

The transform report must contain deterministic canonical checksums and exact
`before`, `transformed`, `archived`, and `rejected` counts. It must exit
nonzero, roll back every write and preserve its report when source checksums,
input manifests, status inventory, attachment checksums, count reconciliation
or mapping rules drift. It must archive old Approval evidence as read-only
history, not as a target lifecycle state.

Prove convergence in an isolated rehearsal before production:

1. Bootstrap a fresh target database from `apps/api/db/target-schema.sql` and
   seed the approved target fixture.
2. Restore a copy of the frozen legacy database and attachment snapshot, then <!-- docs-check: legacy-exception=release-cutover ref=ADR-0051 -->
   execute the one-time transform against that copy.
3. Compare normalized final schema fingerprints (tables, columns, constraints,
   indexes) and canonical business/attachment checksums. Both paths must have
   exactly the target schema and the same intended fixture facts. No source
   table, old action, or old status may remain reachable in the target runtime.

Only then repeat the exact reviewed command once against the frozen production
pair. Keep its report, input checksums, transaction evidence and output
checksums with the release record.

## Acceptance before reopening writes

1. Start only the target frontend/API images at the approved merge SHA. Record
   image IDs, health and readiness; do not reopen ingress yet.
2. Run the all-enabled RPT prepare/explain/limited-execution/result-contract
   gate against the transformed database:

   ```sh
   TARGET_DATABASE_URL="$CUTOVER_DATABASE_URL" pnpm --filter @zerp/api validate:rpt
   ```

3. Verify authentication and representative read-only APP, DCL, VOU, ACC, WFL
   and RPT flows. Confirm Submission actions are server-authoritative and the
   live database has only `PENDING`, `APPROVED` and `REJECTED` Approval states.
4. Recheck database and attachment audit streams: there must be no writes
   between the paired snapshot and this acceptance point except the reviewed
   transform. Compare attachment count and checksum evidence with the report.
5. Record the exact SHA, image IDs, readiness, RPT result, representative
   readbacks and final checksums. The release owner may then reopen ingress,
   workers, WFL, schedulers and operator tooling in that order.

## Rollback

Keep writers frozen. If any cutover or acceptance gate fails, do the following
in order; never attempt a partial reverse transform.

1. Stop target API/frontend and every target worker, scheduler and uploader.
2. Restore the paired PostgreSQL snapshot and attachment snapshot together.
3. Start the exact old frontend/API images recorded before the freeze, plus the
   matching old workers and scheduler configuration.
4. Verify restored schema identity, row counts, attachment checksums, health,
   authentication and representative reads against the pre-cutover evidence.
5. Preserve the failed reports and logs. Only after this verification may the
   release owner reopen old-stack ingress and the four frozen writer classes.

Do not reopen writes if either member of the snapshot pair, image identity,
schema fingerprint, count, attachment checksum or representative read differs.
