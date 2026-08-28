package bob

import (
	"context"
	"encoding/json"

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
	ResolveCurrentAuxiliaryReference(context.Context, pgx.Tx, string, string) (AuxiliaryReference, error)
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
	return EffectiveReference{}, domainError(ErrorValidation, "unsupported BOB snapshot reference entity", nil, nil)
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
	return EffectiveReference{}, domainError(ErrorValidation, "unsupported BOB current reference entity", nil, nil)
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
	resolveAux := func(referenceEntity, referenceObjectID string) error {
		if referenceObjectID == "" {
			return nil
		}
		if exact {
			return nil
		}
		_, err := s.resolveNamedAuxiliaryReference(ctx, tx, referenceEntity, referenceObjectID)
		if err != nil {
			return err
		}
		return nil
	}

	if entity == EntityEmployee {
		if err := resolveAux("department", data.DepartmentID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("position", data.PositionID); err != nil {
			return DetailView{}, err
		}
	}
	if entity == EntityProduct {
		if err := resolveAux("product-category", data.CategoryID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("product-type", data.ProductTypeID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("measurement-unit", data.DefaultInputUnitID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("measurement-unit", data.PricingUnitID); err != nil {
			return DetailView{}, err
		}
		for index := range data.UnitConversions {
			unit := &data.UnitConversions[index].Unit
			if err := resolveAux("measurement-unit", unit.ObjectID); err != nil {
				return DetailView{}, err
			}
		}
		if data.Formula != nil {
			if err := resolveAux("measurement-unit", data.Formula.Output.EnteredUnit.ObjectID); err != nil {
				return DetailView{}, err
			}
			for index := range data.Formula.Components {
				component := &data.Formula.Components[index]
				if err := resolveBob(EntityProduct, component.Material.ObjectID, &component.Material.ApprovalEntryID); err != nil {
					return DetailView{}, err
				}
				if err := resolveAux("measurement-unit", component.Quantity.EnteredUnit.ObjectID); err != nil {
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
		if err := resolveAux("settlement-method", data.SettlementMethodID); err != nil {
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
	reference, err := s.resolveAuxiliaryReference(ctx, tx, "settlement-method", data.SettlementMethodID)
	if err != nil {
		return DetailView{}, err
	}
	data.SettlementMethodCode, data.SettlementMethodName = reference.Code, reference.Data.Name
	data.TermCode, data.RuleType = reference.Data.TermCode, reference.Data.RuleType
	data.MonthOffset, data.DayOfMonth, data.DayOffset = reference.Data.MonthOffset, reference.Data.DayOfMonth, reference.Data.DayOffset
	data.DueDays, data.CutoffDay, data.DefaultSalesSurcharge = reference.Data.DueDays, reference.Data.CutoffDay, reference.Data.DefaultSalesSurcharge
	return data, nil
}

func (s *Service) resolveAuxiliaryReference(ctx context.Context, tx pgx.Tx, entity, objectID string) (EffectiveReference, error) {
	reference, err := s.resolveAuxiliaryReferenceBySemantics(ctx, tx, entity, objectID)
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

func (s *Service) resolveNamedAuxiliaryReference(ctx context.Context, tx pgx.Tx, entity, objectID string) (AuxiliaryReference, error) {
	reference, err := s.resolveAuxiliaryReferenceBySemantics(ctx, tx, entity, objectID)
	if err != nil {
		return AuxiliaryReference{}, domainError(ErrorConflict, entity+" reference is unavailable", nil, err)
	}
	return reference, nil
}

func (s *Service) ResolveCustomerTypeReference(ctx context.Context, tx pgx.Tx, objectID string) (EffectiveReference, error) {
	reference, err := s.resolveNamedAuxiliaryReference(ctx, tx, "dictionary-item", objectID)
	if err != nil || mapString(reference.Data, "dictionaryTypeCode") != "DCT-0001" {
		return EffectiveReference{}, domainError(ErrorConflict, "customer type reference is unavailable", nil, err)
	}
	return EffectiveReference{ObjectID: reference.ObjectID, Entity: reference.Entity, Code: reference.Code, Data: DetailView{Name: mapString(reference.Data, "name")}}, nil
}

func (s *Service) resolveAuxiliaryReferenceBySemantics(ctx context.Context, tx pgx.Tx, entity, objectID string) (AuxiliaryReference, error) {
	return s.auxiliaryResolver.ResolveCurrentAuxiliaryReference(ctx, tx, entity, objectID)
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
