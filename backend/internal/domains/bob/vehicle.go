package bob

import (
	"context"
	"errors"
	"fmt"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

// VehicleData is the typed DCL declaration payload and BOB current projection.
type VehicleData struct {
	Name, PlateNumber, VehicleType, VIN, EngineNumber, LoadCapacityKG, Remark string
	VehicleTypeObjectID, VehicleTypeName                                      string
	CarrierAffiliation                                                        *CarrierAffiliation
	BulkLiquidCapable                                                         bool
}
type VehicleIdentity struct {
	ObjectID, Code string
	ObjectRevision int64
}
type VehicleCurrent struct {
	VehicleIdentity
	SourceApprovalEntryID string
	Enabled               bool
	Data                  VehicleData
}

func ValidateVehicleData(input VehicleData) (VehicleData, error) {
	d, _, err := validateCreate(EntityVehicle, CreateDetailInput{Name: strings.TrimSpace(input.Name), PlateNumber: strings.TrimSpace(input.PlateNumber), VehicleType: strings.TrimSpace(input.VehicleType), VIN: strings.TrimSpace(input.VIN), EngineNumber: strings.TrimSpace(input.EngineNumber), LoadCapacityKG: strings.TrimSpace(input.LoadCapacityKG), Remark: strings.TrimSpace(input.Remark), CarrierAffiliation: input.CarrierAffiliation, BulkLiquidCapable: input.BulkLiquidCapable})
	if err != nil {
		return VehicleData{}, err
	}
	return VehicleData{Name: d.Name, PlateNumber: d.PlateNumber, VehicleType: d.VehicleType, VehicleTypeObjectID: strings.TrimSpace(input.VehicleTypeObjectID), VehicleTypeName: strings.TrimSpace(input.VehicleTypeName), VIN: d.VIN, EngineNumber: d.EngineNumber, LoadCapacityKG: d.LoadCapacityKG, Remark: d.Remark, CarrierAffiliation: d.CarrierAffiliation, BulkLiquidCapable: d.BulkLiquidCapable}, nil
}

func (s *Service) ResolveVehicleType(ctx context.Context, tx pgx.Tx, d VehicleData, exact bool) (VehicleData, error) {
	const dictionaryTypeCode = "DCT-0002"
	if strings.TrimSpace(d.VehicleTypeObjectID) == "" && strings.TrimSpace(d.VehicleType) == "" {
		return VehicleData{}, domainErrorWithKey(ErrorValidation, "vehicle_type_reference_unavailable", "vehicle type is required", nil, nil)
	}
	if exact {
		if !validID(strings.TrimSpace(d.VehicleTypeObjectID)) || strings.TrimSpace(d.VehicleType) == "" || strings.TrimSpace(d.VehicleTypeName) == "" {
			return VehicleData{}, domainErrorWithKey(ErrorConflict, "vehicle_type_reference_unavailable", "vehicle type snapshot is incomplete", nil, nil)
		}
		return d, nil
	}
	var ref AuxiliaryReference
	var err error
	if strings.TrimSpace(d.VehicleTypeObjectID) != "" {
		ref, err = s.auxiliaryResolver.ResolveCurrentAuxiliaryReference(ctx, tx, "dictionary-item", d.VehicleTypeObjectID)
	} else {
		ref, err = s.auxiliaryResolver.ResolveAuxiliaryCode(ctx, tx, "dictionary-item", d.VehicleType)
	}
	if err != nil {
		return VehicleData{}, domainErrorWithKey(ErrorConflict, "vehicle_type_reference_unavailable", "vehicle type reference is unavailable", nil, err)
	}
	typeCode, _ := ref.Data["dictionaryTypeCode"].(string)
	name, _ := ref.Data["name"].(string)
	if !strings.EqualFold(strings.TrimSpace(typeCode), dictionaryTypeCode) || strings.TrimSpace(name) == "" {
		return VehicleData{}, domainErrorWithKey(ErrorConflict, "vehicle_type_reference_unavailable", "vehicle type reference has the wrong dictionary type", nil, nil)
	}
	d.VehicleType = ref.Code
	d.VehicleTypeObjectID = ref.ObjectID
	d.VehicleTypeName = strings.TrimSpace(name)
	return d, nil
}
func (s *Service) ReserveVehicleIdentity(ctx context.Context, tx pgx.Tx, actorID string) (VehicleIdentity, error) {
	q := s.queries.WithTx(tx)
	n, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityVehicle})
	if err != nil {
		return VehicleIdentity{}, s.writeError("allocate vehicle number", err)
	}
	i := VehicleIdentity{ObjectID: newID(), Code: fmt.Sprintf("VEH-%04d", n), ObjectRevision: 1}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: i.ObjectID, Entity: EntityVehicle, Code: i.Code, ActorID: actorID}); err != nil {
		return VehicleIdentity{}, s.writeError("reserve vehicle identity", err)
	}
	return i, nil
}
func (s *Service) GetVehicleIdentity(ctx context.Context, tx pgx.Tx, id string) (VehicleIdentity, error) {
	r, err := s.queries.WithTx(tx).LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: id, Entity: EntityVehicle})
	if errors.Is(err, pgx.ErrNoRows) {
		return VehicleIdentity{}, domainError(ErrorValidation, "vehicle not found", nil, nil)
	}
	if err != nil {
		return VehicleIdentity{}, s.internal("lock vehicle identity", err)
	}
	return VehicleIdentity{r.ID, r.Code, r.Revision}, nil
}
func (s *Service) ResolveVehicleCarrier(ctx context.Context, tx pgx.Tx, d VehicleData, exact bool) (VehicleData, error) {
	if d.CarrierAffiliation == nil || !validCarrierAffiliation(d.CarrierAffiliation) {
		return VehicleData{}, domainError(ErrorValidation, "invalid vehicle carrier affiliation", nil, nil)
	}
	a := *d.CarrierAffiliation
	var r EffectiveReference
	var err error
	if a.Type == "INTERNAL" {
		if exact {
			r, err = s.ValidateApprovedSnapshotReference(ctx, tx, EntityOperatingEntity, a.OperatingEntityID, a.OperatingApprovalEntryID)
			if err == nil {
				latest, latestErr := s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, a.OperatingEntityID)
				if latestErr != nil {
					err = latestErr
				} else if latest.ApprovalEntryID != r.ApprovalEntryID {
					return VehicleData{}, domainErrorWithKey(ErrorConflict, "vehicle_carrier_reference_stale", "vehicle carrier approval snapshot is not latest", nil, nil)
				}
			}
		} else {
			r, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, a.OperatingEntityID)
		}
		a.OperatingApprovalEntryID = r.ApprovalEntryID
		a.ServiceRelationshipObjectID = ""
		a.ServiceApprovalEntryID = ""
	} else {
		if exact {
			r, err = s.ValidateApprovedSnapshotReference(ctx, tx, EntityOtherUnit, a.ServiceRelationshipObjectID, a.ServiceApprovalEntryID)
			if err == nil {
				latest, latestErr := s.ResolveLatestApprovedReference(ctx, tx, EntityOtherUnit, a.ServiceRelationshipObjectID)
				if latestErr != nil {
					err = latestErr
				} else if latest.ApprovalEntryID != r.ApprovalEntryID {
					return VehicleData{}, domainErrorWithKey(ErrorConflict, "vehicle_carrier_reference_stale", "vehicle carrier approval snapshot is not latest", nil, nil)
				}
			}
		} else {
			r, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOtherUnit, a.ServiceRelationshipObjectID)
		}
		a.ServiceApprovalEntryID = r.ApprovalEntryID
		a.OperatingEntityID = ""
		a.OperatingApprovalEntryID = ""
	}
	if err != nil {
		return VehicleData{}, err
	}
	d.CarrierAffiliation = &a
	return d, nil
}
func (s *Service) ApplyVehicleCurrent(ctx context.Context, tx pgx.Tx, objectID, entryID string, enabled bool, d VehicleData, actorID string) (VehicleCurrent, error) {
	d, err := ValidateVehicleData(d)
	if err != nil {
		return VehicleCurrent{}, err
	}
	a := d.CarrierAffiliation
	q := s.queries.WithTx(tx)
	load, err := numericValue(d.LoadCapacityKG)
	if err != nil {
		return VehicleCurrent{}, err
	}
	err = q.UpsertBobVehicleCurrent(ctx, dbsqlc.UpsertBobVehicleCurrentParams{ObjectID: objectID, SourceApprovalEntryID: entryID, Name: d.Name, PlateNumber: d.PlateNumber, VehicleType: d.VehicleType, VehicleTypeObjectID: d.VehicleTypeObjectID, VehicleTypeName: d.VehicleTypeName, Vin: nilIfEmpty(d.VIN), EngineNumber: nilIfEmpty(d.EngineNumber), LoadCapacityKg: load, Remark: nilIfEmpty(d.Remark), CarrierAffiliationType: a.Type, CarrierOperatingEntityID: nilIfEmpty(a.OperatingEntityID), CarrierOperatingEntityApprovalEntryID: nilIfEmpty(a.OperatingApprovalEntryID), CarrierServiceRelationshipObjectID: nilIfEmpty(a.ServiceRelationshipObjectID), CarrierServiceRelationshipApprovalEntryID: nilIfEmpty(a.ServiceApprovalEntryID), BulkLiquidCapable: d.BulkLiquidCapable, Enabled: enabled, ActorID: actorID})
	if err != nil {
		return VehicleCurrent{}, s.writeError("apply vehicle current", err)
	}
	o, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: objectID, Entity: EntityVehicle})
	if err != nil {
		return VehicleCurrent{}, s.writeError("touch vehicle current", err)
	}
	return VehicleCurrent{VehicleIdentity: VehicleIdentity{o.ID, o.Code, o.Revision}, SourceApprovalEntryID: entryID, Enabled: enabled, Data: d}, nil
}
func (s *Service) RemoveVehicleCurrent(ctx context.Context, tx pgx.Tx, id, actorID string) (VehicleIdentity, error) {
	q := s.queries.WithTx(tx)
	n, err := q.DeleteBobVehicleCurrent(ctx, id)
	if err != nil {
		return VehicleIdentity{}, s.writeError("remove vehicle current", err)
	}
	if n != 1 {
		return VehicleIdentity{}, domainError(ErrorConflict, "vehicle current data changed", nil, nil)
	}
	o, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: id, Entity: EntityVehicle})
	if err != nil {
		return VehicleIdentity{}, s.writeError("touch vehicle current removal", err)
	}
	return VehicleIdentity{o.ID, o.Code, o.Revision}, nil
}
func (s *Service) DeleteVehicleIdentity(ctx context.Context, tx pgx.Tx, id string, revision int64) error {
	n, err := s.queries.WithTx(tx).DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{ObjectID: id, Entity: EntityVehicle, ObjectRevision: revision})
	if err != nil || n != 1 {
		return s.writeError("delete vehicle identity", err)
	}
	return nil
}
func (s *Service) EnsureVehicleUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entryID)
}
func vehicleDetail(d VehicleData) DetailView {
	return DetailView{Name: d.Name, PlateNumber: d.PlateNumber, VehicleType: d.VehicleType, VehicleTypeName: d.VehicleTypeName, VIN: d.VIN, EngineNumber: d.EngineNumber, LoadCapacityKG: d.LoadCapacityKG, Remark: d.Remark, CarrierAffiliation: d.CarrierAffiliation, BulkLiquidCapable: d.BulkLiquidCapable}
}

func vehicleDataFromCurrent(r dbsqlc.GetBobVehicleCurrentRow) VehicleData {
	return VehicleData{Name: r.Name, PlateNumber: r.PlateNumber, VehicleType: r.VehicleType, VehicleTypeObjectID: r.VehicleTypeObjectID, VehicleTypeName: r.VehicleTypeName, VIN: deref(r.Vin), EngineNumber: deref(r.EngineNumber), LoadCapacityKG: numericString(r.LoadCapacityKg), Remark: deref(r.Remark), BulkLiquidCapable: r.BulkLiquidCapable, CarrierAffiliation: &CarrierAffiliation{Type: r.CarrierAffiliationType, OperatingEntityID: deref(r.CarrierOperatingEntityID), OperatingApprovalEntryID: deref(r.CarrierOperatingEntityApprovalEntryID), ServiceRelationshipObjectID: deref(r.CarrierServiceRelationshipObjectID), ServiceApprovalEntryID: deref(r.CarrierServiceRelationshipApprovalEntryID)}}
}

func (s *Service) getVehicleCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) || input.ApprovalEntryID != "" {
		return ObjectView{}, domainError(ErrorValidation, "invalid vehicle get request", nil, nil)
	}
	r, err := s.queries.GetBobVehicleCurrent(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "vehicle not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get vehicle current", err)
	}
	entry := dbsqlc.ApprovalEntry{ID: r.SourceApprovalEntryID, Domain: r.Domain, Entity: EntityVehicle, SubjectID: r.ObjectID, VersionNo: r.VersionNo, Status: r.Status, Revision: r.ApprovalRevision, CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedBy: r.ApprovalUpdatedBy, UpdatedAt: r.ApprovalUpdatedAt, SubmittedBy: r.SubmittedBy, SubmittedAt: r.SubmittedAt, ApprovedBy: r.ApprovedBy, ApprovedAt: r.ApprovedAt}
	return ObjectView{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, SourceApprovalEntryID: entry.ID, SourceVersionNo: versionNumber(entry.VersionNo), Data: vehicleDetail(vehicleDataFromCurrent(r)), UpdatedAt: r.UpdatedAt.Time}, nil
}

func (s *Service) queryVehicles(ctx context.Context, input QueryInput) (Page[QueryItem], error) {
	offset, ok := pageOffset(input.Page, input.PageSize)
	if !ok || len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	filters, err := validateQueryFilters(EntityVehicle, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	sortField, sortOrder := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		sortField, sortOrder = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		validField := sortField == "updatedAt" || sortField == "code" || sortField == "name"
		if !validField || (sortOrder != "asc" && sortOrder != "desc") {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid sort", nil, nil)
		}
	}
	enabled := int32(-1)
	if filters.Enabled != nil {
		if *filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	rows, err := s.queries.ListBobVehicles(ctx, dbsqlc.ListBobVehiclesParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled, SortField: sortField, SortOrder: sortOrder, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list vehicle current", err)
	}
	total, err := s.queries.CountBobVehicles(ctx, dbsqlc.CountBobVehiclesParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count vehicle current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		view, viewErr := s.getVehicleCurrent(ctx, GetInput{ObjectID: row.ObjectID})
		if viewErr != nil {
			return Page[QueryItem]{}, viewErr
		}
		items = append(items, QueryItem{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ObjectRevision: row.ObjectRevision, Enabled: row.CurrentEnabled, SourceApprovalEntryID: view.SourceApprovalEntryID, SourceVersionNo: view.SourceVersionNo, Data: view.Data, UpdatedAt: row.UpdatedAt.Time})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) validateVehicleSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityVehicle})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (entry.SubjectID != objectID || entry.Status != string(approval.StatusApproved))) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("validate DCL vehicle snapshot", err)
	}
	identity, err := q.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: objectID, Entity: EntityVehicle})
	if err != nil {
		return EffectiveReference{}, s.internal("load vehicle identity", err)
	}
	stored, err := q.GetDCLVehicleVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load DCL vehicle snapshot", err)
	}
	return EffectiveReference{ObjectID: identity.ID, Entity: identity.Entity, Code: identity.Code, ApprovalEntryID: entry.ID, Data: vehicleDetail(VehicleData{Name: stored.Name, PlateNumber: stored.PlateNumber, VehicleType: stored.VehicleType, VehicleTypeObjectID: stored.VehicleTypeObjectID, VehicleTypeName: stored.VehicleTypeName, VIN: deref(stored.Vin), EngineNumber: deref(stored.EngineNumber), LoadCapacityKG: numericString(stored.LoadCapacityKg), Remark: deref(stored.Remark), BulkLiquidCapable: stored.BulkLiquidCapable, CarrierAffiliation: &CarrierAffiliation{Type: stored.CarrierAffiliationType, OperatingEntityID: deref(stored.CarrierOperatingEntityID), OperatingApprovalEntryID: deref(stored.CarrierOperatingEntityApprovalEntryID), ServiceRelationshipObjectID: deref(stored.CarrierServiceRelationshipObjectID), ServiceApprovalEntryID: deref(stored.CarrierServiceRelationshipApprovalEntryID)}})}, nil
}

func (s *Service) resolveVehicleCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobVehicleCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve vehicle current", err)
	}
	data := VehicleData{Name: r.Name, PlateNumber: r.PlateNumber, VehicleType: r.VehicleType, VehicleTypeObjectID: r.VehicleTypeObjectID, VehicleTypeName: r.VehicleTypeName, VIN: deref(r.Vin), EngineNumber: deref(r.EngineNumber), LoadCapacityKG: numericString(r.LoadCapacityKg), Remark: deref(r.Remark), BulkLiquidCapable: r.BulkLiquidCapable, CarrierAffiliation: &CarrierAffiliation{Type: r.CarrierAffiliationType, OperatingEntityID: deref(r.CarrierOperatingEntityID), OperatingApprovalEntryID: deref(r.CarrierOperatingEntityApprovalEntryID), ServiceRelationshipObjectID: deref(r.CarrierServiceRelationshipObjectID), ServiceApprovalEntryID: deref(r.CarrierServiceRelationshipApprovalEntryID)}}
	return EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: vehicleDetail(data)}, nil
}
