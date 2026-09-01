package vou

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
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
	settlement := settlementSnapshot(
		refs.CustomerSettlement, refs.Customer.Data.MonthlyClosingDay,
	)
	attribution, err := q.GetVouSalesAttributionSnapshot(ctx, dbsqlc.GetVouSalesAttributionSnapshotParams{
		CustomerApprovalEntryID: refs.Customer.ApprovalEntryID,
		AccountObjectID:         refs.Customer.ObjectID,
	})
	if err != nil {
		return s.internal("read customer sales attribution snapshot", err)
	}
	if !validIntermediarySalesAttribution(attribution.PrimarySalesAttributionType, attribution.PrimarySalesSubjectID,
		attribution.PrimarySalesSubjectApprovalEntryID, attribution.PrimarySalesSubjectCode, attribution.PrimarySalesSubjectName) {
		return domainError(ErrorConflict, "customer sales attribution snapshot is incomplete", nil, nil)
	}
	params := dbsqlc.InsertVouSaleOrderDetailParams{
		DocumentID: documentID, CustomerObjectID: refs.Customer.ObjectID,
		CustomerApprovalEntryID: refs.Customer.ApprovalEntryID, CustomerCode: refs.Customer.Code, CustomerName: refs.Customer.Data.Name,
		SalespersonObjectID:        stringPtr(refs.Salesperson.ObjectID),
		SalespersonApprovalEntryID: stringPtr(refs.Salesperson.ApprovalEntryID),
		SalespersonCode:            stringPtr(refs.Salesperson.Code), SalespersonName: stringPtr(refs.Salesperson.Data.Name),
		SalesAttributionType:                   attribution.PrimarySalesAttributionType,
		SalesAttributionSubjectObjectID:        attribution.PrimarySalesSubjectID,
		SalesAttributionSubjectApprovalEntryID: attribution.PrimarySalesSubjectApprovalEntryID,
		SalesAttributionSubjectCode:            attribution.PrimarySalesSubjectCode,
		SalesAttributionSubjectName:            attribution.PrimarySalesSubjectName,
		WarehouseObjectID:                      stringPtr(refs.Warehouse.ObjectID),
		WarehouseApprovalEntryID:               stringPtr(refs.Warehouse.ApprovalEntryID),
		WarehouseCode:                          stringPtr(refs.Warehouse.Code), WarehouseName: stringPtr(refs.Warehouse.Data.Name),
		ContactName:              optionalText(refs.Customer.Data.ContactName),
		ContactPhone:             optionalText(refs.Customer.Data.ContactPhone),
		DeliveryAddress:          optionalText(refs.Customer.Data.Address),
		SettlementMethodObjectID: settlement.ObjectID,
		SettlementMethodCode:     settlement.Code, SettlementMethodName: settlement.Name,
		SettlementRuleType: settlement.RuleType, SettlementMonthOffset: settlement.MonthOffset,
		SettlementTermCode:   deref(settlement.TermCode),
		SettlementDayOfMonth: settlement.DayOfMonth, SettlementDayOffset: settlement.DayOffset,
		SettlementDueDays: settlement.DueDays, SettlementCutoffDay: settlement.CutoffDay,
		SettlementDefaultSalesSurchargeCents: settlement.DefaultSalesSurchargeCents,
		SettlementDescription:                settlement.Description,
		SpecialApproval:                      draft.SpecialApproval,
	}
	if update {
		rows, err := q.UpdateVouSaleOrderDetail(ctx, dbsqlc.UpdateVouSaleOrderDetailParams{
			CustomerObjectID: params.CustomerObjectID, CustomerApprovalEntryID: params.CustomerApprovalEntryID,
			CustomerCode: params.CustomerCode, CustomerName: params.CustomerName,
			SalespersonObjectID: params.SalespersonObjectID, SalespersonApprovalEntryID: params.SalespersonApprovalEntryID,
			SalespersonCode: params.SalespersonCode, SalespersonName: params.SalespersonName,
			SalesAttributionType:                   params.SalesAttributionType,
			SalesAttributionSubjectObjectID:        params.SalesAttributionSubjectObjectID,
			SalesAttributionSubjectApprovalEntryID: params.SalesAttributionSubjectApprovalEntryID,
			SalesAttributionSubjectCode:            params.SalesAttributionSubjectCode,
			SalesAttributionSubjectName:            params.SalesAttributionSubjectName,
			WarehouseObjectID:                      params.WarehouseObjectID, WarehouseApprovalEntryID: params.WarehouseApprovalEntryID,
			WarehouseCode: params.WarehouseCode, WarehouseName: params.WarehouseName,
			ContactName: params.ContactName, ContactPhone: params.ContactPhone,
			DeliveryAddress:          params.DeliveryAddress,
			SettlementMethodObjectID: params.SettlementMethodObjectID,
			SettlementMethodName:     params.SettlementMethodName,
			SettlementRuleType:       params.SettlementRuleType, SettlementMonthOffset: params.SettlementMonthOffset,
			SettlementTermCode:   params.SettlementTermCode,
			SettlementDayOfMonth: params.SettlementDayOfMonth, SettlementDayOffset: params.SettlementDayOffset,
			SettlementDueDays: params.SettlementDueDays, SettlementCutoffDay: params.SettlementCutoffDay,
			SettlementDefaultSalesSurchargeCents: params.SettlementDefaultSalesSurchargeCents,
			SettlementDescription:                params.SettlementDescription, DocumentID: documentID,
			SpecialApproval: params.SpecialApproval,
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
	settlement := settlementSnapshot(refs.SupplierSettlement, 31)
	settlement.DefaultSalesSurchargeCents = 0
	params := dbsqlc.InsertVouPurchaseOrderDetailParams{
		DocumentID: documentID, SupplierObjectID: refs.Supplier.ObjectID,
		SupplierApprovalEntryID: refs.Supplier.ApprovalEntryID, SupplierCode: refs.Supplier.Code, SupplierName: refs.Supplier.Data.Name,
		PurchaserObjectID:        stringPtr(refs.Purchaser.ObjectID),
		PurchaserApprovalEntryID: stringPtr(refs.Purchaser.ApprovalEntryID),
		PurchaserCode:            stringPtr(refs.Purchaser.Code), PurchaserName: stringPtr(refs.Purchaser.Data.Name),
		WarehouseObjectID:        stringPtr(refs.Warehouse.ObjectID),
		WarehouseApprovalEntryID: stringPtr(refs.Warehouse.ApprovalEntryID),
		WarehouseCode:            stringPtr(refs.Warehouse.Code), WarehouseName: stringPtr(refs.Warehouse.Data.Name),
		ContactName:              optionalText(refs.Supplier.Data.ContactName),
		ContactPhone:             optionalText(refs.Supplier.Data.ContactPhone),
		SettlementMethodObjectID: settlement.ObjectID,
		SettlementMethodCode:     settlement.Code, SettlementMethodName: settlement.Name,
		SettlementRuleType: settlement.RuleType, SettlementMonthOffset: settlement.MonthOffset,
		SettlementTermCode:   deref(settlement.TermCode),
		SettlementDayOfMonth: settlement.DayOfMonth, SettlementDayOffset: settlement.DayOffset,
		SettlementDueDays: settlement.DueDays, SettlementCutoffDay: settlement.CutoffDay,
		SettlementDefaultSalesSurchargeCents: settlement.DefaultSalesSurchargeCents,
		SettlementDescription:                settlement.Description,
	}
	if update {
		rows, err := q.UpdateVouPurchaseOrderDetail(ctx, dbsqlc.UpdateVouPurchaseOrderDetailParams{
			SupplierObjectID: params.SupplierObjectID, SupplierApprovalEntryID: params.SupplierApprovalEntryID,
			SupplierCode: params.SupplierCode, SupplierName: params.SupplierName,
			PurchaserObjectID: params.PurchaserObjectID, PurchaserApprovalEntryID: params.PurchaserApprovalEntryID,
			PurchaserCode: params.PurchaserCode, PurchaserName: params.PurchaserName,
			WarehouseObjectID: params.WarehouseObjectID, WarehouseApprovalEntryID: params.WarehouseApprovalEntryID,
			WarehouseCode: params.WarehouseCode, WarehouseName: params.WarehouseName,
			ContactName: params.ContactName, ContactPhone: params.ContactPhone,
			SettlementMethodObjectID: params.SettlementMethodObjectID,
			SettlementMethodName:     params.SettlementMethodName,
			SettlementRuleType:       params.SettlementRuleType, SettlementMonthOffset: params.SettlementMonthOffset,
			SettlementTermCode:   params.SettlementTermCode,
			SettlementDayOfMonth: params.SettlementDayOfMonth, SettlementDayOffset: params.SettlementDayOffset,
			SettlementDueDays: params.SettlementDueDays, SettlementCutoffDay: params.SettlementCutoffDay,
			SettlementDefaultSalesSurchargeCents: params.SettlementDefaultSalesSurchargeCents,
			SettlementDescription:                params.SettlementDescription, DocumentID: documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouPurchaseOrderDetail(ctx, params)
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
	if entity == EntitySalesReceipt {
		return s.writeSalesReceiptDetail(ctx, q, documentID, draft, refs, update)
	}
	counterparty := refs.Counterparty
	var otherCategory *string
	if draft.OtherCategory != "" {
		otherCategory = &draft.OtherCategory
	}
	if receiptEntity(entity) {
		params := dbsqlc.InsertVouReceiptDetailParams{
			DocumentID: documentID, Entity: entity, CounterpartyEntity: stringPtr(draft.CounterpartyType),
			CounterpartyObjectID: stringPtr(counterparty.ObjectID), CounterpartyApprovalEntryID: stringPtr(counterparty.ApprovalEntryID),
			CounterpartyCode: stringPtr(counterparty.Code), CounterpartyName: stringPtr(counterparty.Data.Name),
			FundAccountObjectID: refs.FundAccount.ObjectID, FundAccountApprovalEntryID: refs.FundAccount.ApprovalEntryID,
			FundAccountCode: refs.FundAccount.Code, FundAccountName: refs.FundAccount.Data.Name,
			OtherCategory:   otherCategory,
			HandlerObjectID: stringPtr(refs.Handler.ObjectID), HandlerApprovalEntryID: stringPtr(refs.Handler.ApprovalEntryID),
			HandlerCode: stringPtr(refs.Handler.Code), HandlerName: stringPtr(refs.Handler.Data.Name),
		}
		if update {
			rows, err := q.UpdateVouReceiptDetail(ctx, dbsqlc.UpdateVouReceiptDetailParams{
				CounterpartyEntity: params.CounterpartyEntity, CounterpartyObjectID: params.CounterpartyObjectID,
				CounterpartyApprovalEntryID: params.CounterpartyApprovalEntryID, CounterpartyCode: params.CounterpartyCode,
				CounterpartyName: params.CounterpartyName, FundAccountObjectID: params.FundAccountObjectID,
				FundAccountApprovalEntryID: params.FundAccountApprovalEntryID, FundAccountCode: params.FundAccountCode,
				FundAccountName: params.FundAccountName,
				OtherCategory:   params.OtherCategory,
				HandlerObjectID: params.HandlerObjectID, HandlerApprovalEntryID: params.HandlerApprovalEntryID,
				HandlerCode: params.HandlerCode, HandlerName: params.HandlerName, DocumentID: documentID,
			})
			return oneRow(rows, err)
		}
		return q.InsertVouReceiptDetail(ctx, params)
	}
	params := dbsqlc.InsertVouPaymentDetailParams{
		DocumentID: documentID, Entity: entity, CounterpartyEntity: draft.CounterpartyType,
		CounterpartyObjectID: counterparty.ObjectID, CounterpartyApprovalEntryID: counterparty.ApprovalEntryID,
		CounterpartyCode: counterparty.Code, CounterpartyName: counterparty.Data.Name,
		FundAccountObjectID: refs.FundAccount.ObjectID, FundAccountApprovalEntryID: refs.FundAccount.ApprovalEntryID,
		FundAccountCode: refs.FundAccount.Code, FundAccountName: refs.FundAccount.Data.Name,
		OtherCategory:   otherCategory,
		HandlerObjectID: stringPtr(refs.Handler.ObjectID), HandlerApprovalEntryID: stringPtr(refs.Handler.ApprovalEntryID),
		HandlerCode: stringPtr(refs.Handler.Code), HandlerName: stringPtr(refs.Handler.Data.Name),
	}
	if update {
		rows, err := q.UpdateVouPaymentDetail(ctx, dbsqlc.UpdateVouPaymentDetailParams{
			CounterpartyEntity: params.CounterpartyEntity, CounterpartyObjectID: params.CounterpartyObjectID,
			CounterpartyApprovalEntryID: params.CounterpartyApprovalEntryID, CounterpartyCode: params.CounterpartyCode,
			CounterpartyName: params.CounterpartyName, FundAccountObjectID: params.FundAccountObjectID,
			FundAccountApprovalEntryID: params.FundAccountApprovalEntryID, FundAccountCode: params.FundAccountCode,
			FundAccountName: params.FundAccountName,
			OtherCategory:   params.OtherCategory,
			HandlerObjectID: params.HandlerObjectID, HandlerApprovalEntryID: params.HandlerApprovalEntryID,
			HandlerCode: params.HandlerCode, HandlerName: params.HandlerName, DocumentID: documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouPaymentDetail(ctx, params)
}

func (s *Service) writeSalesReceiptDetail(
	ctx context.Context,
	q *dbsqlc.Queries,
	documentID string,
	draft validatedDraft,
	refs resolvedDraft,
	update bool,
) error {
	params := dbsqlc.InsertVouSalesReceiptDetailParams{
		DocumentID:       documentID,
		CustomerObjectID: stringPtr(refs.Customer.ObjectID), CustomerApprovalEntryID: stringPtr(refs.Customer.ApprovalEntryID),
		CustomerCode: stringPtr(refs.Customer.Code), CustomerName: stringPtr(refs.Customer.Data.Name),
		OperatingEntityObjectID: stringPtr(refs.OperatingEntity.ObjectID), OperatingEntityApprovalEntryID: stringPtr(refs.OperatingEntity.ApprovalEntryID),
		OperatingEntityCode: stringPtr(refs.OperatingEntity.Code), OperatingEntityName: stringPtr(refs.OperatingEntity.Data.Name),
		FundAccountObjectID: refs.FundAccount.ObjectID, FundAccountApprovalEntryID: refs.FundAccount.ApprovalEntryID,
		FundAccountCode: refs.FundAccount.Code, FundAccountName: refs.FundAccount.Data.Name,
		HandlerObjectID: stringPtr(refs.Handler.ObjectID), HandlerApprovalEntryID: stringPtr(refs.Handler.ApprovalEntryID),
		HandlerCode: stringPtr(refs.Handler.Code), HandlerName: stringPtr(refs.Handler.Data.Name),
	}
	if update {
		rows, err := q.UpdateVouSalesReceiptDetail(ctx, dbsqlc.UpdateVouSalesReceiptDetailParams{
			CustomerObjectID: params.CustomerObjectID, CustomerApprovalEntryID: params.CustomerApprovalEntryID,
			CustomerCode: params.CustomerCode, CustomerName: params.CustomerName,
			OperatingEntityObjectID: params.OperatingEntityObjectID, OperatingEntityApprovalEntryID: params.OperatingEntityApprovalEntryID,
			OperatingEntityCode: params.OperatingEntityCode, OperatingEntityName: params.OperatingEntityName,
			FundAccountObjectID: params.FundAccountObjectID, FundAccountApprovalEntryID: params.FundAccountApprovalEntryID,
			FundAccountCode: params.FundAccountCode, FundAccountName: params.FundAccountName,
			HandlerObjectID: params.HandlerObjectID, HandlerApprovalEntryID: params.HandlerApprovalEntryID,
			HandlerCode: params.HandlerCode, HandlerName: params.HandlerName, DocumentID: documentID,
		})
		if err = oneRow(rows, err); err != nil {
			return err
		}
		if err = q.DeleteVouSalesReceiptAccountAllocations(ctx, documentID); err != nil {
			return err
		}
	} else if err := q.InsertVouSalesReceiptDetail(ctx, params); err != nil {
		return err
	}
	for index, allocation := range draft.AccountAllocations {
		account := refs.AccountAllocations[index]
		if err := q.InsertVouSalesReceiptAccountAllocation(ctx, dbsqlc.InsertVouSalesReceiptAccountAllocationParams{
			DocumentID: documentID, LineNo: int32(index + 1),
			CustomerObjectID: refs.Customer.ObjectID, CustomerApprovalEntryID: refs.Customer.ApprovalEntryID,
			AccountObjectID: account.ObjectID, AccountApprovalEntryID: account.ApprovalEntryID,
			AccountCode: account.Code, AccountName: account.Data.Name, AmountCents: allocation.Amount,
		}); err != nil {
			return err
		}
	}
	return nil
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
		EmployeeApprovalEntryID: refs.Employee.ApprovalEntryID, EmployeeCode: refs.Employee.Code,
		EmployeeName: refs.Employee.Data.Name,
	}
	if update {
		rows, err := q.UpdateVouExpenseReimbursementDetail(ctx, dbsqlc.UpdateVouExpenseReimbursementDetailParams{
			EmployeeObjectID: params.EmployeeObjectID, EmployeeApprovalEntryID: params.EmployeeApprovalEntryID,
			EmployeeCode: params.EmployeeCode, EmployeeName: params.EmployeeName,
			DocumentID: documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouExpenseReimbursementDetail(ctx, params)
}

func (s *Service) writeEmployeeLoanWriteoffDetail(
	ctx context.Context,
	q *dbsqlc.Queries,
	documentID string,
	refs resolvedDraft,
	update bool,
) error {
	params := dbsqlc.InsertVouEmployeeLoanWriteoffDetailParams{
		DocumentID: documentID, EmployeeObjectID: refs.Employee.ObjectID,
		EmployeeApprovalEntryID: refs.Employee.ApprovalEntryID, EmployeeCode: refs.Employee.Code,
		EmployeeName: refs.Employee.Data.Name,
	}
	if update {
		rows, err := q.UpdateVouEmployeeLoanWriteoffDetail(ctx, dbsqlc.UpdateVouEmployeeLoanWriteoffDetailParams{
			EmployeeObjectID: params.EmployeeObjectID, EmployeeApprovalEntryID: params.EmployeeApprovalEntryID,
			EmployeeCode: params.EmployeeCode, EmployeeName: params.EmployeeName, DocumentID: documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouEmployeeLoanWriteoffDetail(ctx, params)
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
			stringPtr(refs.Counterparty.ApprovalEntryID), stringPtr(refs.Counterparty.Code), stringPtr(refs.Counterparty.Data.Name)
	}
	params := dbsqlc.InsertVouOtherIncomeDetailParams{
		DocumentID: documentID, SourceName: draft.SourceName, CounterpartyEntity: ce,
		CounterpartyObjectID: co, CounterpartyApprovalEntryID: cv, CounterpartyCode: cc, CounterpartyName: cn,
		FundAccountObjectID: refs.FundAccount.ObjectID, FundAccountApprovalEntryID: refs.FundAccount.ApprovalEntryID,
		FundAccountCode: refs.FundAccount.Code, FundAccountName: refs.FundAccount.Data.Name,
		HandlerObjectID: stringPtr(refs.Handler.ObjectID), HandlerApprovalEntryID: stringPtr(refs.Handler.ApprovalEntryID),
		HandlerCode: stringPtr(refs.Handler.Code), HandlerName: stringPtr(refs.Handler.Data.Name),
	}
	if update {
		rows, err := q.UpdateVouOtherIncomeDetail(ctx, dbsqlc.UpdateVouOtherIncomeDetailParams{
			SourceName: params.SourceName, CounterpartyEntity: ce, CounterpartyObjectID: co,
			CounterpartyApprovalEntryID: cv, CounterpartyCode: cc, CounterpartyName: cn,
			FundAccountObjectID: params.FundAccountObjectID, FundAccountApprovalEntryID: params.FundAccountApprovalEntryID,
			FundAccountCode: params.FundAccountCode, FundAccountName: params.FundAccountName,
			HandlerObjectID: params.HandlerObjectID, HandlerApprovalEntryID: params.HandlerApprovalEntryID,
			HandlerCode: params.HandlerCode, HandlerName: params.HandlerName, DocumentID: documentID,
		})
		return oneRow(rows, err)
	}
	return q.InsertVouOtherIncomeDetail(ctx, params)
}
