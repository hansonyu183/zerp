package bob

import (
	"context"
	"encoding/json"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const kilogramMeasurementUnitCode = "UNT-0001"

type Service struct {
	pool              *pgxpool.Pool
	queries           *dbsqlc.Queries
	auxiliaryResolver AuxiliaryResolver
}

// PartyDeclarationCreator is implemented by DCL. Relationship creation owns
// the surrounding transaction; DCL creates the stable root and V1 candidate
// inside it without committing.
type PartyDeclarationCreator interface {
	CreateForRelationship(context.Context, pgx.Tx, PartyCreateData, approval.Actor, bool) (PartyRelationshipResolved, error)
}

type AuxiliaryResolver interface {
	ResolveLatestApprovedAuxiliaryReference(context.Context, pgx.Tx, string, string) (AuxiliaryReference, error)
	ValidateApprovedAuxiliarySnapshotReference(context.Context, pgx.Tx, string, string, string) (AuxiliaryReference, error)
	ResolveAuxiliaryCode(context.Context, pgx.Tx, string, string) (AuxiliaryReference, error)
}

func NewService(pool *pgxpool.Pool, auxiliaryResolver AuxiliaryResolver) *Service {
	if pool == nil || auxiliaryResolver == nil {
		panic("bob: persistence and auxiliary resolver are required")
	}
	return &Service{pool: pool, queries: dbsqlc.New(pool), auxiliaryResolver: auxiliaryResolver}
}

func (s *Service) Query(ctx context.Context, entity string, input QueryInput) (Page[QueryItem], error) {
	if entity == EntityOperatingEntity {
		return s.queryOperatingEntities(ctx, input)
	}
	if entity == EntityWarehouse {
		return s.queryWarehouses(ctx, input)
	}
	if entity == EntityVehicle {
		return s.queryVehicles(ctx, input)
	}
	if entity == EntityFundAccount {
		return s.queryFundAccounts(ctx, input)
	}
	if entity == EntityEmployee {
		return s.queryEmploymentRelationships(ctx, input)
	}
	if entity == EntitySupplier {
		return s.querySuppliersCurrent(ctx, input)
	}
	if entity == EntityProduct {
		return s.queryProducts(ctx, input)
	}
	if entity == EntityOtherUnit || entity == EntitySalesPartner {
		return s.queryRelationshipCurrent(ctx, entity, input)
	}
	return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query entity", nil, nil)
}

func (s *Service) Get(ctx context.Context, entity string, input GetInput) (ObjectView, error) {
	if entity == EntityOperatingEntity {
		return s.getOperatingEntityCurrent(ctx, input)
	}
	if entity == EntityWarehouse {
		return s.getWarehouseCurrent(ctx, input)
	}
	if entity == EntityVehicle {
		return s.getVehicleCurrent(ctx, input)
	}
	if entity == EntityFundAccount {
		return s.getFundAccountCurrent(ctx, input)
	}
	if entity == EntityProduct {
		return s.getProductCurrent(ctx, input)
	}
	if entity == EntityEmployee {
		return s.getEmployeeCurrent(ctx, input)
	}
	if entity == EntityOtherUnit {
		return s.getOtherUnitCurrent(ctx, input)
	}
	if entity == EntitySalesPartner {
		return s.getSalesPartnerCurrent(ctx, input)
	}
	if entity == EntitySupplier {
		return s.getSupplierCurrent(ctx, input)
	}
	return ObjectView{}, domainError(ErrorValidation, "invalid get entity", nil, nil)
}

func (s *Service) ValidateApprovedSnapshotReference(ctx context.Context, tx pgx.Tx, entity, objectID, approvalEntryID string) (EffectiveReference, error) {
	if !validEntity(entity) || !validID(objectID) || !validID(approvalEntryID) {
		return EffectiveReference{}, domainError(ErrorValidation, "invalid BOB reference", nil, nil)
	}
	q := s.queries.WithTx(tx)
	if entity == EntityOperatingEntity {
		return s.validateOperatingEntitySnapshotReference(ctx, q, objectID, approvalEntryID)
	}
	if entity == EntityWarehouse {
		return s.validateWarehouseSnapshotReference(ctx, q, objectID, approvalEntryID)
	}
	if entity == EntityVehicle {
		return s.validateVehicleSnapshotReference(ctx, q, objectID, approvalEntryID)
	}
	if entity == EntityFundAccount {
		return s.validateFundAccountSnapshotReference(ctx, q, objectID, approvalEntryID)
	}
	if entity == EntityProduct {
		return s.validateProductSnapshotReference(ctx, q, objectID, approvalEntryID)
	}
	if entity == EntityEmployee {
		return s.validateEmployeeSnapshotReference(ctx, q, objectID, approvalEntryID)
	}
	if entity == EntityOtherUnit {
		return s.validateOtherUnitSnapshotReference(ctx, q, objectID, approvalEntryID)
	}
	if entity == EntitySalesPartner {
		return s.validateSalesPartnerSnapshotReference(ctx, q, objectID, approvalEntryID)
	}
	if entity == EntitySupplier {
		return s.validateSupplierSnapshotReference(ctx, q, objectID, approvalEntryID)
	}
	if entity == EntityCustomerAccount {
		return s.validateCustomerAccountSnapshotReference(ctx, q, objectID, approvalEntryID)
	}
	row, err := q.ValidateBobApprovedSnapshotReference(ctx, dbsqlc.ValidateBobApprovedSnapshotReferenceParams{ApprovalEntryID: approvalEntryID, ObjectID: objectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("validate BOB approval snapshot", err)
	}
	data, err := loadDetail(ctx, q, entity, row.ApprovalEntryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load BOB approval snapshot payload", err)
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ApprovalEntryID: row.ApprovalEntryID, Data: data}, nil
}

func (s *Service) ResolveLatestApprovedReference(ctx context.Context, tx pgx.Tx, entity, objectID string) (EffectiveReference, error) {
	if !validEntity(entity) || !validID(objectID) {
		return EffectiveReference{}, domainError(ErrorValidation, "invalid BOB reference", nil, nil)
	}
	q := s.queries.WithTx(tx)
	if entity == EntityOperatingEntity {
		return s.resolveOperatingEntityCurrentReference(ctx, q, objectID)
	}
	if entity == EntityWarehouse {
		return s.resolveWarehouseCurrentReference(ctx, q, objectID)
	}
	if entity == EntityVehicle {
		return s.resolveVehicleCurrentReference(ctx, q, objectID)
	}
	if entity == EntityFundAccount {
		return s.resolveFundAccountCurrentReference(ctx, q, objectID)
	}
	if entity == EntityProduct {
		return s.resolveProductCurrentReference(ctx, q, objectID)
	}
	if entity == EntityEmployee {
		return s.resolveEmployeeCurrentReference(ctx, q, objectID)
	}
	if entity == EntityOtherUnit {
		return s.resolveOtherUnitCurrentReference(ctx, q, objectID)
	}
	if entity == EntitySalesPartner {
		return s.resolveSalesPartnerCurrentReference(ctx, q, objectID)
	}
	if entity == EntitySupplier {
		return s.resolveSupplierCurrentReference(ctx, q, objectID)
	}
	if entity == EntityCustomerAccount {
		return s.resolveCustomerAccountCurrentReference(ctx, q, objectID)
	}
	row, err := q.ResolveBobLatestApprovedReference(ctx, dbsqlc.ResolveBobLatestApprovedReferenceParams{ObjectID: objectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve latest approved BOB reference", err)
	}
	data, err := loadDetail(ctx, q, entity, row.ApprovalEntryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load latest approved BOB reference payload", err)
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ApprovalEntryID: row.ApprovalEntryID, Data: data}, nil
}

func (s *Service) entryForObject(ctx context.Context, q *dbsqlc.Queries, entity, objectID, entryID string) (dbsqlc.ApprovalEntry, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "bob", Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && entry.SubjectID != objectID) {
		return dbsqlc.ApprovalEntry{}, domainError(ErrorValidation, "approval entry does not belong to object", nil, nil)
	}
	if err != nil {
		return dbsqlc.ApprovalEntry{}, s.internal("get BOB approval entry", err)
	}
	return entry, nil
}

func (s *Service) validateStoredApprovalDetail(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, entity, objectID, entryID string) error {
	if entity == EntitySalesPartner {
		data, err := loadDetail(ctx, q, entity, entryID)
		if err != nil {
			return s.internal("load sales relationship payload for validation", err)
		}
		if err = ValidateSalesPartnerDeclaration(data.SalesCapabilities, data.ContactName, data.ContactPhone, data.Email, data.Address, data.Remark); err != nil {
			return err
		}
		identity, identityErr := q.GetBobSalesPartnerRelationship(ctx, objectID)
		if identityErr != nil {
			return s.internal("load sales relationship for validation", identityErr)
		}
		_, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, identity.OperatingEntityID)
		return err
	}
	data, err := loadDetail(ctx, q, entity, entryID)
	if err != nil {
		return s.internal("load BOB approval payload for validation", err)
	}
	data, err = validateDetailData(entity, data)
	if err != nil {
		return err
	}
	if entity == EntityProduct {
		if data.Formula != nil {
			for index := range data.Formula.Components {
				component := &data.Formula.Components[index]
				material, resolveErr := s.ValidateApprovedSnapshotReference(
					ctx, tx, EntityProduct, component.Material.ObjectID, component.Material.ApprovalEntryID,
				)
				if resolveErr != nil {
					return resolveErr
				}
				component.Material.Code = material.Code
				component.Material.Name = material.Data.Name
				component.Material.BehaviorProfile = material.Data.BehaviorProfile
			}
		}
		if err = validateProductComplete(data); err != nil {
			return err
		}
	}
	if entity == EntityEmployee {
		identity, identityErr := q.GetBobEmploymentRelationship(ctx, objectID)
		if identityErr != nil {
			return s.internal("load employment relationship for validation", identityErr)
		}
		if _, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, identity.OperatingEntityID); err != nil {
			return err
		}
	}
	if entity == EntityOtherUnit {
		identity, identityErr := q.GetBobOtherUnitRelationship(ctx, objectID)
		if identityErr != nil {
			return s.internal("load service relationship for validation", identityErr)
		}
		if _, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, identity.OperatingEntityID); err != nil {
			return err
		}
	}
	_, err = s.resolveDetailReferenceSnapshots(ctx, tx, entity, objectID, data, true)
	return err
}

func approvalEntry(row dbsqlc.ApprovalEntry) approval.Entry {
	return approval.Entry{EntryRef: approval.EntryRef{ID: row.ID, Domain: row.Domain, Entity: row.Entity, SubjectID: row.SubjectID, VersionNo: row.VersionNo}, Status: approval.Status(row.Status), Revision: row.Revision, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt.Time, UpdatedBy: row.UpdatedBy, UpdatedAt: row.UpdatedAt.Time, SubmittedBy: row.SubmittedBy, ApprovedBy: row.ApprovedBy}
}

func (s *Service) ensureUnapproveAllowed(ctx context.Context, q *dbsqlc.Queries, entryID string) error {
	counts, err := listBobApprovalEntryReferenceCounts(ctx, q, entryID)
	if err != nil {
		return s.internal("scan exact BOB approval-entry references before unapprove", err)
	}
	if len(counts) != 0 {
		return domainErrorWithKey(ErrorConflict, "bob_unapprove_blocked", "approved version is referenced by current BOB facts", ActiveReferenceBlockers{References: counts}, nil)
	}
	voucherCounts, err := listVoucherApprovalEntryReferenceCounts(ctx, q, entryID)
	if err != nil {
		return s.internal("scan VOU approval-entry references before unapprove", err)
	}
	if len(voucherCounts) != 0 {
		return domainErrorWithKey(ErrorConflict, "bob_unapprove_blocked", "approved version is referenced by existing VOU facts", ActiveReferenceBlockers{References: voucherCounts}, nil)
	}
	return nil
}

func (s *Service) resolveDetailReferenceSnapshots(ctx context.Context, tx pgx.Tx, entity, objectID string, data DetailView, exact bool) (DetailView, error) {
	resolveBob := func(referenceEntity, referenceObjectID string, approvalEntryID *string) error {
		if referenceObjectID == "" {
			*approvalEntryID = ""
			return nil
		}
		if referenceObjectID == objectID {
			return domainError(ErrorValidation, "object cannot reference itself", nil, nil)
		}
		var reference EffectiveReference
		var err error
		if exact {
			if *approvalEntryID == "" {
				return domainError(ErrorConflict, referenceEntity+" approval snapshot is missing", nil, nil)
			}
			reference, err = s.ValidateApprovedSnapshotReference(ctx, tx, referenceEntity, referenceObjectID, *approvalEntryID)
		} else {
			reference, err = s.ResolveLatestApprovedReference(ctx, tx, referenceEntity, referenceObjectID)
		}
		if err != nil {
			return err
		}
		*approvalEntryID = reference.ApprovalEntryID
		return nil
	}
	resolveAux := func(referenceEntity, referenceObjectID string, approvalEntryID *string) error {
		if referenceObjectID == "" {
			*approvalEntryID = ""
			return nil
		}
		requestedEntryID := ""
		if exact {
			requestedEntryID = *approvalEntryID
			if requestedEntryID == "" {
				return domainError(ErrorConflict, referenceEntity+" approval snapshot is missing", nil, nil)
			}
		}
		reference, err := s.resolveNamedAuxiliaryReference(ctx, tx, referenceEntity, referenceObjectID, requestedEntryID)
		if err != nil {
			return err
		}
		*approvalEntryID = reference.ApprovalEntryID
		return nil
	}

	if entity == EntityEmployee {
		if err := resolveAux("department", data.DepartmentID, &data.DepartmentApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("position", data.PositionID, &data.PositionApprovalEntryID); err != nil {
			return DetailView{}, err
		}
	}
	if entity == EntityProduct {
		if err := resolveAux("product-category", data.CategoryID, &data.CategoryApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("product-type", data.ProductTypeID, &data.ProductTypeApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("measurement-unit", data.DefaultInputUnitID, &data.DefaultInputUnitApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("measurement-unit", data.PricingUnitID, &data.PricingUnitApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		for index := range data.UnitConversions {
			unit := &data.UnitConversions[index].Unit
			if err := resolveAux("measurement-unit", unit.ObjectID, &unit.ApprovalEntryID); err != nil {
				return DetailView{}, err
			}
		}
		if data.Formula != nil {
			if err := resolveAux("measurement-unit", data.Formula.Output.EnteredUnit.ObjectID, &data.Formula.Output.EnteredUnit.ApprovalEntryID); err != nil {
				return DetailView{}, err
			}
			for index := range data.Formula.Components {
				component := &data.Formula.Components[index]
				if err := resolveBob(EntityProduct, component.Material.ObjectID, &component.Material.ApprovalEntryID); err != nil {
					return DetailView{}, err
				}
				if err := resolveAux("measurement-unit", component.Quantity.EnteredUnit.ObjectID, &component.Quantity.EnteredUnit.ApprovalEntryID); err != nil {
					return DetailView{}, err
				}
			}
		}
	}
	if entity == EntityWarehouse {
		if err := resolveBob(EntityEmployee, data.ManagerEmployeeID, &data.ManagerEmployeeApprovalEntryID); err != nil {
			return DetailView{}, err
		}
	}
	if entity == EntityOtherUnit {
		if err := resolveAux("settlement-method", data.SettlementMethodID, &data.SettlementMethodApprovalEntryID); err != nil {
			return DetailView{}, err
		}
	}
	if entity == EntityVehicle {
		if !validCarrierAffiliation(data.CarrierAffiliation) {
			return DetailView{}, domainError(ErrorValidation, "invalid vehicle carrier affiliation", nil, nil)
		}
		if data.CarrierAffiliation.Type == "INTERNAL" {
			if err := resolveBob(EntityOperatingEntity, data.CarrierAffiliation.OperatingEntityID, &data.CarrierAffiliation.OperatingApprovalEntryID); err != nil {
				return DetailView{}, err
			}
		} else if err := resolveBob(EntityOtherUnit, data.CarrierAffiliation.ServiceRelationshipObjectID, &data.CarrierAffiliation.ServiceApprovalEntryID); err != nil {
			return DetailView{}, err
		}
	}
	return data, nil
}

func (s *Service) resolveSettlementSnapshot(ctx context.Context, tx pgx.Tx, data DetailView) (DetailView, error) {
	if data.SettlementMethodID == "" {
		return data, nil
	}
	reference, err := s.resolveAuxiliaryReference(ctx, tx, "settlement-method", data.SettlementMethodID, "")
	if err != nil {
		return DetailView{}, err
	}
	data.SettlementMethodApprovalEntryID = reference.ApprovalEntryID
	data.SettlementMethodCode, data.SettlementMethodName = reference.Code, reference.Data.Name
	data.TermCode, data.RuleType = reference.Data.TermCode, reference.Data.RuleType
	data.MonthOffset, data.DayOfMonth, data.DayOffset = reference.Data.MonthOffset, reference.Data.DayOfMonth, reference.Data.DayOffset
	data.DueDays, data.CutoffDay, data.DefaultSalesSurcharge = reference.Data.DueDays, reference.Data.CutoffDay, reference.Data.DefaultSalesSurcharge
	return data, nil
}

func (s *Service) resolveAuxiliaryReference(ctx context.Context, tx pgx.Tx, entity, objectID, approvalEntryID string) (EffectiveReference, error) {
	reference, err := s.resolveAuxiliaryReferenceBySemantics(ctx, tx, entity, objectID, approvalEntryID)
	if err != nil {
		return EffectiveReference{}, domainError(ErrorConflict, entity+" reference is unavailable", nil, err)
	}
	dayOfMonth := int32(mapInt(reference.Data, "dayOfMonth"))
	var dayOfMonthPointer *int32
	if dayOfMonth > 0 {
		dayOfMonthPointer = &dayOfMonth
	}
	return EffectiveReference{ObjectID: reference.ObjectID, Entity: entity, Code: reference.Code, ApprovalEntryID: reference.ApprovalEntryID, Data: DetailView{Name: mapString(reference.Data, "name"), ParentID: mapString(reference.Data, "parentId"), Description: mapString(reference.Data, "description"), TermCode: mapString(reference.Data, "termCode"), RuleType: mapString(reference.Data, "ruleType"), MonthOffset: int32(mapInt(reference.Data, "monthOffset")), DayOfMonth: dayOfMonthPointer, DayOffset: int32(mapInt(reference.Data, "dayOffset")), DueDays: int32(mapInt(reference.Data, "dayOffset")), CutoffDay: int32(mapInt(reference.Data, "dayOfMonth")), DefaultSalesSurcharge: mapString(reference.Data, "defaultSalesSurcharge")}}, nil
}

func (s *Service) resolveNamedAuxiliaryReference(ctx context.Context, tx pgx.Tx, entity, objectID, approvalEntryID string) (AuxiliaryReference, error) {
	reference, err := s.resolveAuxiliaryReferenceBySemantics(ctx, tx, entity, objectID, approvalEntryID)
	if err != nil {
		return AuxiliaryReference{}, domainError(ErrorConflict, entity+" reference is unavailable", nil, err)
	}
	return reference, nil
}

func (s *Service) resolveAuxiliaryReferenceBySemantics(ctx context.Context, tx pgx.Tx, entity, objectID, approvalEntryID string) (AuxiliaryReference, error) {
	if approvalEntryID == "" {
		return s.auxiliaryResolver.ResolveLatestApprovedAuxiliaryReference(ctx, tx, entity, objectID)
	}
	return s.auxiliaryResolver.ValidateApprovedAuxiliarySnapshotReference(ctx, tx, entity, objectID, approvalEntryID)
}

func mapString(data map[string]any, key string) string { value, _ := data[key].(string); return value }
func mapInt(data map[string]any, key string) int {
	switch value := data[key].(type) {
	case int:
		return value
	case int32:
		return int(value)
	case int64:
		return int(value)
	case float64:
		return int(value)
	case json.Number:
		number, _ := value.Int64()
		return int(number)
	default:
		return 0
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func translateApprovalError(err error) error {
	var approvalErr *approval.Error
	if !errors.As(err, &approvalErr) {
		return err
	}
	kind := ErrorInternal
	switch approvalErr.Kind {
	case approval.ErrorValidation, approval.ErrorNotFound:
		kind = ErrorValidation
	case approval.ErrorConflict:
		kind = ErrorConflict
	}
	return domainErrorWithKey(kind, approvalErr.ErrorKey, approvalErr.Message, nil, err)
}
