//go:build integration

package acc

import (
	"errors"
	"testing"
	"time"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/oklog/ulid/v2"
)

func TestZZControlBookFundsAndSettlementBalancesIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)
	fundAccountID, customerID := ulid.Make().String(), ulid.Make().String()

	type bookSubjects struct {
		book          BookView
		cash, expense SubjectView
	}
	createBook := func(name string, opening bool) bookSubjects {
		book, err := service.CreateBook(t.Context(), CreateBookInput{Name: name, StartMonth: "2026-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
		if err != nil {
			t.Fatal(err)
		}
		cash, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "1002", Name: "银行存款", BalanceDirection: BalanceDirectionDebit, Enabled: true, RequiredDimensions: []string{DimensionFundAccount}, SettlementPurpose: SettlementPurposeNone}, adminID)
		if err != nil {
			t.Fatal(err)
		}
		expense, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "6602", Name: "管理费用", BalanceDirection: BalanceDirectionDebit, Enabled: true, RequiredDimensions: []string{}, SettlementPurpose: SettlementPurposeNone}, adminID)
		if err != nil {
			t.Fatal(err)
		}
		if opening {
			advance, createErr := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "2203", Name: "预收账款", BalanceDirection: BalanceDirectionCredit, Enabled: true, RequiredDimensions: []string{DimensionCustomerAccount}, SettlementPurpose: SettlementPurposeAdvanceReceipt}, adminID)
			if createErr != nil {
				t.Fatal(createErr)
			}
			other, createErr := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "2241", Name: "其他应付款", BalanceDirection: BalanceDirectionCredit, Enabled: true, RequiredDimensions: []string{DimensionCustomerAccount}, SettlementPurpose: SettlementPurposeOther}, adminID)
			if createErr != nil {
				t.Fatal(createErr)
			}
			draft, saveErr := service.SaveOpening(t.Context(), SaveOpeningInput{BookID: book.ID, Lines: []OpeningLineInput{
				{SubjectID: cash.ID, Currency: "CNY", DebitAmount: "150.00", CreditAmount: "0", Dimensions: map[string]string{DimensionFundAccount: fundAccountID}},
				{SubjectID: advance.ID, Currency: "CNY", DebitAmount: "0", CreditAmount: "80.00", Dimensions: map[string]string{DimensionCustomerAccount: customerID}},
				{SubjectID: other.ID, Currency: "CNY", DebitAmount: "0", CreditAmount: "70.00", Dimensions: map[string]string{DimensionCustomerAccount: customerID}},
			}}, adminID)
			if saveErr != nil {
				t.Fatal(saveErr)
			}
			if _, err = service.ApproveOpening(t.Context(), book.ID, draft.Revision, adminID); err != nil {
				t.Fatal(err)
			}
		} else {
			createApprovedZeroOpening(t, service, book)
		}
		templateID := "payment"
		mapping, err := service.CreateMapping(t.Context(), CreateMappingInput{BookID: book.ID, VouEntity: voudomain.EntityOtherPayment, DefaultResult: MappingResultPost, Definition: MappingDefinition{DefaultTemplateID: &templateID, Templates: []PostingTemplate{{ID: templateID, Lines: []PostingLineTemplate{
			{SubjectSource: "FIXED", SubjectValue: expense.ID, Direction: BalanceDirectionDebit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
			{SubjectSource: "FIXED", SubjectValue: cash.ID, Direction: BalanceDirectionCredit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{DimensionFundAccount: "fundAccount.objectId"}},
		}}}}}, adminID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = service.ApproveMapping(t.Context(), book.ID, mapping.ID, mapping.Revision, adminID); err != nil {
			t.Fatal(err)
		}
		return bookSubjects{book: book, cash: cash, expense: expense}
	}

	control := createBook("资金控制账", true)
	nonControl := createBook("资金管理账", false)
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	advance, err := service.PartyBalance(t.Context(), tx, voudomain.PartyBalanceQuery{CounterpartyDimension: DimensionCustomerAccount, CounterpartyObjectID: customerID, Currency: "CNY", SettlementPurpose: SettlementPurposeAdvanceReceipt, AsOfDate: time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)})
	if err != nil {
		_ = tx.Rollback(t.Context())
		t.Fatal(err)
	}
	receivable, err := service.PartyBalance(t.Context(), tx, voudomain.PartyBalanceQuery{CounterpartyDimension: DimensionCustomerAccount, CounterpartyObjectID: customerID, Currency: "CNY", SettlementPurpose: SettlementPurposeReceivable, AsOfDate: time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)})
	_ = tx.Rollback(t.Context())
	if err != nil || advance != 8000 || receivable != 0 {
		t.Fatalf("settlement balances advance=%d receivable=%d err=%v", advance, receivable, err)
	}

	approvePayment := func(amount string, wantFailure bool) {
		documentID := ulid.Make().String()
		snapshot := voudomain.DocumentView{DocumentID: documentID, Entity: voudomain.EntityOtherPayment, DocumentNo: "PAY-" + documentID, Status: voudomain.StatusApproved, Revision: 3, Amount: amount, Data: voudomain.DocumentDataView{BusinessDate: "2026-07-25", Currency: "CNY", FundAccount: &voudomain.ReferenceView{ObjectID: fundAccountID}}}
		event := voudomain.DocumentApprovedEvent{Entity: snapshot.Entity, DocumentID: documentID, DocumentNo: snapshot.DocumentNo, Revision: snapshot.Revision, Snapshot: snapshot}
		eventTx, beginErr := pool.Begin(t.Context())
		if beginErr != nil {
			t.Fatal(beginErr)
		}
		deliveryErr := service.HandleDocumentApproved(t.Context(), eventTx, event)
		if wantFailure {
			_ = eventTx.Rollback(t.Context())
			var rejection *txevent.RejectionError
			if !errors.As(deliveryErr, &rejection) || rejection.Error() != "insufficient control book funds" {
				t.Fatalf("fund rejection = %#v", deliveryErr)
			}
			return
		}
		if deliveryErr != nil {
			_ = eventTx.Rollback(t.Context())
			t.Fatal(deliveryErr)
		}
		if commitErr := eventTx.Commit(t.Context()); commitErr != nil {
			t.Fatal(commitErr)
		}
	}
	approvePayment("100.00", false)
	approvePayment("60.00", true)

	var controlBalance, nonControlBalance int64
	queryBalance := `SELECT COALESCE(sum(line.debit_minor-line.credit_minor),0)::bigint FROM acc_voucher_lines line WHERE line.book_id=$1 AND line.subject_id=$2 AND line.dimensions->>'FUND_ACCOUNT'=$3`
	if err = pool.QueryRow(t.Context(), queryBalance, control.book.ID, control.cash.ID, fundAccountID).Scan(&controlBalance); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), queryBalance, nonControl.book.ID, nonControl.cash.ID, fundAccountID).Scan(&nonControlBalance); err != nil {
		t.Fatal(err)
	}
	if controlBalance != 5000 || nonControlBalance != -10000 {
		t.Fatalf("fund balances control=%d noncontrol=%d", controlBalance, nonControlBalance)
	}
}
