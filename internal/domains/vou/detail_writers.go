package vou

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
)

func (s *Service) writeSaleDetail(
	ctx context.Context,
	q *dbsqlc.Queries,
	entity string,
	documentID string,
	draft validatedDraft,
	refs resolvedDraft,
	update bool,
) error {
	settlement := settlementSnapshot(refs.CustomerSettlement)
	params := dbsqlc.InsertVouSaleOrderDetailParams{
		DocumentID: documentID, CustomerObjectID: refs.Customer.ObjectID,
		CustomerVersionID: refs.Customer.VersionID, CustomerCode: refs.Customer.Code, CustomerName: refs.Customer.Data.Name,
		SalespersonObjectID:  stringPtr(refs.Salesperson.ObjectID),
		SalespersonVersionID: stringPtr(refs.Salesperson.VersionID),
		SalespersonCode:      stringPtr(refs.Salesperson.Code), SalespersonName: stringPtr(refs.Salesperson.Data.Name),
		WarehouseObjectID:  stringPtr(refs.Warehouse.ObjectID),
		WarehouseVersionID: stringPtr(refs.Warehouse.VersionID),
		WarehouseCode:      stringPtr(refs.Warehouse.Code), WarehouseName: stringPtr(refs.Warehouse.Data.Name),
		ContactName:              optionalText(refs.Customer.Data.ContactName),
		ContactPhone:             optionalText(refs.Customer.Data.ContactPhone),
		DeliveryAddress:          optionalText(refs.Customer.Data.Address),
		SettlementMethodObjectID: settlement.ObjectID, SettlementMethodVersionID: settlement.VersionID,
		SettlementMethodCode: settlement.Code, SettlementMethodName: settlement.Name,
		SettlementRuleType: settlement.RuleType, SettlementMonthOffset: settlement.MonthOffset,
		SettlementDayOfMonth: settlement.DayOfMonth, SettlementDayOffset: settlement.DayOffset,
		SettlementDescription: settlement.Description,
	}
	if update {
		rows, err := q.UpdateVouSaleOrderDetail(ctx, dbsqlc.UpdateVouSaleOrderDetailParams{
			CustomerObjectID: params.CustomerObjectID, CustomerVersionID: params.CustomerVersionID,
			CustomerCode: params.CustomerCode, CustomerName: params.CustomerName,
			SalespersonObjectID: params.SalespersonObjectID, SalespersonVersionID: params.SalespersonVersionID,
			SalespersonCode: params.SalespersonCode, SalespersonName: params.SalespersonName,
			WarehouseObjectID: params.WarehouseObjectID, WarehouseVersionID: params.WarehouseVersionID,
			WarehouseCode: params.WarehouseCode, WarehouseName: params.WarehouseName,
			ContactName: params.ContactName, ContactPhone: params.ContactPhone,
			DeliveryAddress:           params.DeliveryAddress,
			SettlementMethodObjectID:  params.SettlementMethodObjectID,
			SettlementMethodVersionID: params.SettlementMethodVersionID,
			SettlementMethodCode:      params.SettlementMethodCode, SettlementMethodName: params.SettlementMethodName,
			SettlementRuleType: params.SettlementRuleType, SettlementMonthOffset: params.SettlementMonthOffset,
			SettlementDayOfMonth: params.SettlementDayOfMonth, SettlementDayOffset: params.SettlementDayOffset,
			SettlementDescription: params.SettlementDescription, DocumentID: documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouSaleOrderDetail(ctx, params)
}

func (s *Service) writePurchaseDetail(
	ctx context.Context,
	q *dbsqlc.Queries,
	entity string,
	documentID string,
	draft validatedDraft,
	refs resolvedDraft,
	update bool,
) error {
	settlement := settlementSnapshot(refs.SupplierSettlement)
	params := dbsqlc.InsertVouPurchaseOrderDetailParams{
		DocumentID: documentID, SupplierObjectID: refs.Supplier.ObjectID,
		SupplierVersionID: refs.Supplier.VersionID, SupplierCode: refs.Supplier.Code, SupplierName: refs.Supplier.Data.Name,
		PurchaserObjectID:  stringPtr(refs.Purchaser.ObjectID),
		PurchaserVersionID: stringPtr(refs.Purchaser.VersionID),
		PurchaserCode:      stringPtr(refs.Purchaser.Code), PurchaserName: stringPtr(refs.Purchaser.Data.Name),
		WarehouseObjectID:  stringPtr(refs.Warehouse.ObjectID),
		WarehouseVersionID: stringPtr(refs.Warehouse.VersionID),
		WarehouseCode:      stringPtr(refs.Warehouse.Code), WarehouseName: stringPtr(refs.Warehouse.Data.Name),
		ContactName:              optionalText(refs.Supplier.Data.ContactName),
		ContactPhone:             optionalText(refs.Supplier.Data.ContactPhone),
		SettlementMethodObjectID: settlement.ObjectID, SettlementMethodVersionID: settlement.VersionID,
		SettlementMethodCode: settlement.Code, SettlementMethodName: settlement.Name,
		SettlementRuleType: settlement.RuleType, SettlementMonthOffset: settlement.MonthOffset,
		SettlementDayOfMonth: settlement.DayOfMonth, SettlementDayOffset: settlement.DayOffset,
		SettlementDescription: settlement.Description,
	}
	if update {
		rows, err := q.UpdateVouPurchaseOrderDetail(ctx, dbsqlc.UpdateVouPurchaseOrderDetailParams{
			SupplierObjectID: params.SupplierObjectID, SupplierVersionID: params.SupplierVersionID,
			SupplierCode: params.SupplierCode, SupplierName: params.SupplierName,
			PurchaserObjectID: params.PurchaserObjectID, PurchaserVersionID: params.PurchaserVersionID,
			PurchaserCode: params.PurchaserCode, PurchaserName: params.PurchaserName,
			WarehouseObjectID: params.WarehouseObjectID, WarehouseVersionID: params.WarehouseVersionID,
			WarehouseCode: params.WarehouseCode, WarehouseName: params.WarehouseName,
			ContactName: params.ContactName, ContactPhone: params.ContactPhone,
			SettlementMethodObjectID:  params.SettlementMethodObjectID,
			SettlementMethodVersionID: params.SettlementMethodVersionID,
			SettlementMethodCode:      params.SettlementMethodCode, SettlementMethodName: params.SettlementMethodName,
			SettlementRuleType: params.SettlementRuleType, SettlementMonthOffset: params.SettlementMonthOffset,
			SettlementDayOfMonth: params.SettlementDayOfMonth, SettlementDayOffset: params.SettlementDayOffset,
			SettlementDescription: params.SettlementDescription, DocumentID: documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouPurchaseOrderDetail(ctx, params)
}

func (s *Service) writeIntermediaryDetail(
	ctx context.Context,
	q *dbsqlc.Queries,
	entity string,
	documentID string,
	draft validatedDraft,
	refs resolvedDraft,
	update bool,
) error {
	customerSettlement := settlementSnapshot(refs.CustomerSettlement)
	supplierSettlement := settlementSnapshot(refs.SupplierSettlement)
	params := dbsqlc.InsertVouIntermediarySaleOrderDetailParams{
		DocumentID: documentID, CustomerObjectID: refs.Customer.ObjectID,
		CustomerVersionID: refs.Customer.VersionID, CustomerCode: refs.Customer.Code, CustomerName: refs.Customer.Data.Name,
		SupplierObjectID: refs.Supplier.ObjectID, SupplierVersionID: refs.Supplier.VersionID,
		SupplierCode: refs.Supplier.Code, SupplierName: refs.Supplier.Data.Name,
		SalespersonObjectID:  stringPtr(refs.Salesperson.ObjectID),
		SalespersonVersionID: stringPtr(refs.Salesperson.VersionID),
		SalespersonCode:      stringPtr(refs.Salesperson.Code), SalespersonName: stringPtr(refs.Salesperson.Data.Name),
		PurchaserObjectID:  stringPtr(refs.Purchaser.ObjectID),
		PurchaserVersionID: stringPtr(refs.Purchaser.VersionID),
		PurchaserCode:      stringPtr(refs.Purchaser.Code), PurchaserName: stringPtr(refs.Purchaser.Data.Name),
		ContactName:                       optionalText(refs.Customer.Data.ContactName),
		ContactPhone:                      optionalText(refs.Customer.Data.ContactPhone),
		DeliveryAddress:                   optionalText(refs.Customer.Data.Address),
		CustomerSettlementMethodObjectID:  customerSettlement.ObjectID,
		CustomerSettlementMethodVersionID: customerSettlement.VersionID,
		CustomerSettlementMethodCode:      customerSettlement.Code,
		CustomerSettlementMethodName:      customerSettlement.Name,
		CustomerSettlementRuleType:        customerSettlement.RuleType,
		CustomerSettlementMonthOffset:     customerSettlement.MonthOffset,
		CustomerSettlementDayOfMonth:      customerSettlement.DayOfMonth,
		CustomerSettlementDayOffset:       customerSettlement.DayOffset,
		CustomerSettlementDescription:     customerSettlement.Description,
		SupplierSettlementMethodObjectID:  supplierSettlement.ObjectID,
		SupplierSettlementMethodVersionID: supplierSettlement.VersionID,
		SupplierSettlementMethodCode:      supplierSettlement.Code,
		SupplierSettlementMethodName:      supplierSettlement.Name,
		SupplierSettlementRuleType:        supplierSettlement.RuleType,
		SupplierSettlementMonthOffset:     supplierSettlement.MonthOffset,
		SupplierSettlementDayOfMonth:      supplierSettlement.DayOfMonth,
		SupplierSettlementDayOffset:       supplierSettlement.DayOffset,
		SupplierSettlementDescription:     supplierSettlement.Description,
	}
	if update {
		rows, err := q.UpdateVouIntermediarySaleOrderDetail(ctx, dbsqlc.UpdateVouIntermediarySaleOrderDetailParams{
			CustomerObjectID: params.CustomerObjectID, CustomerVersionID: params.CustomerVersionID,
			CustomerCode: params.CustomerCode, CustomerName: params.CustomerName,
			SupplierObjectID: params.SupplierObjectID, SupplierVersionID: params.SupplierVersionID,
			SupplierCode: params.SupplierCode, SupplierName: params.SupplierName,
			SalespersonObjectID: params.SalespersonObjectID, SalespersonVersionID: params.SalespersonVersionID,
			SalespersonCode: params.SalespersonCode, SalespersonName: params.SalespersonName,
			PurchaserObjectID: params.PurchaserObjectID, PurchaserVersionID: params.PurchaserVersionID,
			PurchaserCode: params.PurchaserCode, PurchaserName: params.PurchaserName,
			ContactName: params.ContactName, ContactPhone: params.ContactPhone,
			DeliveryAddress:                   params.DeliveryAddress,
			CustomerSettlementMethodObjectID:  params.CustomerSettlementMethodObjectID,
			CustomerSettlementMethodVersionID: params.CustomerSettlementMethodVersionID,
			CustomerSettlementMethodCode:      params.CustomerSettlementMethodCode,
			CustomerSettlementMethodName:      params.CustomerSettlementMethodName,
			CustomerSettlementRuleType:        params.CustomerSettlementRuleType,
			CustomerSettlementMonthOffset:     params.CustomerSettlementMonthOffset,
			CustomerSettlementDayOfMonth:      params.CustomerSettlementDayOfMonth,
			CustomerSettlementDayOffset:       params.CustomerSettlementDayOffset,
			CustomerSettlementDescription:     params.CustomerSettlementDescription,
			SupplierSettlementMethodObjectID:  params.SupplierSettlementMethodObjectID,
			SupplierSettlementMethodVersionID: params.SupplierSettlementMethodVersionID,
			SupplierSettlementMethodCode:      params.SupplierSettlementMethodCode,
			SupplierSettlementMethodName:      params.SupplierSettlementMethodName,
			SupplierSettlementRuleType:        params.SupplierSettlementRuleType,
			SupplierSettlementMonthOffset:     params.SupplierSettlementMonthOffset,
			SupplierSettlementDayOfMonth:      params.SupplierSettlementDayOfMonth,
			SupplierSettlementDayOffset:       params.SupplierSettlementDayOffset,
			SupplierSettlementDescription:     params.SupplierSettlementDescription,
			DocumentID:                        documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouIntermediarySaleOrderDetail(ctx, params)
}

func (s *Service) writeCashDetail(
	ctx context.Context,
	q *dbsqlc.Queries,
	entity string,
	documentID string,
	draft validatedDraft,
	refs resolvedDraft,
	update bool,
) error {
	counterparty := refs.Counterparty
	if entity == EntityReceipt {
		params := dbsqlc.InsertVouReceiptDetailParams{
			DocumentID: documentID, CounterpartyEntity: draft.CounterpartyType,
			CounterpartyObjectID: counterparty.ObjectID, CounterpartyVersionID: counterparty.VersionID,
			CounterpartyCode: counterparty.Code, CounterpartyName: counterparty.Data.Name,
			FundAccountObjectID: refs.FundAccount.ObjectID, FundAccountVersionID: refs.FundAccount.VersionID,
			FundAccountCode: refs.FundAccount.Code, FundAccountName: refs.FundAccount.Data.Name,
			HandlerObjectID: stringPtr(refs.Handler.ObjectID), HandlerVersionID: stringPtr(refs.Handler.VersionID),
			HandlerCode: stringPtr(refs.Handler.Code), HandlerName: stringPtr(refs.Handler.Data.Name),
		}
		if update {
			rows, err := q.UpdateVouReceiptDetail(ctx, dbsqlc.UpdateVouReceiptDetailParams{
				CounterpartyEntity: params.CounterpartyEntity, CounterpartyObjectID: params.CounterpartyObjectID,
				CounterpartyVersionID: params.CounterpartyVersionID, CounterpartyCode: params.CounterpartyCode,
				CounterpartyName: params.CounterpartyName, FundAccountObjectID: params.FundAccountObjectID,
				FundAccountVersionID: params.FundAccountVersionID, FundAccountCode: params.FundAccountCode,
				FundAccountName: params.FundAccountName,
				HandlerObjectID: params.HandlerObjectID, HandlerVersionID: params.HandlerVersionID,
				HandlerCode: params.HandlerCode, HandlerName: params.HandlerName, DocumentID: documentID,
			})
			return oneRow(rows, err)
		}
		return q.InsertVouReceiptDetail(ctx, params)
	}
	params := dbsqlc.InsertVouPaymentDetailParams{
		DocumentID: documentID, CounterpartyEntity: draft.CounterpartyType,
		CounterpartyObjectID: counterparty.ObjectID, CounterpartyVersionID: counterparty.VersionID,
		CounterpartyCode: counterparty.Code, CounterpartyName: counterparty.Data.Name,
		FundAccountObjectID: refs.FundAccount.ObjectID, FundAccountVersionID: refs.FundAccount.VersionID,
		FundAccountCode: refs.FundAccount.Code, FundAccountName: refs.FundAccount.Data.Name,
		HandlerObjectID: stringPtr(refs.Handler.ObjectID), HandlerVersionID: stringPtr(refs.Handler.VersionID),
		HandlerCode: stringPtr(refs.Handler.Code), HandlerName: stringPtr(refs.Handler.Data.Name),
	}
	if update {
		rows, err := q.UpdateVouPaymentDetail(ctx, dbsqlc.UpdateVouPaymentDetailParams{
			CounterpartyEntity: params.CounterpartyEntity, CounterpartyObjectID: params.CounterpartyObjectID,
			CounterpartyVersionID: params.CounterpartyVersionID, CounterpartyCode: params.CounterpartyCode,
			CounterpartyName: params.CounterpartyName, FundAccountObjectID: params.FundAccountObjectID,
			FundAccountVersionID: params.FundAccountVersionID, FundAccountCode: params.FundAccountCode,
			FundAccountName: params.FundAccountName,
			HandlerObjectID: params.HandlerObjectID, HandlerVersionID: params.HandlerVersionID,
			HandlerCode: params.HandlerCode, HandlerName: params.HandlerName, DocumentID: documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouPaymentDetail(ctx, params)
}

func (s *Service) writeExpenseDetail(
	ctx context.Context,
	q *dbsqlc.Queries,
	entity string,
	documentID string,
	draft validatedDraft,
	refs resolvedDraft,
	update bool,
) error {
	params := dbsqlc.InsertVouExpenseReimbursementDetailParams{
		DocumentID: documentID, EmployeeObjectID: refs.Employee.ObjectID,
		EmployeeVersionID: refs.Employee.VersionID, EmployeeCode: refs.Employee.Code,
		EmployeeName: refs.Employee.Data.Name, FundAccountObjectID: refs.FundAccount.ObjectID,
		FundAccountVersionID: refs.FundAccount.VersionID, FundAccountCode: refs.FundAccount.Code,
		FundAccountName: refs.FundAccount.Data.Name,
	}
	if update {
		rows, err := q.UpdateVouExpenseReimbursementDetail(ctx, dbsqlc.UpdateVouExpenseReimbursementDetailParams{
			EmployeeObjectID: params.EmployeeObjectID, EmployeeVersionID: params.EmployeeVersionID,
			EmployeeCode: params.EmployeeCode, EmployeeName: params.EmployeeName,
			FundAccountObjectID: params.FundAccountObjectID, FundAccountVersionID: params.FundAccountVersionID,
			FundAccountCode: params.FundAccountCode, FundAccountName: params.FundAccountName, DocumentID: documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouExpenseReimbursementDetail(ctx, params)
}

func (s *Service) writeOtherIncomeDetail(
	ctx context.Context,
	q *dbsqlc.Queries,
	entity string,
	documentID string,
	draft validatedDraft,
	refs resolvedDraft,
	update bool,
) error {
	var ce, co, cv, cc, cn *string
	if refs.Counterparty != nil {
		ce, co, cv, cc, cn = stringPtr(draft.CounterpartyType), stringPtr(refs.Counterparty.ObjectID),
			stringPtr(refs.Counterparty.VersionID), stringPtr(refs.Counterparty.Code), stringPtr(refs.Counterparty.Data.Name)
	}
	params := dbsqlc.InsertVouOtherIncomeDetailParams{
		DocumentID: documentID, SourceName: draft.SourceName, CounterpartyEntity: ce,
		CounterpartyObjectID: co, CounterpartyVersionID: cv, CounterpartyCode: cc, CounterpartyName: cn,
		FundAccountObjectID: refs.FundAccount.ObjectID, FundAccountVersionID: refs.FundAccount.VersionID,
		FundAccountCode: refs.FundAccount.Code, FundAccountName: refs.FundAccount.Data.Name,
		HandlerObjectID: stringPtr(refs.Handler.ObjectID), HandlerVersionID: stringPtr(refs.Handler.VersionID),
		HandlerCode: stringPtr(refs.Handler.Code), HandlerName: stringPtr(refs.Handler.Data.Name),
	}
	if update {
		rows, err := q.UpdateVouOtherIncomeDetail(ctx, dbsqlc.UpdateVouOtherIncomeDetailParams{
			SourceName: params.SourceName, CounterpartyEntity: ce, CounterpartyObjectID: co,
			CounterpartyVersionID: cv, CounterpartyCode: cc, CounterpartyName: cn,
			FundAccountObjectID: params.FundAccountObjectID, FundAccountVersionID: params.FundAccountVersionID,
			FundAccountCode: params.FundAccountCode, FundAccountName: params.FundAccountName,
			HandlerObjectID: params.HandlerObjectID, HandlerVersionID: params.HandlerVersionID,
			HandlerCode: params.HandlerCode, HandlerName: params.HandlerName, DocumentID: documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouOtherIncomeDetail(ctx, params)
}
