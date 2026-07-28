//go:build integration

package wfl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	leddomain "github.com/hansonyu183/zerp/backend/internal/domains/led"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type referenceStub struct {
	values map[string]bobdomain.EffectiveReference
}

type errorRow struct {
	err error
}

func (r errorRow) Scan(...any) error {
	return r.err
}

type failingContainerQueryer struct {
	queryer
	err error
}

func (q failingContainerQueryer) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "FROM led_container_entries") {
		return errorRow{err: q.err}
	}
	return q.queryer.QueryRow(ctx, sql, args...)
}

func (r referenceStub) ResolveEffectiveReference(_ context.Context, _ pgx.Tx, entity, objectID, versionID string) (bobdomain.EffectiveReference, error) {
	value := r.values[objectID]
	if value.Entity != entity || value.VersionID != versionID {
		return bobdomain.EffectiveReference{}, pgx.ErrNoRows
	}
	return value, nil
}

func (r referenceStub) ResolveCurrentEffectiveReference(_ context.Context, _ pgx.Tx, entity, objectID string) (bobdomain.EffectiveReference, error) {
	value := r.values[objectID]
	if value.Entity != entity {
		return bobdomain.EffectiveReference{}, pgx.ErrNoRows
	}
	return value, nil
}

func TestIntermediaryTradeIndependentDocumentsIntegration(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}
	pool, err := pgxpool.New(t.Context(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	_, err = pool.Exec(t.Context(), `TRUNCATE vou_documents,vou_files,vou_number_counters,
		led_audit_events,led_container_entries,led_party_entries,led_fund_entries,
		led_inventory_entries,led_opening_container,led_draft_container,led_opening_party,
		led_opening_fund,led_opening_inventory,led_draft_party,led_draft_fund,
		led_draft_inventory,led_control,led_generations CASCADE;
		INSERT INTO led_control(singleton) VALUES(true)`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `TRUNCATE vou_documents,vou_files,vou_number_counters CASCADE`)
	})
	id := func() string { return ulid.Make().String() }
	customer, salesperson, settlement, product := id(), id(), id(), id()
	supplier, purchaser, platform, vehicle := id(), id(), id(), id()
	version := map[string]string{}
	for _, objectID := range []string{customer, salesperson, settlement, product, supplier, purchaser, platform, vehicle} {
		version[objectID] = id()
	}
	ref := func(objectID, entity, code string, data bobdomain.DetailView) bobdomain.EffectiveReference {
		return bobdomain.EffectiveReference{ObjectID: objectID, VersionID: version[objectID],
			Entity: entity, Code: code, Data: data}
	}
	resolver := referenceStub{values: map[string]bobdomain.EffectiveReference{
		customer: ref(customer, bobdomain.EntityCustomer, "C001", bobdomain.DetailView{
			Name: "客户", SettlementMethodID: settlement, SettlementMethodVersionID: version[settlement]}),
		salesperson: ref(salesperson, bobdomain.EntityEmployee, "E001", bobdomain.DetailView{Name: "业务员"}),
		settlement:  ref(settlement, bobdomain.EntitySettlementMethod, "NET30", bobdomain.DetailView{Name: "月结", RuleType: bobdomain.SettlementRuleRelativeDays, DayOffset: 30}),
		product: ref(product, bobdomain.EntityProduct, "P001", bobdomain.DetailView{
			Name: "溶剂", Unit: "kg", ContainerType: bobdomain.ContainerTypeSolvent, QuantityPerContainer: "2"}),
		supplier: ref(supplier, bobdomain.EntitySupplier, "S001", bobdomain.DetailView{
			Name: "供应商", SupplierType: bobdomain.SupplierTypeGeneral,
			SettlementMethodID: settlement, SettlementMethodVersionID: version[settlement]}),
		purchaser: ref(purchaser, bobdomain.EntityEmployee, "E002", bobdomain.DetailView{Name: "采购员"}),
		platform:  ref(platform, bobdomain.EntitySupplier, "L001", bobdomain.DetailView{Name: "物流", SupplierType: bobdomain.SupplierTypeLogisticsPlatform}),
		vehicle:   ref(vehicle, bobdomain.EntityVehicle, "V001", bobdomain.DetailView{Name: "货车", PlatformObjectID: platform, PlateNumber: "粤B12345"}),
	}}
	actorOne, actorTwo := id(), id()
	bus := txevent.NewBus()
	ledger, err := leddomain.NewService(pool, resolver)
	if err != nil {
		t.Fatal(err)
	}
	if err = ledger.RegisterSubscriptions(bus); err != nil {
		t.Fatal(err)
	}
	opening, err := ledger.SaveOpening(t.Context(), leddomain.OpeningSaveInput{
		Revision: 1, CutoverDate: "2026-01-01",
	}, actorOne, "wfl-led-opening")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ledger.Activate(t.Context(), leddomain.RevisionInput{Revision: opening.Revision},
		actorOne, "wfl-led-activate"); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(pool, resolver, bus, nil)
	if err != nil {
		t.Fatal(err)
	}
	var permissionCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM app_permissions WHERE domain='wfl'`).
		Scan(&permissionCount); err != nil || permissionCount != 96 {
		t.Fatalf("WFL permissions = %d err=%v", permissionCount, err)
	}
	created, err := service.Create(t.Context(), CreateInput{Data: CustomerOrderInput{
		BusinessDate: "2026-07-25", Currency: "CNY", Remark: "客户订单初始备注",
		Customer:    ReferenceInput{ObjectID: customer, VersionID: version[customer]},
		Salesperson: &ReferenceInput{ObjectID: salesperson, VersionID: version[salesperson]},
		Lines: []CustomerLineInput{{Product: ReferenceInput{ObjectID: product, VersionID: version[product]},
			OrderedQuantity: "10", UnitPrice: "12.50"}},
	}}, actorOne, "wfl-create")
	if err != nil {
		t.Fatal(err)
	}
	page, err := service.Query(t.Context(), QueryInput{})
	if err != nil {
		t.Fatalf("query with omitted statuses: %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ProcessID != created.ProcessID {
		t.Fatalf("query with omitted statuses = %+v, want created process", page)
	}
	injectedBalanceError := errors.New("injected container balance failure")
	if _, err = loadBalances(t.Context(), failingContainerQueryer{
		queryer: pool,
		err:     injectedBalanceError,
	}, created.ProcessID, true); !errors.Is(err, injectedBalanceError) {
		t.Fatalf("loadBalances() error = %v, want injected container balance failure", err)
	}
	assertSummary := func(document DocumentSummary, currency, remark string) {
		t.Helper()
		if document.Currency != currency {
			t.Fatalf("%s currency = %q, want %q", document.Stage, document.Currency, currency)
		}
		data, ok := document.Data.(map[string]any)
		if !ok {
			t.Fatalf("%s data = %#v", document.Stage, document.Data)
		}
		if got, exists := data["remark"]; !exists || got != remark {
			t.Fatalf("%s remark = %#v, want %q", document.Stage, got, remark)
		}
	}
	getProcessDocument := func(documentID string, permissions []string) DocumentSummary {
		t.Helper()
		view, getErr := service.Get(t.Context(), GetInput{ProcessID: created.ProcessID}, permissions)
		if getErr != nil {
			t.Fatal(getErr)
		}
		for _, document := range view.Documents {
			if document.DocumentID == documentID {
				return document
			}
		}
		t.Fatalf("document %s not found", documentID)
		return DocumentSummary{}
	}
	assertSummary(getProcessDocument(created.DocumentID, nil), "CNY", "客户订单初始备注")
	rootSaved, err := service.Save(t.Context(), SaveInput{
		ProcessID: created.ProcessID, ProcessRevision: created.ProcessRevision,
		DocumentID: created.DocumentID, DocumentRevision: created.DocumentRevision,
		Data: CustomerOrderInput{
			BusinessDate: "2026-07-25", Currency: "USD", Remark: "客户订单更新备注",
			Customer:    ReferenceInput{ObjectID: customer, VersionID: version[customer]},
			Salesperson: &ReferenceInput{ObjectID: salesperson, VersionID: version[salesperson]},
			Lines: []CustomerLineInput{{Product: ReferenceInput{ObjectID: product, VersionID: version[product]},
				OrderedQuantity: "10", UnitPrice: "12.50"}},
		},
	}, actorOne, "wfl-save")
	if err != nil {
		t.Fatal(err)
	}
	assertSummary(getProcessDocument(created.DocumentID, nil), "USD", "客户订单更新备注")
	var customerLine string
	if err = pool.QueryRow(t.Context(), `SELECT id FROM vou_customer_order_lines WHERE document_id=$1`,
		created.DocumentID).Scan(&customerLine); err != nil {
		t.Fatal(err)
	}
	run := func(action string, revision int64, documentID string, documentRevision int64, data any, actor string) MutationResult {
		t.Helper()
		var raw json.RawMessage
		if data != nil {
			raw, _ = json.Marshal(data)
		}
		value, actionErr := service.Action(t.Context(), action, ActionInput{ProcessID: created.ProcessID,
			ProcessRevision: revision, DocumentID: documentID, DocumentRevision: documentRevision, Data: raw},
			actor, "wfl-"+action)
		if actionErr != nil {
			t.Fatalf("%s: %v", action, actionErr)
		}
		return value.(MutationResult)
	}
	getStage := func(action, documentID string) DocumentSummary {
		t.Helper()
		value, actionErr := service.Action(t.Context(), action, ActionInput{
			ProcessID: created.ProcessID, DocumentID: documentID,
		}, actorOne, "wfl-"+action)
		if actionErr != nil {
			t.Fatalf("%s: %v", action, actionErr)
		}
		return value.(DocumentSummary)
	}
	root := run("check", rootSaved.ProcessRevision, created.DocumentID, rootSaved.DocumentRevision, nil, actorOne)
	root = run("approve", root.ProcessRevision, created.DocumentID, root.DocumentRevision, nil, actorTwo)
	unapprovedAny, err := service.Action(t.Context(), "unapprove", ActionInput{
		ProcessID: created.ProcessID, ProcessRevision: root.ProcessRevision, Reason: "批准后退回重新核对",
	}, actorOne, "wfl-unapprove")
	if err != nil {
		t.Fatalf("unapprove root without children: %v", err)
	}
	root = unapprovedAny.(MutationResult)
	if root.WorkflowStatus != StatusChecked || root.DocumentStatus != StatusChecked {
		t.Fatalf("status after root unapprove = %+v", root)
	}
	var reviewed, approved bool
	if err = pool.QueryRow(t.Context(), `SELECT reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL,
		approved_at IS NOT NULL OR approved_by IS NOT NULL FROM vou_documents WHERE id=$1`,
		created.DocumentID).Scan(&reviewed, &approved); err != nil {
		t.Fatal(err)
	}
	if !reviewed || approved {
		t.Fatalf("root audit fields after unapprove: reviewed=%t approved=%t", reviewed, approved)
	}
	root = run("approve", root.ProcessRevision, created.DocumentID, root.DocumentRevision, nil, actorTwo)
	assertValidation := func(action string, revision int64, data any) {
		t.Helper()
		raw, marshalErr := json.Marshal(data)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		_, actionErr := service.Action(t.Context(), action, ActionInput{
			ProcessID: created.ProcessID, ProcessRevision: revision, Data: raw,
		}, actorOne, "wfl-"+action+"-invalid-reference")
		var domainErr *DomainError
		if !errors.As(actionErr, &domainErr) || domainErr.Kind != ErrorValidation {
			t.Fatalf("%s error = %v, want validation error", action, actionErr)
		}
	}
	assertValidation("procurement-create", root.ProcessRevision, ProcurementInput{
		Supplier:     ReferenceInput{ObjectID: platform, VersionID: version[platform]},
		Purchaser:    &ReferenceInput{ObjectID: purchaser, VersionID: version[purchaser]},
		BusinessDate: "2026-07-25",
		Lines: []ProcurementLineInput{{
			SourceLineID: customerLine, Quantity: "10", UnitPrice: "8.00",
		}},
	})
	procurement := run("procurement-create", root.ProcessRevision, "", 0, ProcurementInput{
		Supplier:     ReferenceInput{ObjectID: supplier, VersionID: version[supplier]},
		Purchaser:    &ReferenceInput{ObjectID: purchaser, VersionID: version[purchaser]},
		Remark:       "采购机密初始备注",
		BusinessDate: "2026-07-25", Lines: []ProcurementLineInput{{
			SourceLineID: customerLine, Quantity: "10", UnitPrice: "8.00"}},
	}, actorOne)
	if !strings.HasPrefix(procurement.DocumentNo, "PRO-") || procurement.ParentDocumentID != created.DocumentID {
		t.Fatalf("procurement identity = %+v", procurement)
	}
	assertSummary(getStage("procurement-get", procurement.DocumentID), "USD", "采购机密初始备注")
	procurement = run("procurement-save", procurement.ProcessRevision, procurement.DocumentID,
		procurement.DocumentRevision, ProcurementInput{
			Supplier:     ReferenceInput{ObjectID: supplier, VersionID: version[supplier]},
			Purchaser:    &ReferenceInput{ObjectID: purchaser, VersionID: version[purchaser]},
			Remark:       "采购机密更新备注",
			BusinessDate: "2026-07-25", Lines: []ProcurementLineInput{{
				SourceLineID: customerLine, Quantity: "10", UnitPrice: "8.00"}},
		}, actorOne)
	assertSummary(getStage("procurement-get", procurement.DocumentID), "USD", "采购机密更新备注")
	procurement = run("procurement-check", procurement.ProcessRevision, procurement.DocumentID, procurement.DocumentRevision, nil, actorOne)
	procurement = run("procurement-place", procurement.ProcessRevision, procurement.DocumentID, procurement.DocumentRevision, nil, actorTwo)
	var procurementLine string
	if err = pool.QueryRow(t.Context(), `SELECT id FROM vou_procurement_order_lines WHERE document_id=$1`,
		procurement.DocumentID).Scan(&procurementLine); err != nil {
		t.Fatal(err)
	}
	receipt := run("receipt-create", procurement.ProcessRevision, "", 0, ReceiptInput{
		BusinessDate: "2026-07-25", Remark: "收货初始备注",
		Lines: []QuantityLineInput{{SourceLineID: procurementLine, Quantity: "10"}},
	}, actorOne)
	if receipt.ParentDocumentID != procurement.DocumentID {
		t.Fatalf("receipt parent = %s", receipt.ParentDocumentID)
	}
	assertSummary(getStage("receipt-get", receipt.DocumentID), "USD", "收货初始备注")
	receipt = run("receipt-save", receipt.ProcessRevision, receipt.DocumentID, receipt.DocumentRevision, ReceiptInput{
		BusinessDate: "2026-07-25", Remark: "收货更新备注",
		Lines: []QuantityLineInput{{SourceLineID: procurementLine, Quantity: "10"}},
	}, actorOne)
	assertSummary(getStage("receipt-get", receipt.DocumentID), "USD", "收货更新备注")
	receipt = run("receipt-check", receipt.ProcessRevision, receipt.DocumentID, receipt.DocumentRevision, nil, actorOne)
	receipt = run("receipt-confirm", receipt.ProcessRevision, receipt.DocumentID, receipt.DocumentRevision, nil, actorTwo)
	assertValidation("delivery-create", receipt.ProcessRevision, DeliveryInput{
		BusinessDate: "2026-07-25",
		Platform:     ReferenceInput{ObjectID: supplier, VersionID: version[supplier]},
		Vehicle:      ReferenceInput{ObjectID: vehicle, VersionID: version[vehicle]},
		Lines:        []QuantityLineInput{{SourceLineID: customerLine, Quantity: "10"}},
	})
	delivery := run("delivery-create", receipt.ProcessRevision, "", 0, DeliveryInput{
		BusinessDate: "2026-07-25", Remark: "送货初始备注",
		Platform: ReferenceInput{ObjectID: platform, VersionID: version[platform]},
		Vehicle:  ReferenceInput{ObjectID: vehicle, VersionID: version[vehicle]},
		Lines:    []QuantityLineInput{{SourceLineID: customerLine, Quantity: "10"}},
	}, actorOne)
	assertSummary(getStage("delivery-get", delivery.DocumentID), "USD", "送货初始备注")
	delivery = run("delivery-save", delivery.ProcessRevision, delivery.DocumentID, delivery.DocumentRevision, DeliveryInput{
		BusinessDate: "2026-07-25", Remark: "送货更新备注",
		Platform: ReferenceInput{ObjectID: platform, VersionID: version[platform]},
		Vehicle:  ReferenceInput{ObjectID: vehicle, VersionID: version[vehicle]},
		Lines:    []QuantityLineInput{{SourceLineID: customerLine, Quantity: "10"}},
	}, actorOne)
	assertSummary(getStage("delivery-get", delivery.DocumentID), "USD", "送货更新备注")
	delivery = run("delivery-check", delivery.ProcessRevision, delivery.DocumentID, delivery.DocumentRevision, nil, actorOne)
	delivery = run("delivery-execute", delivery.ProcessRevision, delivery.DocumentID, delivery.DocumentRevision, nil, actorTwo)
	var deliveryLine string
	if err = pool.QueryRow(t.Context(), `SELECT id FROM vou_delivery_note_lines WHERE document_id=$1`,
		delivery.DocumentID).Scan(&deliveryLine); err != nil {
		t.Fatal(err)
	}
	signoff := run("signoff-create", delivery.ProcessRevision, "", 0, SignoffInput{
		BusinessDate: "2026-07-25", ReturnedSolventContainers: 4, Remark: "签收初始备注",
		ContainerDifferenceReason: "客户少还一桶",
		Lines:                     []SignoffLineInput{{SourceLineID: deliveryLine, SignedQuantity: "10", RejectedQuantity: "0"}},
	}, actorOne)
	if signoff.ParentDocumentID != delivery.DocumentID {
		t.Fatalf("signoff parent = %s", signoff.ParentDocumentID)
	}
	assertSummary(getStage("signoff-get", signoff.DocumentID), "USD", "签收初始备注")
	signoff = run("signoff-save", signoff.ProcessRevision, signoff.DocumentID, signoff.DocumentRevision, SignoffInput{
		BusinessDate: "2026-07-25", ReturnedSolventContainers: 4, Remark: "签收更新备注",
		ContainerDifferenceReason: "客户少还一桶",
		Lines:                     []SignoffLineInput{{SourceLineID: deliveryLine, SignedQuantity: "10", RejectedQuantity: "0"}},
	}, actorOne)
	assertSummary(getStage("signoff-get", signoff.DocumentID), "USD", "签收更新备注")
	signoff = run("signoff-check", signoff.ProcessRevision, signoff.DocumentID, signoff.DocumentRevision, nil, actorOne)
	signoff = run("signoff-confirm", signoff.ProcessRevision, signoff.DocumentID, signoff.DocumentRevision, nil, actorTwo)
	if signoff.WorkflowStatus != StatusCompleted {
		t.Fatalf("workflow status = %s", signoff.WorkflowStatus)
	}
	vouReader, err := voudomain.NewService(pool, resolver, bus, voudomain.AttachmentOptions{
		Root: t.TempDir(),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	atomicDocuments := []struct {
		entity, documentID, status, sourceNo string
	}{
		{voudomain.EntityCustomerOrder, created.DocumentID, voudomain.StatusApproved, ""},
		{voudomain.EntityProcurementOrder, procurement.DocumentID, "ORDERED", created.DocumentNo},
		{voudomain.EntityGoodsReceipt, receipt.DocumentID, "CONFIRMED", procurement.DocumentNo},
		{voudomain.EntityDeliveryNote, delivery.DocumentID, "EXECUTED", created.DocumentNo},
		{voudomain.EntitySignoffNote, signoff.DocumentID, "CONFIRMED", delivery.DocumentNo},
	}
	for _, atomic := range atomicDocuments {
		page, queryErr := vouReader.Query(t.Context(), atomic.entity, voudomain.QueryInput{
			Page: 1, PageSize: 20, Filters: voudomain.QueryFilters{}, Sort: []voudomain.SortInput{},
		})
		if queryErr != nil || page.Total != 1 || len(page.Items) != 1 ||
			page.Items[0].DocumentID != atomic.documentID || page.Items[0].Status != atomic.status {
			t.Fatalf("%s independent query = %+v err=%v", atomic.entity, page, queryErr)
		}
		document, getErr := vouReader.Get(t.Context(), atomic.entity, voudomain.GetInput{
			DocumentID: atomic.documentID,
		})
		if getErr != nil || document.Status != atomic.status || document.SourceDocumentNo != atomic.sourceNo ||
			len(document.Data.Lines) != 1 || document.Data.Lines[0].Product == nil ||
			document.Data.Lines[0].Product.Code != "P001" {
			t.Fatalf("%s independent document = %+v err=%v", atomic.entity, document, getErr)
		}
	}
	view, err := service.Get(t.Context(), GetInput{ProcessID: created.ProcessID},
		[]string{"/wfl/intermediary-trade/procurement-get"})
	if err != nil || len(view.Documents) != 5 || view.Status != StatusCompleted {
		t.Fatalf("workflow view = %+v err=%v", view, err)
	}
	redacted, err := service.Get(t.Context(), GetInput{ProcessID: created.ProcessID}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, document := range redacted.Documents {
		if document.Stage == StageProcurement && (document.Data != nil || document.Lines != nil) {
			t.Fatal("procurement detail leaked without procurement-get permission")
		}
	}
	redactedJSON, err := json.Marshal(redacted)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(redactedJSON), "采购机密更新备注") {
		t.Fatal("procurement remark leaked without procurement-get permission")
	}
	var distinctEntities int
	if err = pool.QueryRow(t.Context(), `SELECT count(DISTINCT entity) FROM vou_documents
		WHERE control_domain='WFL'`).Scan(&distinctEntities); err != nil || distinctEntities != 5 {
		t.Fatalf("independent entities = %d err=%v", distinctEntities, err)
	}
	var partyEntries, containerDelta int64
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM led_party_entries
		WHERE entry_type='POSTING' AND source_entity IN ('goods-receipt','signoff-note')`).
		Scan(&partyEntries); err != nil || partyEntries != 2 {
		t.Fatalf("WFL party postings = %d err=%v", partyEntries, err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT COALESCE(sum(quantity_delta),0)
		FROM led_container_entries WHERE entry_type='POSTING' AND source_entity='signoff-note'`).
		Scan(&containerDelta); err != nil || containerDelta != 1 {
		t.Fatalf("container posting = %d err=%v", containerDelta, err)
	}
	reversedAny, err := service.Action(t.Context(), "signoff-unconfirm", ActionInput{
		ProcessID: created.ProcessID, ProcessRevision: signoff.ProcessRevision,
		DocumentID: signoff.DocumentID, DocumentRevision: signoff.DocumentRevision,
		Reason: "客户签收数据需要修正",
	}, actorTwo, "wfl-signoff-unconfirm")
	if err != nil {
		t.Fatal(err)
	}
	reversed := reversedAny.(MutationResult)
	if reversed.WorkflowStatus != StatusApproved {
		t.Fatalf("status after reversal = %s", reversed.WorkflowStatus)
	}
	var reversalEntries int64
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM led_party_entries
		WHERE entry_type='REVERSAL' AND source_document_id=$1`, signoff.DocumentID).
		Scan(&reversalEntries); err != nil || reversalEntries != 1 {
		t.Fatalf("party reversals = %d err=%v", reversalEntries, err)
	}
	reasonAction := func(action string, processRevision int64, document MutationResult, actor string) MutationResult {
		t.Helper()
		value, actionErr := service.Action(t.Context(), action, ActionInput{
			ProcessID: created.ProcessID, ProcessRevision: processRevision,
			DocumentID: document.DocumentID, DocumentRevision: document.DocumentRevision,
			Reason: "回退后申请不足短结",
		}, actor, "wfl-"+action)
		if actionErr != nil {
			t.Fatalf("%s: %v", action, actionErr)
		}
		return value.(MutationResult)
	}
	signoff = reversed
	signoff = reasonAction("signoff-uncheck", signoff.ProcessRevision, signoff, actorOne)
	signoff = reasonAction("signoff-delete", signoff.ProcessRevision, signoff, actorOne)
	delivery = reasonAction("delivery-unexecute", signoff.ProcessRevision, delivery, actorOne)
	delivery = reasonAction("delivery-uncheck", delivery.ProcessRevision, delivery, actorOne)
	delivery = reasonAction("delivery-delete", delivery.ProcessRevision, delivery, actorOne)
	receipt = reasonAction("receipt-unconfirm", delivery.ProcessRevision, receipt, actorOne)
	receipt = reasonAction("receipt-uncheck", receipt.ProcessRevision, receipt, actorOne)
	receipt = reasonAction("receipt-delete", receipt.ProcessRevision, receipt, actorOne)
	requestedAny, err := service.Action(t.Context(), "short-close-request", ActionInput{
		ProcessID: created.ProcessID, ProcessRevision: receipt.ProcessRevision, Reason: "客户减少剩余采购需求",
	}, actorOne, "wfl-short-request")
	if err != nil {
		t.Fatal(err)
	}
	requested := requestedAny.(MutationResult)
	closedAny, err := service.Action(t.Context(), "short-close-confirm", ActionInput{
		ProcessID: created.ProcessID, ProcessRevision: requested.ProcessRevision,
	}, actorTwo, "wfl-short-confirm")
	if err != nil {
		t.Fatal(err)
	}
	if closedAny.(MutationResult).WorkflowStatus != StatusShortClosed {
		t.Fatalf("short close status = %+v", closedAny)
	}
}

func TestSalesFulfillmentAutoDraftAndReverseGuardIntegration(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}
	pool, err := pgxpool.New(t.Context(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err = pool.Exec(t.Context(), `TRUNCATE vou_documents,vou_files,vou_number_counters CASCADE`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `TRUNCATE vou_documents,vou_files,vou_number_counters CASCADE`)
	})

	id := func() string { return ulid.Make().String() }
	customer, salesperson, product, warehouse, settlement := id(), id(), id(), id(), id()
	platform, vehicle := id(), id()
	versions := map[string]string{
		customer: id(), salesperson: id(), product: id(), warehouse: id(), settlement: id(),
		platform: id(), vehicle: id(),
	}
	ref := func(objectID, entity, code string, data bobdomain.DetailView) bobdomain.EffectiveReference {
		return bobdomain.EffectiveReference{
			ObjectID: objectID, VersionID: versions[objectID],
			Entity: entity, Code: code, Data: data,
		}
	}
	resolver := referenceStub{values: map[string]bobdomain.EffectiveReference{
		customer: ref(customer, bobdomain.EntityCustomer, "C001", bobdomain.DetailView{
			Name:                      "客户",
			SettlementMethodID:        settlement,
			SettlementMethodVersionID: versions[settlement],
		}),
		salesperson: ref(salesperson, bobdomain.EntityEmployee, "E001", bobdomain.DetailView{Name: "业务员"}),
		product: ref(product, bobdomain.EntityProduct, "P001", bobdomain.DetailView{
			Name: "商品", Unit: "kg",
		}),
		warehouse: ref(warehouse, bobdomain.EntityWarehouse, "W001", bobdomain.DetailView{Name: "主仓"}),
		platform: ref(platform, bobdomain.EntitySupplier, "L001", bobdomain.DetailView{
			Name: "物流平台", SupplierType: bobdomain.SupplierTypeLogisticsPlatform,
		}),
		vehicle: ref(vehicle, bobdomain.EntityVehicle, "V001", bobdomain.DetailView{
			Name: "配送车", PlateNumber: "粤B12345", PlatformObjectID: platform,
		}),
		settlement: ref(settlement, bobdomain.EntitySettlementMethod, "NET30", bobdomain.DetailView{
			Name: "月结", RuleType: bobdomain.SettlementRuleRelativeDays, DayOffset: 30,
		}),
	}}
	bus := txevent.NewBus()
	vouchers, err := voudomain.NewService(pool, resolver, bus, voudomain.AttachmentOptions{
		Root: t.TempDir(), UploadTTL: time.Minute, DownloadTTL: time.Minute,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(pool, resolver, bus, nil)
	if err != nil {
		t.Fatal(err)
	}
	service.SetSalesVoucherService(vouchers)
	actor := id()
	created, err := service.SalesCreate(t.Context(), SalesCreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-07-27", Currency: "CNY",
		Customer:    &voudomain.ReferenceInput{ObjectID: customer, VersionID: versions[customer]},
		Salesperson: &voudomain.ReferenceInput{ObjectID: salesperson, VersionID: versions[salesperson]},
		ProductLines: []voudomain.ProductLineInput{{
			Product:         voudomain.ReferenceInput{ObjectID: product, VersionID: versions[product]},
			OrderedQuantity: "10", UnitPrice: "12.50",
		}},
	}}, actor, "sales-create")
	if err != nil {
		t.Fatal(err)
	}
	checkedValue, err := service.SalesAction(t.Context(), "check", ActionInput{
		ProcessID: created.ProcessID, ProcessRevision: created.ProcessRevision,
		DocumentID: created.DocumentID, DocumentRevision: created.DocumentRevision,
	}, actor, "sales-check")
	if err != nil {
		t.Fatalf("%v: %v", err, errors.Unwrap(err))
	}
	checked := checkedValue.(MutationResult)
	type approvalAttempt struct {
		value any
		err   error
	}
	approvals := make(chan approvalAttempt, 2)
	for index := range 2 {
		go func() {
			value, approveErr := service.SalesAction(t.Context(), "approve", ActionInput{
				ProcessID: checked.ProcessID, ProcessRevision: checked.ProcessRevision,
				DocumentID: checked.DocumentID, DocumentRevision: checked.DocumentRevision,
			}, actor, fmt.Sprintf("sales-approve-%d", index))
			approvals <- approvalAttempt{value: value, err: approveErr}
		}()
	}
	var approved MutationResult
	successes := 0
	for range 2 {
		attempt := <-approvals
		if attempt.err == nil {
			successes++
			approved = attempt.value.(MutationResult)
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent approvals succeeded %d times", successes)
	}
	view, err := service.SalesGet(t.Context(), GetInput{ProcessID: approved.ProcessID})
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Documents) != 2 || view.Documents[1].Stage != StageOutbound ||
		view.Documents[1].Status != voudomain.StatusDraft ||
		view.Documents[1].ParentDocumentID != created.DocumentID ||
		view.Documents[1].SourceDocumentNo != view.Documents[0].DocumentNo {
		t.Fatalf("automatic outbound = %+v", view.Documents)
	}
	var generatedCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_documents
		WHERE parent_document_id=$1 AND entity='sale-outbound' AND auto_generated`,
		created.DocumentID).Scan(&generatedCount); err != nil || generatedCount != 1 {
		t.Fatalf("generated outbound count = %d err=%v", generatedCount, err)
	}
	if _, err = service.SalesAction(t.Context(), "approve", ActionInput{
		ProcessID: checked.ProcessID, ProcessRevision: checked.ProcessRevision,
		DocumentID: checked.DocumentID, DocumentRevision: checked.DocumentRevision,
	}, actor, "sales-approve-retry"); err == nil {
		t.Fatal("retrying approve unexpectedly succeeded")
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_documents
		WHERE parent_document_id=$1 AND entity='sale-outbound'`, created.DocumentID).
		Scan(&generatedCount); err != nil || generatedCount != 1 {
		t.Fatalf("retry created duplicate outbound count = %d err=%v", generatedCount, err)
	}

	outbound := view.Documents[1]
	clientOwnedSource, err := json.Marshal(map[string]any{
		"businessDate":     outbound.BusinessDate,
		"currency":         outbound.Currency,
		"sourceDocumentId": created.DocumentID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.SalesAction(t.Context(), "outbound-save", ActionInput{
		ProcessID: approved.ProcessID, ProcessRevision: approved.ProcessRevision,
		DocumentID: outbound.DocumentID, DocumentRevision: outbound.Revision,
		Data: clientOwnedSource,
	}, actor, "sales-outbound-client-source"); err == nil {
		t.Fatal("client-owned sourceDocumentId unexpectedly accepted")
	}
	if _, err = service.SalesAction(t.Context(), "outbound-check", ActionInput{
		ProcessID: approved.ProcessID, ProcessRevision: approved.ProcessRevision,
		DocumentID: outbound.DocumentID, DocumentRevision: outbound.Revision,
	}, actor, "sales-outbound-check-incomplete"); err == nil {
		t.Fatal("checking an automatic outbound without a warehouse unexpectedly succeeded")
	}
	data := outbound.Data.(voudomain.DocumentDataView)
	raw, err := json.Marshal(voudomain.DraftInput{
		BusinessDate: outbound.BusinessDate, Currency: outbound.Currency,
		Warehouse: &voudomain.ReferenceInput{ObjectID: warehouse, VersionID: versions[warehouse]},
		SourceLines: []voudomain.SourceQuantityLineInput{{
			SourceLineID: data.ProductLines[0].SourceLineID,
			Quantity:     data.ProductLines[0].Quantity,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	savedValue, err := service.SalesAction(t.Context(), "outbound-save", ActionInput{
		ProcessID: approved.ProcessID, ProcessRevision: approved.ProcessRevision,
		DocumentID: outbound.DocumentID, DocumentRevision: outbound.Revision, Data: raw,
	}, actor, "sales-outbound-save")
	if err != nil {
		t.Fatal(err)
	}
	saved := savedValue.(MutationResult)
	outboundCheckedValue, err := service.SalesAction(t.Context(), "outbound-check", ActionInput{
		ProcessID: saved.ProcessID, ProcessRevision: saved.ProcessRevision,
		DocumentID: saved.DocumentID, DocumentRevision: saved.DocumentRevision,
	}, actor, "sales-outbound-check")
	if err != nil {
		t.Fatal(err)
	}
	outboundChecked := outboundCheckedValue.(MutationResult)
	outboundApprovedValue, err := service.SalesAction(t.Context(), "outbound-approve", ActionInput{
		ProcessID: outboundChecked.ProcessID, ProcessRevision: outboundChecked.ProcessRevision,
		DocumentID: outboundChecked.DocumentID, DocumentRevision: outboundChecked.DocumentRevision,
	}, actor, "sales-outbound-approve")
	if err != nil {
		t.Fatal(err)
	}
	outboundApproved := outboundApprovedValue.(MutationResult)
	if _, err = service.SalesAction(t.Context(), "outbound-finalize", ActionInput{
		ProcessID: outboundApproved.ProcessID, ProcessRevision: outboundApproved.ProcessRevision,
		DocumentID: outboundApproved.DocumentID, DocumentRevision: outboundApproved.DocumentRevision,
	}, actor, "sales-outbound-finalize-before-parent"); err == nil {
		t.Fatal("outbound finalized before its parent unexpectedly succeeded")
	}
	if _, err = service.SalesAction(t.Context(), "unapprove", ActionInput{
		ProcessID: outboundApproved.ProcessID, ProcessRevision: outboundApproved.ProcessRevision,
		DocumentID: created.DocumentID, DocumentRevision: view.Documents[0].Revision,
		Reason: "验证已编辑自动草稿阻止反批准",
	}, actor, "sales-unapprove"); err == nil {
		t.Fatal("unapprove unexpectedly removed an edited automatic draft")
	}

	view, err = service.SalesGet(t.Context(), GetInput{ProcessID: outboundApproved.ProcessID})
	if err != nil {
		t.Fatal(err)
	}
	root := view.Documents[0]
	rootFinalizedValue, err := service.SalesAction(t.Context(), "finalize", ActionInput{
		ProcessID: outboundApproved.ProcessID, ProcessRevision: outboundApproved.ProcessRevision,
		DocumentID: root.DocumentID, DocumentRevision: root.Revision,
	}, actor, "sales-root-finalize")
	if err != nil {
		t.Fatal(err)
	}
	rootFinalized := rootFinalizedValue.(MutationResult)
	outboundFinalizedValue, err := service.SalesAction(t.Context(), "outbound-finalize", ActionInput{
		ProcessID: rootFinalized.ProcessID, ProcessRevision: rootFinalized.ProcessRevision,
		DocumentID: outboundApproved.DocumentID, DocumentRevision: outboundApproved.DocumentRevision,
	}, actor, "sales-outbound-finalize")
	if err != nil {
		t.Fatal(err)
	}
	outboundFinalized := outboundFinalizedValue.(MutationResult)
	view, err = service.SalesGet(t.Context(), GetInput{ProcessID: outboundFinalized.ProcessID})
	if err != nil {
		t.Fatal(err)
	}
	delivery := view.Documents[2]
	if delivery.Stage != StageDelivery || delivery.ParentDocumentID != outbound.DocumentID {
		t.Fatalf("automatic delivery = %+v", delivery)
	}
	deliveryRaw, err := json.Marshal(voudomain.DraftInput{
		BusinessDate: delivery.BusinessDate, Currency: delivery.Currency,
		Platform: &voudomain.ReferenceInput{ObjectID: platform, VersionID: versions[platform]},
		Vehicle:  &voudomain.ReferenceInput{ObjectID: vehicle, VersionID: versions[vehicle]},
	})
	if err != nil {
		t.Fatal(err)
	}
	deliverySavedValue, err := service.SalesAction(t.Context(), "delivery-save", ActionInput{
		ProcessID: outboundFinalized.ProcessID, ProcessRevision: outboundFinalized.ProcessRevision,
		DocumentID: delivery.DocumentID, DocumentRevision: delivery.Revision, Data: deliveryRaw,
	}, actor, "sales-delivery-save")
	if err != nil {
		t.Fatal(err)
	}
	deliverySaved := deliverySavedValue.(MutationResult)
	deliveryCheckedValue, err := service.SalesAction(t.Context(), "delivery-check", ActionInput{
		ProcessID: deliverySaved.ProcessID, ProcessRevision: deliverySaved.ProcessRevision,
		DocumentID: deliverySaved.DocumentID, DocumentRevision: deliverySaved.DocumentRevision,
	}, actor, "sales-delivery-check")
	if err != nil {
		t.Fatal(err)
	}
	deliveryChecked := deliveryCheckedValue.(MutationResult)
	deliveryApprovedValue, err := service.SalesAction(t.Context(), "delivery-approve", ActionInput{
		ProcessID: deliveryChecked.ProcessID, ProcessRevision: deliveryChecked.ProcessRevision,
		DocumentID: deliveryChecked.DocumentID, DocumentRevision: deliveryChecked.DocumentRevision,
	}, actor, "sales-delivery-approve")
	if err != nil {
		t.Fatal(err)
	}
	deliveryApproved := deliveryApprovedValue.(MutationResult)
	deliveryFinalizedValue, err := service.SalesAction(t.Context(), "delivery-finalize", ActionInput{
		ProcessID: deliveryApproved.ProcessID, ProcessRevision: deliveryApproved.ProcessRevision,
		DocumentID: deliveryApproved.DocumentID, DocumentRevision: deliveryApproved.DocumentRevision,
	}, actor, "sales-delivery-finalize")
	if err != nil {
		t.Fatal(err)
	}
	deliveryFinalized := deliveryFinalizedValue.(MutationResult)
	view, err = service.SalesGet(t.Context(), GetInput{ProcessID: deliveryFinalized.ProcessID})
	if err != nil {
		t.Fatal(err)
	}
	signoff := view.Documents[3]
	signoffData := signoff.Data.(voudomain.DocumentDataView)
	if signoff.Stage != StageSignoff || len(signoffData.SignoffLines) != 1 ||
		signoffData.SignoffLines[0].SignedQuantity != "10.0" ||
		signoffData.SignoffLines[0].RejectedQuantity != "0.0" {
		t.Fatalf("automatic signoff = %+v", signoff)
	}
	signoffRaw, err := json.Marshal(voudomain.DraftInput{
		BusinessDate: signoff.BusinessDate, Currency: signoff.Currency,
		SignoffLines: []voudomain.SaleSignoffLineInput{{
			SourceLineID:   signoffData.SignoffLines[0].SourceLineID,
			SignedQuantity: "8", RejectedQuantity: "1",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	signoffSavedValue, err := service.SalesAction(t.Context(), "signoff-save", ActionInput{
		ProcessID: deliveryFinalized.ProcessID, ProcessRevision: deliveryFinalized.ProcessRevision,
		DocumentID: signoff.DocumentID, DocumentRevision: signoff.Revision, Data: signoffRaw,
	}, actor, "sales-signoff-save")
	if err != nil {
		t.Fatal(err)
	}
	signoffSaved := signoffSavedValue.(MutationResult)
	signoffCheckedValue, err := service.SalesAction(t.Context(), "signoff-check", ActionInput{
		ProcessID: signoffSaved.ProcessID, ProcessRevision: signoffSaved.ProcessRevision,
		DocumentID: signoffSaved.DocumentID, DocumentRevision: signoffSaved.DocumentRevision,
	}, actor, "sales-signoff-check")
	if err != nil {
		t.Fatal(err)
	}
	signoffChecked := signoffCheckedValue.(MutationResult)
	signoffApprovedValue, err := service.SalesAction(t.Context(), "signoff-approve", ActionInput{
		ProcessID: signoffChecked.ProcessID, ProcessRevision: signoffChecked.ProcessRevision,
		DocumentID: signoffChecked.DocumentID, DocumentRevision: signoffChecked.DocumentRevision,
	}, actor, "sales-signoff-approve")
	if err != nil {
		t.Fatal(err)
	}
	signoffApproved := signoffApprovedValue.(MutationResult)
	signoffFinalizedValue, err := service.SalesAction(t.Context(), "signoff-finalize", ActionInput{
		ProcessID: signoffApproved.ProcessID, ProcessRevision: signoffApproved.ProcessRevision,
		DocumentID: signoffApproved.DocumentID, DocumentRevision: signoffApproved.DocumentRevision,
	}, actor, "sales-signoff-finalize")
	if err != nil {
		t.Fatal(err)
	}
	signoffFinalized := signoffFinalizedValue.(MutationResult)
	view, err = service.SalesGet(t.Context(), GetInput{ProcessID: signoffFinalized.ProcessID})
	if err != nil {
		t.Fatal(err)
	}
	var replenished []DocumentSummary
	for _, document := range view.Documents {
		if document.Stage == StageOutbound && document.Status == voudomain.StatusDraft {
			replenished = append(replenished, document)
		}
	}
	if len(replenished) != 1 {
		t.Fatalf("replenished outbound drafts = %+v", replenished)
	}
	replenishedData := replenished[0].Data.(voudomain.DocumentDataView)
	if len(replenishedData.ProductLines) != 1 ||
		replenishedData.ProductLines[0].Quantity != "2.0" {
		t.Fatalf("replenished outbound lines = %+v", replenishedData.ProductLines)
	}
}
