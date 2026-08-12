//go:build integration

package acc

import "testing"

func TestAccountingOpeningTrialApprovalAndReversalIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)
	book, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "期初测试", StartMonth: "2026-08", BaseCurrency: "CNY",
		SubjectTemplate: SubjectTemplateEmpty,
		QueryUserIDs:    []string{queryID}, OperateUserIDs: []string{operatorID},
	}, adminID)
	if err != nil {
		t.Fatalf("create book: %v", err)
	}
	cash, err := service.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "1001", Name: "库存现金",
		BalanceDirection: BalanceDirectionDebit, Enabled: true,
		RequiredDimensions: []string{DimensionFundAccount}, SettlementPurpose: SettlementPurposeNone,
	}, operatorID)
	if err != nil {
		t.Fatalf("create cash subject: %v", err)
	}
	equity, err := service.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "3001", Name: "实收资本",
		BalanceDirection: BalanceDirectionCredit, Enabled: true,
		SettlementPurpose: SettlementPurposeNone,
	}, operatorID)
	if err != nil {
		t.Fatalf("create equity subject: %v", err)
	}

	opening, err := service.GetOpening(t.Context(), book.ID, queryID)
	if err != nil || opening.State != OpeningStateDraft || opening.Revision != 0 || len(opening.Lines) != 0 {
		t.Fatalf("initial opening = %+v, err = %v", opening, err)
	}
	opening, err = service.SaveOpening(t.Context(), SaveOpeningInput{
		BookID: book.ID, Revision: opening.Revision,
		Lines: []OpeningLineInput{{
			SubjectID: cash.ID, Currency: "CNY", DebitAmount: "100.00", CreditAmount: "0.00",
			Dimensions: map[string]string{DimensionFundAccount: "01JACC00000000000000000901"},
		}},
	}, operatorID)
	if err != nil {
		t.Fatalf("save unbalanced draft: %v", err)
	}
	if _, err = service.ApproveOpening(t.Context(), book.ID, opening.Revision, operatorID); !IsKind(err, ErrorConflict) {
		t.Fatalf("approve unbalanced opening error = %v", err)
	}
	opening, err = service.SaveOpening(t.Context(), SaveOpeningInput{
		BookID: book.ID, Revision: opening.Revision,
		Lines: []OpeningLineInput{
			{
				SubjectID: cash.ID, Currency: "CNY", DebitAmount: "100.00", CreditAmount: "0.00",
				Dimensions: map[string]string{DimensionFundAccount: "01JACC00000000000000000901"},
			},
			{SubjectID: equity.ID, Currency: "CNY", DebitAmount: "0.00", CreditAmount: "100.00", Dimensions: map[string]string{}},
		},
	}, operatorID)
	if err != nil {
		t.Fatalf("save balanced opening: %v", err)
	}
	approved, err := service.ApproveOpening(t.Context(), book.ID, opening.Revision, operatorID)
	if err != nil || approved.State != OpeningStateApproved || approved.VoucherID == nil {
		t.Fatalf("approve opening = %+v, err = %v", approved, err)
	}
	ready, err := service.IsBookReadyForPosting(t.Context(), book.ID)
	if err != nil || !ready {
		t.Fatalf("book ready = %v, err = %v", ready, err)
	}
	cashAfter, err := service.GetSubject(t.Context(), book.ID, cash.ID, queryID)
	if err != nil || !cashAfter.Referenced {
		t.Fatalf("opening subject reference = %+v, err = %v", cashAfter, err)
	}
	if _, err = service.SaveOpening(t.Context(), SaveOpeningInput{BookID: book.ID, Revision: approved.Revision}, queryID); !IsKind(err, ErrorForbidden) {
		t.Fatalf("query-only opening save error = %v", err)
	}
	reopened, err := service.UnapproveOpening(t.Context(), book.ID, approved.Revision, operatorID)
	if err != nil || reopened.State != OpeningStateDraft || reopened.VoucherID != nil {
		t.Fatalf("unapprove opening = %+v, err = %v", reopened, err)
	}
	ready, err = service.IsBookReadyForPosting(t.Context(), book.ID)
	if err != nil || ready {
		t.Fatalf("book ready after unapprove = %v, err = %v", ready, err)
	}
}

func TestAccountingOpeningInventoryValidationZeroApprovalAndLaterFactGuardIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)
	book, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "零期初", StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty,
	}, adminID)
	if err != nil {
		t.Fatalf("create book: %v", err)
	}
	inventory, err := service.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "1405", Name: "库存商品", BalanceDirection: BalanceDirectionDebit,
		Enabled: true, RequiredDimensions: []string{DimensionProduct, DimensionWarehouse},
		InventoryQuantity: true, SettlementPurpose: SettlementPurposeNone,
	}, adminID)
	if err != nil {
		t.Fatalf("create inventory subject: %v", err)
	}
	if _, err = service.SaveOpening(t.Context(), SaveOpeningInput{
		BookID: book.ID, Revision: 0,
		Lines: []OpeningLineInput{{
			SubjectID: inventory.ID, Currency: "CNY", DebitAmount: "10.00", CreditAmount: "0.00",
			Quantity: strptr("0"), Dimensions: map[string]string{DimensionProduct: "01JACC00000000000000000902"},
		}},
	}, adminID); !IsKind(err, ErrorValidation) {
		t.Fatalf("invalid inventory opening error = %v", err)
	}
	approved, err := service.ApproveOpening(t.Context(), book.ID, 0, adminID)
	if err != nil || approved.State != OpeningStateApproved || len(approved.Lines) != 0 || approved.VoucherID == nil {
		t.Fatalf("zero opening approval = %+v, err = %v", approved, err)
	}
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO acc_vouchers (id, book_id, source_type, source_id, business_date, created_by)
		VALUES ('01JACC00000000000000000999', $1, 'VOU', 'vou-after-opening', '2026-08-02', $2)
	`, book.ID, adminID); err != nil {
		t.Fatalf("insert later accounting fact: %v", err)
	}
	if _, err = service.UnapproveOpening(t.Context(), book.ID, approved.Revision, adminID); !IsKind(err, ErrorConflict) {
		t.Fatalf("unapprove with later fact error = %v", err)
	}
}

func strptr(value string) *string { return &value }
