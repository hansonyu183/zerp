package dcl

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

type legalIdentifierClaimState struct {
	approvedObjectID *string
	approvedEntryID  *string
	openObjectID     *string
	openEntryID      *string
}

type legalIdentifierClaimStore interface {
	deleteForEntry(context.Context, *string) error
	lockKey(context.Context, string) error
	lock(context.Context, string) (legalIdentifierClaimState, error)
	upsert(context.Context, string, legalIdentifierClaimState) error
}

type legalIdentifierClaimConflict struct {
	errorKey string
	message  string
}

func maintainLegalIdentifierClaim(ctx context.Context, store legalIdentifierClaimStore, objectID, entryID, normalized string, promote bool, conflict legalIdentifierClaimConflict) error {
	if err := store.deleteForEntry(ctx, &entryID); err != nil || normalized == "" {
		return err
	}
	if err := store.lockKey(ctx, normalized); err != nil {
		return err
	}
	state, err := store.lock(ctx, normalized)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil && ((state.approvedObjectID != nil && *state.approvedObjectID != objectID) || (state.openObjectID != nil && *state.openObjectID != objectID)) {
		return newError(ErrorConflict, conflict.errorKey, conflict.message, nil, nil)
	}
	if promote {
		state = legalIdentifierClaimState{approvedObjectID: &objectID, approvedEntryID: &entryID}
	} else {
		state.openObjectID = &objectID
		state.openEntryID = &entryID
	}
	return store.upsert(ctx, normalized, state)
}

type customerLegalIdentifierClaimStore struct{ q *dbsqlc.Queries }

func (s customerLegalIdentifierClaimStore) deleteForEntry(ctx context.Context, entryID *string) error {
	return s.q.DeleteDCLCustomerLegalIdentifierClaimsForEntry(ctx, entryID)
}
func (s customerLegalIdentifierClaimStore) lockKey(ctx context.Context, normalized string) error {
	return s.q.LockDCLCustomerLegalIdentifierClaimKey(ctx, normalized)
}
func (s customerLegalIdentifierClaimStore) lock(ctx context.Context, normalized string) (legalIdentifierClaimState, error) {
	claim, err := s.q.LockDCLCustomerLegalIdentifierClaim(ctx, normalized)
	return legalIdentifierClaimState{approvedObjectID: claim.ApprovedCustomerID, approvedEntryID: claim.ApprovedApprovalEntryID, openObjectID: claim.OpenCustomerID, openEntryID: claim.OpenApprovalEntryID}, err
}
func (s customerLegalIdentifierClaimStore) upsert(ctx context.Context, normalized string, state legalIdentifierClaimState) error {
	return s.q.UpsertDCLCustomerLegalIdentifierClaim(ctx, dbsqlc.UpsertDCLCustomerLegalIdentifierClaimParams{NormalizedLegalIdentifier: normalized, ApprovedCustomerID: state.approvedObjectID, ApprovedApprovalEntryID: state.approvedEntryID, OpenCustomerID: state.openObjectID, OpenApprovalEntryID: state.openEntryID})
}

type employeeLegalIdentifierClaimStore struct{ q *dbsqlc.Queries }

func (s employeeLegalIdentifierClaimStore) deleteForEntry(ctx context.Context, entryID *string) error {
	return s.q.DeleteDCLEmployeeLegalIdentifierClaimsForEntry(ctx, entryID)
}
func (s employeeLegalIdentifierClaimStore) lockKey(ctx context.Context, normalized string) error {
	return s.q.LockDCLEmployeeLegalIdentifierClaimKey(ctx, normalized)
}
func (s employeeLegalIdentifierClaimStore) lock(ctx context.Context, normalized string) (legalIdentifierClaimState, error) {
	claim, err := s.q.LockDCLEmployeeLegalIdentifierClaim(ctx, normalized)
	return legalIdentifierClaimState{approvedObjectID: claim.ApprovedEmployeeID, approvedEntryID: claim.ApprovedApprovalEntryID, openObjectID: claim.OpenEmployeeID, openEntryID: claim.OpenApprovalEntryID}, err
}
func (s employeeLegalIdentifierClaimStore) upsert(ctx context.Context, normalized string, state legalIdentifierClaimState) error {
	return s.q.UpsertDCLEmployeeLegalIdentifierClaim(ctx, dbsqlc.UpsertDCLEmployeeLegalIdentifierClaimParams{NormalizedLegalIdentifier: normalized, ApprovedEmployeeID: state.approvedObjectID, ApprovedApprovalEntryID: state.approvedEntryID, OpenEmployeeID: state.openObjectID, OpenApprovalEntryID: state.openEntryID})
}

type supplierLegalIdentifierClaimStore struct{ q *dbsqlc.Queries }

func (s supplierLegalIdentifierClaimStore) deleteForEntry(ctx context.Context, entryID *string) error {
	return s.q.DeleteDCLSupplierLegalIdentifierClaimsForEntry(ctx, entryID)
}
func (s supplierLegalIdentifierClaimStore) lockKey(ctx context.Context, normalized string) error {
	return s.q.LockDCLSupplierLegalIdentifierClaimKey(ctx, normalized)
}
func (s supplierLegalIdentifierClaimStore) lock(ctx context.Context, normalized string) (legalIdentifierClaimState, error) {
	claim, err := s.q.LockDCLSupplierLegalIdentifierClaim(ctx, normalized)
	return legalIdentifierClaimState{approvedObjectID: claim.ApprovedSupplierID, approvedEntryID: claim.ApprovedApprovalEntryID, openObjectID: claim.OpenSupplierID, openEntryID: claim.OpenApprovalEntryID}, err
}
func (s supplierLegalIdentifierClaimStore) upsert(ctx context.Context, normalized string, state legalIdentifierClaimState) error {
	return s.q.UpsertDCLSupplierLegalIdentifierClaim(ctx, dbsqlc.UpsertDCLSupplierLegalIdentifierClaimParams{NormalizedLegalIdentifier: normalized, ApprovedSupplierID: state.approvedObjectID, ApprovedApprovalEntryID: state.approvedEntryID, OpenSupplierID: state.openObjectID, OpenApprovalEntryID: state.openEntryID})
}

type otherUnitLegalIdentifierClaimStore struct{ q *dbsqlc.Queries }

func (s otherUnitLegalIdentifierClaimStore) deleteForEntry(ctx context.Context, entryID *string) error {
	return s.q.DeleteDCLOtherUnitLegalIdentifierClaimsForEntry(ctx, entryID)
}
func (s otherUnitLegalIdentifierClaimStore) lockKey(ctx context.Context, normalized string) error {
	return s.q.LockDCLOtherUnitLegalIdentifierClaimKey(ctx, normalized)
}
func (s otherUnitLegalIdentifierClaimStore) lock(ctx context.Context, normalized string) (legalIdentifierClaimState, error) {
	claim, err := s.q.LockDCLOtherUnitLegalIdentifierClaim(ctx, normalized)
	return legalIdentifierClaimState{approvedObjectID: claim.ApprovedOtherUnitID, approvedEntryID: claim.ApprovedApprovalEntryID, openObjectID: claim.OpenOtherUnitID, openEntryID: claim.OpenApprovalEntryID}, err
}
func (s otherUnitLegalIdentifierClaimStore) upsert(ctx context.Context, normalized string, state legalIdentifierClaimState) error {
	return s.q.UpsertDCLOtherUnitLegalIdentifierClaim(ctx, dbsqlc.UpsertDCLOtherUnitLegalIdentifierClaimParams{NormalizedLegalIdentifier: normalized, ApprovedOtherUnitID: state.approvedObjectID, ApprovedApprovalEntryID: state.approvedEntryID, OpenOtherUnitID: state.openObjectID, OpenApprovalEntryID: state.openEntryID})
}

type salesPartnerLegalIdentifierClaimStore struct{ q *dbsqlc.Queries }

func (s salesPartnerLegalIdentifierClaimStore) deleteForEntry(ctx context.Context, entryID *string) error {
	return s.q.DeleteDCLSalesPartnerLegalIdentifierClaimsForEntry(ctx, entryID)
}
func (s salesPartnerLegalIdentifierClaimStore) lockKey(ctx context.Context, normalized string) error {
	return s.q.LockDCLSalesPartnerLegalIdentifierClaimKey(ctx, normalized)
}
func (s salesPartnerLegalIdentifierClaimStore) lock(ctx context.Context, normalized string) (legalIdentifierClaimState, error) {
	claim, err := s.q.LockDCLSalesPartnerLegalIdentifierClaim(ctx, normalized)
	return legalIdentifierClaimState{approvedObjectID: claim.ApprovedSalesPartnerID, approvedEntryID: claim.ApprovedApprovalEntryID, openObjectID: claim.OpenSalesPartnerID, openEntryID: claim.OpenApprovalEntryID}, err
}
func (s salesPartnerLegalIdentifierClaimStore) upsert(ctx context.Context, normalized string, state legalIdentifierClaimState) error {
	return s.q.UpsertDCLSalesPartnerLegalIdentifierClaim(ctx, dbsqlc.UpsertDCLSalesPartnerLegalIdentifierClaimParams{NormalizedLegalIdentifier: normalized, ApprovedSalesPartnerID: state.approvedObjectID, ApprovedApprovalEntryID: state.approvedEntryID, OpenSalesPartnerID: state.openObjectID, OpenApprovalEntryID: state.openEntryID})
}
