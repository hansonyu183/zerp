//go:build integration

package acc

import (
	"errors"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/oklog/ulid/v2"
)

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
		VALUES ('01JACC00000000000000000999', $1, 'COST_SETTLEMENT', 'later-fact', '2026-08-02', $2)
	`, book.ID, adminID); err != nil {
		t.Fatalf("insert later accounting fact: %v", err)
	}
	if _, err = service.UnapproveOpening(t.Context(), book.ID, approved.Revision, adminID); !IsKind(err, ErrorConflict) {
		t.Fatalf("unapprove with later fact error = %v", err)
	}
}

func TestAccountingOpeningCreatesAndAssociatesGlobalRegistersIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)
	assetID, billID, customerID := ulid.Make().String(), ulid.Make().String(), ulid.Make().String()
	partyID, partyVersionID := ulid.Make().String(), ulid.Make().String()

	createBookOpening := func(name string, createObjects bool, assetValue, billValue string) OpeningView {
		book, err := service.CreateBook(t.Context(), CreateBookInput{Name: name, StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
		if err != nil {
			t.Fatal(err)
		}
		asset := createOpeningSubject(t, service, book.ID, "1601", "固定资产", BalanceDirectionDebit, []string{DimensionAsset})
		accumulated := createOpeningSubject(t, service, book.ID, "1602", "累计折旧", BalanceDirectionCredit, []string{DimensionAsset})
		expense := createOpeningSubject(t, service, book.ID, "660201", "折旧费", BalanceDirectionDebit, []string{DimensionDepartment})
		bill := createOpeningSubject(t, service, book.ID, "1121", "应收票据", BalanceDirectionDebit, []string{DimensionBill})
		equity := createOpeningSubject(t, service, book.ID, "4001", "实收资本", BalanceDirectionCredit, nil)
		mapping, err := service.CreateMapping(t.Context(), CreateMappingInput{BookID: book.ID, VouEntity: voudomain.EntityAssetAcquisition, DefaultResult: MappingResultUnpost, Definition: MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}, AssetConfiguration: &AssetAccountingConfiguration{
			AssetSubjectID: asset.ID, AssetDimensions: map[string]string{DimensionAsset: "lineId"}, AccumulatedDepreciationSubjectID: accumulated.ID, AccumulatedDepreciationDimensions: map[string]string{DimensionAsset: "lineId"}, DepreciationExpenseSubjectID: expense.ID, DepreciationExpenseDimensions: map[string]string{DimensionDepartment: "department.objectId"},
		}}}, adminID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = service.ApproveMapping(t.Context(), book.ID, mapping.ID, mapping.Revision, adminID); err != nil {
			t.Fatal(err)
		}
		assets := []OpeningAssetInput{{AssetID: assetID, Currency: "CNY", OriginalValue: assetValue, AccumulatedDepreciation: "0.00"}}
		bills := []OpeningBillInput{{BillID: billID, Currency: "CNY", ValueAmount: billValue}}
		containers := []OpeningContainerInput{}
		if createObjects {
			assets[0].AssetNo, assets[0].Name, assets[0].CategoryID, assets[0].DepartmentID = "FA-OPEN-001", "期初设备", ulid.Make().String(), ulid.Make().String()
			assets[0].UsefulLifeMonths, assets[0].ResidualRate, assets[0].AcquiredOn = 60, "0.05", "2026-08-01"
			bills[0] = OpeningBillInput{BillID: billID, BillNo: "BILL-OPEN-001", BillType: "BANK_ACCEPTANCE", PositionType: "ASSET", Medium: "ELECTRONIC", Currency: "CNY", FaceAmount: "50.00", IssueDate: "2026-08-01", MaturityDate: "2026-12-01", Drawer: "出票人", Acceptor: "承兑人", Payee: "收款人", InterestAmount: "0.00", CustomerCostAmount: "0.00", ValueAmount: billValue, OriginatingParty: OpeningPartyInput{Entity: "CUSTOMER", ObjectID: partyID, ApprovalEntryID: partyVersionID, Code: "C001", Name: "期初客户"}}
			containers = []OpeningContainerInput{{CustomerID: customerID, ContainerType: "SOLVENT", Quantity: 8}}
		}
		assetMinor, _ := fixeddecimal.ParsePositive(assetValue, 2, false)
		billMinor, _ := fixeddecimal.ParsePositive(billValue, 2, false)
		opening, err := service.SaveOpening(t.Context(), SaveOpeningInput{BookID: book.ID, Revision: 0, Lines: []OpeningLineInput{
			{SubjectID: asset.ID, Currency: "CNY", DebitAmount: fixeddecimal.Format(assetMinor, 2, false), CreditAmount: "0.00", Dimensions: map[string]string{DimensionAsset: assetID}},
			{SubjectID: bill.ID, Currency: "CNY", DebitAmount: fixeddecimal.Format(billMinor, 2, false), CreditAmount: "0.00", Dimensions: map[string]string{DimensionBill: billID}},
			{SubjectID: equity.ID, Currency: "CNY", DebitAmount: "0.00", CreditAmount: fixeddecimal.Format(assetMinor+billMinor, 2, false), Dimensions: map[string]string{}},
		}, Assets: assets, Bills: bills, Containers: containers}, adminID)
		if err != nil {
			t.Fatal(err)
		}
		approved, err := service.ApproveOpening(t.Context(), book.ID, opening.Revision, adminID)
		if err != nil {
			t.Fatalf("approve %s opening: %v cause=%v", name, err, errors.Unwrap(err))
		}
		return approved
	}

	first := createBookOpening("全局对象期初一", true, "100.00", "50.00")
	_ = createBookOpening("全局对象期初二", false, "80.00", "40.00")
	var assets, assetValues, bills, billValues, containers int
	if err := pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM acc_assets WHERE id=$1),(SELECT count(*) FROM acc_asset_book_values WHERE asset_id=$1),(SELECT count(*) FROM acc_bills WHERE id=$2),(SELECT count(*) FROM acc_bill_book_values WHERE bill_id=$2),(SELECT count(*) FROM acc_container_entries WHERE customer_id=$3)`, assetID, billID, customerID).Scan(&assets, &assetValues, &bills, &billValues, &containers); err != nil {
		t.Fatal(err)
	}
	if assets != 1 || assetValues != 2 || bills != 1 || billValues != 2 || containers != 1 {
		t.Fatalf("opening registers assets=%d assetValues=%d bills=%d billValues=%d containers=%d", assets, assetValues, bills, billValues, containers)
	}
	if _, err := service.UnapproveOpening(t.Context(), first.BookID, first.Revision, adminID); !IsKind(err, ErrorConflict) {
		t.Fatalf("unapprove shared opening error = %v", err)
	}
}

func createOpeningSubject(t *testing.T, service *Service, bookID, code, name, direction string, dimensions []string) SubjectView {
	t.Helper()
	subject, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: bookID, Code: code, Name: name, BalanceDirection: direction, Enabled: true, RequiredDimensions: dimensions, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	return subject
}

func strptr(value string) *string { return &value }
