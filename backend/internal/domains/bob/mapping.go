package bob

import (
	"encoding/json"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

func mutation(object dbsqlc.LockBobObjectRow, version dbsqlc.LockBobVersionRow, status string, revision int64) MutationResult {
	return MutationResult{
		ObjectID: object.ID, ObjectRevision: object.Revision, VersionID: version.ID,
		Enabled: object.Enabled, Version: version.VersionNo, Status: status, Revision: revision,
	}
}

func conflict(object dbsqlc.LockBobObjectRow, version dbsqlc.LockBobVersionRow, message string) error {
	return domainError(ErrorConflict, message, conflictData(object, version), nil)
}

func conflictData(object dbsqlc.LockBobObjectRow, version dbsqlc.LockBobVersionRow) map[string]any {
	return map[string]any{
		"objectRevision": object.Revision,
		"versionId":      version.ID,
		"revision":       version.Revision,
		"status":         version.Status,
	}
}

func detailFields(entity string) []string {
	switch entity {
	case EntityCustomer:
		return []string{"name", "customerType", "shortName", "taxNumber", "contactName", "contactPhone", "email", "address", "remark", "settlementMethodId", "monthlyClosingDay", "salespersonEmployeeId", "rebateUnitPrice"}
	case EntityOtherUnit:
		return []string{"contactName", "contactPhone", "email", "address", "remark", "settlementMethodId"}
	case EntitySupplier:
		return []string{"name", "shortName", "taxNumber", "contactName", "contactPhone", "email", "address", "remark", "settlementMethodId", "defaultPurchaserEmployeeId"}
	case EntityEmployee:
		return []string{"name", "departmentId", "positionId", "phone", "email", "hireDate", "remark"}
	case EntityProduct:
		return []string{"name", "productTypeId", "defaultInputUnitId", "pricingUnitId", "unitConversions",
			"returnable", "defaultPackagingSpec", "formula",
			"categoryId", "specification", "model", "barcode", "remark"}
	case EntityWarehouse:
		return []string{"name", "address", "contactName", "contactPhone", "managerEmployeeId", "remark"}
	case EntityVehicle:
		return []string{"name", "plateNumber", "vehicleType", "carrierAffiliation", "bulkLiquidCapable", "vin", "engineNumber", "loadCapacityKg", "remark"}
	case EntityFundAccount:
		return []string{"name", "currency", "accountName", "bankName", "bankBranch", "accountNumber", "remark"}
	case EntityCategory:
		return []string{"name", "targetEntity", "parentId", "description"}
	case EntityDepartment:
		return []string{"name", "categoryId", "parentId", "description"}
	case EntityPosition:
		return []string{"name", "categoryId", "description"}
	case EntitySettlementMethod:
		return []string{"name", "termCode", "ruleType", "monthOffset", "dayOfMonth", "dayOffset", "defaultSalesSurcharge", "description"}
	case EntityOperatingEntity:
		return []string{"name", "shortName", "taxNumber", "address", "phone", "remark"}
	default:
		return []string{"name"}
	}
}

func versionSummary(row dbsqlc.BobVersionView) VersionSummary {
	summary := detailView(row)
	summary.AccountNumber = ""
	return VersionSummary{
		VersionID: row.VersionID, Version: row.VersionNo, Status: row.Status,
		Revision: row.VersionRevision, SubmittedBy: row.SubmittedBy, Summary: summary,
	}
}

func queryItem(row dbsqlc.BobVersionView, enabled bool) QueryItem {
	return QueryItem{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code,
		ObjectRevision: row.ObjectRevision, Enabled: enabled, UpdatedAt: row.ObjectUpdatedAt.Time}
}

func versionHistoryItem(row dbsqlc.BobVersionView) VersionHistoryItem {
	return VersionHistoryItem{
		VersionID: row.VersionID, Version: row.VersionNo, Status: row.Status, Revision: row.VersionRevision,
		CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy, UpdatedAt: row.UpdatedAt.Time, UpdatedBy: row.UpdatedBy,
		SubmittedAt: timePointer(row.SubmittedAt), SubmittedBy: row.SubmittedBy,
		ReviewedAt: timePointer(row.ReviewedAt), ReviewedBy: row.ReviewedBy, ReviewComment: row.ReviewComment,
		Summary: detailView(row),
	}
}

func objectView(row dbsqlc.BobVersionView, enabled bool) ObjectView {
	return ObjectView{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ObjectRevision: row.ObjectRevision, Enabled: enabled,
		CurrentVersionID: row.CurrentVersionID, EffectiveVersionID: row.EffectiveVersionID, UpdatedAt: row.ObjectUpdatedAt.Time,
		Version: VersionMeta{
			VersionID: row.VersionID, Version: row.VersionNo, Status: row.Status, Revision: row.VersionRevision,
			CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy, UpdatedAt: row.UpdatedAt.Time, UpdatedBy: row.UpdatedBy,
			SubmittedAt: timePointer(row.SubmittedAt), SubmittedBy: row.SubmittedBy,
			ReviewedAt: timePointer(row.ReviewedAt), ReviewedBy: row.ReviewedBy, ReviewComment: row.ReviewComment,
		},
		Data: detailView(row),
	}
}

func detailView(row dbsqlc.BobVersionView) DetailView {
	result := DetailView{
		Name: row.Name, Unit: row.Unit, InventoryUnitID: row.InventoryUnitID,
		Currency:    deref(row.Currency),
		PlateNumber: deref(row.PlateNumber),
		VehicleType: deref(row.VehicleType), BulkLiquidCapable: derefBool(row.BulkLiquidCapable),
		CustomerType: row.CustomerType, ShortName: row.ShortName, CategoryID: row.CategoryID,
		TaxNumber: row.TaxNumber, ContactName: row.ContactName, ContactPhone: row.ContactPhone,
		Email: row.Email, Address: row.Address, Remark: row.Remark,
		DepartmentID: row.DepartmentID, PositionID: row.PositionID, Phone: row.Phone,
		HireDate: row.HireDate, Specification: row.Specification, Model: row.Model,
		Barcode: row.Barcode, Description: row.Description,
		ManagerEmployeeID: row.ManagerEmployeeID, VIN: row.Vin, EngineNumber: row.EngineNumber,
		LoadCapacityKG: row.LoadCapacityKg, AccountName: row.AccountName, BankName: row.BankName,
		BankBranch: row.BankBranch, AccountNumber: row.AccountNumber,
		TargetEntity: row.TargetEntity, ParentID: row.ParentID,
		SettlementMethodID:        row.SettlementMethodID,
		SalespersonEmployeeID:     row.SalespersonEmployeeID,
		SettlementMethodVersionID: row.SettlementMethodVersionID,
		RuleType:                  row.SettlementRuleType,
		MonthOffset:               row.SettlementMonthOffset, DayOffset: row.SettlementDayOffset,
		ProductTypeID: row.ProductTypeID, ProductTypeVersionID: row.ProductTypeVersionID,
		ProductTypeCode: row.ProductTypeCode, ProductTypeName: row.ProductTypeName,
		BehaviorProfile: row.BehaviorProfile, DefaultInputUnitID: row.DefaultInputUnitID,
		PricingUnitID: row.PricingUnitID, Returnable: row.Returnable,
	}
	if row.Entity == EntityCustomer {
		result.MonthlyClosingDay = row.MonthlyClosingDay
		result.RebateUnitPrice = formatMoneyCents(row.RebateUnitPriceCents)
	}
	if row.Entity == EntitySupplier {
		result.DefaultPurchaserEmployeeID = row.SalespersonEmployeeID
		result.SalespersonEmployeeID = ""
	}
	if row.Entity == EntitySettlementMethod {
		result.TermCode = row.SettlementTermCode
		result.DefaultSalesSurcharge = formatMoneyCents(row.SettlementDefaultSalesSurchargeCents)
	}
	if row.Entity == EntityProduct && row.BehaviorProfile != ProductBehaviorPackaging {
		result.DefaultPackagingSpec = formatMicros(row.DefaultPackagingSpecMicros)
	}
	if row.SettlementRuleType == SettlementRuleFixedDay {
		day := row.SettlementDayOfMonth
		result.DayOfMonth = &day
	}
	if row.Entity == EntityVehicle {
		result.CarrierAffiliation = &CarrierAffiliation{Type: deref(row.CarrierAffiliationType),
			OperatingEntityID:           deref(row.CarrierOperatingEntityID),
			ServiceRelationshipObjectID: deref(row.CarrierServiceRelationshipObjectID)}
	}
	return result
}

func auditEventView(row dbsqlc.BobAuditEvent) AuditEventView {
	return AuditEventView{
		ID: row.ID, ObjectID: row.ObjectID, VersionID: row.VersionID, Entity: row.Entity,
		EventType: row.EventType, FromStatus: row.FromStatus, ToStatus: row.ToStatus, ActorID: row.ActorID,
		OccurredAt: row.OccurredAt.Time, Comment: row.Comment, RequestID: row.RequestID, Summary: json.RawMessage(row.Summary),
	}
}

func timePointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func derefBool(value *bool) bool {
	return value != nil && *value
}
