//go:build integration

package acc

import (
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/oklog/ulid/v2"
)

func TestZZSalesReceiptSplitsReceivableAndAdvanceByAccountIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := defaultIntegrationACCService(pool)
	book, err := service.CreateBook(t.Context(), CreateBookInput{Name: "销售收款控制账", StartMonth: "2026-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	cash, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "1002", Name: "银行存款", BalanceDirection: BalanceDirectionDebit, Enabled: true, RequiredDimensions: []string{DimensionFundAccount}, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	receivable, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "1122", Name: "应收账款", BalanceDirection: BalanceDirectionDebit, Enabled: true, RequiredDimensions: []string{DimensionCustomerSubunit}, SettlementPurpose: SettlementPurposeReceivable}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	advance, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "2203", Name: "预收账款", BalanceDirection: BalanceDirectionCredit, Enabled: true, RequiredDimensions: []string{DimensionCustomerSubunit}, SettlementPurpose: SettlementPurposeAdvanceReceipt}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	equity, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "4001", Name: "期初权益", BalanceDirection: BalanceDirectionCredit, Enabled: true, RequiredDimensions: []string{}, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	subunitA := createAccountingCustomerSubunitSnapshot(t, pool, "客户子单位甲")
	subunitB := createAccountingCustomerSubunitSnapshot(t, pool, "客户子单位乙")
	fundID := ulid.Make().String()
	opening, err := service.SaveOpening(t.Context(), SaveOpeningInput{BookID: book.ID, Lines: []OpeningLineInput{
		{SubjectID: receivable.ID, Currency: "CNY", DebitAmount: "70.00", CreditAmount: "0", Dimensions: map[string]string{DimensionCustomerSubunit: subunitA.ObjectID}, DimensionReferences: map[string]BusinessArchiveDimensionReference{DimensionCustomerSubunit: {Entity: "customer-subunit", ObjectID: subunitA.ObjectID, CustomerID: subunitA.CustomerID, ApprovalEntryID: subunitA.ApprovalEntryID, Code: subunitA.Code, Name: subunitA.Name}}},
		{SubjectID: receivable.ID, Currency: "CNY", DebitAmount: "20.00", CreditAmount: "0", Dimensions: map[string]string{DimensionCustomerSubunit: subunitB.ObjectID}, DimensionReferences: map[string]BusinessArchiveDimensionReference{DimensionCustomerSubunit: {Entity: "customer-subunit", ObjectID: subunitB.ObjectID, CustomerID: subunitB.CustomerID, ApprovalEntryID: subunitB.ApprovalEntryID, Code: subunitB.Code, Name: subunitB.Name}}},
		{SubjectID: equity.ID, Currency: "CNY", DebitAmount: "0", CreditAmount: "90.00", Dimensions: map[string]string{}},
	}}, integrationACCActor(t, adminID, "sales-receipt-opening-save"))
	if err != nil {
		t.Fatal(err)
	}
	approveIntegrationOpening(t, service, book.ID, opening)

	collection, templateID := "subunitAllocations", "sales-receipt-subunits"
	mapping, err := createDCLIntegrationMapping(t, service, dclMappingFixtureInput{BookID: book.ID, VouEntity: voudomain.EntitySalesReceipt, DefaultResult: MappingResultPost, Definition: MappingDefinition{DefaultTemplateID: &templateID, Templates: []PostingTemplate{{ID: templateID, Collection: &collection, Lines: []PostingLineTemplate{
		{SubjectSource: "FIXED", SubjectValue: cash.ID, Direction: BalanceDirectionDebit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{DimensionFundAccount: "fundAccount.objectId"}},
		{SubjectSource: "FIXED", SubjectValue: receivable.ID, Direction: BalanceDirectionCredit, AmountField: "receivableApplied", CurrencyField: "currency", Dimensions: map[string]string{DimensionCustomerSubunit: "subunit.objectId"}},
		{SubjectSource: "FIXED", SubjectValue: advance.ID, Direction: BalanceDirectionCredit, AmountField: "advanceReceipt", CurrencyField: "currency", Dimensions: map[string]string{DimensionCustomerSubunit: "subunit.objectId"}},
	}}}}}, integrationACCActor(t, adminID, "sales-receipt-mapping-create"))
	if err != nil {
		t.Fatal(err)
	}
	approveIntegrationMapping(t, service, book.ID, voudomain.EntitySalesReceipt, mapping)

	documentID := ulid.Make().String()
	event := approvedVOUEvent(voudomain.DocumentView{DocumentID: documentID, Entity: voudomain.EntitySalesReceipt, DocumentNo: "SRC-20260724-0001", Approval: approval.Meta{Status: approval.StatusApproved, Revision: 3}, Amount: "150.00", Data: voudomain.DocumentDataView{
		BusinessDate: "2026-07-24", Currency: "CNY", FundAccount: &voudomain.ReferenceView{ObjectID: fundID},
		SubunitAllocations: []voudomain.SalesReceiptSubunitAllocationView{
			{Subunit: voudomain.ReferenceView{ObjectID: subunitA.ObjectID, CustomerID: subunitA.CustomerID, Entity: "customer-subunit", ApprovalEntryID: subunitA.ApprovalEntryID, Code: subunitA.Code, Name: subunitA.Name}, Amount: "100.00"},
			{Subunit: voudomain.ReferenceView{ObjectID: subunitB.ObjectID, CustomerID: subunitB.CustomerID, Entity: "customer-subunit", ApprovalEntryID: subunitB.ApprovalEntryID, Code: subunitB.Code, Name: subunitB.Name}, Amount: "50.00"},
		},
	}})
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if err = service.HandleDocumentApproved(t.Context(), tx, event); err != nil {
		_ = tx.Rollback(t.Context())
		t.Fatal(err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}

	assertAmount := func(subjectID, subunitID string, wantDebit, wantCredit int64) {
		t.Helper()
		var debit, credit int64
		err = pool.QueryRow(t.Context(), `SELECT COALESCE(sum(line.debit_minor),0),COALESCE(sum(line.credit_minor),0) FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.id=line.voucher_id WHERE voucher.source_id=$1 AND line.subject_id=$2 AND ($3='' OR line.dimensions->>'CUSTOMER_SUBUNIT'=$3)`, documentID, subjectID, subunitID).Scan(&debit, &credit)
		if err != nil || debit != wantDebit || credit != wantCredit {
			t.Fatalf("subject %s subunit %s amount=%d/%d want=%d/%d err=%v", subjectID, subunitID, debit, credit, wantDebit, wantCredit, err)
		}
	}
	assertAmount(cash.ID, "", 15000, 0)
	assertAmount(receivable.ID, subunitA.ObjectID, 0, 7000)
	assertAmount(receivable.ID, subunitB.ObjectID, 0, 2000)
	assertAmount(advance.ID, subunitA.ObjectID, 0, 3000)
	assertAmount(advance.ID, subunitB.ObjectID, 0, 3000)
	var stored BusinessArchiveDimensionReference
	if err = pool.QueryRow(t.Context(), `SELECT line.dimension_references->'CUSTOMER_SUBUNIT' FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.id=line.voucher_id WHERE voucher.source_id=$1 AND line.subject_id=$2 AND line.dimensions->>'CUSTOMER_SUBUNIT'=$3 LIMIT 1`, documentID, receivable.ID, subunitA.ObjectID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored.ObjectID != subunitA.ObjectID || stored.CustomerID != subunitA.CustomerID || stored.ApprovalEntryID != subunitA.ApprovalEntryID || stored.Code != subunitA.Code || stored.Name != subunitA.Name {
		t.Fatalf("stored customer subunit snapshot = %#v, want %#v", stored, subunitA)
	}
}
