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
		Version: version.VersionNo, Status: status, Revision: revision,
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
		return []string{"name", "customerType", "shortName", "taxNumber", "contactName", "contactPhone", "email", "address", "remark", "settlementMethodId", "salespersonEmployeeId"}
	case EntitySupplier:
		return []string{"name", "supplierType", "shortName", "taxNumber", "contactName", "contactPhone", "email", "address", "remark", "settlementMethodId", "salespersonEmployeeId"}
	case EntityEmployee:
		return []string{"name", "departmentId", "positionId", "phone", "email", "hireDate", "remark"}
	case EntityProduct:
		return []string{"name", "unit", "productKind", "inventoryUnitId", "pricingUnitId",
			"pricingQuantityPerInventoryUnit", "returnable", "packagingSpecs", "formula",
			"categoryId", "specification", "model", "barcode", "remark"}
	case EntityService:
		return []string{"name", "unit", "inventoryUnitId", "description", "remark"}
	case EntityWarehouse:
		return []string{"name", "address", "contactName", "contactPhone", "managerEmployeeId", "remark"}
	case EntityVehicle:
		return []string{"name", "plateNumber", "vehicleType", "platformObjectId", "vin", "engineNumber", "loadCapacityKg", "remark"}
	case EntityFundAccount:
		return []string{"name", "currency", "accountName", "bankName", "bankBranch", "accountNumber", "remark"}
	case EntityCategory:
		return []string{"name", "targetEntity", "parentId", "description"}
	case EntityDepartment:
		return []string{"name", "categoryId", "parentId", "description"}
	case EntityPosition:
		return []string{"name", "categoryId", "description"}
	case EntitySettlementMethod:
		return []string{"name", "ruleType", "monthOffset", "dayOfMonth", "dayOffset", "description"}
	default:
		return []string{"name"}
	}
}

func queryItem(row dbsqlc.BobVersionView) QueryItem {
	summary := detailView(row)
	summary.AccountNumber = ""
	return QueryItem{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ObjectRevision: row.ObjectRevision,
		CurrentVersion: VersionSummary{
			VersionID: row.VersionID, Version: row.VersionNo, Status: row.Status,
			Revision: row.VersionRevision, Summary: summary,
		},
		EffectiveVersionID: row.EffectiveVersionID, UpdatedAt: row.ObjectUpdatedAt.Time,
	}
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

func objectView(row dbsqlc.BobVersionView) ObjectView {
	return ObjectView{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ObjectRevision: row.ObjectRevision,
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
		Name: row.Name, Unit: row.Unit, Currency: deref(row.Currency),
		SupplierType: deref(row.SupplierType), PlateNumber: deref(row.PlateNumber),
		VehicleType: deref(row.VehicleType), PlatformObjectID: deref(row.PlatformObjectID),
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
		ContainerType: row.ContainerType,
		ProductKind:   row.ProductKind, InventoryUnitID: row.InventoryUnitID,
		PricingUnitID:                   row.PricingUnitID,
		PricingQuantityPerInventoryUnit: formatMicros(row.PricingQuantityPerInventoryUnitMicros),
		Returnable:                      row.Returnable,
	}
	result.PackagingSpecs = packagingSpecs(row.PackagingSpecs)
	if row.ContainerType == ContainerTypeSolvent || row.ContainerType == ContainerTypeResin {
		result.QuantityPerContainer = formatMicros(row.QuantityPerContainerMicros)
	}
	if row.SettlementRuleType == SettlementRuleFixedDay {
		day := row.SettlementDayOfMonth
		result.DayOfMonth = &day
	}
	return result
}

func packagingSpecs(value any) []PackagingSpecInput {
	if value == nil {
		return []PackagingSpecInput{}
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return []PackagingSpecInput{}
	}
	var stored []struct {
		PackagingProductObjectID  string `json:"packagingProductObjectId"`
		PackagingProductVersionID string `json:"packagingProductVersionId"`
		PackagingProductCode      string `json:"packagingProductCode"`
		PackagingProductName      string `json:"packagingProductName"`
		ContentQuantityMicros     int64  `json:"contentQuantityMicros"`
		IsDefault                 bool   `json:"isDefault"`
	}
	if err = json.Unmarshal(raw, &stored); err != nil {
		return []PackagingSpecInput{}
	}
	result := make([]PackagingSpecInput, 0, len(stored))
	for _, item := range stored {
		result = append(result, PackagingSpecInput{
			PackagingProductObjectID:  item.PackagingProductObjectID,
			PackagingProductVersionID: item.PackagingProductVersionID,
			PackagingProductCode:      item.PackagingProductCode,
			PackagingProductName:      item.PackagingProductName,
			ContentQuantity:           formatMicros(item.ContentQuantityMicros),
			IsDefault:                 item.IsDefault,
		})
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
