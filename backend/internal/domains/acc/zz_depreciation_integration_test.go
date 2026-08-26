//go:build integration

package acc

import (
	"errors"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/oklog/ulid/v2"
)

func TestZZPeriodDepreciationBalancesAndUnlockIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := defaultIntegrationACCService(pool)
	book, err := service.CreateBook(t.Context(), CreateBookInput{Name: "折旧账", StartMonth: "2026-06", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	asset, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "1601", Name: "固定资产", BalanceDirection: BalanceDirectionDebit, Enabled: true, RequiredDimensions: []string{DimensionAsset}, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	accumulated, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "1602", Name: "累计折旧", BalanceDirection: BalanceDirectionCredit, Enabled: true, RequiredDimensions: []string{DimensionAsset}, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	expense, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "660201", Name: "折旧费", BalanceDirection: BalanceDirectionDebit, Enabled: true, RequiredDimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	createApprovedZeroOpening(t, service, book)
	mapping, err := service.CreateMapping(t.Context(), CreateMappingInput{BookID: book.ID, VouEntity: voudomain.EntityAssetAcquisition, DefaultResult: MappingResultUnpost, Definition: MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}, AssetConfiguration: &AssetAccountingConfiguration{
		AssetSubjectID: asset.ID, AssetDimensions: map[string]string{DimensionAsset: "lineId"}, AccumulatedDepreciationSubjectID: accumulated.ID, AccumulatedDepreciationDimensions: map[string]string{DimensionAsset: "lineId"}, DepreciationExpenseSubjectID: expense.ID, DepreciationExpenseDimensions: map[string]string{DimensionDepartment: "department.objectId"},
	}}}, integrationACCActor(t, adminID, "acc-depreciation-mapping-create"))
	if err != nil {
		t.Fatal(err)
	}
	approveIntegrationMapping(t, service, book.ID, voudomain.EntityAssetAcquisition, mapping)
	assetID, departmentID := ulid.Make().String(), ulid.Make().String()
	snapshot := voudomain.DocumentView{DocumentID: ulid.Make().String(), Entity: voudomain.EntityAssetAcquisition, DocumentNo: "ACQ-JUNE", Approval: approval.Meta{Status: approval.StatusApproved, Revision: 3}, Data: voudomain.DocumentDataView{BusinessDate: "2026-06-15", Currency: "CNY", AssetAcquisitionLines: []voudomain.AssetAcquisitionLineView{{LineID: assetID, AssetName: "设备", Category: voudomain.ReferenceView{ObjectID: ulid.Make().String()}, Department: voudomain.ReferenceView{ObjectID: departmentID}, OriginalValue: "120.00", UsefulLifeMonths: 12, ResidualRate: "0"}}}}
	deliverApprovalEvent(t, pool, service, approvedVOUEvent(snapshot), false)
	june, err := service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2026-06", Revision: 0}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	_ = june
	july, err := service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2026-07", Revision: 0}, adminID)
	if err != nil {
		t.Fatalf("lock July depreciation: %v cause=%v", err, errors.Unwrap(err))
	}
	var depreciation int64
	var entries, balances int
	if err = pool.QueryRow(t.Context(), `SELECT COALESCE(sum(amount_minor),0),count(*) FROM acc_depreciation_entries WHERE book_id=$1 AND period_month='2026-07-01'`, book.ID).Scan(&depreciation, &entries); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_period_balances WHERE book_id=$1 AND period_month='2026-07-01'`, book.ID).Scan(&balances); err != nil {
		t.Fatal(err)
	}
	if depreciation != 1000 || entries != 1 || balances != 2 {
		t.Fatalf("depreciation=%d entries=%d balances=%d", depreciation, entries, balances)
	}
	if _, err = service.UnlockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2026-07", Revision: july.Revision}, adminID); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT accumulated_depreciation_minor FROM acc_asset_book_values WHERE book_id=$1 AND asset_id=$2`, book.ID, assetID).Scan(&depreciation); err != nil || depreciation != 0 {
		t.Fatalf("accumulated after unlock=%d err=%v", depreciation, err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_period_balances WHERE book_id=$1 AND period_month='2026-07-01'`, book.ID).Scan(&balances); err != nil || balances != 0 {
		t.Fatalf("balances after unlock=%d err=%v", balances, err)
	}
}
