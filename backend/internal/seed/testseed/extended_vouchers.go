package testseed

import (
	"context"
	"fmt"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Seeder) seedExtendedVouchers(ctx context.Context, counts *Counts) error {
	customer := s.voucherReference("customer-effective")
	supplier := s.voucherReference("supplier-effective")
	otherUnit := s.voucherReference("other-unit-effective")
	employee := s.voucherReference("employee-effective")
	warehouse := s.voucherReference("warehouse-effective")
	fund := s.voucherReference("fund-effective")
	raw := s.voucherReference("raw-effective")
	finished := s.voucherReference("finished-effective")

	samples := []struct {
		key, entity, target string
		data                voudomain.DraftInput
	}{
		{"sale-pricing-approved", voudomain.EntitySalePricing, voudomain.StatusApproved, voudomain.DraftInput{
			BusinessDate: "2026-07-01", Currency: "CNY", Remark: "测试销售价格来源",
			PriceLines: []voudomain.PriceLineInput{{Product: productReference(finished), UnitPrice: "96.00"}},
		}},
		{"purchase-inquiry-approved", voudomain.EntityPurchaseInquiry, voudomain.StatusApproved, voudomain.DraftInput{
			BusinessDate: "2026-07-01", Currency: "CNY", Supplier: &supplier,
			Remark:     "测试采购询价来源",
			PriceLines: []voudomain.PriceLineInput{{Product: productReference(raw), UnitPrice: "18.00"}},
		}},
		{"inventory-count-draft", voudomain.EntityInventoryCount, voudomain.StatusDraft, voudomain.DraftInput{
			BusinessDate: businessDate, Currency: "CNY", Warehouse: &warehouse,
			Remark: "测试可操作草稿：库存盘点",
			InventoryCountLines: []voudomain.InventoryCountLineInput{{
				Product: productReference(finished), EnteredQuantity: "6",
				EnteredUnit: voudomain.UnitReferenceInput{ObjectID: s.auxRefs["UNT-0002"].ObjectID}, BaseQuantity: "6",
			}},
		}},
		{"purchase-refund-draft", voudomain.EntityPurchaseRefund, voudomain.StatusDraft, cashDraft(supplier, fund, employee, "200.00", "测试可操作草稿：采购退款")},
		{"other-receipt-draft", voudomain.EntityOtherReceipt, voudomain.StatusDraft, otherCashDraft("other-unit", otherUnit, fund, employee, "160.00", "COMMISSION", "测试可操作草稿：其他收款")},
		{"sales-refund-draft", voudomain.EntitySalesRefund, voudomain.StatusDraft, cashDraft(customer, fund, employee, "120.00", "测试可操作草稿：销售退款")},
		{"other-payment-draft", voudomain.EntityOtherPayment, voudomain.StatusDraft, otherCashDraft("other-unit", otherUnit, fund, employee, "90.00", "INTERMEDIARY", "测试可操作草稿：其他付款")},
		{"employee-loan-draft", voudomain.EntityEmployeeLoan, voudomain.StatusDraft, cashDraft(employee, fund, employee, "500.00", "测试可操作草稿：员工借款")},
		{"employee-repayment-draft", voudomain.EntityEmployeeRepayment, voudomain.StatusDraft, cashDraft(employee, fund, employee, "100.00", "测试可操作草稿：员工还款")},
		{"employee-writeoff-draft", voudomain.EntityEmployeeLoanWriteoff, voudomain.StatusDraft, voudomain.DraftInput{
			BusinessDate: businessDate, Currency: "CNY", Employee: &employee,
			Remark:       "测试可操作草稿：员工借款核销",
			ExpenseLines: []voudomain.ExpenseLineInput{{Category: "差旅", Description: "借款核销", Amount: "80.00"}},
		}},
		{"accounting-income-approved", voudomain.EntityOtherIncome, voudomain.StatusApproved, voudomain.DraftInput{
			BusinessDate: "2026-07-13", Currency: "CNY",
			CounterpartyType: bobdomain.EntityCustomerSubunit, Counterparty: &customer,
			FundAccount: &fund, Handler: &employee, SourceName: "会计联动测试",
			Amount: "88.00", Remark: "测试 ACC/RPT 过账样本",
		}},
	}
	for _, sample := range samples {
		sample := sample
		_, _, result, err := s.ensureVoucher(ctx, sample.key, sample.entity, sample.target, func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, sample.entity, voudomain.CreateInput{Data: sample.data}, mustApprovalActor(requestID(sample.key, "create")))
		})
		if err != nil {
			return fmt.Errorf("%s: %w", sample.key, err)
		}
		counts.add(result)
	}
	if err := s.seedAssetDocuments(ctx, counts, supplier, customer, employee); err != nil {
		return err
	}
	if err := s.seedBillDocuments(ctx, counts, customer, supplier, otherUnit, employee, fund); err != nil {
		return err
	}
	if err := s.seedIntermediaryCalculation(ctx, counts); err != nil {
		return err
	}
	return nil
}

func cashDraft(counterparty, fund, handler voudomain.ReferenceInput, amount, remark string) voudomain.DraftInput {
	return voudomain.DraftInput{
		BusinessDate: businessDate, Currency: "CNY", Counterparty: &counterparty,
		FundAccount: &fund, Handler: &handler, Amount: amount, Remark: remark,
	}
}

func otherCashDraft(counterpartyType string, counterparty, fund, handler voudomain.ReferenceInput, amount, category, remark string) voudomain.DraftInput {
	result := cashDraft(counterparty, fund, handler, amount, remark)
	result.CounterpartyType = counterpartyType
	result.OtherCategory = category
	return result
}

func (s *Seeder) seedAssetDocuments(ctx context.Context, counts *Counts, supplier, customer, employee voudomain.ReferenceInput) error {
	category := s.auxRefs["asset-category-test"]
	department := s.auxRefs["department-root"]
	acquisition, _, result, err := s.ensureVoucher(ctx, "asset-acquisition-approved", voudomain.EntityAssetAcquisition, voudomain.StatusApproved, func() (voudomain.MutationResult, error) {
		return s.vouchers.Create(ctx, voudomain.EntityAssetAcquisition, voudomain.CreateInput{Data: voudomain.DraftInput{
			BusinessDate: "2026-07-02", Currency: "CNY", Supplier: &supplier,
			Remark: "测试固定资产来源",
			AssetAcquisitionLines: []voudomain.AssetAcquisitionLineInput{
				{AssetName: "测试叉车", Specification: "FD-30", Category: voudomain.AuxiliaryReferenceInput{ObjectID: category.ObjectID}, OriginalValue: "50000.00", UsefulLifeMonths: 60, ResidualRate: "5.00", Department: voudomain.AuxiliaryReferenceInput{ObjectID: department.ObjectID}, Custodian: &employee, Location: "一号仓"},
				{AssetName: "测试包装机", Specification: "PK-01", Category: voudomain.AuxiliaryReferenceInput{ObjectID: category.ObjectID}, OriginalValue: "30000.00", UsefulLifeMonths: 60, ResidualRate: "5.00", Department: voudomain.AuxiliaryReferenceInput{ObjectID: department.ObjectID}, Custodian: &employee, Location: "包装区"},
			},
		}}, mustApprovalActor(requestID("asset-acquisition-approved", "create")))
	})
	if err != nil {
		return fmt.Errorf("asset acquisition: %w", err)
	}
	counts.add(result)
	assetIDs, err := s.queries.ListAccountingAssetIDsBySourceDocument(ctx, acquisition.DocumentID)
	if err != nil {
		return err
	}
	if len(assetIDs) != 2 {
		return fmt.Errorf("asset acquisition registered %d assets, want 2", len(assetIDs))
	}
	assetSamples := []struct {
		key, entity string
		data        voudomain.DraftInput
	}{
		{"asset-sale-draft", voudomain.EntityAssetSale, voudomain.DraftInput{BusinessDate: businessDate, Currency: "CNY", CounterpartyType: bobdomain.EntityCustomerSubunit, Counterparty: &customer, Remark: "测试可操作草稿：资产出让", AssetSaleLines: []voudomain.AssetSaleLineInput{{AssetID: assetIDs[0], SaleAmount: "42000.00"}}}},
		{"asset-liquidation-draft", voudomain.EntityAssetLiquidation, voudomain.DraftInput{BusinessDate: businessDate, Currency: "CNY", Remark: "测试可操作草稿：资产清算", AssetLiquidationLines: []voudomain.AssetLiquidationLineInput{{AssetID: assetIDs[1], Reason: "设备更新", SalvageIncome: "3000.00", DisposalExpense: "500.00"}}}},
	}
	for _, sample := range assetSamples {
		sample := sample
		_, _, seedResult, seedErr := s.ensureVoucher(ctx, sample.key, sample.entity, voudomain.StatusDraft, func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, sample.entity, voudomain.CreateInput{Data: sample.data}, mustApprovalActor(requestID(sample.key, "create")))
		})
		if seedErr != nil {
			return fmt.Errorf("%s: %w", sample.key, seedErr)
		}
		counts.add(seedResult)
	}
	return nil
}

func (s *Seeder) seedBillDocuments(
	ctx context.Context,
	counts *Counts,
	customer, supplier, otherUnit, employee, fund voudomain.ReferenceInput,
) error {
	assetReceipt, _, result, err := s.ensureVoucher(ctx, "bill-receipt-approved", voudomain.EntityBillReceipt, voudomain.StatusApproved, func() (voudomain.MutationResult, error) {
		return s.vouchers.Create(ctx, voudomain.EntityBillReceipt, voudomain.CreateInput{Data: voudomain.DraftInput{
			BusinessDate: "2026-07-03", Currency: "CNY", Counterparty: &customer,
			Handler: &employee, InternalCostRateBps: 365, Remark: "测试应收票据来源",
			BillLines: []voudomain.BillLineInput{{PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY", BillType: "BANK_ACCEPTANCE", BillNo: "TEST-AR-001", Medium: "ELECTRONIC", Currency: "CNY", FaceAmount: "10000.00", IssueDate: "2026-07-01", MaturityDate: "2026-09-30", Drawer: "星河制造有限公司", Acceptor: "测试银行", Payee: "本公司", AnnualRateBps: 120}},
		}}, mustApprovalActor(requestID("bill-receipt-approved", "create")))
	})
	if err != nil {
		return fmt.Errorf("bill receipt: %w", err)
	}
	counts.add(result)
	liabilityIssue, _, result, err := s.ensureVoucher(ctx, "bill-issue-approved", voudomain.EntityBillIssue, voudomain.StatusApproved, func() (voudomain.MutationResult, error) {
		return s.vouchers.Create(ctx, voudomain.EntityBillIssue, voudomain.CreateInput{Data: voudomain.DraftInput{
			BusinessDate: "2026-07-03", Currency: "CNY", Supplier: &supplier,
			InterestMode: "BANK_DEDUCTED", Remark: "测试应付票据来源",
			BillLines: []voudomain.BillLineInput{{PositionType: "LIABILITY", Direction: "IN", Purpose: "PRIMARY", BillType: "BANK_ACCEPTANCE", BillNo: "TEST-AP-001", Medium: "ELECTRONIC", Currency: "CNY", FaceAmount: "8000.00", IssueDate: "2026-07-01", MaturityDate: "2026-09-30", Drawer: "本公司", Acceptor: "测试银行", Payee: "启明供应链有限公司", AnnualRateBps: 100}},
		}}, mustApprovalActor(requestID("bill-issue-approved", "create")))
	})
	if err != nil {
		return fmt.Errorf("bill issue: %w", err)
	}
	counts.add(result)
	var assetBillID, liabilityBillID string
	if assetBillID, err = s.queries.FindAccountingBillIDBySourceDocument(ctx, assetReceipt.DocumentID); err != nil {
		return fmt.Errorf("load asset bill: %w", err)
	}
	if liabilityBillID, err = s.queries.FindAccountingBillIDBySourceDocument(ctx, liabilityIssue.DocumentID); err != nil {
		return fmt.Errorf("load liability bill: %w", err)
	}
	billSamples := []struct {
		key, entity string
		data        voudomain.DraftInput
	}{
		{"bill-payment-draft", voudomain.EntityBillPayment, voudomain.DraftInput{BusinessDate: businessDate, Currency: "CNY", Supplier: &supplier, Remark: "测试可操作草稿：票据付出", BillLines: []voudomain.BillLineInput{{BillID: assetBillID, Purpose: "PRIMARY"}}}},
		{"bill-discount-draft", voudomain.EntityBillDiscount, voudomain.DraftInput{BusinessDate: businessDate, Currency: "CNY", CounterpartyType: bobdomain.EntityOtherUnit, Counterparty: &otherUnit, InterestMode: "BANK_DEDUCTED", WithRecourse: true, Remark: "测试可操作草稿：票据贴现", BillLines: []voudomain.BillLineInput{{BillID: assetBillID, Purpose: "PRIMARY", AnnualRateBps: 365}}, BillCashLines: []voudomain.BillCashLineInput{{FundAccount: fund, Direction: "IN", AmountType: "PRINCIPAL", Amount: "9800.00"}}}},
		{"bill-maturity-draft", voudomain.EntityBillMaturity, voudomain.DraftInput{BusinessDate: "2026-09-30", Currency: "CNY", MaturityType: "PAYMENT", Remark: "测试可操作草稿：票据到期", BillLines: []voudomain.BillLineInput{{BillID: liabilityBillID, Purpose: "PRIMARY"}}, BillCashLines: []voudomain.BillCashLineInput{{FundAccount: fund, Direction: "OUT", AmountType: "PRINCIPAL", Amount: "8000.00"}}}},
	}
	for _, sample := range billSamples {
		sample := sample
		_, _, seedResult, seedErr := s.ensureVoucher(ctx, sample.key, sample.entity, voudomain.StatusDraft, func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, sample.entity, voudomain.CreateInput{Data: sample.data}, mustApprovalActor(requestID(sample.key, "create")))
		})
		if seedErr != nil {
			return fmt.Errorf("%s: %w", sample.key, seedErr)
		}
		counts.add(seedResult)
	}
	return nil
}

func (s *Seeder) seedIntermediaryCalculation(ctx context.Context, counts *Counts) error {
	periodOccupied, err := s.queries.VouEntityExistsOnBusinessDate(ctx, dbsqlc.VouEntityExistsOnBusinessDateParams{
		Entity:       voudomain.EntityIntermediaryCalculation,
		BusinessDate: pgtype.Date{Time: time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC), Valid: true},
	})
	if err != nil {
		return fmt.Errorf("find intermediary calculation period: %w", err)
	}
	if periodOccupied {
		counts.add(outcomeSkipped)
		return nil
	}
	source, err := s.vouchers.IntermediarySource(ctx, voudomain.IntermediarySourceInput{BusinessDate: "2026-06-30"})
	if err != nil {
		return fmt.Errorf("intermediary source: %w", err)
	}
	script, err := s.vouchers.GetIntermediaryScript(ctx)
	if err != nil {
		return fmt.Errorf("intermediary script: %w", err)
	}
	lines := make([]voudomain.IntermediaryResultLine, 0, len(source.Source.Lines))
	for _, sourceLine := range source.Source.Lines {
		lines = append(lines, voudomain.IntermediaryResultLine{
			SourceSignoffLineID: sourceLine.SourceSignoffLineID,
			PremiumUnitPrice:    "0.00", StandardPieceQuantity: sourceLine.StandardPieceQuantity,
			BaseCommission: "0.00", PremiumCommission: "0.00", LowPriceCommission: "0.00",
			MarketMaintenanceSubsidy: "0.00", MarketDevelopmentSubsidy: "0.00",
			BillCost: "0.00", BillLineIDs: []string{}, EmployeeAmount: "0.00", IntermediaryAmount: "0.00",
		})
	}
	_, _, result, err := s.ensureVoucher(ctx, "intermediary-calculation-draft", voudomain.EntityIntermediaryCalculation, voudomain.StatusDraft, func() (voudomain.MutationResult, error) {
		return s.vouchers.CreateIntermediaryCalculation(ctx, voudomain.CreateInput{Data: voudomain.DraftInput{
			BusinessDate: "2026-06-30", Currency: "CNY", Remark: "测试可操作草稿：居间计算",
			IntermediaryCalculation: &voudomain.IntermediaryCalculationInput{
				Source: source.Source, SourceHash: source.SourceHash, Script: script,
				Result: voudomain.IntermediaryCalculationResult{Lines: lines, Summaries: []voudomain.IntermediarySummary{}},
			},
		}}, mustApprovalActor(requestID("intermediary-calculation-draft", "create")))
	})
	if err != nil {
		return fmt.Errorf("intermediary calculation: %w", err)
	}
	counts.add(result)
	return nil
}
