//go:build integration

package dcl

import (
	"context"
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func TestCustomerOtherLegalIdentifierKeepsCaseDistinctIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := NewCustomerService(pool, legalIdentifierCustomerRules{}, authorization.Func(nil), txevent.NewBus())
	actor := dclActor(t, ulid.Make().String(), "customer-other-case")

	for _, identifier := range []string{"other-a", "OTHER-A"} {
		if _, err := service.Create(t.Context(), CustomerCreateInput{Data: legalIdentifierCustomerInput(identifier)}, actor); err != nil {
			t.Fatalf("create Customer with %q: %v", identifier, err)
		}
	}

	var claims int
	if err := pool.QueryRow(t.Context(), `
		SELECT count(*) FROM dcl_customer_legal_identifier_claims
		WHERE normalized_legal_identifier IN ('other-a', 'OTHER-A')
	`).Scan(&claims); err != nil {
		t.Fatalf("count Customer OTHER claims: %v", err)
	}
	if claims != 2 {
		t.Fatalf("Customer OTHER claims = %d, want 2 distinct case-sensitive values", claims)
	}
}

func TestCustomerDraftAllowsEmptyLegalIdentifierIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := NewCustomerService(pool, legalIdentifierCustomerRules{}, authorization.Func(nil), txevent.NewBus())
	actor := dclActor(t, ulid.Make().String(), "customer-empty-identifier")

	draft, err := service.Create(t.Context(), CustomerCreateInput{Data: legalIdentifierCustomerInput("")}, actor)
	if err != nil {
		t.Fatalf("create Customer draft without legal identifier: %v", err)
	}
	view, err := service.Get(t.Context(), CustomerGetInput{ObjectID: draft.ObjectID}, actor)
	if err != nil {
		t.Fatalf("get Customer draft without legal identifier: %v", err)
	}
	if view.Data.LegalIdentifier != "" {
		t.Fatalf("Customer draft legal identifier = %q, want empty", view.Data.LegalIdentifier)
	}
}

func TestEmployeeLegalIdentifierIsValidatedAcrossLifecycleIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	actor := dclActor(t, ulid.Make().String(), "employee-identifier-creator")
	reviewer := dclActor(t, ulid.Make().String(), "employee-identifier-reviewer")
	operatingEntityID := legalIdentifierOperatingEntity(t, pool, business, authorizer, bus, actor, reviewer)
	service := NewEmployeeService(pool, business, authorizer, bus)

	for _, input := range []EmployeeInput{
		legalIdentifierEmployeeInput("PERSON", "110101199002300015", operatingEntityID),
		legalIdentifierEmployeeInput("ORGANIZATION", "91350211M000100Y43", operatingEntityID),
	} {
		if _, err := service.Create(t.Context(), EmployeeCreateInput{Data: input}, actor); err == nil {
			t.Fatalf("create Employee accepted invalid %s identifier %q", input.Kind, input.LegalIdentifier)
		} else {
			requireLegalIdentifierError(t, err, "invalid_legal_identifier")
		}
	}

	draft, err := service.Create(t.Context(), EmployeeCreateInput{Data: legalIdentifierEmployeeInput("PERSON", "", operatingEntityID)}, actor)
	if err != nil {
		t.Fatalf("create Employee without draft identifier: %s", legalIdentifierErrorDetail(err))
	}
	if _, err = service.Save(t.Context(), EmployeeSaveInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision, Data: legalIdentifierEmployeeInput("PERSON", "110101199002300015", operatingEntityID)}, actor); err == nil {
		t.Fatal("save Employee accepted an invalid resident identity number")
	} else {
		requireLegalIdentifierError(t, err, "invalid_legal_identifier")
	}
	if _, err = service.Submit(t.Context(), EmployeeVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, actor); err == nil {
		t.Fatal("submit Employee accepted an empty legal identifier")
	} else {
		requireLegalIdentifierError(t, err, "legal_identifier_required")
	}
	assertLifecycleState(t, pool, draft.Approval.ApprovalEntryID, approval.StatusDraft, draft.Approval.Revision)

	pendingSource, err := service.Create(t.Context(), EmployeeCreateInput{Data: legalIdentifierEmployeeInput("PERSON", "110101199001010015", operatingEntityID)}, actor)
	if err != nil {
		t.Fatalf("create valid Employee: %v", err)
	}
	pending, err := service.Submit(t.Context(), EmployeeVersionInput{ObjectID: pendingSource.ObjectID, ApprovalEntryID: pendingSource.Approval.ApprovalEntryID, ApprovalRevision: pendingSource.Approval.Revision}, actor)
	if err != nil {
		t.Fatalf("submit valid Employee: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE dcl_employee_versions SET legal_identifier='110101199002300015' WHERE approval_entry_id=$1`, pending.Approval.ApprovalEntryID); err != nil {
		t.Fatalf("replace pending Employee identifier: %v", err)
	}
	if _, err = service.Approve(t.Context(), EmployeeVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer); err == nil {
		t.Fatal("approve Employee accepted an invalid resident identity number")
	} else {
		requireLegalIdentifierError(t, err, "invalid_legal_identifier")
	}
	assertLifecycleState(t, pool, pending.Approval.ApprovalEntryID, approval.StatusPending, pending.Approval.Revision)
}

func TestSupplierLegalIdentifierIsValidatedAcrossLifecycleIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	actor := dclActor(t, ulid.Make().String(), "supplier-identifier-creator")
	reviewer := dclActor(t, ulid.Make().String(), "supplier-identifier-reviewer")
	operatingEntityID := legalIdentifierOperatingEntity(t, pool, business, authorizer, bus, actor, reviewer)
	service := NewSupplierService(pool, business, authorizer, bus)

	for _, input := range []SupplierInput{
		legalIdentifierSupplierInput("PERSON", "110101199002300015", operatingEntityID),
		legalIdentifierSupplierInput("ORGANIZATION", "91350211M000100Y43", operatingEntityID),
	} {
		if _, err := service.Create(t.Context(), SupplierCreateInput{Data: input}, actor); err == nil {
			t.Fatalf("create Supplier accepted invalid %s identifier %q", input.Kind, input.LegalIdentifier)
		} else {
			requireLegalIdentifierError(t, err, "invalid_legal_identifier")
		}
	}

	draft, err := service.Create(t.Context(), SupplierCreateInput{Data: legalIdentifierSupplierInput("PERSON", "", operatingEntityID)}, actor)
	if err != nil {
		t.Fatalf("create Supplier without draft identifier: %s", legalIdentifierErrorDetail(err))
	}
	if _, err = service.Save(t.Context(), SupplierSaveInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision, Data: legalIdentifierSupplierInput("PERSON", "110101199002300015", operatingEntityID)}, actor); err == nil {
		t.Fatal("save Supplier accepted an invalid resident identity number")
	} else {
		requireLegalIdentifierError(t, err, "invalid_legal_identifier")
	}
	if _, err = service.Submit(t.Context(), SupplierVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, actor); err == nil {
		t.Fatal("submit Supplier accepted an empty legal identifier")
	} else {
		requireLegalIdentifierError(t, err, "legal_identifier_required")
	}
	assertLifecycleState(t, pool, draft.Approval.ApprovalEntryID, approval.StatusDraft, draft.Approval.Revision)

	pendingSource, err := service.Create(t.Context(), SupplierCreateInput{Data: legalIdentifierSupplierInput("ORGANIZATION", "91350211M000100Y46", operatingEntityID)}, actor)
	if err != nil {
		t.Fatalf("create valid Supplier: %v", err)
	}
	pending, err := service.Submit(t.Context(), SupplierVersionInput{ObjectID: pendingSource.ObjectID, ApprovalEntryID: pendingSource.Approval.ApprovalEntryID, ApprovalRevision: pendingSource.Approval.Revision}, actor)
	if err != nil {
		t.Fatalf("submit valid Supplier: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE dcl_supplier_versions SET legal_identifier='91350211M000100Y43' WHERE approval_entry_id=$1`, pending.Approval.ApprovalEntryID); err != nil {
		t.Fatalf("replace pending Supplier identifier: %v", err)
	}
	if _, err = service.Approve(t.Context(), SupplierVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer); err == nil {
		t.Fatal("approve Supplier accepted an invalid unified social credit code")
	} else {
		requireLegalIdentifierError(t, err, "invalid_legal_identifier")
	}
	assertLifecycleState(t, pool, pending.Approval.ApprovalEntryID, approval.StatusPending, pending.Approval.Revision)
}

func TestCustomerSubmitRevalidatesLegalIdentifierClaimIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := NewCustomerService(pool, legalIdentifierCustomerRules{}, authorization.Func(nil), txevent.NewBus())
	actor := dclActor(t, ulid.Make().String(), "customer-claim-creator")

	draft, err := service.Create(t.Context(), CustomerCreateInput{Data: legalIdentifierCustomerInput("submit-claim")}, actor)
	if err != nil {
		t.Fatalf("create original Customer: %v", err)
	}
	deleteOpenLegalIdentifierClaim(t, pool, "dcl_customer_legal_identifier_claims", draft.Approval.ApprovalEntryID)
	if _, err = service.Create(t.Context(), CustomerCreateInput{Data: legalIdentifierCustomerInput("submit-claim")}, actor); err != nil {
		t.Fatalf("create occupying Customer: %v", err)
	}
	if _, err = service.Submit(t.Context(), CustomerVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, actor); err == nil {
		t.Fatal("submit Customer accepted a newly occupied legal identifier")
	} else {
		requireLegalIdentifierError(t, err, "customer_legal_identifier_claimed")
	}
	assertLifecycleState(t, pool, draft.Approval.ApprovalEntryID, approval.StatusDraft, draft.Approval.Revision)
}

func TestEmployeeSubmitRevalidatesLegalIdentifierClaimIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	actor := dclActor(t, ulid.Make().String(), "employee-claim-creator")
	reviewer := dclActor(t, ulid.Make().String(), "employee-claim-reviewer")
	operatingEntityID := legalIdentifierOperatingEntity(t, pool, business, authorizer, bus, actor, reviewer)
	service := NewEmployeeService(pool, business, authorizer, bus)

	draft, err := service.Create(t.Context(), EmployeeCreateInput{Data: legalIdentifierEmployeeInput("PERSON", "110101199001010015", operatingEntityID)}, actor)
	if err != nil {
		t.Fatalf("create original Employee: %v", err)
	}
	deleteOpenLegalIdentifierClaim(t, pool, "dcl_employee_legal_identifier_claims", draft.Approval.ApprovalEntryID)
	if _, err = service.Create(t.Context(), EmployeeCreateInput{Data: legalIdentifierEmployeeInput("PERSON", "110101199001010015", operatingEntityID)}, actor); err != nil {
		t.Fatalf("create occupying Employee: %v", err)
	}
	if _, err = service.Submit(t.Context(), EmployeeVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, actor); err == nil {
		t.Fatal("submit Employee accepted a newly occupied legal identifier")
	} else {
		requireLegalIdentifierError(t, err, "employee_legal_identifier_claimed")
	}
	assertLifecycleState(t, pool, draft.Approval.ApprovalEntryID, approval.StatusDraft, draft.Approval.Revision)
}

func TestSupplierSubmitRevalidatesLegalIdentifierClaimIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	actor := dclActor(t, ulid.Make().String(), "supplier-claim-creator")
	reviewer := dclActor(t, ulid.Make().String(), "supplier-claim-reviewer")
	operatingEntityID := legalIdentifierOperatingEntity(t, pool, business, authorizer, bus, actor, reviewer)
	service := NewSupplierService(pool, business, authorizer, bus)

	draft, err := service.Create(t.Context(), SupplierCreateInput{Data: legalIdentifierSupplierInput("ORGANIZATION", "91350211M000100Y46", operatingEntityID)}, actor)
	if err != nil {
		t.Fatalf("create original Supplier: %v", err)
	}
	deleteOpenLegalIdentifierClaim(t, pool, "dcl_supplier_legal_identifier_claims", draft.Approval.ApprovalEntryID)
	if _, err = service.Create(t.Context(), SupplierCreateInput{Data: legalIdentifierSupplierInput("ORGANIZATION", "91350211M000100Y46", operatingEntityID)}, actor); err != nil {
		t.Fatalf("create occupying Supplier: %v", err)
	}
	if _, err = service.Submit(t.Context(), SupplierVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, actor); err == nil {
		t.Fatal("submit Supplier accepted a newly occupied legal identifier")
	} else {
		requireLegalIdentifierError(t, err, "supplier_legal_identifier_claimed")
	}
	assertLifecycleState(t, pool, draft.Approval.ApprovalEntryID, approval.StatusDraft, draft.Approval.Revision)
}

func TestCustomerApproveRevalidatesLegalIdentifierClaimIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := NewCustomerService(pool, legalIdentifierCustomerRules{}, authorization.Func(nil), txevent.NewBus())
	creator := dclActor(t, ulid.Make().String(), "customer-approve-claim-creator")
	reviewer := dclActor(t, ulid.Make().String(), "customer-approve-claim-reviewer")

	draft, err := service.Create(t.Context(), CustomerCreateInput{Data: legalIdentifierCustomerInput("approve-claim")}, creator)
	if err != nil {
		t.Fatalf("create original Customer: %v", err)
	}
	pending, err := service.Submit(t.Context(), CustomerVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, creator)
	if err != nil {
		t.Fatalf("submit original Customer: %v", err)
	}
	deleteOpenLegalIdentifierClaim(t, pool, "dcl_customer_legal_identifier_claims", pending.Approval.ApprovalEntryID)
	if _, err = service.Create(t.Context(), CustomerCreateInput{Data: legalIdentifierCustomerInput("approve-claim")}, creator); err != nil {
		t.Fatalf("create occupying Customer: %v", err)
	}
	if _, err = service.Approve(t.Context(), CustomerVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer); err == nil {
		t.Fatal("approve Customer accepted a newly occupied legal identifier")
	} else {
		requireLegalIdentifierError(t, err, "customer_legal_identifier_claimed")
	}
	assertLifecycleState(t, pool, pending.Approval.ApprovalEntryID, approval.StatusPending, pending.Approval.Revision)
}

func TestCustomerUnapproveRestoresPreviousApprovedLegalIdentifierClaimIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := NewCustomerService(pool, legalIdentifierCustomerRules{}, authorization.Func(nil), txevent.NewBus())
	creator := dclActor(t, ulid.Make().String(), "customer-unapprove-claim-creator")
	reviewer := dclActor(t, ulid.Make().String(), "customer-unapprove-claim-reviewer")

	v1Input := legalIdentifierCustomerInput("91350211M000100Y46")
	v1Input.Root.Kind = "MAINLAND_ENTERPRISE"
	v1, err := service.Create(t.Context(), CustomerCreateInput{Data: v1Input}, creator)
	if err != nil {
		t.Fatalf("create Customer V1: %v", err)
	}
	v1 = approveCustomerAggregate(t, service, v1, creator, reviewer)

	v2Input := legalIdentifierCustomerInput("91350211M000100X45")
	v2Input.Root.Kind = "MAINLAND_ENTERPRISE"
	v2, err := service.Save(t.Context(), CustomerSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: v2Input.Root}, creator)
	if err != nil {
		t.Fatalf("save Customer V2: %v", err)
	}
	v2 = approveCustomerAggregate(t, service, v2, creator, reviewer)

	v2, err = service.Unapprove(t.Context(), CustomerReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "回落 V1"}, reviewer)
	if err != nil {
		t.Fatalf("unapprove Customer V2: %v", err)
	}
	assertCustomerLegalIdentifierClaim(t, pool, "91350211M000100Y46", v1.Approval.ApprovalEntryID, "")
	assertCustomerLegalIdentifierClaim(t, pool, "91350211M000100X45", "", v2.Approval.ApprovalEntryID)

	if _, err = service.Create(t.Context(), CustomerCreateInput{Data: v1Input}, creator); err == nil {
		t.Fatal("another Customer occupied the restored V1 legal identifier")
	} else {
		requireLegalIdentifierError(t, err, "customer_legal_identifier_claimed")
	}
}

func TestEmployeeApproveRevalidatesLegalIdentifierClaimIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	creator := dclActor(t, ulid.Make().String(), "employee-approve-claim-creator")
	reviewer := dclActor(t, ulid.Make().String(), "employee-approve-claim-reviewer")
	operatingEntityID := legalIdentifierOperatingEntity(t, pool, business, authorizer, bus, creator, reviewer)
	service := NewEmployeeService(pool, business, authorizer, bus)
	identifier := "110101199001010015"

	draft, err := service.Create(t.Context(), EmployeeCreateInput{Data: legalIdentifierEmployeeInput("PERSON", identifier, operatingEntityID)}, creator)
	if err != nil {
		t.Fatalf("create original Employee: %v", err)
	}
	pending, err := service.Submit(t.Context(), EmployeeVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, creator)
	if err != nil {
		t.Fatalf("submit original Employee: %v", err)
	}
	deleteOpenLegalIdentifierClaim(t, pool, "dcl_employee_legal_identifier_claims", pending.Approval.ApprovalEntryID)
	if _, err = service.Create(t.Context(), EmployeeCreateInput{Data: legalIdentifierEmployeeInput("PERSON", identifier, operatingEntityID)}, creator); err != nil {
		t.Fatalf("create occupying Employee: %v", err)
	}
	if _, err = service.Approve(t.Context(), EmployeeVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer); err == nil {
		t.Fatal("approve Employee accepted a newly occupied legal identifier")
	} else {
		requireLegalIdentifierError(t, err, "employee_legal_identifier_claimed")
	}
	assertLifecycleState(t, pool, pending.Approval.ApprovalEntryID, approval.StatusPending, pending.Approval.Revision)
}

func TestSupplierApproveRevalidatesLegalIdentifierClaimIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	creator := dclActor(t, ulid.Make().String(), "supplier-approve-claim-creator")
	reviewer := dclActor(t, ulid.Make().String(), "supplier-approve-claim-reviewer")
	operatingEntityID := legalIdentifierOperatingEntity(t, pool, business, authorizer, bus, creator, reviewer)
	service := NewSupplierService(pool, business, authorizer, bus)
	identifier := "91350211M000100Y46"

	draft, err := service.Create(t.Context(), SupplierCreateInput{Data: legalIdentifierSupplierInput("ORGANIZATION", identifier, operatingEntityID)}, creator)
	if err != nil {
		t.Fatalf("create original Supplier: %v", err)
	}
	pending, err := service.Submit(t.Context(), SupplierVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, creator)
	if err != nil {
		t.Fatalf("submit original Supplier: %v", err)
	}
	deleteOpenLegalIdentifierClaim(t, pool, "dcl_supplier_legal_identifier_claims", pending.Approval.ApprovalEntryID)
	if _, err = service.Create(t.Context(), SupplierCreateInput{Data: legalIdentifierSupplierInput("ORGANIZATION", identifier, operatingEntityID)}, creator); err != nil {
		t.Fatalf("create occupying Supplier: %v", err)
	}
	if _, err = service.Approve(t.Context(), SupplierVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer); err == nil {
		t.Fatal("approve Supplier accepted a newly occupied legal identifier")
	} else {
		requireLegalIdentifierError(t, err, "supplier_legal_identifier_claimed")
	}
	assertLifecycleState(t, pool, pending.Approval.ApprovalEntryID, approval.StatusPending, pending.Approval.Revision)
}

func deleteOpenLegalIdentifierClaim(t *testing.T, pool interface {
	Begin(context.Context) (pgx.Tx, error)
}, table, entryID string) {
	t.Helper()
	if table != "dcl_customer_legal_identifier_claims" && table != "dcl_employee_legal_identifier_claims" && table != "dcl_supplier_legal_identifier_claims" {
		t.Fatalf("unexpected legal identifier claim table %q", table)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin claim tampering transaction: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	if _, err = tx.Exec(t.Context(), "DELETE FROM "+table+" WHERE open_approval_entry_id=$1", entryID); err != nil {
		t.Fatalf("delete open claim: %v", err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit claim tampering transaction: %v", err)
	}
}

func assertLifecycleState(t *testing.T, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, entryID string, wantStatus approval.Status, wantRevision int64) {
	t.Helper()
	var status string
	var revision int64
	if err := pool.QueryRow(t.Context(), `SELECT status,revision FROM approval_entries WHERE id=$1`, entryID).Scan(&status, &revision); err != nil {
		t.Fatalf("read lifecycle state: %v", err)
	}
	if status != string(wantStatus) || revision != wantRevision {
		t.Fatalf("lifecycle state = (%s,%d), want (%s,%d)", status, revision, wantStatus, wantRevision)
	}
}

func assertCustomerLegalIdentifierClaim(t *testing.T, pool *pgxpool.Pool, normalizedValue, approvedEntryID, openEntryID string) {
	t.Helper()
	var approved, open *string
	if err := pool.QueryRow(t.Context(), `
		SELECT approved_approval_entry_id, open_approval_entry_id
		FROM dcl_customer_legal_identifier_claims
		WHERE normalized_legal_identifier=$1
	`, normalizedValue).Scan(&approved, &open); err != nil {
		t.Fatalf("read Customer legal identifier claim %s: %v", normalizedValue, err)
	}
	if stringPointerValue(approved) != approvedEntryID || stringPointerValue(open) != openEntryID {
		t.Fatalf("Customer legal identifier claim %s = approved %q open %q, want approved %q open %q", normalizedValue, stringPointerValue(approved), stringPointerValue(open), approvedEntryID, openEntryID)
	}
}

func legalIdentifierSupplierInput(kind, identifier, operatingEntityID string) SupplierInput {
	return SupplierInput{
		Kind: kind, LegalName: "生命周期供应商", DisplayName: "生命周期供应商", LegalIdentifier: identifier, Enabled: true,
		OperatingEntityIDs: []string{operatingEntityID}, DefaultOperatingEntityID: operatingEntityID,
	}
}

func legalIdentifierEmployeeInput(kind, identifier, operatingEntityID string) EmployeeInput {
	return EmployeeInput{
		Kind: kind, LegalName: "生命周期员工", DisplayName: "生命周期员工", LegalIdentifier: identifier, Enabled: true,
		CurrentOperatingEntityID: operatingEntityID, Email: "employee@example.com", HireDate: "2026-08-01",
	}
}

func legalIdentifierOperatingEntity(t *testing.T, pool *pgxpool.Pool, business *bobdomain.Service, authorizer approval.Authorizer, bus *txevent.Bus, creator, reviewer approval.Actor) string {
	t.Helper()
	service := NewOperatingEntityService(pool, business, authorizer, bus)
	draft, err := service.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "生命周期经营主体"}}, creator)
	if err != nil {
		t.Fatalf("create operating entity: %v", err)
	}
	pending, err := service.Submit(t.Context(), OperatingEntityVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, creator)
	if err != nil {
		t.Fatalf("submit operating entity: %v", err)
	}
	if _, err = service.Approve(t.Context(), OperatingEntityVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer); err != nil {
		t.Fatalf("approve operating entity: %v", err)
	}
	return draft.ObjectID
}

type legalIdentifierCustomerRules struct{}

func (legalIdentifierCustomerRules) ResolveCurrentReference(_ context.Context, _ pgx.Tx, entity, objectID string) (bobdomain.EffectiveReference, error) {
	return bobdomain.EffectiveReference{ObjectID: objectID, Entity: entity, Code: "REF-0001", ApprovalEntryID: objectID, VersionNo: 1, Data: bobdomain.DetailView{Name: "测试经营主体"}}, nil
}

func (legalIdentifierCustomerRules) ResolveCustomerTypeReference(_ context.Context, _ pgx.Tx, objectID string) (bobdomain.EffectiveReference, error) {
	return bobdomain.EffectiveReference{ObjectID: objectID, Entity: "dictionary-item", Code: "DIT-0001", ApprovalEntryID: objectID, VersionNo: 1, Data: bobdomain.DetailView{Name: "测试客户类型"}}, nil
}

func (legalIdentifierCustomerRules) ResolveCustomerSubunitReferences(_ context.Context, _ pgx.Tx, _ string, _ string, settlementID, paymentID, attributionType, attributionID string) (bobdomain.EffectiveReference, bobdomain.EffectiveReference, bobdomain.EffectiveReference, error) {
	settlement := bobdomain.EffectiveReference{ObjectID: settlementID}
	payment := bobdomain.EffectiveReference{ObjectID: paymentID}
	attribution := bobdomain.EffectiveReference{ObjectID: attributionID, Entity: attributionType, Code: "REF-0002", ApprovalEntryID: attributionID, VersionNo: 1, Data: bobdomain.DetailView{Name: "测试销售归属"}}
	return settlement, payment, attribution, nil
}

func (legalIdentifierCustomerRules) ValidateCustomerSubunitReferences(context.Context, pgx.Tx, string, string, string, string, string) error {
	return nil
}

func (legalIdentifierCustomerRules) ValidateHistoricalReference(_ context.Context, _ pgx.Tx, entity, objectID, entryID string) (bobdomain.EffectiveReference, error) {
	return bobdomain.EffectiveReference{ObjectID: objectID, Entity: entity, ApprovalEntryID: entryID, Data: bobdomain.DetailView{Name: "测试经营主体"}}, nil
}

func (legalIdentifierCustomerRules) EnsureCustomerUnapproveAllowed(context.Context, pgx.Tx, string) error {
	return nil
}

func legalIdentifierCustomerInput(identifier string) CustomerCreateDataInput {
	return CustomerCreateDataInput{Root: CustomerRootDataInput{
		Kind:                     "OTHER",
		LegalName:                "生命周期客户",
		DisplayName:              "生命周期客户",
		LegalIdentifier:          identifier,
		DefaultOperatingEntityID: ulid.Make().String(),
		Enabled:                  true,
		RemittanceProfiles:       []CustomerRemittanceProfile{},
	}, Subunits: []CustomerSubunitDataInput{{
		Enabled:        true,
		Name:           "默认账户",
		CustomerTypeID: ulid.Make().String(),
		PricingPolicy:  CustomerPricingPolicy{CostItems: []CustomerPricingCostItem{}},
		CreditLimits:   []CustomerCreditLimit{},
		PrimarySalesAttribution: CustomerSalesAttributionInput{
			Type:            CustomerSalesAttributionInternalEmployee,
			SubjectObjectID: ulid.Make().String(),
		},
	}},
	}
}

func requireLegalIdentifierError(t *testing.T, err error, errorKey string) {
	t.Helper()
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != errorKey {
		t.Fatalf("error = %v, want %s", err, errorKey)
	}
}

func legalIdentifierErrorDetail(err error) string {
	var domainErr *DomainError
	if errors.As(err, &domainErr) && domainErr.Cause != nil {
		return domainErr.Error() + ": " + domainErr.Cause.Error()
	}
	return err.Error()
}
