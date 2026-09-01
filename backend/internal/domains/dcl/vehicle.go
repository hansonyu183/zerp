package dcl

import (
	"context"
	"errors"
	"fmt"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type vehicleRules interface {
	ResolveVehicleType(context.Context, pgx.Tx, bobdomain.VehicleData, bool) (bobdomain.VehicleData, error)
	ResolveVehicleCarrier(context.Context, pgx.Tx, bobdomain.VehicleData, bool) (bobdomain.VehicleData, error)
	EnsureVehicleUnapproveAllowed(context.Context, pgx.Tx, string) error
}
type VehicleService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       vehicleRules
	coordinator *approval.Coordinator[dclapproval.VehiclePayload]
}

func NewVehicleService(pool *pgxpool.Pool, rules vehicleRules, authorizer approval.Authorizer, bus *txevent.Bus) *VehicleService {
	if pool == nil || rules == nil || authorizer == nil || bus == nil {
		panic("dcl: vehicle dependencies are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityVehicle, authorizer, bus, dclapproval.VehicleTopic)
	if err != nil {
		panic(err)
	}
	return &VehicleService{pool: pool, queries: dbsqlc.New(pool), rules: rules, coordinator: c}
}
func vehicleBobData(d VehicleData) bobdomain.VehicleData {
	return bobdomain.VehicleData{Name: d.Name, PlateNumber: d.PlateNumber, VehicleType: d.VehicleType, CarrierAffiliation: d.CarrierAffiliation, BulkLiquidCapable: d.BulkLiquidCapable, VIN: d.VIN, EngineNumber: d.EngineNumber, LoadCapacityKG: d.LoadCapacityKG, Remark: d.Remark}
}
func vehicleDCLData(d bobdomain.VehicleData) VehicleData {
	return VehicleData{Name: d.Name, PlateNumber: d.PlateNumber, VehicleType: d.VehicleType, CarrierAffiliation: d.CarrierAffiliation, BulkLiquidCapable: d.BulkLiquidCapable, VIN: d.VIN, EngineNumber: d.EngineNumber, LoadCapacityKG: d.LoadCapacityKG, Remark: d.Remark}
}
func vehiclePayload(i subjectIdentity, enabled bool, d VehicleData) dclapproval.VehiclePayload {
	return dclapproval.VehiclePayload{SubjectID: i.ObjectID, Code: i.Code, Name: d.Name, Enabled: enabled}
}
func vehicleMutation(i subjectIdentity, enabled bool, e approval.Entry) VehicleMutation {
	return VehicleMutation{ObjectID: i.ObjectID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(e)}
}
func vehicleInput(i VehicleReviewInput) VehicleVersionInput {
	return VehicleVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}
}

func (s *VehicleService) Create(ctx context.Context, in VehicleCreateInput, a approval.Actor) (VehicleMutation, error) {
	d, err := bobdomain.ValidateVehicleData(vehicleBobData(in.Data))
	if err != nil || !validActor(a) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid vehicle declaration create request", nil, nil)
		}
		return VehicleMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	i, err := reserveSubject(ctx, tx, EntityVehicle, "VEH", a.ID())
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	d, err = s.rules.ResolveVehicleCarrier(ctx, tx, d, false)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	d, err = s.rules.ResolveVehicleType(ctx, tx, d, false)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := s.coordinator.CreateFirstVersion(ctx, tx, i.ObjectID, a, vehiclePayload(i, true, vehicleDCLData(d)))
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	if err = insertVehicleVersion(ctx, q, e.ID, true, d); err != nil {
		return VehicleMutation{}, translateError(err)
	}
	if err = refreshVehicleIdentifierClaims(ctx, q, i.ObjectID); err != nil {
		return VehicleMutation{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return VehicleMutation{}, translateError(err)
	}
	return vehicleMutation(i, true, e), nil
}
func (s *VehicleService) Save(ctx context.Context, in VehicleSaveInput, a approval.Actor) (VehicleMutation, error) {
	d, err := bobdomain.ValidateVehicleData(vehicleBobData(in.Data))
	if err != nil || !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, a) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid vehicle declaration save request", nil, nil)
		}
		return VehicleMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, in.ObjectID); err != nil {
		return VehicleMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: in.ApprovalEntryID, Domain: "dcl", Entity: EntityVehicle})
	if err != nil || stored.SubjectID != in.ObjectID || stored.Revision != in.ApprovalRevision {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
		}
		return VehicleMutation{}, translateError(err)
	}
	i, err := lockSubject(ctx, tx, EntityVehicle, in.ObjectID)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	var e approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		e, err = s.coordinator.CreateNextVersion(ctx, tx, in.ObjectID, a, vehiclePayload(i, in.Enabled, in.Data))
		if err == nil {
			n, copyErr := q.CopyDCLVehicleVersion(ctx, dbsqlc.CopyDCLVehicleVersionParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
			if copyErr != nil || n != 1 {
				err = copyErr
				if err == nil {
					err = errors.New("approved vehicle snapshot is missing")
				}
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	d, err = s.rules.ResolveVehicleCarrier(ctx, tx, d, false)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	d, err = s.rules.ResolveVehicleType(ctx, tx, d, false)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	params, err := vehicleUpdateParams(e.ID, in.Enabled, d)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	n, err := q.UpdateDCLVehicleVersion(ctx, params)
	if err != nil || n != 1 {
		if err == nil {
			err = errors.New("vehicle declaration snapshot is missing")
		}
		return VehicleMutation{}, translateError(err)
	}
	e, err = s.coordinator.SaveDraft(ctx, tx, e.ID, e.Revision, a, vehiclePayload(i, in.Enabled, vehicleDCLData(d)))
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	if err = refreshVehicleIdentifierClaims(ctx, q, in.ObjectID); err != nil {
		return VehicleMutation{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return VehicleMutation{}, translateError(err)
	}
	return vehicleMutation(i, in.Enabled, e), nil
}
func (s *VehicleService) Submit(ctx context.Context, i VehicleVersionInput, a approval.Actor) (VehicleMutation, error) {
	return s.transition(ctx, i, "", approval.ActionSubmitted, a)
}
func (s *VehicleService) Unsubmit(ctx context.Context, i VehicleReviewInput, a approval.Actor) (VehicleMutation, error) {
	return s.transition(ctx, vehicleInput(i), strings.TrimSpace(i.Reason), approval.ActionUnsubmitted, a)
}
func (s *VehicleService) Reject(ctx context.Context, i VehicleReviewInput, a approval.Actor) (VehicleMutation, error) {
	return s.transition(ctx, vehicleInput(i), strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}
func (s *VehicleService) Approve(ctx context.Context, i VehicleVersionInput, a approval.Actor) (VehicleMutation, error) {
	return s.transition(ctx, i, "", approval.ActionApproved, a)
}
func (s *VehicleService) Unapprove(ctx context.Context, i VehicleReviewInput, a approval.Actor) (VehicleMutation, error) {
	return s.transition(ctx, vehicleInput(i), strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}
func (s *VehicleService) transition(ctx context.Context, in VehicleVersionInput, reason string, action approval.Action, a approval.Actor) (VehicleMutation, error) {
	if !validVersionInput(in.ObjectID, in.ApprovalEntryID, in.ApprovalRevision, a) {
		return VehicleMutation{}, newError(ErrorValidation, "validation_failed", "invalid vehicle declaration lifecycle request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	p, err := s.coordinator.Prepare(ctx, tx, action, in.ApprovalEntryID, in.ApprovalRevision, a, reason)
	if err != nil || p.Entry().SubjectID != in.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "declaration not found", nil, nil)
		}
		return VehicleMutation{}, translateError(err)
	}
	i, err := lockSubject(ctx, tx, EntityVehicle, in.ObjectID)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetDCLVehicleVersion(ctx, in.ApprovalEntryID)
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	d, err := bobdomain.ValidateVehicleData(vehicleStoredData(stored))
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		d, err = s.rules.ResolveVehicleType(ctx, tx, d, true)
		if err != nil {
			return VehicleMutation{}, translateError(err)
		}
		d, err = s.rules.ResolveVehicleCarrier(ctx, tx, d, true)
		if err != nil {
			return VehicleMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureVehicleUnapproveAllowed(ctx, tx, in.ApprovalEntryID); err != nil {
			return VehicleMutation{}, translateError(err)
		}
	}
	e, err := s.coordinator.Commit(ctx, tx, p, vehiclePayload(i, stored.Enabled, vehicleDCLData(d)))
	if err != nil {
		return VehicleMutation{}, translateError(err)
	}
	if err = refreshVehicleIdentifierClaims(ctx, q, in.ObjectID); err != nil {
		return VehicleMutation{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return VehicleMutation{}, translateError(err)
	}
	return vehicleMutation(i, stored.Enabled, e), nil
}

func (s *VehicleService) Delete(ctx context.Context, input VehicleDeleteInput, actor approval.Actor) error {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid vehicle declaration delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return translateError(err)
	}
	identity, err := lockSubject(ctx, tx, EntityVehicle, input.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityVehicle})
	if err != nil || entry.SubjectID != input.ObjectID {
		return translateError(newError(ErrorValidation, "validation_failed", "declaration not found", nil, err))
	}
	stored, err := q.GetDCLVehicleVersion(ctx, entry.ID)
	if err != nil {
		return translateError(err)
	}
	if n, deleteErr := q.DeleteDCLVehicleVersion(ctx, entry.ID); deleteErr != nil || n != 1 {
		if deleteErr == nil {
			deleteErr = errors.New("vehicle declaration snapshot changed")
		}
		return translateError(deleteErr)
	}
	if err = refreshVehicleIdentifierClaims(ctx, q, input.ObjectID); err != nil {
		return err
	}
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, entry.ID, input.ApprovalRevision, actor, vehiclePayload(identity, stored.Enabled, vehicleDCLData(vehicleStoredData(stored)))); err != nil {
		return translateError(err)
	}
	_, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityVehicle, SubjectID: input.ObjectID})
	if errors.Is(latestErr, pgx.ErrNoRows) {
		if n, deleteErr := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: input.ObjectID, Entity: EntityVehicle}); deleteErr != nil || n != 1 {
			if deleteErr == nil {
				deleteErr = errors.New("DCL subject changed")
			}
			return translateError(deleteErr)
		}
	} else if latestErr != nil {
		return translateError(latestErr)
	}
	return translateError(tx.Commit(ctx))
}

func insertVehicleVersion(ctx context.Context, q *dbsqlc.Queries, id string, enabled bool, d bobdomain.VehicleData) error {
	params, err := vehicleInsertParams(id, enabled, d)
	if err != nil {
		return err
	}
	return q.InsertDCLVehicleVersion(ctx, params)
}
func vehicleInsertParams(id string, enabled bool, d bobdomain.VehicleData) (dbsqlc.InsertDCLVehicleVersionParams, error) {
	a := d.CarrierAffiliation
	load, err := vehicleNumericValue(d.LoadCapacityKG)
	if err != nil {
		return dbsqlc.InsertDCLVehicleVersionParams{}, err
	}
	return dbsqlc.InsertDCLVehicleVersionParams{ApprovalEntryID: id, Name: d.Name, PlateNumber: d.PlateNumber, VehicleType: d.VehicleType, VehicleTypeObjectID: d.VehicleTypeObjectID, VehicleTypeName: d.VehicleTypeName, Vin: nilIfEmpty(d.VIN), EngineNumber: nilIfEmpty(d.EngineNumber), LoadCapacityKg: load, Remark: nilIfEmpty(d.Remark), CarrierAffiliationType: a.Type, CarrierOperatingEntityID: nilIfEmpty(a.OperatingEntityID), CarrierOperatingEntityApprovalEntryID: nilIfEmpty(a.OperatingApprovalEntryID), CarrierOtherUnitObjectID: nilIfEmpty(a.OtherUnitObjectID), CarrierOtherUnitApprovalEntryID: nilIfEmpty(a.OtherUnitApprovalEntryID), BulkLiquidCapable: d.BulkLiquidCapable, Enabled: enabled}, nil
}
func vehicleUpdateParams(id string, enabled bool, d bobdomain.VehicleData) (dbsqlc.UpdateDCLVehicleVersionParams, error) {
	p, err := vehicleInsertParams(id, enabled, d)
	if err != nil {
		return dbsqlc.UpdateDCLVehicleVersionParams{}, err
	}
	return dbsqlc.UpdateDCLVehicleVersionParams{ApprovalEntryID: p.ApprovalEntryID, Name: p.Name, PlateNumber: p.PlateNumber, VehicleType: p.VehicleType, VehicleTypeObjectID: p.VehicleTypeObjectID, VehicleTypeName: p.VehicleTypeName, Vin: p.Vin, EngineNumber: p.EngineNumber, LoadCapacityKg: p.LoadCapacityKg, Remark: p.Remark, CarrierAffiliationType: p.CarrierAffiliationType, CarrierOperatingEntityID: p.CarrierOperatingEntityID, CarrierOperatingEntityApprovalEntryID: p.CarrierOperatingEntityApprovalEntryID, CarrierOtherUnitObjectID: p.CarrierOtherUnitObjectID, CarrierOtherUnitApprovalEntryID: p.CarrierOtherUnitApprovalEntryID, BulkLiquidCapable: p.BulkLiquidCapable, Enabled: p.Enabled}, nil
}
func vehicleStoredData(r dbsqlc.DclVehicleVersion) bobdomain.VehicleData {
	return bobdomain.VehicleData{Name: r.Name, PlateNumber: r.PlateNumber, VehicleType: r.VehicleType, VehicleTypeObjectID: r.VehicleTypeObjectID, VehicleTypeName: r.VehicleTypeName, VIN: stringValue(r.Vin), EngineNumber: stringValue(r.EngineNumber), LoadCapacityKG: vehicleNumericString(r.LoadCapacityKg), Remark: stringValue(r.Remark), BulkLiquidCapable: r.BulkLiquidCapable, CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: r.CarrierAffiliationType, OperatingEntityID: stringValue(r.CarrierOperatingEntityID), OperatingApprovalEntryID: stringValue(r.CarrierOperatingEntityApprovalEntryID), OtherUnitObjectID: stringValue(r.CarrierOtherUnitObjectID), OtherUnitApprovalEntryID: stringValue(r.CarrierOtherUnitApprovalEntryID)}}
}

func refreshVehicleIdentifierClaims(ctx context.Context, q *dbsqlc.Queries, objectID string) error {
	if err := q.LockDCLVehicleIdentifierClaims(ctx); err != nil {
		return translateError(err)
	}
	conflict, err := q.FindDCLVehicleIdentifierConflict(ctx, objectID)
	if err == nil {
		field := "vin"
		if conflict.IdentifierKind == "PLATE" {
			field = "plateNumber"
		}
		return newError(ErrorConflict, "vehicle_identifier_conflict", "vehicle identifier is already occupied", map[string]string{"field": field}, nil)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return translateError(err)
	}
	if err = q.DeleteDCLVehicleIdentifierClaims(ctx, objectID); err != nil {
		return translateError(err)
	}
	if err = q.RebuildDCLVehicleIdentifierClaims(ctx, objectID); err != nil {
		return translateError(err)
	}
	return nil
}

func vehicleNumericValue(value string) (pgtype.Numeric, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return pgtype.Numeric{}, nil
	}
	var numeric pgtype.Numeric
	if err := numeric.Scan(value); err != nil {
		return pgtype.Numeric{}, newError(ErrorValidation, "validation_failed", "invalid vehicle load capacity", nil, err)
	}
	return numeric, nil
}

func vehicleNumericString(value pgtype.Numeric) string {
	if !value.Valid {
		return ""
	}
	raw, err := value.Value()
	if err != nil || raw == nil {
		return ""
	}
	return fmt.Sprint(raw)
}
