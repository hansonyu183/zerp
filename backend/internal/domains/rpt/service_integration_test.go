//go:build integration

package rpt

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type rptApprovalInput struct {
	Code                 string
	VersionID            string
	Revision             int64
	ValidationParameters map[string]any
}

type rptExecutionMutation struct {
	ID       string
	Code     string
	Status   string
	Revision int64
}

type rptExecutionService struct {
	*Service
	declarations *dcldomain.RptDefinitionService
	t            *testing.T
}

type rptDefinitionCreateInput struct {
	Code, Name, Description string
	Data                    VersionData
}

func newRPTExecutionService(t *testing.T, pool *pgxpool.Pool) (*rptExecutionService, error) {
	t.Helper()
	seedRPTActors(t, pool)
	bus := txevent.NewBus()
	service, err := NewService(pool)
	if err != nil {
		return nil, err
	}
	declarations := dcldomain.NewRptDefinitionService(pool, service, authorization.Func(nil), bus)
	return &rptExecutionService{Service: service, declarations: declarations, t: t}, nil
}

func (service *rptExecutionService) CreateDefinition(ctx context.Context, input rptDefinitionCreateInput, _ string, requestID string) (rptExecutionMutation, error) {
	parameters, err := json.Marshal(input.Data.Parameters)
	if err != nil {
		return rptExecutionMutation{}, err
	}
	columns, err := json.Marshal(input.Data.Columns)
	if err != nil {
		return rptExecutionMutation{}, err
	}
	created, err := service.declarations.Create(ctx, dcldomain.RptDefinitionCreateInput{
		Name: input.Name, Description: input.Description, Enabled: true,
		Data: dcldomain.RptDefinitionData{SQL: input.Data.SQL, Parameters: parameters, Columns: columns},
	}, rptActor(service.t, rptSubmitterID, requestID))
	if err != nil {
		return rptExecutionMutation{}, err
	}
	return rptExecutionMutation{ID: created.Approval.ApprovalEntryID, Code: created.Code, Status: string(created.Approval.Status), Revision: created.Approval.Revision}, nil
}

func (service *rptExecutionService) submitAndApprove(ctx context.Context, input rptApprovalInput, requestID string) (rptExecutionMutation, error) {
	pending, err := service.declarations.Submit(ctx, dcldomain.RptDefinitionVersionInput{
		Code: input.Code, ApprovalEntryID: input.VersionID, ApprovalRevision: input.Revision,
		ValidationParameters: input.ValidationParameters,
	}, rptActor(service.t, rptSubmitterID, requestID+"-submit"))
	if err != nil {
		return rptExecutionMutation{}, err
	}
	approved, err := service.declarations.Approve(ctx, dcldomain.RptDefinitionVersionInput{
		Code: input.Code, ApprovalEntryID: input.VersionID, ApprovalRevision: pending.Approval.Revision,
		ValidationParameters: input.ValidationParameters,
	}, rptActor(service.t, rptReviewerID, requestID))
	if err != nil {
		return rptExecutionMutation{}, err
	}
	return rptExecutionMutation{ID: approved.Approval.ApprovalEntryID, Status: string(approved.Approval.Status), Revision: approved.Approval.Revision}, nil
}

func rptPermission(t *testing.T, pool *pgxpool.Pool, code, action string) (string, string) {
	t.Helper()
	var id, status string
	if err := pool.QueryRow(t.Context(), `SELECT id,status FROM app_permissions WHERE path=$1`, permissionPath(code, action)).Scan(&id, &status); err != nil {
		t.Fatalf("read %s permission: %v", action, err)
	}
	return id, status
}

func TestRPTExecutionPaginationIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	service, err := newRPTExecutionService(t, pool)
	if err != nil {
		t.Fatal(err)
	}
	code := rptCode()
	created, err := service.CreateDefinition(t.Context(), rptDefinitionCreateInput{
		Code: code, Name: "分页报表", Data: rptData(`SELECT path AS value FROM app_permissions ORDER BY path`, "value"),
	}, rptIntegrationActor, "rpt-page-create")
	if err != nil {
		t.Fatalf("create report: %v", err)
	}
	code = created.Code
	approved, err := service.submitAndApprove(t.Context(), rptApprovalInput{
		Code: code, VersionID: created.ID, Revision: created.Revision,
	}, "rpt-page-approve")
	if err != nil {
		t.Fatalf("approve report: %v", err)
	}
	var expectedTotal int64
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM app_permissions`).Scan(&expectedTotal); err != nil {
		t.Fatalf("count report rows: %v", err)
	}
	page, pageSize := 1, 2
	first, err := service.Execute(t.Context(), code, ExecuteInput{Page: &page, PageSize: &pageSize, Parameters: map[string]any{}}, rptIntegrationActor, "rpt-page-query-1")
	if err != nil {
		t.Fatalf("query first page: %v", err)
	}
	if len(first.Items) != pageSize || first.Page != page || first.PageSize != pageSize || first.Total != expectedTotal {
		t.Fatalf("first page = items %d total %d page %d size %d, want items %d total %d", len(first.Items), first.Total, first.Page, first.PageSize, pageSize, expectedTotal)
	}
	page = 2
	second, err := service.Execute(t.Context(), code, ExecuteInput{Page: &page, PageSize: &pageSize, Parameters: map[string]any{}}, rptIntegrationActor, "rpt-page-query-2")
	if err != nil {
		t.Fatalf("query second page: %v", err)
	}
	if len(second.Items) != pageSize || second.Total != expectedTotal || fmt.Sprint(first.Items) == fmt.Sprint(second.Items) {
		t.Fatalf("second page = items %d total %d data %v, first data %v", len(second.Items), second.Total, second.Items, first.Items)
	}

	tooLarge := 101
	if _, err = service.Execute(t.Context(), code, ExecuteInput{PageSize: &tooLarge, Parameters: map[string]any{}}, rptIntegrationActor, "rpt-page-too-large"); !rptErrorKind(err, ErrorValidation) {
		t.Fatalf("page size 101 error = %v", err)
	}
	zero, negative := 0, -1
	for _, request := range []ExecuteInput{
		{Page: &zero, Parameters: map[string]any{}},
		{Page: &negative, Parameters: map[string]any{}},
		{PageSize: &zero, Parameters: map[string]any{}},
	} {
		if _, err = service.Execute(t.Context(), code, request, rptIntegrationActor, "rpt-page-invalid"); !rptErrorKind(err, ErrorValidation) {
			t.Fatalf("invalid pagination request %+v error = %v", request, err)
		}
	}
	_ = approved
}

func TestValidatePublishedDefinitionsIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	service, err := newRPTExecutionService(t, pool)
	if err != nil {
		t.Fatal(err)
	}

	valid, err := service.CreateDefinition(t.Context(), rptDefinitionCreateInput{
		Name: "可发布报表", Data: rptData(`SELECT 'ok'::text AS value`, "value"),
	}, rptIntegrationActor, "rpt-release-valid-create")
	if err != nil {
		t.Fatalf("create valid report: %v", err)
	}
	if _, err = service.submitAndApprove(t.Context(), rptApprovalInput{Code: valid.Code, VersionID: valid.ID, Revision: valid.Revision}, "rpt-release-valid-approve"); err != nil {
		t.Fatalf("approve valid report: %v", err)
	}

	badDefinitionID, badEntryID := newID(), newID()
	badCode := "z-release-bad-" + strings.ToLower(newID()[:8])
	if _, err = pool.Exec(t.Context(), `
		WITH subject AS (
			INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'rpt-definition',$2,$3)
		), entry AS (
			INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at)
			VALUES($4,'dcl','rpt-definition',$1,1,'APPROVED',$3,now(),$3,now(),$3,now(),$5,now())
		), version AS (
			INSERT INTO dcl_rpt_definition_versions(approval_entry_id,enabled,name,description,sql_text,parameters,columns,created_by,updated_by)
			VALUES($4,true,'失效报表','', 'SELECT missing_release_column::text AS value','[]'::jsonb,'[{"alias":"value","name":"value","order":1,"type":"TEXT","width":160,"visible":true}]'::jsonb,$3,$3)
		)
		INSERT INTO rpt_definition_validities(approval_entry_id,validity,created_by,updated_by)
		VALUES($4,'VALID',$3,$3)`,
		badDefinitionID, badCode, rptSubmitterID, badEntryID, rptReviewerID); err != nil {
		t.Fatalf("insert incompatible published report: %v", err)
	}
	insertSkipped := func(code string, enabled bool, validity string, versions []string) {
		t.Helper()
		definitionID := newID()
		for index, entryID := range versions {
			sqlText := `SELECT 'latest'::text AS value`
			if index == 0 && len(versions) > 1 || len(versions) == 1 {
				sqlText = `SELECT missing_skipped_release_column::text AS value`
			}
			if _, insertErr := pool.Exec(t.Context(), `
				WITH subject AS (
					INSERT INTO dcl_subjects(id,entity,code,created_by)
					SELECT $2,'rpt-definition',$3,$5 WHERE $4=1
				), entry AS (
					INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at)
					VALUES($1,'dcl','rpt-definition',$2,$4,'APPROVED',$5,now(),$5,now(),$5,now(),$6,now())
				), version AS (
					INSERT INTO dcl_rpt_definition_versions(approval_entry_id,enabled,name,description,sql_text,parameters,columns,created_by,updated_by)
					VALUES($1,$7,'skipped','',$8,'[]'::jsonb,'[{"alias":"value","name":"value","order":1,"type":"TEXT","width":160,"visible":true}]'::jsonb,$5,$5)
				)
				INSERT INTO rpt_definition_validities(approval_entry_id,validity,created_by,updated_by) VALUES($1,$9,$5,$5)`, entryID, definitionID, code, index+1, rptSubmitterID, rptReviewerID, enabled, sqlText, validity); insertErr != nil {
				t.Fatal(insertErr)
			}
		}
	}
	insertSkipped("a-release-disabled-"+strings.ToLower(newID()[:8]), false, "VALID", []string{newID()})
	insertSkipped("a-release-invalid-"+strings.ToLower(newID()[:8]), true, "INVALID", []string{newID()})
	insertSkipped("a-release-nonlatest-"+strings.ToLower(newID()[:8]), true, "VALID", []string{newID(), newID()})

	err = service.ValidatePublishedDefinitions(t.Context())
	if err == nil || !strings.Contains(err.Error(), badCode) || !strings.Contains(err.Error(), badDefinitionID) || !strings.Contains(err.Error(), badEntryID) {
		t.Fatalf("release validation error = %v, want actionable definition %s/%s approval %s", err, badCode, badDefinitionID, badEntryID)
	}
}

func TestRPTBuiltInBillsCounterpartyReferenceIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	service, err := NewService(pool)
	if err != nil {
		t.Fatal(err)
	}
	objectID, firstEntryID, secondEntryID := newID(), newID(), newID()
	firstBillID, secondBillID := newID(), newID()
	code := "RPT-COUNTERPARTY-" + strings.ToUpper(newID()[:8])
	for _, snapshot := range []struct {
		billID, approvalEntryID, name string
	}{
		{firstBillID, firstEntryID, "历史相对方 V1"},
		{secondBillID, secondEntryID, "历史相对方 V2"},
	} {
		if _, err = pool.Exec(t.Context(), `INSERT INTO acc_bills(
			id,bill_no,bill_type,position_type,currency,medium,face_amount_minor,
			issue_date,maturity_date,drawer,acceptor,payee,annual_rate_bps,interest_days,
			interest_amount_minor,customer_cost_amount_minor,origin_counterparty_entity,
			origin_counterparty_object_id,origin_counterparty_approval_entry_id,
			origin_counterparty_code,origin_counterparty_name,state,source_document_id,source_line_id
		) VALUES($1,$2,'BANK_ACCEPTANCE','ASSET','CNY','ELECTRONIC',10000,
			'2026-01-01','2026-06-01','D','A','P',0,0,0,0,'supplier',$3,$4,$5,$6,
			'AVAILABLE',$7,$8)`, snapshot.billID, "BILL-"+snapshot.billID, objectID, snapshot.approvalEntryID, code, snapshot.name, newID(), newID()); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM acc_bills WHERE id=ANY($1)`, []string{firstBillID, secondBillID})
	})
	page, err := service.QueryReferences(t.Context(), "bills", ReferenceQueryInput{
		ParameterKey: "counterpartyObjectId",
		Keyword:      code,
		SelectedID:   objectID,
	})
	if err != nil {
		t.Fatalf("query built-in bills counterparty reference: %v", err)
	}
	if page.Page != 1 || page.PageSize != 20 {
		t.Fatalf("reference page = %d size = %d", page.Page, page.PageSize)
	}
	items, ok := page.Items.([]CounterpartyReference)
	if !ok {
		t.Fatalf("counterparty reference items type = %T", page.Items)
	}
	want := map[string]CounterpartyReference{
		firstEntryID:  {Entity: "supplier", ObjectID: objectID, ApprovalEntryID: firstEntryID, Code: code, Name: "历史相对方 V1"},
		secondEntryID: {Entity: "supplier", ObjectID: objectID, ApprovalEntryID: secondEntryID, Code: code, Name: "历史相对方 V2"},
	}
	for _, item := range items {
		if expected, found := want[item.ApprovalEntryID]; !found || item != expected {
			t.Fatalf("counterparty snapshot = %#v, want one of %#v", item, want)
		}
		delete(want, item.ApprovalEntryID)
	}
	if len(want) != 0 {
		t.Fatalf("counterparty approval snapshots were collapsed: %#v", want)
	}
}

func TestRPTCustomerSubunitReferencesUseLatestEnabledCustomerSnapshotIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	seedRPTActors(t, pool)
	service, err := NewService(pool)
	if err != nil {
		t.Fatal(err)
	}

	currentCustomerID, secondCustomerID, disabledCustomerID := newID(), newID(), newID()
	firstEntryID, latestEntryID, secondCustomerEntryID, disabledCustomerEntryID := newID(), newID(), newID(), newID()
	currentSubunitID, oldSubunitID, disabledSubunitID, secondSubunitID, disabledCustomerSubunitID := newID(), newID(), newID(), newID(), newID()
	entryIDs := []string{firstEntryID, latestEntryID, secondCustomerEntryID, disabledCustomerEntryID}
	customerIDs := []string{currentCustomerID, secondCustomerID, disabledCustomerID}

	marshal := func(value any) []byte {
		encoded, marshalErr := json.Marshal(value)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		return encoded
	}
	customerData := func(legalName, displayName string, enabled bool) []byte {
		data := map[string]any{
			"kind": "MAINLAND_ENTERPRISE", "legalName": legalName, "displayName": displayName,
			"legalIdentifier": "91350211M00010001X", "remittanceProfiles": []any{},
			"defaultOperatingEntityId": newID(), "defaultOperatingEntity": map[string]any{},
			"enabled": enabled, "subunits": []any{},
		}
		return marshal(data)
	}
	subunitData := func(subunitID, code, name string, enabled bool) []byte {
		return marshal(map[string]any{
			"subunitId": subunitID, "enabled": enabled, "name": name,
			"customerTypeId": newID(), "transportSurcharge": "0.00",
			"pricingPolicy": map[string]any{"costItems": []any{}}, "creditLimits": []any{},
			"primarySalesAttribution": map[string]any{}, "code": code, "attachments": []any{},
			"customerType": map[string]any{"objectId": newID(), "code": "DIT-0001", "name": "客户"},
		})
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	for _, subject := range []struct{ id, code string }{
		{currentCustomerID, "CUS-9001"},
		{secondCustomerID, "CUS-9002"},
		{disabledCustomerID, "CUS-9003"},
	} {
		if _, err = tx.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'customer',$2,$3)`, subject.id, subject.code, rptSubmitterID); err != nil {
			t.Fatal(err)
		}
	}
	for _, entry := range []struct {
		id, customerID string
		version        int
	}{
		{firstEntryID, currentCustomerID, 1},
		{latestEntryID, currentCustomerID, 2},
		{secondCustomerEntryID, secondCustomerID, 1},
		{disabledCustomerEntryID, disabledCustomerID, 1},
	} {
		if _, err = tx.Exec(t.Context(), `INSERT INTO approval_entries(
			id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
		) VALUES($1,'dcl','customer',$2,$3,'APPROVED',1,$4,now(),$4,now(),$4,now(),$5,now())`, entry.id, entry.customerID, entry.version, rptSubmitterID, rptReviewerID); err != nil {
			t.Fatal(err)
		}
	}
	for _, version := range []struct {
		entryID string
		data    []byte
		enabled bool
	}{
		{firstEntryID, customerData("RPT 客户历史", "RPT 客户历史", true), true},
		{latestEntryID, customerData("RPT 客户当前", "RPT 客户当前", true), true},
		{secondCustomerEntryID, customerData("RPT 第二客户法定名称", "", true), true},
		{disabledCustomerEntryID, customerData("RPT 客户已禁用", "RPT 客户已禁用", false), false},
	} {
		if _, err = tx.Exec(t.Context(), `INSERT INTO dcl_customer_versions(approval_entry_id,kind,legal_identifier,data,enabled) VALUES($1,'MAINLAND_ENTERPRISE','91350211M00010001X',$2,$3)`, version.entryID, version.data, version.enabled); err != nil {
			t.Fatal(err)
		}
	}
	for _, root := range []struct {
		subunitID, customerID, code string
		firstEntryID                string
	}{
		{currentSubunitID, currentCustomerID, "SUB-9001", firstEntryID},
		{oldSubunitID, currentCustomerID, "SUB-9002", firstEntryID},
		{disabledSubunitID, currentCustomerID, "SUB-9003", firstEntryID},
		{secondSubunitID, secondCustomerID, "SUB-9001", secondCustomerEntryID},
		{disabledCustomerSubunitID, disabledCustomerID, "SUB-9004", disabledCustomerEntryID},
	} {
		if _, err = tx.Exec(t.Context(), `INSERT INTO dcl_customer_subunit_roots(subunit_id,customer_id,code,ever_approved,first_approved_customer_entry_id) VALUES($1,$2,$3,TRUE,$4)`, root.subunitID, root.customerID, root.code, root.firstEntryID); err != nil {
			t.Fatal(err)
		}
	}
	for _, line := range []struct {
		entryID, subunitID, code, name string
		enabled                        bool
	}{
		{firstEntryID, oldSubunitID, "SUB-9002", "RPT 客户旧版本子单位", true},
		{latestEntryID, currentSubunitID, "SUB-9001", "RPT 客户当前子单位", true},
		{latestEntryID, disabledSubunitID, "SUB-9003", "RPT 客户禁用子单位", false},
		{secondCustomerEntryID, secondSubunitID, "SUB-9001", "RPT 第二客户子单位", true},
		{disabledCustomerEntryID, disabledCustomerSubunitID, "SUB-9004", "RPT 已禁用客户子单位", true},
	} {
		if _, err = tx.Exec(t.Context(), `INSERT INTO dcl_customer_version_subunits(customer_approval_entry_id,subunit_id,data,enabled) VALUES($1,$2,$3,$4)`, line.entryID, line.subunitID, subunitData(line.subunitID, line.code, line.name, line.enabled), line.enabled); err != nil {
			t.Fatal(err)
		}
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM dcl_customer_version_subunits WHERE customer_approval_entry_id=ANY($1)`, entryIDs)
		_, _ = pool.Exec(ctx, `DELETE FROM dcl_customer_subunit_roots WHERE customer_id=ANY($1)`, customerIDs)
		_, _ = pool.Exec(ctx, `DELETE FROM dcl_customer_versions WHERE approval_entry_id=ANY($1)`, entryIDs)
		_, _ = pool.Exec(ctx, `DELETE FROM approval_entries WHERE id=ANY($1)`, entryIDs)
		_, _ = pool.Exec(ctx, `DELETE FROM dcl_subjects WHERE id=ANY($1)`, customerIDs)
	})

	query := func(keyword, selectedID string) Page {
		t.Helper()
		page, queryErr := service.QueryReferences(t.Context(), "customer-aging", ReferenceQueryInput{
			ParameterKey: "customerSubunitId", Keyword: keyword, SelectedID: selectedID,
		})
		if queryErr != nil {
			t.Fatalf("query customer subunit references: %v", queryErr)
		}
		return page
	}
	page := query("RPT", "")
	items, ok := page.Items.([]CustomerSubunitReference)
	if !ok {
		t.Fatalf("customer subunit reference items type = %T", page.Items)
	}
	want := map[string]CustomerSubunitReference{
		currentSubunitID: {ID: currentSubunitID, Code: "SUB-9001", Name: "RPT 客户当前子单位", CustomerCode: "CUS-9001", CustomerName: "RPT 客户当前"},
		secondSubunitID:  {ID: secondSubunitID, Code: "SUB-9001", Name: "RPT 第二客户子单位", CustomerCode: "CUS-9002", CustomerName: "RPT 第二客户法定名称"},
	}
	if page.Total != int64(len(want)) || len(items) != len(want) {
		t.Fatalf("current customer subunit candidates = total %d items %#v", page.Total, items)
	}
	for _, item := range items {
		if expected, found := want[item.ID]; !found || item != expected {
			t.Fatalf("customer subunit candidate = %#v, want one of %#v", item, want)
		}
		delete(want, item.ID)
	}
	if len(want) != 0 {
		t.Fatalf("customer subunit candidates missing: %#v", want)
	}
	for keyword, expectedID := range map[string]string{
		"CUS-9001": currentSubunitID,
		"第二客户法定名称": secondSubunitID,
	} {
		searched := query(keyword, "")
		searchedItems, searchedOK := searched.Items.([]CustomerSubunitReference)
		if !searchedOK || searched.Total != 1 || len(searchedItems) != 1 || searchedItems[0].ID != expectedID {
			t.Fatalf("customer subunit search %q = total %d items %#v", keyword, searched.Total, searched.Items)
		}
	}
	selectedCurrent := query("does-not-match", currentSubunitID)
	selectedItems, ok := selectedCurrent.Items.([]CustomerSubunitReference)
	if !ok || selectedCurrent.Total != 1 || len(selectedItems) != 1 || selectedItems[0].ID != currentSubunitID {
		t.Fatalf("selected current customer subunit = total %d items %#v", selectedCurrent.Total, selectedCurrent.Items)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	authorizer := authorization.Func(func(context.Context, *http.Request, string, string) (authorization.Principal, error) {
		return authorization.Principal{ActorID: rptIntegrationActor, Permissions: []string{permissionPath("customer-aging", "query")}}, nil
	})
	NewHandler(service, authorizer, slog.Default()).Register(router)
	request := httptest.NewRequest(http.MethodPost, "/rpt/customer-aging/reference-query", bytes.NewBufferString(`{"parameterKey":"customerSubunitId","keyword":"RPT"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	var responseBody struct {
		Data struct {
			Items []CustomerSubunitReference `json:"items"`
			Total int64                      `json:"total"`
		} `json:"data"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &responseBody); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusOK || responseBody.Data.Total != 2 || len(responseBody.Data.Items) != 2 {
		t.Fatalf("customer subunit reference response status=%d data=%#v", recorder.Code, responseBody.Data)
	}
	wireCustomers := map[string]string{}
	for _, item := range responseBody.Data.Items {
		if item.Code != "SUB-9001" || (item.CustomerCode != "CUS-9001" && item.CustomerCode != "CUS-9002") || item.CustomerName == "" {
			t.Fatalf("customer subunit reference response item = %#v", item)
		}
		wireCustomers[item.CustomerCode] = item.CustomerName
	}
	if len(wireCustomers) != 2 || wireCustomers["CUS-9001"] != "RPT 客户当前" || wireCustomers["CUS-9002"] != "RPT 第二客户法定名称" {
		t.Fatalf("customer subunit reference response owners = %#v", wireCustomers)
	}
	for _, excludedID := range []string{oldSubunitID, disabledSubunitID, disabledCustomerSubunitID} {
		if excluded := query("does-not-match", excludedID); excluded.Total != 0 || len(excluded.Items.([]CustomerSubunitReference)) != 0 {
			t.Fatalf("stale or disabled customer subunit %q leaked into candidates: total %d items %#v", excludedID, excluded.Total, excluded.Items)
		}
	}
}

func TestRPTStructuralErrorInvalidatesVersionAndDisablesPermissionsIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	service, err := newRPTExecutionService(t, pool)
	if err != nil {
		t.Fatal(err)
	}
	tableName := "rpt_it_" + strings.ReplaceAll(strings.ToLower(newID()), "-", "_")
	if _, err = pool.Exec(t.Context(), fmt.Sprintf(`CREATE TABLE %s(value text NOT NULL)`, tableName)); err != nil {
		t.Fatalf("create report fixture table: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), fmt.Sprintf(`DROP TABLE IF EXISTS %s`, tableName)) })
	if _, err = pool.Exec(t.Context(), fmt.Sprintf(`INSERT INTO %s(value) VALUES('ok'); GRANT SELECT ON %s TO zerp_report_reader`, tableName, tableName)); err != nil {
		t.Fatalf("seed report fixture table: %v", err)
	}
	code := rptCode()
	v1, err := service.CreateDefinition(t.Context(), rptDefinitionCreateInput{Code: code, Name: "有效版本 V1", Data: rptData(`SELECT 'v1'::text AS value`, "value")}, rptIntegrationActor, "rpt-valid-v1-create")
	if err != nil {
		t.Fatalf("create report: %v", err)
	}
	code = v1.Code
	v1Approved, err := service.submitAndApprove(t.Context(), rptApprovalInput{Code: code, VersionID: v1.ID, Revision: v1.Revision}, "rpt-valid-v1-approve")
	if err != nil {
		t.Fatalf("approve V1 report: %v", err)
	}
	v2, err := service.declarations.CreateNext(t.Context(), dcldomain.RptDefinitionVersionInput{
		Code: code, ApprovalEntryID: v1Approved.ID, ApprovalRevision: v1Approved.Revision,
	}, rptActor(t, rptSubmitterID, "rpt-invalid-v2-next"))
	if err != nil {
		t.Fatalf("create V2 report: %v", err)
	}
	serviceSQL := fmt.Sprintf(`SELECT value AS value FROM %s`, tableName)
	v2Name := "失效版本 V2"
	parameters, _ := json.Marshal(rptData(serviceSQL, "value").Parameters)
	columns, _ := json.Marshal(rptData(serviceSQL, "value").Columns)
	v2, err = service.declarations.Save(t.Context(), dcldomain.RptDefinitionSaveInput{
		Code: code, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision,
		Name: &v2Name, Enabled: true, Data: dcldomain.RptDefinitionData{SQL: serviceSQL, Parameters: parameters, Columns: columns},
	}, rptActor(t, rptSubmitterID, "rpt-invalid-v2-save"))
	if err != nil {
		t.Fatalf("save V2 report: %v", err)
	}
	v2Approved, err := service.submitAndApprove(t.Context(), rptApprovalInput{Code: code, VersionID: v2.Approval.ApprovalEntryID, Revision: v2.Approval.Revision}, "rpt-invalid-v2-approve")
	if err != nil {
		t.Fatalf("approve V2 report: %v", err)
	}
	if _, err = pool.Exec(t.Context(), fmt.Sprintf(`DROP TABLE %s`, tableName)); err != nil {
		t.Fatalf("drop report fixture table: %v", err)
	}
	_, err = service.Execute(t.Context(), code, ExecuteInput{Parameters: map[string]any{}}, rptIntegrationActor, "rpt-invalid-query")
	if err == nil || err.Error() != "report is invalid" {
		t.Fatalf("invalid report query error = %v", err)
	}
	var status, validity string
	if err = pool.QueryRow(t.Context(), `SELECT entry.status,validity.validity
		FROM approval_entries entry
		JOIN rpt_definition_validities validity ON validity.approval_entry_id=entry.id
		WHERE entry.id=$1`, v2Approved.ID).Scan(&status, &validity); err != nil {
		t.Fatalf("read invalid report: %v", err)
	}
	if status != "APPROVED" || validity != "INVALID" {
		t.Fatalf("invalid report state = status %q validity %q", status, validity)
	}
	_, queryStatus := rptPermission(t, pool, code, "query")
	_, exportStatus := rptPermission(t, pool, code, "export")
	if queryStatus != "DISABLED" || exportStatus != "DISABLED" {
		t.Fatalf("invalid report permissions = query %q export %q", queryStatus, exportStatus)
	}
	if _, err = service.Execute(t.Context(), code, ExecuteInput{Parameters: map[string]any{}}, rptIntegrationActor, "rpt-invalid-query-again"); err == nil || err.Error() != "report is unavailable" {
		t.Fatalf("second invalid report query error = %v", err)
	}
}

func TestRPTReadOnlySQLAndApprovalTimeoutIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	service, err := newRPTExecutionService(t, pool)
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{"DELETE FROM app_permissions", "SELECT 1; SELECT 2", "WITH removed AS (DELETE FROM app_permissions RETURNING id) SELECT * FROM removed"} {
		if _, err = service.CreateDefinition(t.Context(), rptDefinitionCreateInput{Code: rptCode(), Name: "只读校验", Data: rptData(sql, "value")}, rptIntegrationActor, "rpt-readonly-create"); !rptErrorKind(err, ErrorValidation) {
			t.Fatalf("unsafe SQL %q error = %v", sql, err)
		}
	}

	code := rptCode()
	created, err := service.CreateDefinition(t.Context(), rptDefinitionCreateInput{Code: code, Name: "超时报表", Data: rptData(`SELECT pg_sleep(3) AS value`, "value")}, rptIntegrationActor, "rpt-timeout-create")
	if err != nil {
		t.Fatalf("create timeout report: %v", err)
	}
	code = created.Code
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Second)
	defer cancel()
	if _, err = service.submitAndApprove(ctx, rptApprovalInput{Code: code, VersionID: created.ID, Revision: created.Revision}, "rpt-timeout-approve"); !rptErrorKind(err, ErrorValidation) {
		t.Fatalf("timeout approval error = %v", err)
	}

	runtimeError := rptData(`SELECT 1 / floor(random())::bigint AS value`, "value")
	runtimeError.Columns[0].Type = ResultTypeInteger
	parameters, marshalErr := json.Marshal(runtimeError.Parameters)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	columns, marshalErr := json.Marshal(runtimeError.Columns)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if err = service.ValidateDefinition(t.Context(), runtimeError.SQL, parameters, columns, map[string]any{}); !rptErrorKind(err, ErrorValidation) {
		t.Fatalf("runtime SQL error = %v, want validation error", err)
	}
}

func TestRPTBuiltInReportsUseOrdinaryExecutionPathIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	service, err := newRPTExecutionService(t, pool)
	if err != nil {
		t.Fatal(err)
	}
	codes := []string{
		"account-journal", "subject-balance", "customer-aging", "supplier-aging",
		"inventory-movement", "bills", "containers", "employee-loans",
	}
	for _, code := range codes {
		t.Run(code, func(t *testing.T) {
			var status, validity, queryStatus, exportStatus string
			err := pool.QueryRow(t.Context(), `SELECT e.status,v.validity,q.status,x.status
				FROM dcl_subjects d
				JOIN LATERAL (
					SELECT entry.id,entry.status
					FROM approval_entries entry
					WHERE entry.domain='dcl' AND entry.entity='rpt-definition'
						AND entry.subject_id=d.id AND entry.status='APPROVED'
					ORDER BY entry.version_no DESC LIMIT 1
				) e ON true
				JOIN rpt_definition_validities v ON v.approval_entry_id=e.id
				JOIN app_permissions q ON q.path='/rpt/'||d.code||'/query'
				JOIN app_permissions x ON x.path='/rpt/'||d.code||'/export' WHERE d.entity='rpt-definition' AND d.code=$1`, code).
				Scan(&status, &validity, &queryStatus, &exportStatus)
			if err != nil || status != "APPROVED" || validity != "VALID" || queryStatus != "ENABLED" || exportStatus != "ENABLED" {
				t.Fatalf("built-in state: status=%q validity=%q query=%q export=%q err=%v", status, validity, queryStatus, exportStatus, err)
			}
			result, err := service.Execute(t.Context(), code, ExecuteInput{Parameters: map[string]any{}}, rptIntegrationActor, "rpt-built-in")
			if err != nil {
				t.Fatalf("execute built-in: %v", err)
			}
			if result.Page != 1 || result.PageSize != 50 || result.Columns == nil || result.Items == nil {
				t.Fatalf("built-in result = %+v", result)
			}
		})
	}
}

func rptNormalizedRow(t *testing.T, result QueryResult) map[string]any {
	t.Helper()
	if len(result.Items) != 1 {
		t.Fatalf("result rows = %d, want 1: %+v", len(result.Items), result.Items)
	}
	raw, err := json.Marshal(result.Items[0])
	if err != nil {
		t.Fatal(err)
	}
	var row map[string]any
	if err = json.Unmarshal(raw, &row); err != nil {
		t.Fatal(err)
	}
	return row
}

func TestRPTBuiltInAccountingSemanticsIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	service, err := newRPTExecutionService(t, pool)
	if err != nil {
		t.Fatal(err)
	}
	bookID, bookCode := newID(), "RPT-"+strings.ToUpper(newID()[:8])
	customerSubunitID, customerID, customerApprovalEntryID := newID(), newID(), newID()
	supplierID, employeeID := newID(), newID()
	actor := rptIntegrationActor
	if _, err = pool.Exec(t.Context(), `INSERT INTO acc_books(id,code,name,start_month,base_currency,created_by,updated_by)
		VALUES($1,$2,'RPT semantic book','2026-01-01','CNY',$3,$3)`, bookID, bookCode, actor); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM acc_container_entries WHERE source_document_id IN (SELECT source_id FROM acc_vouchers WHERE book_id=$1);
			DELETE FROM acc_bill_book_values WHERE book_id=$1; DELETE FROM acc_bills WHERE source_document_id=$1;
			DELETE FROM acc_inventory_cost_allocations WHERE book_id=$1; DELETE FROM acc_inventory_entries WHERE book_id=$1;
			DELETE FROM acc_voucher_lines WHERE book_id=$1; DELETE FROM acc_vouchers WHERE book_id=$1;
			DELETE FROM acc_subjects WHERE book_id=$1; DELETE FROM acc_books WHERE id=$1`, bookID)
	})
	type subject struct{ id, code, purpose, direction, dimension string }
	subjects := []subject{
		{newID(), "1122", "RECEIVABLE", "DEBIT", "CUSTOMER_SUBUNIT"},
		{newID(), "2203", "ADVANCE_RECEIPT", "CREDIT", "CUSTOMER_SUBUNIT"},
		{newID(), "2202", "PAYABLE", "CREDIT", "SUPPLIER"},
		{newID(), "1123", "PREPAID", "DEBIT", "SUPPLIER"},
		{newID(), "1221", "OTHER", "DEBIT", "EMPLOYEE"},
		{newID(), "1405", "NONE", "DEBIT", "WAREHOUSE"},
	}
	for _, item := range subjects {
		inventory := item.code == "1405"
		if _, err = pool.Exec(t.Context(), `INSERT INTO acc_subjects(id,book_id,code,name,balance_direction,settlement_purpose,inventory_quantity,created_by,updated_by)
			VALUES($1,$2,$3,$3,$4,$5,$6,$7,$7)`, item.id, bookID, item.code, item.direction, item.purpose, inventory, actor); err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(t.Context(), `INSERT INTO acc_subject_dimensions(subject_id,dimension) VALUES($1,$2)`, item.id, item.dimension); err != nil {
			t.Fatal(err)
		}
		if inventory {
			if _, err = pool.Exec(t.Context(), `INSERT INTO acc_subject_dimensions(subject_id,dimension) VALUES($1,'PRODUCT')`, item.id); err != nil {
				t.Fatal(err)
			}
		}
	}
	subjectID := func(code string) string {
		for _, item := range subjects {
			if item.code == code {
				return item.id
			}
		}
		return ""
	}
	type posting struct {
		entity, date, due, subjectID, direction, dimension, referenceID string
		amount                                                          int64
	}
	postings := []posting{
		{"sale-delivery", "2026-01-01", "2026-01-01", subjectID("1122"), "DEBIT", "CUSTOMER_SUBUNIT", customerSubunitID, 10000},
		{"sale-delivery", "2026-02-01", "2026-02-01", subjectID("1122"), "DEBIT", "CUSTOMER_SUBUNIT", customerSubunitID, 5000},
		{"sales-receipt", "2026-02-10", "2026-02-10", subjectID("2203"), "CREDIT", "CUSTOMER_SUBUNIT", customerSubunitID, 12000},
		{"purchase-inbound", "2026-01-05", "2026-01-05", subjectID("2202"), "CREDIT", "SUPPLIER", supplierID, 20000},
		{"purchase-payment", "2026-02-05", "2026-02-05", subjectID("1123"), "DEBIT", "SUPPLIER", supplierID, 15000},
		{"employee-loan", "2026-01-10", "2026-01-10", subjectID("1221"), "DEBIT", "EMPLOYEE", employeeID, 10000},
		{"employee-repayment", "2026-02-10", "2026-02-10", subjectID("1221"), "CREDIT", "EMPLOYEE", employeeID, 12000},
	}
	for index, item := range postings {
		voucherID, documentID := newID(), newID()
		if _, err = pool.Exec(t.Context(), `INSERT INTO acc_vouchers(id,book_id,source_type,source_id,business_date,source_entity,source_revision,source_document_no,created_by)
			VALUES($1,$2,'COST_SETTLEMENT',$3,$4,$5,1,$6,$7)`, voucherID, bookID, documentID, item.date, item.entity, fmt.Sprintf("RPT-%02d", index), actor); err != nil {
			t.Fatal(err)
		}
		dimensions, _ := json.Marshal(map[string]string{item.dimension: item.referenceID})
		dimensionReferences := []byte(`{}`)
		if item.dimension == "CUSTOMER_SUBUNIT" {
			dimensionReferences, _ = json.Marshal(map[string]map[string]string{
				"CUSTOMER_SUBUNIT": {
					"entity": "customer-subunit", "objectId": customerSubunitID,
					"customerId": customerID, "approvalEntryId": customerApprovalEntryID,
					"code": "SUB-HISTORY", "name": "历史客户子单位",
				},
			})
		}
		debit, credit := int64(0), int64(0)
		if item.direction == "DEBIT" {
			debit = item.amount
		} else {
			credit = item.amount
		}
		if _, err = pool.Exec(t.Context(), `INSERT INTO acc_voucher_lines(id,voucher_id,book_id,subject_id,currency,debit_minor,credit_minor,dimensions,dimension_references,source_line_id,line_order)
			VALUES($1,$2,$3,$4,'CNY',$5,$6,$7,$8,$9,1)`, newID(), voucherID, bookID, item.subjectID, debit, credit, dimensions, dimensionReferences, documentID); err != nil {
			t.Fatal(err)
		}
	}
	var customerFacts int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.id=line.voucher_id JOIN acc_subjects subject ON subject.id=line.subject_id WHERE line.book_id=$1 AND line.dimensions ? 'CUSTOMER_SUBUNIT' AND subject.settlement_purpose IN ('RECEIVABLE','ADVANCE_RECEIPT') AND voucher.business_date<='2026-03-01'`, bookID).Scan(&customerFacts); err != nil || customerFacts != 3 {
		t.Fatalf("customer fact fixture count = %d, err=%v", customerFacts, err)
	}
	execute := func(code string, parameters map[string]any) map[string]any {
		result, queryErr := service.Execute(t.Context(), code, ExecuteInput{Parameters: parameters}, actor, "rpt-semantics-"+code)
		if queryErr != nil {
			t.Fatalf("execute %s: %v", code, queryErr)
		}
		if len(result.Items) != 1 {
			t.Fatalf("execute %s rows = %d, want 1: %+v", code, len(result.Items), result.Items)
		}
		return rptNormalizedRow(t, result)
	}
	customer := execute("customer-aging", map[string]any{"bookId": bookID, "customerSubunitId": customerSubunitID, "currency": "CNY", "asOfDate": "2026-03-01", "minAgeDays": float64(0)})
	if customer["customer_subunit_id"] != customerSubunitID {
		t.Fatalf("customer subunit result = %+v", customer)
	}
	if customer["customer_subunit_code"] != "SUB-HISTORY" || customer["customer_subunit_name"] != "历史客户子单位" {
		t.Fatalf("customer subunit fact snapshot = %+v", customer)
	}
	if customer["receivable_amount"] != 150.0 || customer["advance_amount"] != 120.0 || customer["unsettled_amount"] != 30.0 || customer["oldest_age_days"] != 28.0 {
		t.Fatalf("customer FIFO row = %+v", customer)
	}
	supplier := execute("supplier-aging", map[string]any{"bookId": bookID, "supplierId": supplierID, "currency": "CNY", "asOfDate": "2026-03-01", "minAgeDays": float64(0)})
	if supplier["payable_amount"] != 200.0 || supplier["advance_amount"] != 150.0 || supplier["unsettled_amount"] != 50.0 {
		t.Fatalf("supplier FIFO row = %+v", supplier)
	}
	employee := execute("employee-loans", map[string]any{"bookId": bookID, "employeeId": employeeID, "currency": "CNY", "asOfDate": "2026-03-01"})
	if employee["balance"] != -20.0 || employee["unsettled_amount"] != 20.0 || employee["balance_meaning"] != "PAYABLE_TO_EMPLOYEE" {
		t.Fatalf("employee FIFO row = %+v", employee)
	}

	warehouseID, productID := newID(), newID()
	for _, entry := range []struct {
		date             string
		quantity, amount int64
	}{{"2026-01-15", 10_000_000, 10000}, {"2026-02-15", -4_000_000, 4000}} {
		voucherID, documentID, lineID, entryID := newID(), newID(), newID(), newID()
		if _, err = pool.Exec(t.Context(), `INSERT INTO acc_vouchers(id,book_id,source_type,source_id,business_date,source_entity,created_by) VALUES($1,$2,'COST_SETTLEMENT',$3,$4,'sale-delivery',$5)`, voucherID, bookID, documentID, entry.date, actor); err != nil {
			t.Fatal(err)
		}
		lineAmount := entry.amount
		quantityMicros := entry.quantity
		if entry.quantity < 0 {
			lineAmount = 0
			quantityMicros = -entry.quantity
		}
		if _, err = pool.Exec(t.Context(), `INSERT INTO acc_voucher_lines(id,book_id,voucher_id,subject_id,currency,debit_minor,credit_minor,quantity_micros,dimensions,source_line_id,line_order) VALUES($1,$2,$3,$4,'CNY',$5,0,$6,$7,$8,1)`, lineID, bookID, voucherID, subjectID("1405"), lineAmount, quantityMicros, []byte(`{"WAREHOUSE":"`+warehouseID+`","PRODUCT":"`+productID+`"}`), documentID); err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(t.Context(), `INSERT INTO acc_inventory_entries(id,book_id,voucher_id,voucher_line_id,subject_id,product_id,product_approval_entry_id,product_code,product_name,warehouse_id,business_date,quantity_delta_micros,source_line_id) VALUES($1,$2,$3,$4,$5,$6,$7,'PRD-0001','报表测试产品',$8,$9,$10,$11)`, entryID, bookID, voucherID, lineID, subjectID("1405"), productID, newID(), warehouseID, entry.date, entry.quantity, documentID); err != nil {
			t.Fatal(err)
		}
		if entry.quantity < 0 {
			if _, err = pool.Exec(t.Context(), `INSERT INTO acc_inventory_cost_allocations(entry_id,book_id,period_month,quantity_micros,cost_minor) VALUES($1,$2,'2026-02-01',$3,$4)`, entryID, bookID, -entry.quantity, entry.amount); err != nil {
				t.Fatal(err)
			}
		}
	}
	inventory := execute("inventory-movement", map[string]any{"bookId": bookID, "subjectId": subjectID("1405"), "warehouseId": warehouseID, "productId": productID, "asOfDate": "2026-02-28"})
	if inventory["ending_quantity"] != 6.0 || inventory["ending_amount"] != 60.0 || inventory["average_unit_cost"] != 10.0 {
		t.Fatalf("inventory row = %+v", inventory)
	}

	billID := newID()
	billNo := "BILL-" + newID()
	if _, err = pool.Exec(t.Context(), `INSERT INTO acc_bills(id,bill_no,bill_type,position_type,currency,medium,face_amount_minor,issue_date,maturity_date,drawer,acceptor,payee,annual_rate_bps,interest_days,interest_amount_minor,customer_cost_amount_minor,state,source_document_id,source_line_id) VALUES($1,$2,'BANK_ACCEPTANCE','ASSET','CNY','ELECTRONIC',10000,'2026-01-01','2026-06-01','D','A','P',0,0,0,0,'AVAILABLE',$3,$4)`, billID, billNo, bookID, newID()); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO acc_bill_book_values(book_id,bill_id,value_minor) VALUES($1,$2,10000)`, bookID, billID); err != nil {
		t.Fatal(err)
	}
	bill := execute("bills", map[string]any{"bookId": bookID, "billId": billID, "counterpartyObjectId": "", "status": "", "asOfDate": "2026-02-01"})
	if bill["business_status"] != "AVAILABLE" {
		t.Fatalf("bill cutoff row = %+v", bill)
	}

	for _, event := range []struct {
		date     string
		quantity int64
	}{{"2026-01-10", 10}, {"2026-02-10", -4}, {"2026-02-20", -1}} {
		documentID := newID()
		if _, err = pool.Exec(t.Context(), `INSERT INTO acc_vouchers(id,book_id,source_type,source_id,business_date,source_entity,created_by) VALUES($1,$2,'COST_SETTLEMENT',$3,$4,'sale-signoff',$5)`, newID(), bookID, documentID, event.date, actor); err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(t.Context(), `INSERT INTO acc_container_entries(id,customer_subunit_id,customer_id,customer_approval_entry_id,customer_subunit_code,customer_subunit_name,container_type,quantity_delta,source_document_id,source_revision) VALUES($1,$2,$3,$4,'SUB-RPT','报表客户子单位','SOLVENT',$5,$6,1)`, newID(), customerSubunitID, customerID, customerApprovalEntryID, event.quantity, documentID); err != nil {
			t.Fatal(err)
		}
	}
	container := execute("containers", map[string]any{"bookId": bookID, "customerSubunitId": customerSubunitID, "containerType": "SOLVENT", "asOfDate": "2026-02-28"})
	if container["customer_subunit_id"] != customerSubunitID || container["customer_id"] != customerID || container["customer_approval_entry_id"] != customerApprovalEntryID || container["customer_subunit_code"] != "SUB-RPT" || container["customer_subunit_name"] != "报表客户子单位" {
		t.Fatalf("container snapshot row = %+v", container)
	}
	if container["issued_quantity"] != 0.0 || container["returned_quantity"] != 5.0 || container["adjusted_quantity"] != 0.0 || container["balance_quantity"] != 5.0 || container["amount"] != nil {
		t.Fatalf("container row = %+v", container)
	}
}

func TestRPTCSVExportStreamsAndRejectsOversizeIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	service, err := newRPTExecutionService(t, pool)
	if err != nil {
		t.Fatal(err)
	}
	code := rptCode()
	data := rptData(`SELECT i::bigint AS value FROM generate_series(1,3) i ORDER BY i`, "value")
	data.Columns[0].Type = ResultTypeInteger
	created, err := service.CreateDefinition(t.Context(), rptDefinitionCreateInput{Code: code, Name: "CSV 导出", Data: data}, rptIntegrationActor, "rpt-export-create")
	if err != nil {
		t.Fatal(err)
	}
	code = created.Code
	if _, err = service.submitAndApprove(t.Context(), rptApprovalInput{Code: code, VersionID: created.ID, Revision: created.Revision}, "rpt-export-approve"); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	authorizer := authorization.Func(func(context.Context, *http.Request, string, string) (authorization.Principal, error) {
		return authorization.Principal{ActorID: rptIntegrationActor, Permissions: []string{permissionPath(code, "export")}}, nil
	})
	NewHandler(service.Service, authorizer, slog.Default()).Register(router)
	metadataRequest := httptest.NewRequest(http.MethodPost, "/rpt/directory/query", bytes.NewBufferString(`{"page":1,"pageSize":20}`))
	metadataRequest.Header.Set("Content-Type", "application/json")
	metadataRecorder := httptest.NewRecorder()
	router.ServeHTTP(metadataRecorder, metadataRequest)
	var metadataEnvelope struct {
		Data map[string]any `json:"data"`
	}
	if err = json.Unmarshal(metadataRecorder.Body.Bytes(), &metadataEnvelope); err != nil {
		t.Fatal(err)
	}
	if metadataRecorder.Code != http.StatusOK || metadataEnvelope.Data["items"] == nil || metadataEnvelope.Data["sql"] != nil {
		t.Fatalf("metadata status=%d data=%+v", metadataRecorder.Code, metadataEnvelope.Data)
	}
	unknownRequest := httptest.NewRequest(http.MethodPost, "/rpt/directory/query", bytes.NewBufferString(`{"page":1,"pageSize":20,"unexpected":true}`))
	unknownRequest.Header.Set("Content-Type", "application/json")
	unknownRecorder := httptest.NewRecorder()
	router.ServeHTTP(unknownRecorder, unknownRequest)
	var unknownEnvelope struct {
		Code int `json:"code"`
	}
	if err = json.Unmarshal(unknownRecorder.Body.Bytes(), &unknownEnvelope); err != nil {
		t.Fatal(err)
	}
	if unknownRecorder.Code != http.StatusOK || unknownEnvelope.Code != response.CodeValidation {
		t.Fatalf("directory accepted unknown request field: status=%d body=%s", unknownRecorder.Code, unknownRecorder.Body.String())
	}
	request := httptest.NewRequest(http.MethodPost, "/rpt/"+code+"/export", bytes.NewBufferString(`{"parameters":{}}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "text/csv; charset=utf-8" || recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("export response status=%d headers=%v body=%s", recorder.Code, recorder.Header(), recorder.Body.String())
	}
	if got := recorder.Body.String(); got != "value\n1\n2\n3\n" {
		t.Fatalf("CSV = %q", got)
	}

	oversizeCode := rptCode()
	oversize := rptData(`SELECT i::text AS value FROM generate_series(1,100001) i`, "value")
	created, err = service.CreateDefinition(t.Context(), rptDefinitionCreateInput{Code: oversizeCode, Name: "超限导出", Data: oversize}, rptIntegrationActor, "rpt-oversize-create")
	if err != nil {
		t.Fatal(err)
	}
	oversizeCode = created.Code
	if _, err = service.submitAndApprove(t.Context(), rptApprovalInput{Code: oversizeCode, VersionID: created.ID, Revision: created.Revision}, "rpt-oversize-approve"); err != nil {
		t.Fatal(err)
	}
	consumed := false
	err = service.StreamExport(t.Context(), oversizeCode, ExecuteInput{Parameters: map[string]any{}}, rptIntegrationActor, "rpt-oversize-export", func([]ResultColumn, pgx.Rows) error { consumed = true; return nil })
	if !rptErrorKind(err, ErrorValidation) || consumed {
		t.Fatalf("oversize export err=%v consumed=%t", err, consumed)
	}
}

func TestRPTExecutionStatementTimeoutIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	service, err := newRPTExecutionService(t, pool)
	if err != nil {
		t.Fatal(err)
	}
	code := rptCode()
	data := rptData(`SELECT value FROM (SELECT pg_sleep($1), 'ok'::text AS value) rpt_sleep`, "value")
	data.Parameters = []Parameter{{Key: "delay", Name: "延迟秒数", Type: ParameterTypeInteger, Required: true}}
	created, err := service.CreateDefinition(t.Context(), rptDefinitionCreateInput{Code: code, Name: "执行超时报表", Data: data}, rptIntegrationActor, "rpt-execution-timeout-create")
	if err != nil {
		t.Fatalf("create execution timeout report: %v", err)
	}
	code = created.Code
	validationParameters := map[string]any{"delay": float64(0)}
	if _, err = service.submitAndApprove(t.Context(), rptApprovalInput{Code: code, VersionID: created.ID, Revision: created.Revision, ValidationParameters: validationParameters}, "rpt-execution-timeout-approve"); err != nil {
		t.Fatalf("approve execution timeout report: %v", err)
	}
	queryParameters := map[string]any{"delay": float64(6)}
	_, err = service.Execute(t.Context(), code, ExecuteInput{Parameters: queryParameters}, rptIntegrationActor, "rpt-execution-timeout-query")
	if err == nil || !rptErrorKind(err, ErrorInternal) {
		t.Fatalf("execution timeout error = %v", err)
	}
	var validity string
	if err = pool.QueryRow(t.Context(), `SELECT validity FROM rpt_definition_validities WHERE approval_entry_id=$1`, created.ID).Scan(&validity); err != nil {
		t.Fatalf("read execution timeout validity: %v", err)
	}
	if validity != "VALID" {
		t.Fatalf("execution timeout changed validity to %q", validity)
	}
}
