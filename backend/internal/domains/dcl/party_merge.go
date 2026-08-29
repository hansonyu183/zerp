package dcl

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

// PartyMergeEngine owns DCL Party merge preflight, confirmation and audit.
type PartyMergeEngine struct {
	pool    *pgxpool.Pool
	queries *dbsqlc.Queries
}

func NewPartyMergeEngine(pool *pgxpool.Pool) *PartyMergeEngine {
	if pool == nil {
		panic("dcl: Party merge engine requires persistence")
	}
	return &PartyMergeEngine{pool: pool, queries: dbsqlc.New(pool)}
}

func (e *PartyMergeEngine) Preflight(ctx context.Context, in bobdomain.PartyMergePreflightInput, visibility bobdomain.PartyRelationshipVisibility, actorID, requestID string) (bobdomain.PartyMergePreflightResult, error) {
	return e.PartyMergePreflight(ctx, in, visibility, actorID, requestID)
}
func (e *PartyMergeEngine) Confirm(ctx context.Context, in bobdomain.PartyMergeConfirmInput, visibility bobdomain.PartyRelationshipVisibility, actorID, requestID string) (bobdomain.PartyMergeResult, error) {
	return e.PartyMergeConfirm(ctx, in, visibility, actorID, requestID)
}

const (
	partyMergeActionTransferred = "TRANSFERRED"
	partyMergeActionMerged      = "MERGED"
)

type partyMergeRelationship struct {
	relationshipType    string
	objectID            string
	objectCode          string
	operatingEntityID   string
	operatingEntityName string
	objectRevision      int64
	enabled             bool
	openApprovalEntryID string
	latestApprovedID    string
	visibleStatus       string
	visibleRevision     int64
	mergedIntoObjectID  string
}

func (s *PartyMergeEngine) PartyMergePreflight(
	ctx context.Context, input bobdomain.PartyMergePreflightInput, visibility bobdomain.PartyRelationshipVisibility, actorID, requestID string,
) (bobdomain.PartyMergePreflightResult, error) {
	if !validPartyMergeInput(input) ||
		!validActorAndRequest(actorID, requestID) {
		return bobdomain.PartyMergePreflightResult{}, domainError(ErrorValidation, "invalid Party merge preflight", nil, nil)
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return bobdomain.PartyMergePreflightResult{}, s.internal("begin Party merge preflight", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	source, target, err := lockPartyMergePair(ctx, qtx, input.SourcePartyID, input.TargetPartyID)
	if err != nil {
		return bobdomain.PartyMergePreflightResult{}, s.partyMergeLockError(err)
	}
	if source.SourceApprovalEntryID != input.SourceApprovalEntryID || target.SourceApprovalEntryID != input.TargetApprovalEntryID ||
		source.Revision != input.SourceApprovalRevision || target.Revision != input.TargetApprovalRevision {
		return bobdomain.PartyMergePreflightResult{}, domainError(ErrorConflict, "主体资料已变化，请重新预检", nil, nil)
	}
	result, sourceRelationships, targetRelationships := partyMergeAssessment(source, target)
	result.SourcePartyID, result.TargetPartyID = input.SourcePartyID, input.TargetPartyID
	result.SourceApprovalEntryID, result.TargetApprovalEntryID = source.SourceApprovalEntryID, target.SourceApprovalEntryID
	result.SourceApprovalRevision, result.TargetApprovalRevision = source.Revision, target.Revision
	if len(result.BlockReasons) == 0 {
		ids := mergeRelationshipIDs(sourceRelationships, targetRelationships)
		if _, err = qtx.LockPartyMergeObjects(ctx, ids); err != nil {
			return bobdomain.PartyMergePreflightResult{}, s.internal("lock Party merge relationships", err)
		}
		sourceRelationships, targetRelationships, err = listPartyMergeRelationshipPair(ctx, qtx, input.SourcePartyID, input.TargetPartyID)
		if err != nil {
			return bobdomain.PartyMergePreflightResult{}, s.internal("list Party merge relationships", err)
		}
		result, _, _ = partyMergeAssessment(source, target)
		result.SourcePartyID, result.TargetPartyID = input.SourcePartyID, input.TargetPartyID
		result.SourceApprovalEntryID, result.TargetApprovalEntryID = source.SourceApprovalEntryID, target.SourceApprovalEntryID
		result.SourceApprovalRevision, result.TargetApprovalRevision = source.Revision, target.Revision
		// Re-run assessment using the locked relationship state.
		result, sourceRelationships, targetRelationships = partyMergeAssessmentWithRelationships(source, target, sourceRelationships, targetRelationships)
		result.SourcePartyID, result.TargetPartyID = input.SourcePartyID, input.TargetPartyID
		result.SourceApprovalEntryID, result.TargetApprovalEntryID = source.SourceApprovalEntryID, target.SourceApprovalEntryID
		result.SourceApprovalRevision, result.TargetApprovalRevision = source.Revision, target.Revision
	}
	redactHiddenPartyMergeConflicts(&result, visibility)
	if len(result.BlockReasons) == 0 {
		result.CanMerge = true
		fingerprint := partyMergeFingerprint(source, target, sourceRelationships, targetRelationships)
		result.PreflightID = newID()
		if err = qtx.InsertPartyMergePreflight(ctx, dbsqlc.InsertPartyMergePreflightParams{
			ID: result.PreflightID, SourcePartyID: input.SourcePartyID, TargetPartyID: input.TargetPartyID,
			SourceApprovalEntryID: source.SourceApprovalEntryID, TargetApprovalEntryID: target.SourceApprovalEntryID,
			SourceApprovalRevision: source.Revision, TargetApprovalRevision: target.Revision, StateFingerprint: fingerprint,
			ActorID: actorID, RequestID: requestID,
		}); err != nil {
			return bobdomain.PartyMergePreflightResult{}, s.writeError("insert Party merge preflight", err)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return bobdomain.PartyMergePreflightResult{}, s.writeError("commit Party merge preflight", err)
	}
	return result, nil
}

func (s *PartyMergeEngine) PartyMergeConfirm(
	ctx context.Context, input bobdomain.PartyMergeConfirmInput, visibility bobdomain.PartyRelationshipVisibility, actorID, requestID string,
) (bobdomain.PartyMergeResult, error) {
	if !validID(input.PreflightID) || !validActorAndRequest(actorID, requestID) {
		return bobdomain.PartyMergeResult{}, domainError(ErrorValidation, "invalid Party merge confirmation", nil, nil)
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return bobdomain.PartyMergeResult{}, s.internal("begin Party merge confirmation", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	preflight, err := qtx.LockPartyMergePreflight(ctx, input.PreflightID)
	if errors.Is(err, pgx.ErrNoRows) {
		return bobdomain.PartyMergeResult{}, domainError(ErrorConflict, "合并预检已失效，请重新预检", nil, nil)
	}
	if err != nil {
		return bobdomain.PartyMergeResult{}, s.internal("lock Party merge preflight", err)
	}
	if preflight.ConsumedAt.Valid {
		return bobdomain.PartyMergeResult{}, domainError(ErrorConflict, "合并预检已失效，请重新预检", nil, nil)
	}
	source, target, err := lockPartyMergePair(ctx, qtx, preflight.SourcePartyID, preflight.TargetPartyID)
	if err != nil {
		return bobdomain.PartyMergeResult{}, s.partyMergeLockError(err)
	}
	if source.SourceApprovalEntryID != preflight.SourceApprovalEntryID || target.SourceApprovalEntryID != preflight.TargetApprovalEntryID ||
		source.Revision != preflight.SourceApprovalRevision || target.Revision != preflight.TargetApprovalRevision {
		return bobdomain.PartyMergeResult{}, domainError(ErrorConflict, "合并预检已失效，请重新预检", nil, nil)
	}
	sourceRelationships, targetRelationships, err := listPartyMergeRelationshipPair(ctx, qtx, preflight.SourcePartyID, preflight.TargetPartyID)
	if err != nil {
		return bobdomain.PartyMergeResult{}, s.internal("list Party merge relationships", err)
	}
	if _, err = qtx.LockPartyMergeObjects(ctx, mergeRelationshipIDs(sourceRelationships, targetRelationships)); err != nil {
		return bobdomain.PartyMergeResult{}, s.internal("lock Party merge relationships", err)
	}
	sourceRelationships, targetRelationships, err = listPartyMergeRelationshipPair(ctx, qtx, preflight.SourcePartyID, preflight.TargetPartyID)
	if err != nil {
		return bobdomain.PartyMergeResult{}, s.internal("re-read Party merge relationships", err)
	}
	assessment, sourceRelationships, targetRelationships := partyMergeAssessmentWithRelationships(source, target, sourceRelationships, targetRelationships)
	redactHiddenPartyMergeConflicts(&assessment, visibility)
	if len(assessment.BlockReasons) > 0 || partyMergeFingerprint(source, target, sourceRelationships, targetRelationships) != preflight.StateFingerprint {
		return bobdomain.PartyMergeResult{}, domainError(ErrorConflict, "合并预检已失效，请重新预检", nil, nil)
	}
	resolutions, err := validatePartyMergeResolutions(assessment.RelationshipConflicts, input.ConflictResolutions)
	if err != nil {
		return bobdomain.PartyMergeResult{}, err
	}
	mergeEventID := newID()
	if err = qtx.InsertPartyMergeEvent(ctx, dbsqlc.InsertPartyMergeEventParams{
		ID: mergeEventID, PreflightID: input.PreflightID, SourcePartyID: preflight.SourcePartyID,
		TargetPartyID: preflight.TargetPartyID, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return bobdomain.PartyMergeResult{}, s.writeError("insert Party merge event", err)
	}
	transferred, merged := 0, 0
	conflictBySource := make(map[string]bobdomain.PartyMergeRelationshipConflict, len(assessment.RelationshipConflicts))
	targetRelationshipByObject := make(map[string]partyMergeRelationship, len(targetRelationships))
	for _, conflict := range assessment.RelationshipConflicts {
		conflictBySource[conflict.SourceObjectID] = conflict
	}
	for _, relationship := range targetRelationships {
		targetRelationshipByObject[relationship.objectID] = relationship
	}
	for _, relationship := range sourceRelationships {
		if conflict, conflictExists := conflictBySource[relationship.objectID]; conflictExists {
			retainedObjectID := resolutions[partyMergeConflictKey(conflict)]
			mergedRelationship := relationship
			mergedPartyID := preflight.SourcePartyID
			if retainedObjectID == conflict.SourceObjectID {
				mergedRelationship = targetRelationshipByObject[conflict.TargetObjectID]
				mergedPartyID = preflight.TargetPartyID
			}
			if mergedRelationship.relationshipType == EntityCustomer {
				rows, moveErr := qtx.MoveCustomerAccountsToRetainedRelationship(ctx, dbsqlc.MoveCustomerAccountsToRetainedRelationshipParams{
					TargetRelationshipID: retainedObjectID, SourceRelationshipID: mergedRelationship.objectID,
				})
				if moveErr != nil || rows < 1 {
					return bobdomain.PartyMergeResult{}, s.writeError("move customer accounts to retained relationship", moveErr)
				}
			}
			if err = markMergedPartyRelationship(ctx, qtx, mergedRelationship, mergedPartyID, retainedObjectID); err != nil {
				return bobdomain.PartyMergeResult{}, err
			}
			if retainedObjectID == conflict.SourceObjectID {
				if err = movePartyRelationship(ctx, qtx, relationship, preflight.SourcePartyID, preflight.TargetPartyID); err != nil {
					return bobdomain.PartyMergeResult{}, err
				}
			}
			if err = qtx.InsertPartyRelationshipMergeEvent(ctx, dbsqlc.InsertPartyRelationshipMergeEventParams{
				ID: newID(), MergeEventID: mergeEventID, RelationshipType: mergedRelationship.relationshipType,
				SourceObjectID: mergedRelationship.objectID, TargetObjectID: &retainedObjectID,
				OperatingEntityID: relationship.operatingEntityID, Action: partyMergeActionMerged,
			}); err != nil {
				return bobdomain.PartyMergeResult{}, s.writeError("audit merged Party relationship", err)
			}
			merged++
			continue
		}
		if err = movePartyRelationship(ctx, qtx, relationship, preflight.SourcePartyID, preflight.TargetPartyID); err != nil {
			return bobdomain.PartyMergeResult{}, err
		}
		if err = qtx.InsertPartyRelationshipMergeEvent(ctx, dbsqlc.InsertPartyRelationshipMergeEventParams{
			ID: newID(), MergeEventID: mergeEventID, RelationshipType: relationship.relationshipType,
			SourceObjectID: relationship.objectID, OperatingEntityID: relationship.operatingEntityID,
			Action: partyMergeActionTransferred,
		}); err != nil {
			return bobdomain.PartyMergeResult{}, s.writeError("audit transferred Party relationship", err)
		}
		transferred++
	}
	if rows, markErr := qtx.MarkPartyMerged(ctx, dbsqlc.MarkPartyMergedParams{
		TargetPartyID: &preflight.TargetPartyID, SourcePartyID: preflight.SourcePartyID,
	}); markErr != nil || rows != 1 {
		return bobdomain.PartyMergeResult{}, s.writeError("mark source Party merged", markErr)
	}
	// DCL retains the source's latest approved identifier claims for history and
	// to prevent that retired identity from being claimed by a new Party.
	if rows, consumeErr := qtx.ConsumePartyMergePreflight(ctx, dbsqlc.ConsumePartyMergePreflightParams{ID: input.PreflightID, ActorID: &actorID}); consumeErr != nil || rows != 1 {
		return bobdomain.PartyMergeResult{}, s.writeError("consume Party merge preflight", consumeErr)
	}
	if err = tx.Commit(ctx); err != nil {
		return bobdomain.PartyMergeResult{}, s.writeError("commit Party merge", err)
	}
	return bobdomain.PartyMergeResult{MergeEventID: mergeEventID, SourcePartyID: preflight.SourcePartyID, TargetPartyID: preflight.TargetPartyID,
		TransferredRelationships: transferred, MergedRelationships: merged}, nil
}

func redactHiddenPartyMergeConflicts(result *bobdomain.PartyMergePreflightResult, visibility bobdomain.PartyRelationshipVisibility) {
	visible := result.RelationshipConflicts[:0]
	hidden := false
	for _, conflict := range result.RelationshipConflicts {
		if visibility.Allows(conflict.RelationshipType) {
			visible = append(visible, conflict)
		} else {
			hidden = true
		}
	}
	result.RelationshipConflicts = visible
	if hidden {
		result.BlockReasons = append(result.BlockReasons, "存在无权处理的关系冲突，请联系有权人员")
	}
}

func validPartyMergeInput(input bobdomain.PartyMergePreflightInput) bool {
	return validID(input.SourcePartyID) && validID(input.TargetPartyID) && input.SourcePartyID != input.TargetPartyID &&
		validID(input.SourceApprovalEntryID) && validID(input.TargetApprovalEntryID) &&
		input.SourceApprovalRevision >= 1 && input.TargetApprovalRevision >= 1
}

func lockPartyMergePair(ctx context.Context, q *dbsqlc.Queries, sourceID, targetID string) (dbsqlc.LockPartyMergePartyRow, dbsqlc.LockPartyMergePartyRow, error) {
	firstID, secondID := sourceID, targetID
	if secondID < firstID {
		firstID, secondID = secondID, firstID
	}
	first, err := q.LockPartyMergeParty(ctx, firstID)
	if err != nil {
		return dbsqlc.LockPartyMergePartyRow{}, dbsqlc.LockPartyMergePartyRow{}, err
	}
	second, err := q.LockPartyMergeParty(ctx, secondID)
	if err != nil {
		return dbsqlc.LockPartyMergePartyRow{}, dbsqlc.LockPartyMergePartyRow{}, err
	}
	if sourceID == firstID {
		return first, second, nil
	}
	return second, first, nil
}

func (s *PartyMergeEngine) internal(operation string, err error) error {
	return domainError(ErrorInternal, "internal server error", nil, fmt.Errorf("%s: %w", operation, err))
}
func (s *PartyMergeEngine) writeError(operation string, err error) error {
	return translateError(fmt.Errorf("%s: %w", operation, err))
}

func domainError(kind ErrorKind, message string, details any, cause error) error {
	key := "party_merge_failed"
	if kind == ErrorValidation {
		key = "validation_failed"
	} else if kind == ErrorConflict {
		key = "party_merge_conflict"
	} else if kind == ErrorInternal {
		key = "internal_error"
	}
	return newError(kind, key, message, details, cause)
}

func newID() string { return ulid.Make().String() }

func validActorAndRequest(actorID, requestID string) bool {
	return validID(actorID) && strings.TrimSpace(requestID) != ""
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
func (s *PartyMergeEngine) partyMergeLockError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "主体不存在", nil, nil)
	}
	return s.internal("lock Party merge Parties", err)
}

func listPartyMergeRelationshipPair(ctx context.Context, q *dbsqlc.Queries, sourcePartyID, targetPartyID string) ([]partyMergeRelationship, []partyMergeRelationship, error) {
	sourceRows, err := q.ListPartyMergeRelationships(ctx, sourcePartyID)
	if err != nil {
		return nil, nil, err
	}
	targetRows, err := q.ListPartyMergeRelationships(ctx, targetPartyID)
	if err != nil {
		return nil, nil, err
	}
	return mapPartyMergeRelationships(sourceRows), mapPartyMergeRelationships(targetRows), nil
}

func mapPartyMergeRelationships(rows []dbsqlc.ListPartyMergeRelationshipsRow) []partyMergeRelationship {
	result := make([]partyMergeRelationship, 0, len(rows))
	for _, row := range rows {
		result = append(result, partyMergeRelationship{relationshipType: row.RelationshipType, objectID: row.ObjectID,
			objectCode: stringValue(row.ObjectCode), operatingEntityID: row.OperatingEntityID, operatingEntityName: row.OperatingEntityName,
			objectRevision: row.ObjectRevision, enabled: row.Enabled,
			openApprovalEntryID: row.OpenApprovalEntryID, latestApprovedID: row.LatestApprovedEntryID, visibleStatus: row.VisibleStatus,
			visibleRevision: row.VisibleApprovalRevision, mergedIntoObjectID: deref(row.MergedIntoObjectID)})
	}
	return result
}

func partyMergeAssessment(source, target dbsqlc.LockPartyMergePartyRow) (bobdomain.PartyMergePreflightResult, []partyMergeRelationship, []partyMergeRelationship) {
	return partyMergeAssessmentWithRelationships(source, target, nil, nil)
}

func partyMergeAssessmentWithRelationships(source, target dbsqlc.LockPartyMergePartyRow, sourceRelationships, targetRelationships []partyMergeRelationship) (bobdomain.PartyMergePreflightResult, []partyMergeRelationship, []partyMergeRelationship) {
	result := bobdomain.PartyMergePreflightResult{BlockReasons: []string{}, RelationshipConflicts: []bobdomain.PartyMergeRelationshipConflict{}}
	if source.Kind != target.Kind {
		result.BlockReasons = append(result.BlockReasons, "主体类型不同，不能合并")
	}
	if source.MergedIntoPartyID != nil || target.MergedIntoPartyID != nil {
		result.BlockReasons = append(result.BlockReasons, "主体已处于合并状态")
	}
	if source.HasOpenCandidate || target.HasOpenCandidate {
		result.BlockReasons = append(result.BlockReasons, "存在主体候选版本，不能合并")
	}
	for _, relationship := range append(append([]partyMergeRelationship{}, sourceRelationships...), targetRelationships...) {
		if relationship.mergedIntoObjectID != "" {
			result.BlockReasons = append(result.BlockReasons, "关系已合并，不能再次合并主体")
			break
		}
		if !relationship.enabled || relationship.latestApprovedID == "" || relationship.openApprovalEntryID != "" || relationship.visibleStatus != string(approval.StatusApproved) {
			result.BlockReasons = append(result.BlockReasons, "存在候选、失效或已停用关系，不能合并")
			break
		}
	}
	targetByKey := make(map[string]partyMergeRelationship, len(targetRelationships))
	for _, relationship := range targetRelationships {
		targetByKey[relationship.relationshipType+"\x00"+relationship.operatingEntityID] = relationship
	}
	for _, sourceRelationship := range sourceRelationships {
		if targetRelationship, exists := targetByKey[sourceRelationship.relationshipType+"\x00"+sourceRelationship.operatingEntityID]; exists {
			result.RelationshipConflicts = append(result.RelationshipConflicts, bobdomain.PartyMergeRelationshipConflict{
				RelationshipType: sourceRelationship.relationshipType, OperatingEntityID: sourceRelationship.operatingEntityID,
				OperatingEntityName: sourceRelationship.operatingEntityName,
				SourceObjectID:      sourceRelationship.objectID, SourceObjectCode: sourceRelationship.objectCode,
				TargetObjectID: targetRelationship.objectID, TargetObjectCode: targetRelationship.objectCode,
			})
		}
	}
	return result, sourceRelationships, targetRelationships
}

func partyMergeFingerprint(source, target dbsqlc.LockPartyMergePartyRow, sourceRelationships, targetRelationships []partyMergeRelationship) string {
	parts := []string{fmt.Sprintf("source:%s:%s:%s:%d:%s", source.ID, source.Kind, source.SourceApprovalEntryID, source.Revision, deref(source.MergedIntoPartyID)),
		fmt.Sprintf("target:%s:%s:%s:%d:%s", target.ID, target.Kind, target.SourceApprovalEntryID, target.Revision, deref(target.MergedIntoPartyID))}
	for side, relationships := range map[string][]partyMergeRelationship{"source": sourceRelationships, "target": targetRelationships} {
		for _, relationship := range relationships {
			parts = append(parts, fmt.Sprintf("%s:%s:%s:%s:%d:%t:%s:%s:%s:%d:%s", side, relationship.relationshipType,
				relationship.objectID, relationship.operatingEntityID, relationship.objectRevision, relationship.enabled,
				relationship.openApprovalEntryID, relationship.latestApprovedID, relationship.visibleStatus, relationship.visibleRevision,
				relationship.mergedIntoObjectID))
		}
	}
	sort.Strings(parts)
	sum := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(sum[:])
}

func mergeRelationshipIDs(source, target []partyMergeRelationship) []string {
	seen := make(map[string]struct{}, len(source)+len(target))
	for _, relationship := range append(append([]partyMergeRelationship{}, source...), target...) {
		seen[relationship.objectID] = struct{}{}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func partyMergeConflictKey(conflict bobdomain.PartyMergeRelationshipConflict) string {
	return conflict.RelationshipType + "\x00" + conflict.OperatingEntityID
}

func validatePartyMergeResolutions(conflicts []bobdomain.PartyMergeRelationshipConflict, resolutions []bobdomain.PartyMergeConflictResolution) (map[string]string, error) {
	if len(conflicts) != len(resolutions) {
		return nil, domainError(ErrorValidation, "必须为每个关系冲突选择保留关系", nil, nil)
	}
	result := make(map[string]string, len(resolutions))
	conflictByKey := make(map[string]bobdomain.PartyMergeRelationshipConflict, len(conflicts))
	for _, conflict := range conflicts {
		conflictByKey[partyMergeConflictKey(conflict)] = conflict
	}
	for _, resolution := range resolutions {
		key := resolution.RelationshipType + "\x00" + resolution.OperatingEntityID
		conflict, exists := conflictByKey[key]
		if !exists || result[key] != "" || !validID(resolution.RetainObjectID) ||
			(resolution.RetainObjectID != conflict.SourceObjectID && resolution.RetainObjectID != conflict.TargetObjectID) {
			return nil, domainError(ErrorValidation, "关系冲突保留方案无效", nil, nil)
		}
		result[key] = resolution.RetainObjectID
	}
	return result, nil
}

func movePartyRelationship(ctx context.Context, q *dbsqlc.Queries, relationship partyMergeRelationship, sourcePartyID, targetPartyID string) error {
	var rows int64
	var err error
	switch relationship.relationshipType {
	case EntityCustomer:
		rows, err = q.MoveCustomerRelationshipParty(ctx, dbsqlc.MoveCustomerRelationshipPartyParams{TargetPartyID: targetPartyID, SourceObjectID: relationship.objectID, SourcePartyID: sourcePartyID})
	case EntitySupplier:
		rows, err = q.MoveSupplierRelationshipParty(ctx, dbsqlc.MoveSupplierRelationshipPartyParams{TargetPartyID: targetPartyID, SourceObjectID: relationship.objectID, SourcePartyID: sourcePartyID})
	case EntityEmployee:
		rows, err = q.MoveEmploymentRelationshipParty(ctx, dbsqlc.MoveEmploymentRelationshipPartyParams{TargetPartyID: targetPartyID, SourceObjectID: relationship.objectID, SourcePartyID: sourcePartyID})
	case EntityOtherUnit:
		rows, err = q.MoveServiceRelationshipParty(ctx, dbsqlc.MoveServiceRelationshipPartyParams{TargetPartyID: targetPartyID, SourceObjectID: relationship.objectID, SourcePartyID: sourcePartyID})
	case EntitySalesPartner:
		rows, err = q.MoveSalesRelationshipParty(ctx, dbsqlc.MoveSalesRelationshipPartyParams{TargetPartyID: targetPartyID, SourceObjectID: relationship.objectID, SourcePartyID: sourcePartyID})
	default:
		return domainError(ErrorValidation, "invalid Party merge relationship type", nil, nil)
	}
	if err != nil || rows != 1 {
		return domainError(ErrorConflict, "主体关系已变化，请重新预检", nil, err)
	}
	return nil
}

func markMergedPartyRelationship(ctx context.Context, q *dbsqlc.Queries, relationship partyMergeRelationship, sourcePartyID, targetObjectID string) error {
	var rows int64
	var err error
	target := &targetObjectID
	switch relationship.relationshipType {
	case EntityCustomer:
		rows, err = q.MarkCustomerRelationshipMerged(ctx, dbsqlc.MarkCustomerRelationshipMergedParams{TargetObjectID: target, SourceObjectID: relationship.objectID, SourcePartyID: sourcePartyID})
	case EntitySupplier:
		rows, err = q.MarkSupplierRelationshipMerged(ctx, dbsqlc.MarkSupplierRelationshipMergedParams{TargetObjectID: target, SourceObjectID: relationship.objectID, SourcePartyID: sourcePartyID})
	case EntityEmployee:
		rows, err = q.MarkEmploymentRelationshipMerged(ctx, dbsqlc.MarkEmploymentRelationshipMergedParams{TargetObjectID: target, SourceObjectID: relationship.objectID, SourcePartyID: sourcePartyID})
	case EntityOtherUnit:
		rows, err = q.MarkServiceRelationshipMerged(ctx, dbsqlc.MarkServiceRelationshipMergedParams{TargetObjectID: target, SourceObjectID: relationship.objectID, SourcePartyID: sourcePartyID})
	case EntitySalesPartner:
		rows, err = q.MarkSalesRelationshipMerged(ctx, dbsqlc.MarkSalesRelationshipMergedParams{TargetObjectID: target, SourceObjectID: relationship.objectID, SourcePartyID: sourcePartyID})
	default:
		return domainError(ErrorValidation, "invalid Party merge relationship type", nil, nil)
	}
	if err != nil || rows != 1 {
		return domainError(ErrorConflict, "主体关系已变化，请重新预检", nil, err)
	}
	return nil
}
