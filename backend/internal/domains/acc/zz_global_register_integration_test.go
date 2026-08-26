//go:build integration

package acc

import (
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/oklog/ulid/v2"
)

func TestZZGlobalAssetRegisterIgnoresPerBookUnpostAndReversesIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := defaultIntegrationACCService(pool)
	books := make([]BookView, 0, 2)
	for _, name := range []string{"资产控制账", "资产管理账"} {
		book, err := service.CreateBook(t.Context(), CreateBookInput{Name: name, StartMonth: "2026-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
		if err != nil {
			t.Fatal(err)
		}
		createApprovedZeroOpening(t, service, book)
		mapping, err := service.CreateMapping(t.Context(), CreateMappingInput{
			BookID: book.ID, VouEntity: voudomain.EntityAssetAcquisition,
			DefaultResult: MappingResultUnpost,
			Definition:    MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}},
		}, integrationACCActor(t, adminID, "acc-global-register-mapping-create-"+book.ID))
		if err != nil {
			t.Fatal(err)
		}
		approveIntegrationMapping(t, service, book.ID, voudomain.EntityAssetAcquisition, mapping)
		books = append(books, book)
	}
	lineID := ulid.Make().String()
	documentID := ulid.Make().String()
	snapshot := voudomain.DocumentView{
		DocumentID: documentID, Entity: voudomain.EntityAssetAcquisition, DocumentNo: "FAA-20260720-0001",
		Approval: approval.Meta{Status: approval.StatusApproved, Revision: 3},
		Data: voudomain.DocumentDataView{BusinessDate: "2026-07-20", Currency: "CNY", AssetAcquisitionLines: []voudomain.AssetAcquisitionLineView{{
			LineID: lineID, AssetName: "反应釜", Category: voudomain.ReferenceView{ObjectID: ulid.Make().String()}, Department: voudomain.ReferenceView{ObjectID: ulid.Make().String()}, OriginalValue: "12000.00", UsefulLifeMonths: 60, ResidualRate: "5.00",
		}}},
	}
	event := approvedVOUEvent(snapshot)
	deliverApprovalEvent(t, pool, service, event, false)
	deliverApprovalEvent(t, pool, service, event, false)
	var assets, values, vouchers, residualRateBPS int
	if err := pool.QueryRow(t.Context(), `SELECT count(*), COALESCE(max(residual_rate_bps),0) FROM acc_assets WHERE id=$1 AND state='ACTIVE'`, lineID).Scan(&assets, &residualRateBPS); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_asset_book_values WHERE asset_id=$1`, lineID).Scan(&values); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_vouchers WHERE source_id=$1`, documentID).Scan(&vouchers); err != nil {
		t.Fatal(err)
	}
	if assets != 1 || values != len(books) || vouchers != 0 {
		t.Fatalf("global asset facts = asset:%d values:%d vouchers:%d", assets, values, vouchers)
	}
	if residualRateBPS != 500 {
		t.Fatalf("global asset residual rate = %d bps, want 500", residualRateBPS)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if err = service.HandleDocumentUnapproved(t.Context(), tx, unapprovedVOUEvent(snapshot)); err != nil {
		_ = tx.Rollback(t.Context())
		t.Fatal(err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_assets WHERE id=$1`, lineID).Scan(&assets); err != nil || assets != 0 {
		t.Fatalf("assets after reversal = %d, err=%v", assets, err)
	}
}
