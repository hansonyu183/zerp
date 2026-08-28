//go:build integration

package app

import (
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/oklog/ulid/v2"
)

func TestWorkbenchQueryIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	bus := txevent.NewBus()
	authorizer := authorization.Func(nil)
	auxiliary := auxdomain.NewService(pool)
	bobService := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	declarations := dcldomain.NewOperatingEntityService(pool, bobService, authorizer, bus)
	warehouses := dcldomain.NewWarehouseService(pool, bobService, authorizer, bus)
	fundAccounts := dcldomain.NewFundAccountService(pool, bobService, authorizer, bus)
	products := dcldomain.NewProductService(pool, bobService, authorizer, bus)
	actor := func(id, requestID string) approval.Actor {
		result, actorErr := approval.UserActor(authorization.Principal{ActorID: id}, requestID)
		if actorErr != nil {
			t.Fatalf("create workbench actor: %v", actorErr)
		}
		return result
	}
	suffix := ulid.Make().String()[20:]
	draftName := "工作台草稿-" + suffix
	pendingName := "工作台待批准-" + suffix

	draft, err := warehouses.Create(t.Context(), dcldomain.WarehouseCreateInput{
		Data: dcldomain.WarehouseData{Name: draftName},
	}, actor(admin.ID, "workbench-create-draft"))
	if err != nil {
		t.Fatalf("create draft object: %v", err)
	}
	pending, err := warehouses.Create(t.Context(), dcldomain.WarehouseCreateInput{
		Data: dcldomain.WarehouseData{Name: pendingName},
	}, actor(admin.ID, "workbench-create-pending"))
	if err != nil {
		t.Fatalf("create pending object: %v", err)
	}
	if _, err = warehouses.Submit(t.Context(), dcldomain.WarehouseVersionInput{
		ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision,
	}, actor(admin.ID, "workbench-submit-pending")); err != nil {
		t.Fatalf("submit pending object: %v", err)
	}
	operating, err := declarations.Create(t.Context(), dcldomain.OperatingEntityCreateInput{
		Data: dcldomain.OperatingEntityData{Name: "工作台经营主体-" + suffix},
	}, actor(admin.ID, "workbench-create-operating"))
	if err != nil {
		t.Fatalf("create operating entity: %v", err)
	}
	operatingSubmitted, err := declarations.Submit(t.Context(), dcldomain.OperatingEntityVersionInput{
		ObjectID: operating.ObjectID, ApprovalEntryID: operating.Approval.ApprovalEntryID, ApprovalRevision: operating.Approval.Revision,
	}, actor(admin.ID, "workbench-submit-operating"))
	if err != nil {
		t.Fatalf("submit operating entity: %v", err)
	}
	if _, err = declarations.Approve(t.Context(), dcldomain.OperatingEntityVersionInput{
		ObjectID: operating.ObjectID, ApprovalEntryID: operatingSubmitted.Approval.ApprovalEntryID, ApprovalRevision: operatingSubmitted.Approval.Revision,
	}, actor(ulid.Make().String(), "workbench-approve-operating")); err != nil {
		t.Fatalf("approve operating entity: %v", err)
	}
	fund, err := fundAccounts.Create(t.Context(), dcldomain.FundAccountCreateInput{
		Data: dcldomain.FundAccountData{Name: "工作台资金账户-" + suffix, Currency: "CNY", OperatingEntityID: operating.ObjectID},
	}, actor(admin.ID, "workbench-create-fund"))
	if err != nil {
		t.Fatalf("create fund account: %v", err)
	}
	fundSubmitted, err := fundAccounts.Submit(t.Context(), dcldomain.FundAccountVersionInput{
		ObjectID: fund.ObjectID, ApprovalEntryID: fund.Approval.ApprovalEntryID, ApprovalRevision: fund.Approval.Revision,
	}, actor(admin.ID, "workbench-submit-fund"))
	if err != nil {
		t.Fatalf("submit fund account: %v", err)
	}
	reviewerID := ulid.Make().String()
	if _, err = fundAccounts.Approve(t.Context(), dcldomain.FundAccountVersionInput{
		ObjectID: fund.ObjectID, ApprovalEntryID: fundSubmitted.Approval.ApprovalEntryID, ApprovalRevision: fundSubmitted.Approval.Revision,
	}, actor(reviewerID, "workbench-approve-fund")); err != nil {
		t.Fatalf("approve fund account: %v", err)
	}
	fundView, err := bobService.Get(t.Context(), bobdomain.EntityFundAccount, bobdomain.GetInput{ObjectID: fund.ObjectID})
	if err != nil {
		t.Fatalf("get fund account: %v", err)
	}
	dclPending, err := declarations.Create(t.Context(), dcldomain.OperatingEntityCreateInput{
		Data: dcldomain.OperatingEntityData{Name: "工作台经营主体待审核-" + suffix},
	}, actor(admin.ID, "workbench-create-dcl-pending"))
	if err != nil {
		t.Fatalf("create DCL pending operating entity: %v", err)
	}
	dclPending, err = declarations.Submit(t.Context(), dcldomain.OperatingEntityVersionInput{
		ObjectID: dclPending.ObjectID, ApprovalEntryID: dclPending.Approval.ApprovalEntryID,
		ApprovalRevision: dclPending.Approval.Revision,
	}, actor(admin.ID, "workbench-submit-dcl-pending"))
	if err != nil {
		t.Fatalf("submit DCL pending operating entity: %v", err)
	}
	productInput := func(name string) dcldomain.ProductInput {
		const productTypeID = "01JPTP00000000000000000001"
		const unitID = "01JAVX00000000000000000011"
		return dcldomain.ProductInput{
			Name: name, ProductTypeID: productTypeID,
			DefaultInputUnitID: unitID, PricingUnitID: unitID,
			UnitConversions: []bobdomain.ProductUnitConversion{{
				Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: unitID}, Factor: "1",
			}},
			DefaultPackagingSpec: "1",
		}
	}
	productDraft, err := products.Create(t.Context(), dcldomain.ProductCreateInput{
		Data: productInput("工作台产品草稿-" + suffix),
	}, actor(admin.ID, "workbench-create-product-draft"))
	if err != nil {
		t.Fatalf("create DCL draft product: %v", err)
	}
	productPending, err := products.Create(t.Context(), dcldomain.ProductCreateInput{
		Data: productInput("工作台产品待审核-" + suffix),
	}, actor(admin.ID, "workbench-create-product-pending"))
	if err != nil {
		t.Fatalf("create DCL pending product: %v", err)
	}
	productPending, err = products.Submit(t.Context(), dcldomain.ProductVersionInput{
		ObjectID: productPending.ObjectID, ApprovalEntryID: productPending.Approval.ApprovalEntryID,
		ApprovalRevision: productPending.Approval.Revision,
	}, actor(admin.ID, "workbench-submit-product-pending"))
	if err != nil {
		t.Fatalf("submit DCL pending product: %v", err)
	}

	baseSequence := int(time.Now().UnixNano()%9000) + 1
	documentPrefix := "OIN-20991231"
	documentIDs := []string{ulid.Make().String(), ulid.Make().String(), ulid.Make().String()}
	documentApprovalEntryIDs := []string{ulid.Make().String(), ulid.Make().String(), ulid.Make().String()}
	slices.Sort(documentIDs[:2])
	documentIDs[0], documentIDs[1] = documentIDs[1], documentIDs[0]
	documentNos := []string{
		fmt.Sprintf("%s-%04d", documentPrefix, baseSequence),
		fmt.Sprintf("%s-%04d", documentPrefix, baseSequence+1),
		fmt.Sprintf("%s-%04d", documentPrefix, baseSequence+2),
	}
	allObjectIDs := []string{
		draft.ObjectID, pending.ObjectID, operating.ObjectID, fund.ObjectID, dclPending.ObjectID,
		productDraft.ObjectID, productPending.ObjectID,
	}
	allApprovalEntryIDs := []string{
		draft.Approval.ApprovalEntryID, pending.Approval.ApprovalEntryID,
		operatingSubmitted.Approval.ApprovalEntryID, fundSubmitted.Approval.ApprovalEntryID,
		dclPending.Approval.ApprovalEntryID, productDraft.Approval.ApprovalEntryID,
		productPending.Approval.ApprovalEntryID,
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(t.Context(), `DELETE FROM vou_other_income_details WHERE document_id=ANY($1::text[])`, documentIDs)
		_, _ = pool.Exec(t.Context(), `DELETE FROM vou_documents WHERE id=ANY($1::text[])`, documentIDs)
		_, _ = pool.Exec(t.Context(), `DELETE FROM approval_entries WHERE id=ANY($1::text[])`, documentApprovalEntryIDs)
		tx, cleanupErr := pool.Begin(t.Context())
		if cleanupErr != nil {
			return
		}
		defer tx.Rollback(t.Context()) //nolint:errcheck
		_, _ = tx.Exec(t.Context(), `SET CONSTRAINTS ALL DEFERRED`)
		_, _ = tx.Exec(t.Context(), `DELETE FROM approval_events WHERE domain IN ('bob','dcl') AND subject_id=ANY($1::text[])`, allObjectIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM bob_warehouses WHERE object_id=ANY($1::text[])`, allObjectIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM bob_fund_accounts WHERE object_id=ANY($1::text[])`, allObjectIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM dcl_fund_account_identifier_claims WHERE object_id=ANY($1::text[])`, allObjectIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM dcl_fund_account_versions WHERE approval_entry_id=ANY($1::text[])`, allApprovalEntryIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM dcl_product_barcode_claims WHERE object_id=ANY($1::text[])`, allObjectIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM dcl_product_formula_lines WHERE formula_id IN (SELECT id FROM dcl_product_formulas WHERE approval_entry_id=ANY($1::text[]))`, allApprovalEntryIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM dcl_product_formulas WHERE approval_entry_id=ANY($1::text[])`, allApprovalEntryIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM dcl_product_unit_conversions WHERE approval_entry_id=ANY($1::text[])`, allApprovalEntryIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM dcl_product_versions WHERE approval_entry_id=ANY($1::text[])`, allApprovalEntryIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM bob_operating_entities WHERE object_id=ANY($1::text[])`, allObjectIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM dcl_warehouse_versions WHERE approval_entry_id=ANY($1::text[])`, allApprovalEntryIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM dcl_operating_entity_versions WHERE approval_entry_id=ANY($1::text[])`, allApprovalEntryIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM dcl_subjects WHERE id=ANY($1::text[])`, allObjectIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM bob_objects WHERE id=ANY($1::text[])`, allObjectIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM approval_entries WHERE domain IN ('bob','dcl') AND subject_id=ANY($1::text[])`, allObjectIDs)
		_ = tx.Commit(t.Context())
	})

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin voucher fixtures: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	if _, err = tx.Exec(t.Context(), `SET CONSTRAINTS ALL DEFERRED`); err != nil {
		t.Fatalf("defer voucher fixture constraints: %v", err)
	}
	if _, err = tx.Exec(t.Context(), `
		INSERT INTO approval_entries (
			id,domain,entity,subject_id,version_no,status,revision,
			created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
		) VALUES
			($1,'vou','other-income',$2,NULL,'DRAFT',1,$7,now(),$7,now(),NULL,NULL,NULL,NULL),
			($3,'vou','other-income',$4,NULL,'PENDING',2,$7,now(),$7,now(),$7,now(),NULL,NULL),
			($5,'vou','other-income',$6,NULL,'APPROVED',3,$7,now(),$7,now(),$7,now(),$8,now())
	`, documentApprovalEntryIDs[0], documentIDs[0], documentApprovalEntryIDs[1], documentIDs[1], documentApprovalEntryIDs[2], documentIDs[2], admin.ID, reviewerID); err != nil {
		t.Fatalf("insert workbench VOU approvals: %v", err)
	}
	if _, err = tx.Exec(t.Context(), `
		INSERT INTO vou_documents (
			id, entity, document_no, approval_entry_id, business_date, currency,
			total_amount_cents
		) VALUES
			($1, 'other-income', $2, $3, '2099-12-31', 'CNY', 12345),
			($4, 'other-income', $5, $6, '2099-12-31', 'CNY', 23456),
			($7, 'other-income', $8, $9, '2099-12-31', 'CNY', 34567)
	`, documentIDs[0], documentNos[0], documentApprovalEntryIDs[0], documentIDs[1], documentNos[1], documentApprovalEntryIDs[1], documentIDs[2], documentNos[2], documentApprovalEntryIDs[2]); err != nil {
		t.Fatalf("insert workbench vouchers: %v", err)
	}
	if _, err = tx.Exec(t.Context(), `
		INSERT INTO vou_other_income_details (
			document_id, source_name, fund_account_object_id, fund_account_approval_entry_id,
			fund_account_code, fund_account_name
		) VALUES
			($1, '工作台待核对', $4, $5, $6, $7),
			($2, '工作台待批准', $4, $5, $6, $7),
			($3, '工作台待完成', $4, $5, $6, $7)
	`, documentIDs[0], documentIDs[1], documentIDs[2], fund.ObjectID, fundView.Approval.ApprovalEntryID, fundView.Code, fundView.Data.Name); err != nil {
		t.Fatalf("insert workbench voucher details: %v", err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit workbench vouchers: %v", err)
	}

	bobPrincipal := Principal{User: UserSummary{ID: reviewerID}, Permissions: []string{
		"/dcl/warehouse/query", "/dcl/warehouse/get", "/dcl/warehouse/save",
		"/dcl/warehouse/submit", "/dcl/warehouse/approve", "/dcl/warehouse/reject", "/dcl/warehouse/unsubmit",
		"/dcl/operating-entity/query", "/dcl/operating-entity/get", "/dcl/operating-entity/save",
		"/dcl/operating-entity/submit", "/dcl/operating-entity/approve", "/dcl/operating-entity/reject",
		"/dcl/operating-entity/unsubmit",
		"/dcl/product/query", "/dcl/product/get", "/dcl/product/save",
		"/dcl/product/submit", "/dcl/product/approve", "/dcl/product/reject", "/dcl/product/unsubmit",
	}}
	bobPage, err := service.QueryWorkbench(t.Context(), bobPrincipal, WorkbenchQueryInput{
		Category: WorkbenchCategoryBob, Keyword: "  工作台  ", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("query BOB workbench: %v (cause: %v)", err, errors.Unwrap(err))
	}
	byID := make(map[string]WorkbenchItem, len(bobPage.Items))
	for _, item := range bobPage.Items {
		byID[item.ObjectID] = item
	}
	if byID[draft.ObjectID].PendingStage != "SUBMIT" || byID[pending.ObjectID].PendingStage != "APPROVE" {
		t.Fatalf("unexpected BOB stages: %#v", byID)
	}
	if dclItem := byID[dclPending.ObjectID]; dclItem.Category != WorkbenchCategoryBob ||
		dclItem.Entity != bobdomain.EntityOperatingEntity || dclItem.PendingStage != "APPROVE" ||
		!slices.Equal(dclItem.AvailableActions, []string{"view", "approve", "reject", "unsubmit"}) {
		t.Fatalf("DCL operating entity workbench item = %+v", dclItem)
	}
	if item := byID[productDraft.ObjectID]; item.Entity != bobdomain.EntityProduct ||
		item.PendingStage != "SUBMIT" || !slices.Equal(item.AvailableActions, []string{"view", "edit", "submit"}) {
		t.Fatalf("DCL draft product workbench item = %+v", item)
	}
	if item := byID[productPending.ObjectID]; item.Entity != bobdomain.EntityProduct ||
		item.PendingStage != "APPROVE" ||
		!slices.Equal(item.AvailableActions, []string{"view", "approve", "reject", "unsubmit"}) {
		t.Fatalf("DCL pending product workbench item = %+v", item)
	}
	if bobPage.Total < 5 {
		t.Fatalf("BOB total = %d, want at least 5", bobPage.Total)
	}
	if bobPage.Page != 1 || bobPage.PageSize != 20 {
		t.Fatalf("BOB pagination = page %d size %d", bobPage.Page, bobPage.PageSize)
	}
	if _, err = service.QueryWorkbench(t.Context(), bobPrincipal, WorkbenchQueryInput{
		Category: WorkbenchCategoryBob, Page: 1, PageSize: 21,
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("non-fixed workbench page size error = %v", err)
	}
	if !slices.Contains(byID[pending.ObjectID].AvailableActions, "unsubmit") {
		t.Fatalf("pending BOB actions = %v, want unsubmit", byID[pending.ObjectID].AvailableActions)
	}
	if !slices.Equal(byID[draft.ObjectID].AvailableActions, []string{"view", "edit", "submit"}) {
		t.Fatalf("draft BOB actions = %v", byID[draft.ObjectID].AvailableActions)
	}
	if !slices.Equal(byID[pending.ObjectID].AvailableActions, []string{"view", "approve", "reject", "unsubmit"}) {
		t.Fatalf("pending BOB actions = %v", byID[pending.ObjectID].AvailableActions)
	}
	outsideScopePage, err := service.QueryWorkbench(t.Context(), bobPrincipal, WorkbenchQueryInput{
		Category: WorkbenchCategoryBob, Entities: []string{"customer"}, Page: 1, PageSize: 20,
	})
	if err != nil || outsideScopePage.Total != 0 || len(outsideScopePage.Items) != 0 {
		t.Fatalf("out-of-scope entity filter expanded BOB permissions: page=%+v err=%v", outsideScopePage, err)
	}
	bobApprovalPage, err := service.QueryWorkbench(t.Context(), bobPrincipal, WorkbenchQueryInput{
		Category: WorkbenchCategoryBob, Keyword: pendingName, Entities: []string{"warehouse"},
		PendingStages: []string{"APPROVE"}, Page: 1, PageSize: 20,
	})
	if err != nil || bobApprovalPage.Total != 1 || len(bobApprovalPage.Items) != 1 ||
		bobApprovalPage.Items[0].ObjectID != pending.ObjectID {
		t.Fatalf("filtered BOB workbench page = %+v, err = %v", bobApprovalPage, err)
	}
	selfApprovalPage, err := service.QueryWorkbench(t.Context(), Principal{
		User: UserSummary{ID: admin.ID}, Permissions: []string{
			"/dcl/warehouse/query", "/dcl/warehouse/approve", "/dcl/warehouse/reject",
		},
	}, WorkbenchQueryInput{
		Category: WorkbenchCategoryBob, Keyword: pendingName,
		PendingStages: []string{"APPROVE"}, Page: 1, PageSize: 20,
	})
	if err != nil || selfApprovalPage.Total != 0 || len(selfApprovalPage.Items) != 0 {
		t.Fatalf("self-submitted BOB workbench page = %+v, err = %v", selfApprovalPage, err)
	}
	unsubmitOnlyPage, err := service.QueryWorkbench(t.Context(), Principal{
		User: UserSummary{ID: reviewerID}, Permissions: []string{
			"/dcl/warehouse/query", "/dcl/warehouse/unsubmit",
		},
	}, WorkbenchQueryInput{
		Category: WorkbenchCategoryBob, Keyword: pendingName,
		PendingStages: []string{"APPROVE"}, Page: 1, PageSize: 20,
	})
	if err != nil || unsubmitOnlyPage.Total != 1 || len(unsubmitOnlyPage.Items) != 1 ||
		unsubmitOnlyPage.Items[0].ObjectID != pending.ObjectID ||
		!slices.Equal(unsubmitOnlyPage.Items[0].AvailableActions, []string{"unsubmit"}) {
		t.Fatalf("unsubmit-only BOB workbench page = %+v, err = %v", unsubmitOnlyPage, err)
	}

	noActionPage, err := service.QueryWorkbench(t.Context(), Principal{Permissions: []string{
		"/dcl/warehouse/query",
	}}, WorkbenchQueryInput{Category: WorkbenchCategoryBob, Keyword: suffix, Page: 1, PageSize: 20})
	if err != nil || noActionPage.Total != 0 {
		t.Fatalf("query-only workbench page = %+v, err = %v", noActionPage, err)
	}

	vouPrincipal := Principal{Permissions: []string{
		"/vou/other-income/query", "/vou/other-income/get", "/vou/other-income/save",
		"/vou/other-income/submit", "/vou/other-income/approve", "/vou/other-income/unsubmit",
	}}
	vouInput := WorkbenchQueryInput{Category: WorkbenchCategoryVou, Keyword: documentPrefix, Page: 1, PageSize: 20}
	vouPage, err := service.QueryWorkbench(t.Context(), vouPrincipal, vouInput)
	if err != nil {
		t.Fatalf("query VOU workbench: %v", err)
	}
	if vouPage.Total != 2 || len(vouPage.Items) != 2 {
		t.Fatalf("VOU workbench page = %+v, want exactly two pending items", vouPage)
	}
	vouByID := make(map[string]WorkbenchItem, len(vouPage.Items))
	for _, item := range vouPage.Items {
		vouByID[item.DocumentID] = item
	}
	if vouByID[documentIDs[0]].PendingStage != "SUBMIT" || vouByID[documentIDs[0]].Amount != "123.45" ||
		vouByID[documentIDs[1]].PendingStage != "APPROVE" {
		t.Fatalf("unexpected VOU workbench items: %+v", vouByID)
	}
	if _, exists := vouByID[documentIDs[2]]; exists {
		t.Fatalf("approved document unexpectedly appears in workbench: %+v", vouByID[documentIDs[2]])
	}
	if !vouPage.Items[0].UpdatedAt.Equal(vouPage.Items[1].UpdatedAt) {
		t.Fatalf("VOU fixture timestamps differ: %s and %s", vouPage.Items[0].UpdatedAt, vouPage.Items[1].UpdatedAt)
	}
	wantStableOrder := []string{documentIDs[1], documentIDs[0]}
	gotStableOrder := []string{vouPage.Items[0].DocumentID, vouPage.Items[1].DocumentID}
	if !slices.Equal(gotStableOrder, wantStableOrder) {
		t.Fatalf("VOU stable order = %v, want %v", gotStableOrder, wantStableOrder)
	}
	repeatedVouPage, err := service.QueryWorkbench(t.Context(), vouPrincipal, vouInput)
	if err != nil {
		t.Fatalf("repeat VOU workbench query: %v", err)
	}
	if repeatedVouPage.Total != 2 || len(repeatedVouPage.Items) != 2 {
		t.Fatalf("repeated VOU workbench page = %+v, want exactly two pending items", repeatedVouPage)
	}
	repeatedStableOrder := []string{repeatedVouPage.Items[0].DocumentID, repeatedVouPage.Items[1].DocumentID}
	if !slices.Equal(repeatedStableOrder, wantStableOrder) {
		t.Fatalf("repeated VOU stable order = %v, want %v", repeatedStableOrder, wantStableOrder)
	}
	if !slices.Contains(vouByID[documentIDs[0]].AvailableActions, "submit") ||
		!slices.Contains(vouByID[documentIDs[0]].AvailableActions, "edit") {
		t.Fatalf("incomplete VOU draft actions = %v, want edit and submit",
			vouByID[documentIDs[0]].AvailableActions)
	}
	if !slices.Contains(vouByID[documentIDs[1]].AvailableActions, "unsubmit") {
		t.Fatalf("incomplete VOU pending actions = %v, want unsubmit", vouByID[documentIDs[1]].AvailableActions)
	}
	if !slices.Equal(vouByID[documentIDs[0]].AvailableActions, []string{"view", "edit", "submit"}) {
		t.Fatalf("draft VOU actions = %v", vouByID[documentIDs[0]].AvailableActions)
	}
	if !slices.Equal(vouByID[documentIDs[1]].AvailableActions, []string{"view", "approve", "unsubmit"}) {
		t.Fatalf("pending VOU actions = %v", vouByID[documentIDs[1]].AvailableActions)
	}
	vouSecondPage, err := service.QueryWorkbench(t.Context(), Principal{Permissions: []string{
		"/vou/other-income/query", "/vou/other-income/submit", "/vou/other-income/approve",
	}}, WorkbenchQueryInput{Category: WorkbenchCategoryVou, Keyword: documentPrefix, Page: 2, PageSize: 20})
	if err != nil || vouSecondPage.Total != 2 || vouSecondPage.Page != 2 || len(vouSecondPage.Items) != 0 {
		t.Fatalf("VOU second page = %+v, err = %v", vouSecondPage, err)
	}
	vouApprovalPage, err := service.QueryWorkbench(t.Context(), Principal{Permissions: []string{
		"/vou/other-income/query", "/vou/other-income/approve",
	}}, WorkbenchQueryInput{
		Category: WorkbenchCategoryVou, Keyword: documentNos[1], Entities: []string{"other-income"},
		PendingStages: []string{"APPROVE"}, Page: 1, PageSize: 20,
	})
	if err != nil || vouApprovalPage.Total != 1 || len(vouApprovalPage.Items) != 1 ||
		vouApprovalPage.Items[0].DocumentID != documentIDs[1] {
		t.Fatalf("filtered VOU workbench page = %+v, err = %v", vouApprovalPage, err)
	}
	vouUnsubmitPage, err := service.QueryWorkbench(t.Context(), Principal{Permissions: []string{
		"/vou/other-income/query", "/vou/other-income/unsubmit",
	}}, WorkbenchQueryInput{Category: WorkbenchCategoryVou, Keyword: documentNos[1], Page: 1, PageSize: 20})
	if err != nil || vouUnsubmitPage.Total != 1 || len(vouUnsubmitPage.Items) != 1 ||
		vouUnsubmitPage.Items[0].DocumentID != documentIDs[1] ||
		!slices.Equal(vouUnsubmitPage.Items[0].AvailableActions, []string{"unsubmit"}) {
		t.Fatalf("unsubmit-only VOU workbench page = %+v, err = %v", vouUnsubmitPage, err)
	}
}
