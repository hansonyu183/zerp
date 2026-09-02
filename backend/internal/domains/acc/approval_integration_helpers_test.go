//go:build integration

package acc

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type accountingProductSnapshot struct {
	ObjectID, ApprovalEntryID, Code, Name string
}

type accountingCustomerAccountSnapshot struct {
	CustomerID, ObjectID, ApprovalEntryID, Code, Name string
}

func createAccountingCustomerAccountSnapshot(t *testing.T, pool *pgxpool.Pool, name string) accountingCustomerAccountSnapshot {
	t.Helper()
	customerID, accountID, entryID := ulid.Make().String(), ulid.Make().String(), ulid.Make().String()
	code := fmt.Sprintf("ACC-%04d", atomic.AddUint32(&accountingProductCodeSequence, 1))
	customerData := map[string]any{
		"kind": "MAINLAND_ENTERPRISE", "legalName": name, "displayName": name,
		"legalIdentifier": "91350211M00010001X", "remittanceProfiles": []any{},
		"defaultOperatingEntityId": ulid.Make().String(),
		"defaultOperatingEntity":   map[string]any{"sourceObjectId": ulid.Make().String(), "approvalEntryId": ulid.Make().String(), "code": "OPE-0001", "name": "经营主体"},
		"enabled":                  true, "accounts": []any{},
	}
	accountData := map[string]any{
		"accountId": accountID, "enabled": true, "isDefault": true, "name": name,
		"customerTypeId": ulid.Make().String(), "transportSurcharge": "0.00",
		"pricingPolicy": map[string]any{"costItems": []any{}}, "creditLimits": []any{},
		"primarySalesAttribution": map[string]any{}, "code": code, "attachments": []any{},
		"customerType": map[string]any{"objectId": ulid.Make().String(), "code": "DIT-0001", "name": "客户"},
	}
	encodedCustomer, err := json.Marshal(customerData)
	if err != nil {
		t.Fatal(err)
	}
	encodedAccount, err := json.Marshal(accountData)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	statements := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'customer',$2,$3)`, []any{customerID, "CUS-" + code[4:], adminID}},
		{`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'dcl','customer',$2,1,'APPROVED',1,$3,now(),$3,now(),$3,now(),$4,now())`, []any{entryID, customerID, adminID, operatorID}},
		{`INSERT INTO dcl_customer_versions(approval_entry_id,kind,legal_identifier,data,enabled) VALUES($1,'MAINLAND_ENTERPRISE','91350211M00010001X',$2,TRUE)`, []any{entryID, encodedCustomer}},
		{`INSERT INTO dcl_customer_account_roots(account_id,customer_id,code,ever_approved,first_approved_customer_entry_id) VALUES($1,$2,$3,TRUE,$4)`, []any{accountID, customerID, code, entryID}},
		{`INSERT INTO dcl_customer_version_accounts(customer_approval_entry_id,account_id,data,enabled,is_default) VALUES($1,$2,$3,TRUE,TRUE)`, []any{entryID, accountID, encodedAccount}},
	}
	for _, statement := range statements {
		if _, err = tx.Exec(t.Context(), statement.sql, statement.args...); err != nil {
			t.Fatalf("create accounting customer account snapshot: %v", err)
		}
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	return accountingCustomerAccountSnapshot{CustomerID: customerID, ObjectID: accountID, ApprovalEntryID: entryID, Code: code, Name: name}
}

type dclMappingFixtureInput struct {
	BookID, VouEntity, DefaultResult string
	Definition                       MappingDefinition
}

var accountingProductCodeSequence uint32 = 8000

func accMappingIntegrationError(err error) error {
	var dclErr *dcldomain.DomainError
	if !errors.As(err, &dclErr) {
		return err
	}
	kind := ErrorInternal
	switch dclErr.Kind {
	case dcldomain.ErrorValidation:
		kind = ErrorValidation
	case dcldomain.ErrorForbidden:
		kind = ErrorForbidden
	case dcldomain.ErrorConflict:
		kind = ErrorConflict
	}
	return domainErrorWithKey(kind, dclErr.ErrorKey, dclErr.Message, err)
}

func createAccountingProductSnapshot(t *testing.T, pool *pgxpool.Pool, objectID, name string) accountingProductSnapshot {
	t.Helper()
	entryID := ulid.Make().String()
	code := fmt.Sprintf("PRD-%04d", atomic.AddUint32(&accountingProductCodeSequence, 1))
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin accounting product snapshot: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'product',$2,$3)`, []any{objectID, code, adminID}},
		{`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'dcl','product',$2,1,'APPROVED',1,$3,now(),$3,now(),$3,now(),$4,now())`, []any{entryID, objectID, adminID, operatorID}},
		{`INSERT INTO dcl_product_versions(approval_entry_id,name,enabled) VALUES($1,$2,TRUE)`, []any{entryID, name}},
	} {
		if _, err := tx.Exec(t.Context(), statement.sql, statement.args...); err != nil {
			t.Fatalf("create accounting product snapshot: %v", err)
		}
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit accounting product snapshot: %v", err)
	}
	return accountingProductSnapshot{ObjectID: objectID, ApprovalEntryID: entryID, Code: code, Name: name}
}

func createAccountingProductVersion(t *testing.T, pool *pgxpool.Pool, previous accountingProductSnapshot, name string) accountingProductSnapshot {
	t.Helper()
	entryID := ulid.Make().String()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin accounting product version: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'dcl','product',$2,2,'APPROVED',1,$3,now(),$3,now(),$3,now(),$4,now())`, []any{entryID, previous.ObjectID, adminID, operatorID}},
		{`INSERT INTO dcl_product_versions(approval_entry_id,name,enabled) VALUES($1,$2,TRUE)`, []any{entryID, name}},
	} {
		if _, err := tx.Exec(t.Context(), statement.sql, statement.args...); err != nil {
			t.Fatalf("create accounting product version: %v", err)
		}
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit accounting product version: %v", err)
	}
	return accountingProductSnapshot{ObjectID: previous.ObjectID, ApprovalEntryID: entryID, Code: previous.Code, Name: name}
}

func integrationACCService(pool *pgxpool.Pool, bus *txevent.Bus) *Service {
	return NewService(pool, newAccountingIntegrationBOBService(pool, bus), authorization.Func(nil), bus)
}

func defaultIntegrationACCService(pool *pgxpool.Pool) *Service {
	return integrationACCService(pool, txevent.NewBus())
}

func integrationACCActor(t *testing.T, actorID, requestID string) approval.Actor {
	t.Helper()
	actor, err := approval.UserActor(authorization.Principal{ActorID: actorID}, requestID)
	if err != nil {
		t.Fatal(err)
	}
	return actor
}

func ensureIntegrationBookAccess(t *testing.T, service *Service, bookID, userID string) {
	t.Helper()
	if _, err := service.pool.Exec(t.Context(), `
		INSERT INTO acc_book_user_scopes(book_id,user_id,query_access,operate_access,created_by)
		VALUES($1,$2,TRUE,TRUE,$3)
		ON CONFLICT (book_id,user_id) DO UPDATE
		SET query_access=TRUE, operate_access=TRUE
	`, bookID, userID, adminID); err != nil {
		t.Fatalf("grant integration book access: %v", err)
	}
}

func approveIntegrationOpening(t *testing.T, service *Service, bookID string, draft OpeningView) OpeningView {
	t.Helper()
	ensureIntegrationBookAccess(t, service, bookID, operatorID)
	submitter := integrationACCActor(t, adminID, fmt.Sprintf("acc-opening-submit-%s", bookID))
	reviewer := integrationACCActor(t, operatorID, fmt.Sprintf("acc-opening-approve-%s", bookID))
	pending, err := service.SubmitOpening(t.Context(), bookID, draft.Approval.Revision, submitter)
	if err != nil {
		t.Fatalf("submit integration opening: %v", err)
	}
	approved, err := service.ApproveOpening(t.Context(), bookID, pending.Approval.Revision, reviewer)
	if err != nil {
		t.Fatalf("approve integration opening: %v", err)
	}
	return approved
}

func createApprovedZeroOpening(t *testing.T, service *Service, book BookView) {
	t.Helper()
	draft, err := service.SaveOpening(t.Context(), SaveOpeningInput{
		BookID: book.ID, Revision: 0,
		Lines: []OpeningLineInput{}, Assets: []OpeningAssetInput{}, Bills: []OpeningBillInput{}, Containers: []OpeningContainerInput{},
	}, integrationACCActor(t, adminID, "acc-zero-opening-save-"+book.ID))
	if err != nil {
		t.Fatalf("save zero opening for %s: %v", book.Code, err)
	}
	approved := approveIntegrationOpening(t, service, book.ID, draft)
	if approved.Approval.Status != approval.StatusApproved {
		t.Fatalf("approve zero opening for %s: %+v", book.Code, approved)
	}
}

func approveIntegrationMapping(t *testing.T, service *Service, bookID, entity string, draft MappingView) MappingView {
	t.Helper()
	ensureIntegrationBookAccess(t, service, bookID, operatorID)
	submitter := integrationACCActor(t, adminID, fmt.Sprintf("acc-mapping-submit-%s-%s", bookID, entity))
	reviewer := integrationACCActor(t, operatorID, fmt.Sprintf("acc-mapping-approve-%s-%s", bookID, entity))
	dclService := testDCLAccMappingService(service)
	pending, err := dclService.Submit(t.Context(), dcldomain.AccMappingVersionInput{
		BookID: bookID, VouEntity: entity, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision,
	}, submitter)
	if err != nil {
		t.Fatalf("submit integration mapping: %v", err)
	}
	approved, err := dclService.Approve(t.Context(), dcldomain.AccMappingVersionInput{
		BookID: bookID, VouEntity: entity, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision,
	}, reviewer)
	if err != nil {
		t.Fatalf("approve integration mapping: %v", err)
	}
	return getDCLIntegrationMapping(t, service, bookID, entity, approved.Approval.ApprovalEntryID, reviewer)
}

func testDCLAccMappingService(service *Service) *dcldomain.AccMappingService {
	return dcldomain.NewAccMappingService(service.pool, service, authorization.Func(nil), txevent.NewBus())
}

func dclMappingData(t *testing.T, defaultResult string, definition MappingDefinition) dcldomain.AccMappingData {
	t.Helper()
	encoded, err := json.Marshal(definition)
	if err != nil {
		t.Fatalf("encode integration mapping: %v", err)
	}
	return dcldomain.AccMappingData{DefaultResult: defaultResult, Definition: encoded}
}

func accMappingViewFromDCL(t *testing.T, view dcldomain.AccMappingView) MappingView {
	t.Helper()
	result, err := mappingView(view.BookID, view.VouEntity, view.Data.DefaultResult, view.Data.Definition, approval.Entry{
		EntryRef: approval.EntryRef{
			ID: view.Approval.ApprovalEntryID, Domain: "dcl", Entity: dcldomain.EntityAccMapping,
			VersionNo: &view.Approval.VersionNo,
		},
		Status: view.Approval.Status, Revision: view.Approval.Revision,
		CreatedBy: view.Approval.CreatedBy, CreatedAt: view.Approval.CreatedAt,
		UpdatedBy: view.Approval.UpdatedBy, UpdatedAt: view.Approval.UpdatedAt,
		SubmittedBy: view.Approval.SubmittedBy, SubmittedAt: view.Approval.SubmittedAt,
		ApprovedBy: view.Approval.ApprovedBy, ApprovedAt: view.Approval.ApprovedAt,
	})
	if err != nil {
		t.Fatalf("project DCL integration mapping: %v", err)
	}
	return result
}

func getDCLIntegrationMapping(t *testing.T, service *Service, bookID, entity, entryID string, actor approval.Actor) MappingView {
	t.Helper()
	view, err := testDCLAccMappingService(service).Get(t.Context(), dcldomain.AccMappingGetInput{BookID: bookID, VouEntity: entity, ApprovalEntryID: entryID}, actor)
	if err != nil {
		t.Fatalf("get DCL integration mapping: %v", err)
	}
	return accMappingViewFromDCL(t, view)
}

// createDCLIntegrationMapping keeps ACC posting fixtures on the typed DCL
// lifecycle without adding declaration methods to the ACC service surface.
func createDCLIntegrationMapping(t *testing.T, s *Service, input dclMappingFixtureInput, actor approval.Actor) (MappingView, error) {
	t.Helper()
	service := testDCLAccMappingService(s)
	mutation, err := service.Create(t.Context(), dcldomain.AccMappingCreateInput{BookID: input.BookID, VouEntity: input.VouEntity, Data: dclMappingData(t, input.DefaultResult, input.Definition)}, actor)
	if err != nil {
		return MappingView{}, accMappingIntegrationError(err)
	}
	view, err := service.Get(t.Context(), dcldomain.AccMappingGetInput{BookID: input.BookID, VouEntity: input.VouEntity, ApprovalEntryID: mutation.Approval.ApprovalEntryID}, actor)
	if err != nil {
		return MappingView{}, accMappingIntegrationError(err)
	}
	return accMappingViewFromDCL(t, view), nil
}
