//go:build integration

package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

func TestCustomerAggregateSchemaIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	for _, table := range []string{
		"dcl_customer_versions",
		"dcl_customer_subunit_roots",
		"dcl_customer_version_subunits",
		"dcl_customer_version_subunit_credit_limits",
		"dcl_customer_legal_identifier_claims",
		"dcl_customer_attachments",
	} {
		var exists bool
		if err := pool.QueryRow(t.Context(), `SELECT to_regclass($1) IS NOT NULL`, "public."+table).Scan(&exists); err != nil {
			t.Fatalf("check %s: %v", table, err)
		}
		if !exists {
			t.Fatalf("missing Customer aggregate table %s", table)
		}
	}
	for _, retired := range []string{
		"dcl_customer_version" + "_identifiers",
		"dcl_customer_identifier" + "_claims",
		"dcl_customer_relationships",
		"dcl_customer_subunits",
		"dcl_customer_subunit_versions",
		"dcl_customer_subunit_credit_limits",
		"dcl_customer_subunit_attachments",
	} {
		var exists bool
		if err := pool.QueryRow(t.Context(), `SELECT to_regclass($1) IS NOT NULL`, "public."+retired).Scan(&exists); err != nil {
			t.Fatalf("check retired %s: %v", retired, err)
		}
		if exists {
			t.Fatalf("retired independent Customer Subunit table remains: %s", retired)
		}
	}
}

type customerAggregateRules struct {
	blockUnapprove bool
}

type customerPermissionAuthorizer struct{}

func (customerPermissionAuthorizer) RequirePermission(_ context.Context, principal authorization.Principal, path, _ string) error {
	if slices.Contains(principal.Permissions, path) {
		return nil
	}
	return authorization.NewError(authorization.ErrorForbidden, "permission denied: "+path, nil)
}

func (r *customerAggregateRules) ResolveCurrentReference(_ context.Context, _ pgx.Tx, entity, objectID string) (bobdomain.EffectiveReference, error) {
	return bobdomain.EffectiveReference{
		ObjectID: objectID, Entity: entity, Code: "REF-0001", ApprovalEntryID: ulid.Make().String(), VersionNo: 1,
		Data: bobdomain.DetailView{Name: "经营主体"},
	}, nil
}

func (r *customerAggregateRules) ResolveCustomerTypeReference(_ context.Context, _ pgx.Tx, objectID string) (bobdomain.EffectiveReference, error) {
	return bobdomain.EffectiveReference{
		ObjectID: objectID, Entity: "dictionary-item", Code: "DIT-0001", ApprovalEntryID: objectID, VersionNo: 1,
		Data: bobdomain.DetailView{Name: "终端客户"},
	}, nil
}

func (r *customerAggregateRules) ResolveCustomerSubunitReferences(_ context.Context, _ pgx.Tx, _, _, settlementID, paymentID, attributionType, attributionID string) (bobdomain.EffectiveReference, bobdomain.EffectiveReference, bobdomain.EffectiveReference, error) {
	settlement := bobdomain.EffectiveReference{}
	if settlementID != "" {
		settlement = bobdomain.EffectiveReference{ObjectID: settlementID, Entity: "settlement-method", Code: "SET-0001", ApprovalEntryID: settlementID, Data: bobdomain.DetailView{Name: "月结"}}
	}
	payment := bobdomain.EffectiveReference{}
	if paymentID != "" {
		payment = bobdomain.EffectiveReference{ObjectID: paymentID, Entity: "payment-method", Code: "PAY-0001", ApprovalEntryID: paymentID, Data: bobdomain.DetailView{Name: "转账"}}
	}
	attribution := bobdomain.EffectiveReference{ObjectID: attributionID, Entity: attributionType, Code: "SAL-0001", ApprovalEntryID: ulid.Make().String(), Data: bobdomain.DetailView{Name: "销售归属"}}
	return settlement, payment, attribution, nil
}

func (r *customerAggregateRules) ValidateCustomerSubunitReferences(context.Context, pgx.Tx, string, string, string, string, string) error {
	return nil
}

func (r *customerAggregateRules) ValidateHistoricalReference(_ context.Context, _ pgx.Tx, entity, objectID, entryID string) (bobdomain.EffectiveReference, error) {
	return bobdomain.EffectiveReference{ObjectID: objectID, Entity: entity, ApprovalEntryID: entryID, Data: bobdomain.DetailView{Name: "历史经营主体"}}, nil
}

func (r *customerAggregateRules) EnsureCustomerUnapproveAllowed(context.Context, pgx.Tx, string) error {
	if r.blockUnapprove {
		return errors.New("customer is referenced")
	}
	return nil
}

func customerAggregateRoot(legalIdentifier, legalName string) CustomerRootDataInput {
	return CustomerRootDataInput{
		Kind: "MAINLAND_ENTERPRISE", LegalName: legalName, DisplayName: legalName,
		LegalIdentifier:    legalIdentifier,
		RemittanceProfiles: []CustomerRemittanceProfile{}, DefaultOperatingEntityID: "01JCTEST000000000000000001", Enabled: true,
	}
}

func customerAggregateData(legalIdentifier, legalName string, subunits ...CustomerSubunitDataInput) CustomerCreateDataInput {
	return CustomerCreateDataInput{Root: customerAggregateRoot(legalIdentifier, legalName), Subunits: subunits}
}

func customerAggregateSubunit(name string) CustomerSubunitDataInput {
	return CustomerSubunitDataInput{
		Enabled: true, Name: name, CustomerTypeID: "01JAVX00000000000000000005",
		PricingPolicy:           CustomerPricingPolicy{CostItems: []CustomerPricingCostItem{}},
		CreditLimits:            []CustomerCreditLimit{{Currency: "CNY", Amount: "1000.00"}, {Currency: "USD", Amount: "200.00"}},
		PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: "01JCTEST000000000000000002"},
	}
}

func approveCustomerAggregate(t *testing.T, service *CustomerService, mutation CustomerMutation, creator, reviewer approval.Actor) CustomerMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), CustomerVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}, creator)
	if err != nil {
		t.Fatalf("submit Customer: %v", err)
	}
	approved, err := service.Approve(t.Context(), CustomerVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatalf("approve Customer: %v", err)
	}
	return approved
}

func TestCustomerAggregateLifecycleAndHistoricalSubunitsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	rules := &customerAggregateRules{}
	authorizer := authorization.Func(nil)
	service := NewCustomerService(pool, rules, authorizer, txevent.NewBus())
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	creatorID := ulid.Make().String()
	creator := dclActor(t, creatorID, "customer-aggregate-creator")
	reviewer := dclActor(t, ulid.Make().String(), "customer-aggregate-reviewer")

	v1, err := service.Create(t.Context(), CustomerCreateInput{Data: customerAggregateData("91350211M00010001X", "聚合客户 V1",
		customerAggregateSubunit("默认子单位"), customerAggregateSubunit("项目子单位"),
	)}, creator)
	if err != nil {
		t.Fatalf("create Customer V1: %v (cause: %v)", err, errors.Unwrap(err))
	}
	v1View, err := service.Get(t.Context(), CustomerGetInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID}, creator)
	if err != nil {
		t.Fatalf("get Customer V1: %v", err)
	}
	if len(v1View.Data.Subunits) != 2 || v1View.Data.Subunits[0].Code != "SUB-0001" || v1View.Data.Subunits[1].Code != "SUB-0002" {
		t.Fatalf("Customer V1 subunit roots = %+v", v1View.Data.Subunits)
	}
	defaultID, removedApprovedID := v1View.Data.Subunits[0].SubunitID, v1View.Data.Subunits[1].SubunitID
	v1 = approveCustomerAggregate(t, service, v1, creator, reviewer)

	other, err := service.Create(t.Context(), CustomerCreateInput{Data: customerAggregateData("91350211M000100021", "占用法定识别号客户", customerAggregateSubunit("唯一子单位"))}, creator)
	if err != nil {
		t.Fatalf("create conflicting legal identifier owner: %v", err)
	}
	_ = approveCustomerAggregate(t, service, other, creator, reviewer)

	failedRoot := customerAggregateRoot("91350211M000100021", "应回滚客户")
	if _, err = service.Save(t.Context(), CustomerSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: failedRoot}, creator); err == nil {
		t.Fatal("saved Customer with an occupied legal identifier")
	}
	var rootCount, openCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_customer_subunit_roots WHERE customer_id=$1`, v1.ObjectID).Scan(&rootCount); err != nil {
		t.Fatalf("count roots after rollback: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=$1 AND status IN ('DRAFT','PENDING')`, v1.ObjectID).Scan(&openCount); err != nil {
		t.Fatalf("count candidates after rollback: %v", err)
	}
	if rootCount != 2 || openCount != 0 {
		t.Fatalf("failed aggregate save leaked state: roots=%d open=%d", rootCount, openCount)
	}

	v2Root := customerAggregateRoot("91350211M00010001X", "聚合客户 V2")
	v2, err := service.Save(t.Context(), CustomerSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: v2Root}, creator)
	if err != nil {
		t.Fatalf("save Customer V2: %v", err)
	}
	v2Subunits := []CustomerSubunitDataInput{customerAggregateSubunit("默认子单位 V2"), customerAggregateSubunit("候选临时子单位")}
	v2Subunits[0].SubunitID = defaultID
	v2, err = service.SaveSubunits(t.Context(), CustomerSaveSubunitsInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Subunits: v2Subunits}, creator)
	if err != nil {
		t.Fatalf("save Customer V2 subunits: %v", err)
	}
	v2View, err := service.Get(t.Context(), CustomerGetInput{ObjectID: v1.ObjectID}, creator)
	if err != nil || len(v2View.Data.Subunits) != 2 {
		t.Fatalf("get Customer V2 candidate: view=%+v err=%v", v2View, err)
	}
	temporaryID := v2View.Data.Subunits[1].SubunitID
	current, err := business.CustomerCurrentGet(t.Context(), v1.ObjectID)
	if err != nil || current.SourceApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("open V2 leaked into BOB current: current=%+v err=%v", current, err)
	}
	fileID := ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO dcl_customer_files(
			id,storage_key,original_name,content_type,declared_size,sha256_hex,status,
			upload_token_hash,upload_expires_at,stored_at,created_by
		) VALUES($1,$2,'customer-subunit.pdf','application/pdf',1,$3,'READY',$4,now()+interval '1 hour',now(),$5)`,
		fileID, "customer/"+fileID, strings.Repeat("a", 64), strings.Repeat("b", 64), creatorID); err != nil {
		t.Fatalf("insert Customer subunit file: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO dcl_customer_attachments(
			approval_entry_id,subunit_id,file_id,category_object_id,category_code,category_name,created_by
		) VALUES($1,$2,$3,$4,'BUSINESS','业务附件',$5)`,
		v2.Approval.ApprovalEntryID, defaultID, fileID, ulid.Make().String(), creatorID); err != nil {
		t.Fatalf("attach file to Customer subunit: %v", err)
	}

	finalSubunits := []CustomerSubunitDataInput{customerAggregateSubunit("默认子单位 V2")}
	finalSubunits[0].SubunitID = defaultID
	v2, err = service.SaveSubunits(t.Context(), CustomerSaveSubunitsInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Subunits: finalSubunits}, creator)
	if err != nil {
		t.Fatalf("remove never-approved subunit from V2: %v", err)
	}
	var storesImplicitSubunit bool
	if err = pool.QueryRow(t.Context(), `SELECT data ? 'implicitSubunitId' FROM dcl_customer_versions WHERE approval_entry_id=$1`, v2.Approval.ApprovalEntryID).Scan(&storesImplicitSubunit); err != nil {
		t.Fatalf("inspect persisted Customer snapshot: %v", err)
	}
	if storesImplicitSubunit {
		t.Fatal("Customer approval snapshot persisted the derived implicit subunit")
	}
	v2View, err = service.Get(t.Context(), CustomerGetInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID}, creator)
	if err != nil || v2View.Data.ImplicitSubunitID == nil || *v2View.Data.ImplicitSubunitID != defaultID {
		t.Fatalf("Customer query did not derive the unique enabled subunit: view=%+v err=%v", v2View, err)
	}
	var attachmentExists bool
	if err = pool.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM dcl_customer_attachments WHERE approval_entry_id=$1 AND subunit_id=$2 AND file_id=$3)`, v2.Approval.ApprovalEntryID, defaultID, fileID).Scan(&attachmentExists); err != nil {
		t.Fatalf("check Customer subunit attachment after save: %v", err)
	}
	if !attachmentExists {
		t.Fatal("saving Customer subunits deleted an attachment from an unchanged subunit")
	}
	var temporaryExists, approvedRemovedExists bool
	if err = pool.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM dcl_customer_subunit_roots WHERE subunit_id=$1), EXISTS(SELECT 1 FROM dcl_customer_subunit_roots WHERE subunit_id=$2)`, temporaryID, removedApprovedID).Scan(&temporaryExists, &approvedRemovedExists); err != nil {
		t.Fatalf("check subunit-root deletion rules: %v", err)
	}
	if temporaryExists || !approvedRemovedExists {
		t.Fatalf("subunit-root retention mismatch: temporary=%t approved=%t", temporaryExists, approvedRemovedExists)
	}
	v2 = approveCustomerAggregate(t, service, v2, creator, reviewer)
	current, err = business.CustomerCurrentGet(t.Context(), v1.ObjectID)
	if err != nil || current.SourceApprovalEntryID != v2.Approval.ApprovalEntryID {
		t.Fatalf("approved V2 did not atomically replace BOB current: current=%+v err=%v", current, err)
	}
	var currentData CustomerData
	if err = json.Unmarshal(current.Data, &currentData); err != nil || len(currentData.Subunits) != 1 || currentData.Subunits[0].SubunitID != defaultID || currentData.ImplicitSubunitID == nil || *currentData.ImplicitSubunitID != defaultID {
		t.Fatalf("BOB current Customer aggregate = %+v err=%v", currentData, err)
	}

	staleRoot := customerAggregateRoot("91350211M00010001X", "陈旧 V1 覆盖")
	_, err = service.Save(t.Context(), CustomerSaveInput{
		ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision, Data: staleRoot,
	}, creator)
	var staleErr *DomainError
	if !errors.As(err, &staleErr) || staleErr.ErrorKey != "approval_stale_revision" {
		t.Fatalf("save from stale approved Customer = %v, want approval_stale_revision", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=$1 AND status IN ('DRAFT','PENDING')`, v1.ObjectID).Scan(&openCount); err != nil {
		t.Fatalf("count candidates after stale save: %v", err)
	}
	if openCount != 0 {
		t.Fatalf("stale approved Customer created %d candidate versions", openCount)
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin subunit reference checks: %v", err)
	}
	defer tx.Rollback(t.Context())
	historical, err := business.ValidateHistoricalReference(t.Context(), tx, bobdomain.EntityCustomerSubunit, removedApprovedID, v1.Approval.ApprovalEntryID)
	if err != nil || historical.CustomerID != v1.ObjectID || historical.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("historical embedded subunit reference = %+v err=%v", historical, err)
	}
	if _, err = business.ResolveCurrentReference(t.Context(), tx, bobdomain.EntityCustomerSubunit, removedApprovedID); err == nil {
		t.Fatal("removed subunit remained available as current reference")
	}
	currentDefault, err := business.ResolveCurrentReference(t.Context(), tx, bobdomain.EntityCustomerSubunit, defaultID)
	if err != nil || currentDefault.CustomerID != v1.ObjectID || currentDefault.ApprovalEntryID != v2.Approval.ApprovalEntryID {
		t.Fatalf("current embedded subunit reference = %+v err=%v", currentDefault, err)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback account reference checks: %v", err)
	}

	rules.blockUnapprove = true
	if _, err = service.Unapprove(t.Context(), CustomerReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "存在历史引用"}, reviewer); err == nil {
		t.Fatal("unapproved a referenced Customer aggregate")
	}
	current, err = business.CustomerCurrentGet(t.Context(), v1.ObjectID)
	if err != nil || current.SourceApprovalEntryID != v2.Approval.ApprovalEntryID {
		t.Fatalf("blocked unapprove changed BOB current: current=%+v err=%v", current, err)
	}
}

func TestCustomerAggregateUsesExactMaintenanceAndApprovalPermissionsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	rules := &customerAggregateRules{}
	unrestricted := NewCustomerService(pool, rules, authorization.Func(nil), txevent.NewBus())
	restricted := NewCustomerService(pool, rules, customerPermissionAuthorizer{}, txevent.NewBus())
	creator := dclActor(t, ulid.Make().String(), "customer-permission-creator")
	reviewer := dclActor(t, ulid.Make().String(), "customer-permission-reviewer")

	v1, err := unrestricted.Create(t.Context(), CustomerCreateInput{Data: customerAggregateData(
		"91350211M00010001X", "最小权限客户", customerAggregateSubunit("最小权限子单位"),
	)}, creator)
	if err != nil {
		t.Fatalf("create permission Customer: %v", err)
	}
	v1 = approveCustomerAggregate(t, unrestricted, v1, creator, reviewer)
	v1View, err := unrestricted.Get(t.Context(), CustomerGetInput{ObjectID: v1.ObjectID}, creator)
	if err != nil || len(v1View.Data.Subunits) != 1 {
		t.Fatalf("get permission Customer V1: view=%+v err=%v", v1View, err)
	}

	subunitEditor := dclActorWithPermissions(t, ulid.Make().String(), "customer-subunit-only", "/dcl/customer/save-subunits")
	subunit := customerAggregateSubunit("仅子单位权限已修改")
	subunit.SubunitID = v1View.Data.Subunits[0].SubunitID
	v2, err := restricted.SaveSubunits(t.Context(), CustomerSaveSubunitsInput{
		ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision, Subunits: []CustomerSubunitDataInput{subunit},
	}, subunitEditor)
	if err != nil {
		t.Fatalf("save subunits without root save permission: %v", err)
	}
	v2, err = unrestricted.Submit(t.Context(), CustomerVersionInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision,
	}, creator)
	if err != nil {
		t.Fatalf("submit permission Customer V2: %v", err)
	}

	approvalOnly := dclActorWithPermissions(t, ulid.Make().String(), "customer-approval-only", "/dcl/customer/approve")
	v2, err = restricted.Approve(t.Context(), CustomerVersionInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision,
	}, approvalOnly)
	if err != nil {
		t.Fatalf("approve Customer without get permission: %v", err)
	}
	view, err := restricted.Get(t.Context(), CustomerGetInput{ObjectID: v2.ObjectID}, approvalOnly)
	if err != nil || view.Approval.ApprovalEntryID != v2.Approval.ApprovalEntryID || view.Data.Subunits[0].Name != subunit.Name {
		t.Fatalf("approval-only Customer get: view=%+v err=%v", view, err)
	}
	page, err := restricted.Query(t.Context(), CustomerQueryInput{Page: 1, PageSize: 20}, approvalOnly)
	if err != nil || len(page.Items) != 1 || page.Items[0].ObjectID != v2.ObjectID {
		t.Fatalf("approval-only Customer query: page=%+v err=%v", page, err)
	}

	rootEditor := dclActorWithPermissions(t, ulid.Make().String(), "customer-root-only", "/dcl/customer/save")
	if _, err = restricted.Save(t.Context(), CustomerSaveInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Data: customerAggregateRoot("91350211M00010001X", "仅根权限已修改"),
	}, rootEditor); err != nil {
		t.Fatalf("save root without get permission: %v", err)
	}
}
