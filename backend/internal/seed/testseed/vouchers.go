package testseed

import (
	"context"
	"errors"
	"fmt"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

type voucherCreate func() (voudomain.MutationResult, error)

func (s *Seeder) productLine(product voudomain.ReferenceInput, quantity, price string) voudomain.ProductLineInput {
	return voudomain.ProductLineInput{
		Product:         voudomain.ProductReferenceInput{ObjectID: product.ObjectID},
		EnteredQuantity: quantity,
		EnteredUnit:     voudomain.UnitReferenceInput{ObjectID: s.auxRefs["UNT-0002"].ObjectID},
		BaseQuantity:    quantity, UnitPrice: price,
	}
}

func productReference(input voudomain.ReferenceInput) voudomain.ProductReferenceInput {
	return voudomain.ProductReferenceInput{ObjectID: input.ObjectID}
}

func (s *Seeder) productionOutput(
	source string, product *voudomain.ReferenceInput, quantity, loss string,
	material voudomain.ReferenceInput, actual string,
) voudomain.ProductionOutputInput {
	result := voudomain.ProductionOutputInput{
		SourceOrderLineID: source, EnteredQuantity: quantity,
		EnteredUnit:  voudomain.UnitReferenceInput{ObjectID: s.auxRefs["UNT-0002"].ObjectID},
		BaseQuantity: quantity, LossRate: loss,
		Materials: []voudomain.ProductionMaterialInput{{
			FormulaLineNo: 1, ActualMaterial: productReference(material),
			ActualEnteredQuantity: actual,
			ActualEnteredUnit:     voudomain.UnitReferenceInput{ObjectID: s.auxRefs["UNT-0002"].ObjectID},
			ActualBaseQuantity:    actual,
		}},
	}
	if product != nil {
		ref := productReference(*product)
		result.Product = &ref
	}
	return result
}

func (s *Seeder) seedVouchers(ctx context.Context, counts *Counts) error {
	if err := s.seedPurchaseChain(ctx, counts); err != nil {
		return err
	}
	if err := s.seedProductionDocuments(ctx, counts); err != nil {
		return err
	}
	if err := s.seedSalesChain(ctx, counts); err != nil {
		return err
	}
	if err := s.seedFinancialDocuments(ctx, counts); err != nil {
		return err
	}
	return nil
}

func (s *Seeder) seedPurchaseChain(ctx context.Context, counts *Counts) error {
	supplier := s.voucherReference("supplier-effective")
	employee := s.voucherReference("employee-effective")
	warehouse := s.voucherReference("warehouse-effective")
	raw := s.voucherReference("raw-effective")

	order, orderView, result, err := s.ensureVoucher(
		ctx,
		"purchase-complete-order",
		voudomain.EntityPurchaseOrder,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntityPurchaseOrder, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-01", Currency: "CNY", Supplier: &supplier,
				Purchaser: &employee, Warehouse: &warehouse,
				Remark:       "测试完整采购链：已批准采购订单",
				ProductLines: []voudomain.ProductLineInput{s.productLine(raw, "500", "10.00")},
			}}, actorID, requestID("purchase-complete-order", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("purchase complete order: %w", err)
	}
	counts.add(result)
	if len(orderView.Data.ProductLines) != 1 {
		return errors.New("purchase order seed must have one line")
	}
	_, inboundView, result, err := s.ensureVoucher(
		ctx,
		"purchase-complete-inbound",
		voudomain.EntityPurchaseInbound,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.CreatePurchaseInbound(ctx, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-02", SourceDocumentID: order.DocumentID,
				Warehouse: &warehouse, Remark: "测试完整采购链：已批准采购入库",
				SourceLines: []voudomain.SourceQuantityLineInput{{
					SourceLineID: orderView.Data.ProductLines[0].LineID, BaseQuantity: "500",
				}},
			}}, actorID, requestID("purchase-complete-inbound", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("purchase complete inbound: %w", err)
	}
	counts.add(result)
	if len(inboundView.Data.ProductLines) != 1 {
		return errors.New("purchase inbound seed must have one line")
	}
	_, _, result, err = s.ensureVoucher(
		ctx,
		"purchase-complete-return",
		voudomain.EntityPurchaseReturn,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.CreatePurchaseReturn(ctx, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-09", Warehouse: &warehouse,
				ReturnReason: "测试质量退货",
				ReturnLines: []voudomain.ReturnLineInput{{
					SourceLineID: inboundView.Data.ProductLines[0].LineID, BaseQuantity: "20",
				}},
			}}, actorID, requestID("purchase-complete-return", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("purchase complete return: %w", err)
	}
	counts.add(result)

	_, _, result, err = s.ensureVoucher(
		ctx,
		"purchase-draft",
		voudomain.EntityPurchaseOrder,
		voudomain.StatusDraft,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntityPurchaseOrder, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: businessDate, Currency: "CNY", Supplier: &supplier,
				Purchaser: &employee, Warehouse: &warehouse,
				Remark:       "测试可操作草稿：采购订单",
				ProductLines: []voudomain.ProductLineInput{s.productLine(raw, "80", "11.00")},
			}}, actorID, requestID("purchase-draft", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("purchase draft: %w", err)
	}
	counts.add(result)

	openOrder, openView, result, err := s.ensureVoucher(
		ctx,
		"purchase-open-order",
		voudomain.EntityPurchaseOrder,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntityPurchaseOrder, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: businessDate, Currency: "CNY", Supplier: &supplier,
				Purchaser: &employee, Warehouse: &warehouse,
				Remark:       "测试可操作来源：采购入库与退货",
				ProductLines: []voudomain.ProductLineInput{s.productLine(raw, "100", "10.50")},
			}}, actorID, requestID("purchase-open-order", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("purchase open order: %w", err)
	}
	counts.add(result)
	if len(openView.Data.ProductLines) != 1 {
		return errors.New("open purchase order seed must have one line")
	}
	_, _, result, err = s.ensureVoucher(
		ctx,
		"purchase-inbound-draft",
		voudomain.EntityPurchaseInbound,
		voudomain.StatusDraft,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.CreatePurchaseInbound(ctx, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: businessDate, SourceDocumentID: openOrder.DocumentID,
				Warehouse: &warehouse, Remark: "测试可操作草稿：采购入库",
				SourceLines: []voudomain.SourceQuantityLineInput{{
					SourceLineID: openView.Data.ProductLines[0].LineID, BaseQuantity: "40",
				}},
			}}, actorID, requestID("purchase-inbound-draft", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("purchase inbound draft: %w", err)
	}
	counts.add(result)
	_, _, result, err = s.ensureVoucher(
		ctx,
		"purchase-return-draft",
		voudomain.EntityPurchaseReturn,
		voudomain.StatusDraft,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.CreatePurchaseReturn(ctx, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: businessDate, Warehouse: &warehouse,
				ReturnReason: "测试可操作草稿：采购退货",
				ReturnLines: []voudomain.ReturnLineInput{{
					SourceLineID: inboundView.Data.ProductLines[0].LineID, BaseQuantity: "10",
				}},
			}}, actorID, requestID("purchase-return-draft", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("purchase return draft: %w", err)
	}
	counts.add(result)
	if err = s.seedCompletedPurchaseWorkflow(ctx, counts); err != nil {
		return err
	}
	return nil
}

func (s *Seeder) seedCompletedPurchaseWorkflow(ctx context.Context, counts *Counts) error {
	supplier := s.voucherReference("supplier-effective")
	employee := s.voucherReference("employee-effective")
	warehouse := s.voucherReference("warehouse-effective")
	raw := s.voucherReference("raw-effective")
	order, orderView, result, err := s.ensureVoucher(
		ctx,
		"purchase-fulfilled-order",
		voudomain.EntityPurchaseOrder,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntityPurchaseOrder, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-13", Currency: "CNY", Supplier: &supplier,
				Purchaser: &employee, Warehouse: &warehouse,
				Remark:       "测试已批准采购履约流程",
				ProductLines: []voudomain.ProductLineInput{s.productLine(raw, "50", "10.00")},
			}}, actorID, requestID("purchase-fulfilled-order", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("fulfilled purchase order: %w", err)
	}
	counts.add(result)
	if len(orderView.Data.ProductLines) != 1 {
		return errors.New("fulfilled purchase order must have one line")
	}
	_, _, result, err = s.ensureVoucher(
		ctx,
		"purchase-fulfilled-inbound",
		voudomain.EntityPurchaseInbound,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.CreatePurchaseInbound(ctx, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-13", SourceDocumentID: order.DocumentID,
				Warehouse: &warehouse, Remark: "测试已批准采购履约流程：全部入库",
				SourceLines: []voudomain.SourceQuantityLineInput{{
					SourceLineID: orderView.Data.ProductLines[0].LineID, BaseQuantity: "50",
				}},
			}}, actorID, requestID("purchase-fulfilled-inbound", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("fulfilled purchase inbound: %w", err)
	}
	counts.add(result)
	return nil
}

func (s *Seeder) seedProductionDocuments(ctx context.Context, counts *Counts) error {
	customer := s.voucherReference("customer-effective")
	employee := s.voucherReference("employee-effective")
	warehouse := s.voucherReference("warehouse-effective")
	raw := s.voucherReference("raw-effective")
	finished := s.voucherReference("finished-effective")
	formula := s.fixedFormula(raw, "2")

	order, orderView, result, err := s.ensureVoucher(
		ctx,
		"production-source-order",
		voudomain.EntitySaleOrder,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySaleOrder, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-03", Currency: "CNY", Customer: &customer,
				Salesperson: &employee, Warehouse: &warehouse, Remark: "测试生产配货来源订单",
				ProductLines: []voudomain.ProductLineInput{func() voudomain.ProductLineInput {
					line := s.productLine(finished, "40", "80.00")
					line.Formula = formula
					return line
				}()},
			}}, actorID, requestID("production-source-order", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("production source order: %w", err)
	}
	counts.add(result)
	if len(orderView.Data.ProductLines) != 1 {
		return errors.New("production source order must have one line")
	}
	productionData := func(quantity, loss, actual, remark string) voudomain.DraftInput {
		return voudomain.DraftInput{
			BusinessDate: "2026-07-04", MaterialWarehouse: &warehouse,
			FinishedWarehouse: &warehouse, Remark: remark,
			ProductionLines: []voudomain.ProductionOutputInput{
				s.productionOutput(orderView.Data.ProductLines[0].LineID, nil, quantity, loss, raw, actual),
			},
		}
	}
	_, _, result, err = s.ensureVoucher(
		ctx,
		"order-production-approved",
		voudomain.EntityOrderProduction,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntityOrderProduction, voudomain.CreateInput{
				ParentEntity: voudomain.EntitySaleOrder, ParentDocumentID: order.DocumentID,
				Data: productionData("10", "2", "20.4", "测试生产配货：已批准"),
			}, actorID, requestID("order-production-approved", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("approved order production: %w", err)
	}
	counts.add(result)
	_, _, result, err = s.ensureVoucher(
		ctx,
		"order-production-draft",
		voudomain.EntityOrderProduction,
		voudomain.StatusDraft,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntityOrderProduction, voudomain.CreateInput{
				ParentEntity: voudomain.EntitySaleOrder, ParentDocumentID: order.DocumentID,
				Data: productionData("8", "3", "16.48", "测试可操作草稿：生产配货"),
			}, actorID, requestID("order-production-draft", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("draft order production: %w", err)
	}
	counts.add(result)
	selfData := func(quantity, loss, actual, remark string) voudomain.DraftInput {
		return voudomain.DraftInput{
			BusinessDate: "2026-07-04", MaterialWarehouse: &warehouse,
			FinishedWarehouse: &warehouse, Remark: remark,
			ProductionLines: []voudomain.ProductionOutputInput{
				s.productionOutput("", &finished, quantity, loss, raw, actual),
			},
		}
	}
	_, _, result, err = s.ensureVoucher(
		ctx,
		"self-production-approved",
		voudomain.EntitySelfProduction,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySelfProduction, voudomain.CreateInput{
				Data: selfData("20", "5", "42", "测试生产自制品：已批准"),
			}, actorID, requestID("self-production-approved", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("approved self production: %w", err)
	}
	counts.add(result)
	_, _, result, err = s.ensureVoucher(
		ctx,
		"self-production-draft",
		voudomain.EntitySelfProduction,
		voudomain.StatusDraft,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySelfProduction, voudomain.CreateInput{
				Data: selfData("15", "3", "30.9", "测试可操作草稿：生产自制品"),
			}, actorID, requestID("self-production-draft", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("draft self production: %w", err)
	}
	counts.add(result)
	return nil
}

func (s *Seeder) seedSalesChain(ctx context.Context, counts *Counts) error {
	customer := s.voucherReference("customer-effective")
	employee := s.voucherReference("employee-effective")
	warehouse := s.voucherReference("warehouse-effective")
	carrier := s.voucherReference("external-carrier")
	vehicle := s.voucherReference("vehicle-effective")
	raw := s.voucherReference("raw-effective")
	finished := s.voucherReference("finished-effective")

	order, orderView, result, err := s.ensureVoucher(
		ctx,
		"sales-complete-order",
		voudomain.EntitySaleOrder,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySaleOrder, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-05", Currency: "CNY", Customer: &customer,
				Salesperson: &employee, Warehouse: &warehouse, Remark: "测试完整销售履约链",
				ProductLines: []voudomain.ProductLineInput{func() voudomain.ProductLineInput {
					line := s.productLine(finished, "12", "85.00")
					line.Formula = s.fixedFormula(raw, "2")
					return line
				}()},
			}}, actorID, requestID("sales-complete-order", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("sales complete order: %w", err)
	}
	counts.add(result)
	if len(orderView.Data.ProductLines) != 1 {
		return errors.New("sales order seed must have one line")
	}
	outbound, _, result, err := s.ensureVoucher(
		ctx,
		"sales-complete-outbound",
		voudomain.EntitySaleOutbound,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySaleOutbound, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-06", SourceDocumentID: order.DocumentID,
				Warehouse: &warehouse, Remark: "测试完整销售履约链：已出库",
				SourceLines: []voudomain.SourceQuantityLineInput{{
					SourceLineID: orderView.Data.ProductLines[0].LineID, BaseQuantity: "10",
				}},
			}}, actorID, requestID("sales-complete-outbound", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("sales complete outbound: %w", err)
	}
	counts.add(result)
	delivery, _, result, err := s.ensureVoucher(
		ctx,
		"sales-complete-delivery",
		voudomain.EntitySaleDelivery,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySaleDelivery, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-07", SourceDocumentID: outbound.DocumentID,
				Carrier: &carrier, Vehicle: &vehicle, Remark: "测试完整销售履约链：配送中",
			}}, actorID, requestID("sales-complete-delivery", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("sales complete delivery: %w", err)
	}
	counts.add(result)
	deliveryView, err := s.vouchers.Get(
		ctx, voudomain.EntitySaleDelivery, voudomain.GetInput{DocumentID: delivery.DocumentID},
	)
	if err != nil {
		return err
	}
	if len(deliveryView.Data.ProductLines) != 1 {
		return errors.New("sales delivery seed must have one line")
	}
	_, signoffView, result, err := s.ensureVoucher(
		ctx,
		"sales-complete-signoff",
		voudomain.EntitySaleSignoff,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySaleSignoff, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-08", SourceDocumentID: delivery.DocumentID,
				Remark: "测试完整销售履约链：已签收",
				SignoffLines: []voudomain.SaleSignoffLineInput{{
					SourceLineID:       deliveryView.Data.ProductLines[0].LineID,
					SignedBaseQuantity: "10", RejectedBaseQuantity: "0",
				}},
			}}, actorID, requestID("sales-complete-signoff", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("sales complete signoff: %w", err)
	}
	counts.add(result)
	if len(signoffView.Data.SignoffLines) != 1 {
		return errors.New("sales signoff seed must have one line")
	}
	_, _, result, err = s.ensureVoucher(
		ctx,
		"sales-complete-return",
		voudomain.EntitySaleReturn,
		voudomain.StatusApproved,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.CreateSaleReturn(ctx, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: "2026-07-10", Warehouse: &warehouse,
				ReturnReason: "测试售后退货",
				ReturnLines: []voudomain.ReturnLineInput{{
					SourceLineID: signoffView.Data.SignoffLines[0].LineID, BaseQuantity: "2",
				}},
			}}, actorID, requestID("sales-complete-return", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("sales complete return: %w", err)
	}
	counts.add(result)
	_, _, result, err = s.ensureVoucher(
		ctx,
		"sales-return-draft",
		voudomain.EntitySaleReturn,
		voudomain.StatusDraft,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.CreateSaleReturn(ctx, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: businessDate, Warehouse: &warehouse,
				ReturnReason: "测试可操作草稿：销售退货",
				ReturnLines: []voudomain.ReturnLineInput{{
					SourceLineID: signoffView.Data.SignoffLines[0].LineID, BaseQuantity: "1",
				}},
			}}, actorID, requestID("sales-return-draft", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("sales return draft: %w", err)
	}
	counts.add(result)
	_, _, result, err = s.ensureVoucher(
		ctx,
		"sales-order-draft",
		voudomain.EntitySaleOrder,
		voudomain.StatusDraft,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySaleOrder, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: businessDate, Currency: "CNY", Customer: &customer,
				Salesperson: &employee, Warehouse: &warehouse, Remark: "测试可操作草稿：销售订单",
				ProductLines: []voudomain.ProductLineInput{func() voudomain.ProductLineInput {
					line := s.productLine(finished, "20", "88.00")
					line.Formula = s.fixedFormula(raw, "2")
					return line
				}()},
			}}, actorID, requestID("sales-order-draft", "create"))
		},
	)
	if err != nil {
		return fmt.Errorf("sales order draft: %w", err)
	}
	counts.add(result)
	return nil
}

func (s *Seeder) seedFinancialDocuments(ctx context.Context, counts *Counts) error {
	customer := s.voucherReference("customer-effective")
	supplier := s.voucherReference("supplier-effective")
	employee := s.voucherReference("employee-effective")
	fund := s.voucherReference("fund-effective")
	type financialSample struct {
		key, entity string
		target      string
		data        voudomain.DraftInput
	}
	samples := []financialSample{
		{
			"receipt-approved", voudomain.EntitySalesReceipt, voudomain.StatusApproved,
			voudomain.DraftInput{
				BusinessDate: "2026-07-11", Currency: "CNY",
				CounterpartyType: "customer-account", Counterparty: &customer,
				FundAccount: &fund, Handler: &employee, Amount: "1200.00",
				Remark: "测试往来收款：已批准",
			},
		},
		{
			"receipt-draft", voudomain.EntitySalesReceipt, voudomain.StatusDraft,
			voudomain.DraftInput{
				BusinessDate: businessDate, Currency: "CNY",
				CounterpartyType: "customer-account", Counterparty: &customer,
				FundAccount: &fund, Handler: &employee, Amount: "300.00",
				Remark: "测试可操作草稿：往来收款",
			},
		},
		{
			"payment-approved", voudomain.EntityPurchasePayment, voudomain.StatusApproved,
			voudomain.DraftInput{
				BusinessDate: "2026-07-11", Currency: "CNY",
				CounterpartyType: "supplier", Counterparty: &supplier,
				FundAccount: &fund, Handler: &employee, Amount: "800.00",
				Remark: "测试往来付款：已批准",
			},
		},
		{
			"payment-draft", voudomain.EntityPurchasePayment, voudomain.StatusDraft,
			voudomain.DraftInput{
				BusinessDate: businessDate, Currency: "CNY",
				CounterpartyType: "supplier", Counterparty: &supplier,
				FundAccount: &fund, Handler: &employee, Amount: "200.00",
				Remark: "测试可操作草稿：往来付款",
			},
		},
		{
			"expense-approved", voudomain.EntityExpenseReimbursement, voudomain.StatusApproved,
			voudomain.DraftInput{
				BusinessDate: "2026-07-12", Currency: "CNY",
				FundAccount: &fund, Employee: &employee,
				ExpenseLines: []voudomain.ExpenseLineInput{
					{Category: "交通", Description: "客户现场交通费", Amount: "120.00"},
					{Category: "住宿", Description: "客户现场住宿费", Amount: "380.00"},
				},
				Remark: "测试费用报销：已批准",
			},
		},
		{
			"expense-draft", voudomain.EntityExpenseReimbursement, voudomain.StatusDraft,
			voudomain.DraftInput{
				BusinessDate: businessDate, Currency: "CNY",
				FundAccount: &fund, Employee: &employee,
				ExpenseLines: []voudomain.ExpenseLineInput{{
					Category: "交通", Description: "测试可编辑费用", Amount: "50.00",
				}},
				Remark: "测试可操作草稿：费用报销",
			},
		},
		{
			"income-approved", voudomain.EntityOtherIncome, voudomain.StatusApproved,
			voudomain.DraftInput{
				BusinessDate: "2026-07-12", Currency: "CNY",
				CounterpartyType: "customer-account", Counterparty: &customer,
				FundAccount: &fund, Handler: &employee, SourceName: "废料处置",
				Amount: "600.00", Remark: "测试其他收入：已批准",
			},
		},
		{
			"income-draft", voudomain.EntityOtherIncome, voudomain.StatusDraft,
			voudomain.DraftInput{
				BusinessDate: businessDate, Currency: "CNY",
				CounterpartyType: "customer-account", Counterparty: &customer,
				FundAccount: &fund, Handler: &employee, SourceName: "服务收入",
				Amount: "180.00", Remark: "测试可操作草稿：其他收入",
			},
		},
	}
	for _, sample := range samples {
		sample := sample
		_, _, result, err := s.ensureVoucher(
			ctx,
			sample.key,
			sample.entity,
			sample.target,
			func() (voudomain.MutationResult, error) {
				return s.vouchers.Create(
					ctx,
					sample.entity,
					voudomain.CreateInput{Data: sample.data},
					actorID,
					requestID(sample.key, "create"),
				)
			},
		)
		if err != nil {
			return fmt.Errorf("%s: %w", sample.key, err)
		}
		counts.add(result)
	}
	return nil
}

func (s *Seeder) ensureVoucher(
	ctx context.Context,
	key, entity, targetStatus string,
	create voucherCreate,
) (voudomain.MutationResult, voudomain.DocumentView, outcome, error) {
	var documentID string
	err := s.pool.QueryRow(ctx, `
		SELECT document_id
		FROM vou_audit_events
		WHERE request_id=$1 AND event_type IN ('CREATED','SAVED')
		ORDER BY occurred_at,id
		LIMIT 1
	`, requestID(key, "create")).Scan(&documentID)
	created := false
	var current voudomain.MutationResult
	if errors.Is(err, pgx.ErrNoRows) {
		current, err = create()
		if err != nil {
			return current, voudomain.DocumentView{}, 0, err
		}
		documentID = current.DocumentID
		created = true
	} else if err != nil {
		return current, voudomain.DocumentView{}, 0, err
	}
	view, err := s.vouchers.Get(ctx, entity, voudomain.GetInput{DocumentID: documentID})
	if err != nil {
		return current, voudomain.DocumentView{}, 0, err
	}
	current = voudomain.MutationResult{
		DocumentID: view.DocumentID, DocumentNo: view.DocumentNo,
		Status: view.Status, Revision: view.Revision,
	}
	currentRank, currentKnown := voucherStatusRank(current.Status)
	targetRank, targetKnown := voucherStatusRank(targetStatus)
	if !currentKnown || !targetKnown {
		return current, view, 0, fmt.Errorf("unsupported status %s -> %s", current.Status, targetStatus)
	}
	if currentRank >= targetRank {
		if created {
			return current, view, outcomeCreated, nil
		}
		return current, view, outcomeSkipped, nil
	}
	var external int
	if err = s.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM vou_audit_events
		WHERE document_id=$1 AND request_id NOT LIKE $2
	`, documentID, seedPrefix+"%").Scan(&external); err != nil {
		return current, view, 0, err
	}
	if external > 0 {
		return current, view, outcomeSkipped, nil
	}
	current, err = s.advanceVoucher(ctx, key, entity, current, targetStatus)
	if err != nil {
		return current, view, 0, err
	}
	view, err = s.vouchers.Get(ctx, entity, voudomain.GetInput{DocumentID: documentID})
	if err != nil {
		return current, view, 0, err
	}
	if created {
		return current, view, outcomeCreated, nil
	}
	return current, view, outcomeResumed, nil
}

func (s *Seeder) advanceVoucher(
	ctx context.Context,
	key, entity string,
	current voudomain.MutationResult,
	targetStatus string,
) (voudomain.MutationResult, error) {
	targetRank, _ := voucherStatusRank(targetStatus)
	currentRank, _ := voucherStatusRank(current.Status)
	for currentRank < targetRank {
		var err error
		switch current.Status {
		case voudomain.StatusDraft:
			current, err = s.vouchers.Check(ctx, entity, voudomain.DocumentRevisionInput{
				DocumentID: current.DocumentID, Revision: current.Revision,
			}, actorID, requestID(key, "check"))
		case voudomain.StatusChecked:
			current, err = s.vouchers.Approve(ctx, entity, voudomain.DocumentRevisionInput{
				DocumentID: current.DocumentID, Revision: current.Revision,
			}, actorID, requestID(key, "approve"))
		default:
			return current, fmt.Errorf("cannot advance %s from %s", entity, current.Status)
		}
		if err != nil {
			return current, err
		}
		currentRank, _ = voucherStatusRank(current.Status)
	}
	return current, nil
}

func voucherStatusRank(status string) (int, bool) {
	switch status {
	case voudomain.StatusDraft:
		return 0, true
	case voudomain.StatusChecked:
		return 1, true
	case voudomain.StatusApproved:
		return 2, true
	default:
		return 0, false
	}
}

func (s *Seeder) voucherReference(key string) voudomain.ReferenceInput {
	view := s.bobRefs[key]
	return voudomain.ReferenceInput{ObjectID: view.ObjectID, VersionID: view.Version.VersionID}
}

func (s *Seeder) fixedFormula(
	raw voudomain.ReferenceInput,
	quantity string,
) *voudomain.FormulaInput {
	unit := voudomain.UnitReferenceInput{ObjectID: s.auxRefs["UNT-0002"].ObjectID}
	return &voudomain.FormulaInput{
		Output: voudomain.QuantitySnapshotInput{
			EnteredQuantity: "1", EnteredUnit: unit, BaseQuantity: "1",
		},
		SourceType: "PRODUCT_FIXED",
		Components: []voudomain.FormulaComponentInput{{
			Material: productReference(raw),
			Quantity: voudomain.QuantitySnapshotInput{
				EnteredQuantity: quantity, EnteredUnit: unit, BaseQuantity: quantity,
			},
		}},
	}
}
