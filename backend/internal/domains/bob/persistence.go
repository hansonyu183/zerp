package bob

import (
	"context"
	"encoding/json"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/oklog/ulid/v2"
)

func insertDetail(ctx context.Context, q *dbsqlc.Queries, entity, versionID string, data DetailView) error {
	switch entity {
	case EntityCustomer:
		return q.InsertBobCustomerDetail(ctx, dbsqlc.InsertBobCustomerDetailParams{
			VersionID: versionID, Name: data.Name, CustomerType: data.CustomerType,
			ShortName: nilIfEmpty(data.ShortName), CategoryID: nilIfEmpty(data.CategoryID),
			TaxNumber: nilIfEmpty(data.TaxNumber), ContactName: nilIfEmpty(data.ContactName),
			ContactPhone: nilIfEmpty(data.ContactPhone), Email: nilIfEmpty(data.Email),
			Address: nilIfEmpty(data.Address), Remark: nilIfEmpty(data.Remark),
			SettlementMethodID:    nilIfEmpty(data.SettlementMethodID),
			SalespersonEmployeeID: data.SalespersonEmployeeID,
		})
	case EntitySupplier:
		return q.InsertBobSupplierDetail(ctx, dbsqlc.InsertBobSupplierDetailParams{
			VersionID: versionID, Name: data.Name, SupplierType: data.SupplierType,
			ShortName: nilIfEmpty(data.ShortName), CategoryID: nilIfEmpty(data.CategoryID),
			TaxNumber: nilIfEmpty(data.TaxNumber), ContactName: nilIfEmpty(data.ContactName),
			ContactPhone: nilIfEmpty(data.ContactPhone), Email: nilIfEmpty(data.Email),
			Address: nilIfEmpty(data.Address), Remark: nilIfEmpty(data.Remark),
			SettlementMethodID:    nilIfEmpty(data.SettlementMethodID),
			SalespersonEmployeeID: data.SalespersonEmployeeID,
		})
	case EntityEmployee:
		return q.InsertBobEmployeeDetail(ctx, dbsqlc.InsertBobEmployeeDetailParams{
			VersionID: versionID, Name: data.Name, CategoryID: nilIfEmpty(data.CategoryID),
			DepartmentID: nilIfEmpty(data.DepartmentID), PositionID: nilIfEmpty(data.PositionID),
			Phone: nilIfEmpty(data.Phone), Email: nilIfEmpty(data.Email),
			HireDate: data.HireDate, Remark: nilIfEmpty(data.Remark),
		})
	case EntityProduct:
		quantity, err := optionalContainerMicros(data)
		if err != nil {
			return err
		}
		return q.InsertBobProductDetail(ctx, dbsqlc.InsertBobProductDetailParams{
			VersionID: versionID, Name: data.Name, Unit: data.Unit, CategoryID: nilIfEmpty(data.CategoryID),
			Specification: nilIfEmpty(data.Specification), Model: nilIfEmpty(data.Model),
			Barcode: nilIfEmpty(data.Barcode), Remark: nilIfEmpty(data.Remark),
			ContainerType: data.ContainerType, QuantityPerContainerMicros: quantity,
		})
	case EntityService:
		return q.InsertBobServiceDetail(ctx, dbsqlc.InsertBobServiceDetailParams{
			VersionID: versionID, Name: data.Name, Unit: data.Unit, CategoryID: nilIfEmpty(data.CategoryID),
			Description: nilIfEmpty(data.Description), Remark: nilIfEmpty(data.Remark),
		})
	case EntityWarehouse:
		return q.InsertBobWarehouseDetail(ctx, dbsqlc.InsertBobWarehouseDetailParams{
			VersionID: versionID, Name: data.Name, CategoryID: nilIfEmpty(data.CategoryID),
			Address: nilIfEmpty(data.Address), ContactName: nilIfEmpty(data.ContactName),
			ContactPhone: nilIfEmpty(data.ContactPhone), ManagerEmployeeID: nilIfEmpty(data.ManagerEmployeeID),
			Remark: nilIfEmpty(data.Remark),
		})
	case EntityVehicle:
		return q.InsertBobVehicleDetail(ctx, dbsqlc.InsertBobVehicleDetailParams{
			VersionID: versionID, Name: data.Name, PlateNumber: data.PlateNumber,
			VehicleType: data.VehicleType, PlatformObjectID: data.PlatformObjectID,
			CategoryID: nilIfEmpty(data.CategoryID), Vin: nilIfEmpty(data.VIN),
			EngineNumber: nilIfEmpty(data.EngineNumber), LoadCapacityKg: data.LoadCapacityKG,
			Remark: nilIfEmpty(data.Remark),
		})
	case EntityFundAccount:
		return q.InsertBobFundAccountDetail(ctx, dbsqlc.InsertBobFundAccountDetailParams{
			VersionID: versionID, Name: data.Name, Currency: data.Currency,
			CategoryID: nilIfEmpty(data.CategoryID), AccountName: nilIfEmpty(data.AccountName),
			BankName: nilIfEmpty(data.BankName), BankBranch: nilIfEmpty(data.BankBranch),
			AccountNumber: nilIfEmpty(data.AccountNumber), Remark: nilIfEmpty(data.Remark),
		})
	case EntityCategory:
		return q.InsertBobCategoryDetail(ctx, dbsqlc.InsertBobCategoryDetailParams{
			VersionID: versionID, Name: data.Name, TargetEntity: data.TargetEntity,
			ParentID: nilIfEmpty(data.ParentID), Description: nilIfEmpty(data.Description),
		})
	case EntityDepartment:
		return q.InsertBobDepartmentDetail(ctx, dbsqlc.InsertBobDepartmentDetailParams{
			VersionID: versionID, Name: data.Name, CategoryID: nilIfEmpty(data.CategoryID),
			ParentID: nilIfEmpty(data.ParentID), Description: nilIfEmpty(data.Description),
		})
	case EntityPosition:
		return q.InsertBobPositionDetail(ctx, dbsqlc.InsertBobPositionDetailParams{
			VersionID: versionID, Name: data.Name, CategoryID: nilIfEmpty(data.CategoryID),
			Description: nilIfEmpty(data.Description),
		})
	case EntitySettlementMethod:
		return q.InsertBobSettlementMethodDetail(ctx, dbsqlc.InsertBobSettlementMethodDetailParams{
			VersionID: versionID, Name: data.Name, RuleType: data.RuleType,
			MonthOffset: data.MonthOffset, DayOfMonth: data.DayOfMonth,
			DayOffset: data.DayOffset, Description: nilIfEmpty(data.Description),
		})
	default:
		return domainError(ErrorValidation, "invalid entity", nil, nil)
	}
}

func updateDetail(ctx context.Context, q *dbsqlc.Queries, entity, versionID string, data DetailView) error {
	var rows int64
	var err error
	switch entity {
	case EntityCustomer:
		rows, err = q.UpdateBobCustomerDetail(ctx, dbsqlc.UpdateBobCustomerDetailParams{
			Name: data.Name, CustomerType: data.CustomerType, ShortName: nilIfEmpty(data.ShortName),
			CategoryID: nilIfEmpty(data.CategoryID), TaxNumber: nilIfEmpty(data.TaxNumber),
			ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone),
			Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address),
			Remark: nilIfEmpty(data.Remark), SettlementMethodID: nilIfEmpty(data.SettlementMethodID),
			SalespersonEmployeeID: data.SalespersonEmployeeID,
			VersionID:             versionID,
		})
	case EntitySupplier:
		rows, err = q.UpdateBobSupplierDetail(ctx, dbsqlc.UpdateBobSupplierDetailParams{
			Name: data.Name, SupplierType: data.SupplierType, ShortName: nilIfEmpty(data.ShortName),
			CategoryID: nilIfEmpty(data.CategoryID), TaxNumber: nilIfEmpty(data.TaxNumber),
			ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone),
			Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address),
			Remark: nilIfEmpty(data.Remark), SettlementMethodID: nilIfEmpty(data.SettlementMethodID),
			SalespersonEmployeeID: data.SalespersonEmployeeID,
			VersionID:             versionID,
		})
	case EntityEmployee:
		rows, err = q.UpdateBobEmployeeDetail(ctx, dbsqlc.UpdateBobEmployeeDetailParams{
			Name: data.Name, CategoryID: nilIfEmpty(data.CategoryID),
			DepartmentID: nilIfEmpty(data.DepartmentID), PositionID: nilIfEmpty(data.PositionID),
			Phone: nilIfEmpty(data.Phone), Email: nilIfEmpty(data.Email), HireDate: data.HireDate,
			Remark: nilIfEmpty(data.Remark), VersionID: versionID,
		})
	case EntityProduct:
		quantity, parseErr := optionalContainerMicros(data)
		if parseErr != nil {
			return parseErr
		}
		rows, err = q.UpdateBobProductDetail(ctx, dbsqlc.UpdateBobProductDetailParams{
			Name: data.Name, Unit: data.Unit, CategoryID: nilIfEmpty(data.CategoryID),
			Specification: nilIfEmpty(data.Specification), Model: nilIfEmpty(data.Model),
			Barcode: nilIfEmpty(data.Barcode), Remark: nilIfEmpty(data.Remark), VersionID: versionID,
			ContainerType: data.ContainerType, QuantityPerContainerMicros: quantity,
		})
	case EntityService:
		rows, err = q.UpdateBobServiceDetail(ctx, dbsqlc.UpdateBobServiceDetailParams{
			Name: data.Name, Unit: data.Unit, CategoryID: nilIfEmpty(data.CategoryID),
			Description: nilIfEmpty(data.Description), Remark: nilIfEmpty(data.Remark), VersionID: versionID,
		})
	case EntityWarehouse:
		rows, err = q.UpdateBobWarehouseDetail(ctx, dbsqlc.UpdateBobWarehouseDetailParams{
			Name: data.Name, CategoryID: nilIfEmpty(data.CategoryID), Address: nilIfEmpty(data.Address),
			ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone),
			ManagerEmployeeID: nilIfEmpty(data.ManagerEmployeeID), Remark: nilIfEmpty(data.Remark),
			VersionID: versionID,
		})
	case EntityVehicle:
		rows, err = q.UpdateBobVehicleDetail(ctx, dbsqlc.UpdateBobVehicleDetailParams{
			Name: data.Name, PlateNumber: data.PlateNumber, VehicleType: data.VehicleType,
			PlatformObjectID: data.PlatformObjectID, VersionID: versionID,
			CategoryID: nilIfEmpty(data.CategoryID), Vin: nilIfEmpty(data.VIN),
			EngineNumber: nilIfEmpty(data.EngineNumber), LoadCapacityKg: data.LoadCapacityKG,
			Remark: nilIfEmpty(data.Remark),
		})
	case EntityFundAccount:
		rows, err = q.UpdateBobFundAccountDetail(ctx, dbsqlc.UpdateBobFundAccountDetailParams{
			Name: data.Name, Currency: data.Currency, CategoryID: nilIfEmpty(data.CategoryID),
			AccountName: nilIfEmpty(data.AccountName), BankName: nilIfEmpty(data.BankName),
			BankBranch: nilIfEmpty(data.BankBranch), AccountNumber: nilIfEmpty(data.AccountNumber),
			Remark: nilIfEmpty(data.Remark), VersionID: versionID,
		})
	case EntityCategory:
		rows, err = q.UpdateBobCategoryDetail(ctx, dbsqlc.UpdateBobCategoryDetailParams{
			Name: data.Name, TargetEntity: data.TargetEntity, ParentID: nilIfEmpty(data.ParentID),
			Description: nilIfEmpty(data.Description), VersionID: versionID,
		})
	case EntityDepartment:
		rows, err = q.UpdateBobDepartmentDetail(ctx, dbsqlc.UpdateBobDepartmentDetailParams{
			Name: data.Name, CategoryID: nilIfEmpty(data.CategoryID), ParentID: nilIfEmpty(data.ParentID),
			Description: nilIfEmpty(data.Description), VersionID: versionID,
		})
	case EntityPosition:
		rows, err = q.UpdateBobPositionDetail(ctx, dbsqlc.UpdateBobPositionDetailParams{
			Name: data.Name, CategoryID: nilIfEmpty(data.CategoryID),
			Description: nilIfEmpty(data.Description), VersionID: versionID,
		})
	case EntitySettlementMethod:
		rows, err = q.UpdateBobSettlementMethodDetail(ctx, dbsqlc.UpdateBobSettlementMethodDetailParams{
			Name: data.Name, RuleType: data.RuleType, MonthOffset: data.MonthOffset,
			DayOfMonth: data.DayOfMonth, DayOffset: data.DayOffset,
			Description: nilIfEmpty(data.Description), VersionID: versionID,
		})
	default:
		return domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	if err == nil && rows != 1 {
		return domainError(ErrorConflict, "version detail changed", nil, nil)
	}
	return err
}

func copyDetail(ctx context.Context, q *dbsqlc.Queries, entity, newVersionID, sourceVersionID string) error {
	switch entity {
	case EntityCustomer:
		return q.CopyBobCustomerDetail(ctx, dbsqlc.CopyBobCustomerDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntitySupplier:
		return q.CopyBobSupplierDetail(ctx, dbsqlc.CopyBobSupplierDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntityEmployee:
		return q.CopyBobEmployeeDetail(ctx, dbsqlc.CopyBobEmployeeDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntityProduct:
		return q.CopyBobProductDetail(ctx, dbsqlc.CopyBobProductDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntityService:
		return q.CopyBobServiceDetail(ctx, dbsqlc.CopyBobServiceDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntityWarehouse:
		return q.CopyBobWarehouseDetail(ctx, dbsqlc.CopyBobWarehouseDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntityVehicle:
		return q.CopyBobVehicleDetail(ctx, dbsqlc.CopyBobVehicleDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntityFundAccount:
		return q.CopyBobFundAccountDetail(ctx, dbsqlc.CopyBobFundAccountDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntityCategory:
		return q.CopyBobCategoryDetail(ctx, dbsqlc.CopyBobCategoryDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntityDepartment:
		return q.CopyBobDepartmentDetail(ctx, dbsqlc.CopyBobDepartmentDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntityPosition:
		return q.CopyBobPositionDetail(ctx, dbsqlc.CopyBobPositionDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	case EntitySettlementMethod:
		return q.CopyBobSettlementMethodDetail(ctx, dbsqlc.CopyBobSettlementMethodDetailParams{NewVersionID: newVersionID, SourceVersionID: sourceVersionID})
	default:
		return domainError(ErrorValidation, "invalid entity", nil, nil)
	}
}

func deleteDetail(ctx context.Context, q *dbsqlc.Queries, entity, versionID string) (int64, error) {
	switch entity {
	case EntityCustomer:
		return q.DeleteBobCustomerDetail(ctx, versionID)
	case EntitySupplier:
		return q.DeleteBobSupplierDetail(ctx, versionID)
	case EntityEmployee:
		return q.DeleteBobEmployeeDetail(ctx, versionID)
	case EntityProduct:
		return q.DeleteBobProductDetail(ctx, versionID)
	case EntityService:
		return q.DeleteBobServiceDetail(ctx, versionID)
	case EntityWarehouse:
		return q.DeleteBobWarehouseDetail(ctx, versionID)
	case EntityVehicle:
		return q.DeleteBobVehicleDetail(ctx, versionID)
	case EntityFundAccount:
		return q.DeleteBobFundAccountDetail(ctx, versionID)
	case EntityCategory:
		return q.DeleteBobCategoryDetail(ctx, versionID)
	case EntityDepartment:
		return q.DeleteBobDepartmentDetail(ctx, versionID)
	case EntityPosition:
		return q.DeleteBobPositionDetail(ctx, versionID)
	case EntitySettlementMethod:
		return q.DeleteBobSettlementMethodDetail(ctx, versionID)
	default:
		return 0, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
}

func nilIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func optionalContainerMicros(data DetailView) (*int64, error) {
	if data.ContainerType == ContainerTypeNone {
		return nil, nil
	}
	value, err := fixedMicros(data.QuantityPerContainer)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

type auditInput struct {
	ObjectID, VersionID, Entity, Event, To, ActorID, RequestID string
	From, Comment                                              *string
	Summary                                                    map[string]any
}

func insertAudit(ctx context.Context, q *dbsqlc.Queries, input auditInput) error {
	summary := input.Summary
	if summary == nil {
		summary = map[string]any{}
	}
	encoded, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	return q.InsertBobAuditEvent(ctx, dbsqlc.InsertBobAuditEventParams{
		ID: newID(), ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: input.Entity,
		EventType: input.Event, FromStatus: input.From, ToStatus: input.To, ActorID: input.ActorID,
		Comment: input.Comment, RequestID: input.RequestID, Summary: encoded,
	})
}

func newID() string { return ulid.Make().String() }
