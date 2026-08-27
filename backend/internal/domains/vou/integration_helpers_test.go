//go:build integration

package vou

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func trustedIntegrationActor(t *testing.T, requestID string) approval.Actor {
	t.Helper()
	actorID := integrationActorOne
	if strings.Contains(requestID, "approve") || strings.Contains(requestID, "reject") {
		actorID = integrationActorTwo
	}
	actor, err := approval.UserActor(authorization.Principal{ActorID: actorID}, requestID)
	if err != nil {
		t.Fatalf("create trusted integration actor: %v", err)
	}
	return actor
}

func integrationApprovalActor(t *testing.T, actorID, requestID string) approval.Actor {
	t.Helper()
	if strings.HasSuffix(requestID, "-approve") || strings.HasSuffix(requestID, "-reject") {
		actorID = integrationActorTwo
	}
	actor, err := approval.UserActor(authorization.Principal{ActorID: actorID}, requestID)
	if err != nil {
		t.Fatalf("create integration Approval actor: %v", err)
	}
	return actor
}

const (
	integrationActorOne         = "01J00000000000000000000000"
	integrationActorTwo         = "01J00000000000000000000001"
	integrationRawProductTypeID = "01JPTP00000000000000000001"
	integrationKGUnitID         = "01JAVX00000000000000000011"
	integrationTonUnitID        = "01JAVX00000000000000000027"
)

type integrationReferences struct {
	customer, supplier, employee, product, warehouse, fundAccount ReferenceInput
	settlement, carrier, vehicle                                  ReferenceInput
}

func integrationProductLine(t *testing.T, product ReferenceInput, quantity, price string) ProductLineInput {
	t.Helper()
	return ProductLineInput{
		Product:         ProductReferenceInput{ObjectID: product.ObjectID},
		EnteredQuantity: quantity,
		EnteredUnit:     UnitReferenceInput{ObjectID: integrationKGUnitID},
		BaseQuantity:    quantity, UnitPrice: price,
	}
}

func vouIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	expectedName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || expectedName == "" || !strings.HasSuffix(expectedName, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	var actual string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&actual); err != nil || actual != expectedName {
		t.Fatalf("integration database = %q, want %q, err=%v", actual, expectedName, err)
	}
	var table *string
	if err = pool.QueryRow(t.Context(), "select to_regclass('vou_documents')::text").Scan(&table); err != nil ||
		table == nil || *table != "vou_documents" {
		t.Fatalf("VOU migrations are not applied: table=%v err=%v", table, err)
	}
	return pool
}

func truncateVOU(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		TRUNCATE acc_books CASCADE;
		TRUNCATE
			wfl_runtime_audit_events, wfl_action_executions, wfl_create_child_requests, wfl_node_instances,
			wfl_definition_instances, vou_download_tokens, vou_document_attachments,
			vou_files,
			vou_asset_liquidation_lines,vou_asset_liquidation_details,
			vou_asset_sale_lines,vou_asset_sale_details,
			vou_asset_acquisition_lines,vou_asset_acquisition_details,
			vou_intermediary_calculation_bill_allocations,
			vou_bill_cash_lines,vou_bill_lines,vou_bill_details,
			vou_intermediary_calculation_lines,vou_intermediary_calculation_summaries,vou_intermediary_calculation_details,
			vou_price_lines, vou_purchase_inquiry_details, vou_sale_pricing_details,
			vou_inventory_count_lines, vou_inventory_count_details,
			vou_sale_return_lines, vou_sale_return_details,
			vou_purchase_return_lines, vou_purchase_return_details,
			vou_sale_signoff_lines, vou_sale_signoff_details,
			vou_sale_delivery_details, vou_sale_outbound_lines, vou_sale_outbound_details,
			vou_purchase_inbound_lines, vou_purchase_inbound_details,
			vou_production_material_lines, vou_production_output_lines, vou_production_details,
			vou_expense_lines, vou_sale_order_formula_lines, vou_sale_order_formulas,
			vou_product_lines, vou_other_income_details,
			vou_employee_loan_writeoff_details, vou_expense_payment_details, vou_expense_reimbursement_details, vou_payment_details, vou_receipt_details,
			vou_service_acceptance_details, vou_service_contract_details,
			vou_purchase_order_details,
			vou_sale_order_details, vou_documents, vou_number_counters;
		DELETE FROM approval_events
		WHERE entry_id IN (SELECT id FROM approval_entries WHERE domain = 'vou');
		DELETE FROM approval_entries WHERE domain = 'vou';
		INSERT INTO app_users(id,username,display_name,password_hash,status,password_changed_at,created_by,updated_by)
		VALUES
			('01J00000000000000000000000','vou-test-one','VOU 测试用户一','hash','ENABLED',now(),'01J00000000000000000000000','01J00000000000000000000000'),
			('01J00000000000000000000001','vou-test-two','VOU 测试用户二','hash','ENABLED',now(),'01J00000000000000000000000','01J00000000000000000000000')
		ON CONFLICT(id) DO NOTHING`)
	if err != nil {
		t.Fatalf("truncate VOU: %v", err)
	}
}

func createApprovedBOB(
	t *testing.T, service *bobdomain.Service, entity string, data bobdomain.CreateDetailInput,
) ReferenceInput {
	t.Helper()
	if entity == bobdomain.EntityOperatingEntity {
		declarations := dcldomain.NewOperatingEntityService(vouIntegrationPool(t), service, authorization.Func(nil), txevent.NewBus())
		created, err := declarations.Create(t.Context(), dcldomain.OperatingEntityCreateInput{Data: dcldomain.OperatingEntityData{
			Name: data.Name, ShortName: data.ShortName, TaxNumber: data.TaxNumber,
			Address: data.Address, Phone: data.Phone, Remark: data.Remark,
		}}, trustedIntegrationActor(t, "vou-ref-create"))
		if err != nil {
			t.Fatalf("create operating entity reference: %v", err)
		}
		submitted, err := declarations.Submit(t.Context(), dcldomain.OperatingEntityVersionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, trustedIntegrationActor(t, "vou-ref-submit"))
		if err != nil {
			t.Fatalf("submit operating entity reference: %v", err)
		}
		approved, err := declarations.Approve(t.Context(), dcldomain.OperatingEntityVersionInput{
			ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID,
			ApprovalRevision: submitted.Approval.Revision,
		}, trustedIntegrationActor(t, "vou-ref-approve"))
		if err != nil {
			t.Fatalf("approve operating entity reference: %v", err)
		}
		return ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
	}
	if entity == bobdomain.EntityProduct && data.ProductTypeID != "01JPTP00000000000000000007" && data.DefaultPackagingSpec == "" {
		data.DefaultPackagingSpec = "1"
	}
	if (entity == bobdomain.EntityFundAccount || entity == bobdomain.EntityEmployee ||
		entity == bobdomain.EntitySupplier || entity == bobdomain.EntityOtherUnit) && data.OperatingEntityID == "" {
		operating := createApprovedBOB(t, service, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{
			Name: "VOU 自动经营主体", TaxNumber: "TAX" + newID()[3:],
		})
		data.OperatingEntityID = operating.ObjectID
	}
	var created bobdomain.MutationResult
	var err error
	switch entity {
	case bobdomain.EntityEmployee:
		result, createErr := service.EmploymentCreate(t.Context(), bobdomain.EmploymentCreateInput{
			NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindPerson, LegalName: data.Name},
			Data:     data,
		}, trustedIntegrationActor(t, "vou-ref-create"), true)
		created, err = result.MutationResult, createErr
	case bobdomain.EntitySupplier:
		result, createErr := service.SupplierCreate(t.Context(), bobdomain.SupplierCreateInput{
			NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: data.Name},
			Data: bobdomain.SupplierData{OperatingEntityID: data.OperatingEntityID,
				ContactName: data.ContactName, ContactPhone: data.ContactPhone,
				SettlementMethodID:         data.SettlementMethodID,
				DefaultPurchaserEmployeeID: data.DefaultPurchaserEmployeeID},
		}, trustedIntegrationActor(t, "vou-ref-create"), true)
		created, err = result.MutationResult, createErr
	case bobdomain.EntityOtherUnit:
		result, createErr := service.OtherUnitCreate(t.Context(), bobdomain.OtherUnitCreateInput{
			NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: data.Name},
			Data: bobdomain.OtherUnitData{OperatingEntityID: data.OperatingEntityID,
				ContactName: data.ContactName, ContactPhone: data.ContactPhone,
				SettlementMethodID: data.SettlementMethodID},
		}, trustedIntegrationActor(t, "vou-ref-create"), true)
		created, err = result.MutationResult, createErr
	default:
		created, err = service.Create(t.Context(), entity, bobdomain.CreateInput{Data: data},
			trustedIntegrationActor(t, "vou-ref-create"))
	}
	if err != nil {
		t.Fatalf("create %s reference: %v (cause: %v)", entity, err, errors.Unwrap(err))
	}
	submitted, err := service.Submit(t.Context(), entity, bobdomain.VersionRevisionInput{
		ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision,
	}, trustedIntegrationActor(t, "vou-ref-submit"))
	if err != nil {
		t.Fatalf("submit %s reference: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, bobdomain.ReviewInput{
		ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: submitted.Approval.Revision,
	}, trustedIntegrationActor(t, "vou-ref-approve"))
	if err != nil {
		t.Fatalf("approve %s reference: %v", entity, err)
	}
	return ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
}

func reverseApprovedBOBToDraft(
	t *testing.T,
	service *bobdomain.Service,
	entity string,
	view bobdomain.ObjectView,
	requestID string,
) bobdomain.MutationResult {
	t.Helper()
	unapproved, err := service.Unapprove(t.Context(), entity, bobdomain.ReverseInput{
		ObjectID: view.ObjectID, ApprovalEntryID: view.Approval.ApprovalEntryID,
		ApprovalRevision: view.Approval.Revision, Reason: "integration update",
	}, trustedIntegrationActor(t, requestID+"-unapprove"))
	if err != nil {
		t.Fatalf("unapprove BOB reference: %v", err)
	}
	draft, err := service.Unsubmit(t.Context(), entity, bobdomain.ReverseInput{
		ObjectID: unapproved.ObjectID, ApprovalEntryID: unapproved.Approval.ApprovalEntryID,
		ApprovalRevision: unapproved.Approval.Revision, Reason: "integration update",
	}, trustedIntegrationActor(t, requestID+"-unsubmit"))
	if err != nil {
		t.Fatalf("unsubmit BOB reference: %v", err)
	}
	return draft
}

func fixedSettlementReference(t *testing.T, pool *pgxpool.Pool, termCode string) ReferenceInput {
	t.Helper()
	var result ReferenceInput
	if err := pool.QueryRow(t.Context(), `
		SELECT object.id,entry.id
		FROM aux_objects object
		JOIN approval_entries entry ON entry.domain='aux' AND entry.entity=object.entity
		  AND entry.subject_id=object.id AND entry.status='APPROVED'
		JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
		WHERE object.entity='settlement-method' AND object.enabled AND payload.data->>'termCode'=$1
		ORDER BY entry.version_no DESC LIMIT 1
	`, termCode).Scan(&result.ObjectID, &result.ApprovalEntryID); err != nil {
		t.Fatalf("find fixed settlement method %s: %v", termCode, err)
	}
	return result
}

func newBOBIntegrationService(pool *pgxpool.Pool) *bobdomain.Service {
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorization.Func(nil), bus)
	return bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorization.Func(nil), bus)
}

type vouCustomerAuxiliaryResolver struct{}

func (resolver vouCustomerAuxiliaryResolver) ResolveLatestApprovedAuxiliaryReference(
	ctx context.Context, tx pgx.Tx, entity, objectID string,
) (bobdomain.AuxiliaryReference, error) {
	return resolver.ValidateApprovedAuxiliarySnapshotReference(ctx, tx, entity, objectID, "")
}

func (vouCustomerAuxiliaryResolver) ValidateApprovedAuxiliarySnapshotReference(
	ctx context.Context, tx pgx.Tx, entity, objectID, _ string,
) (bobdomain.AuxiliaryReference, error) {
	if entity == "payment-method" {
		return bobdomain.AuxiliaryReference{ObjectID: objectID, ApprovalEntryID: "01J00000000000000000000083",
			Entity: entity, Code: "PAY-0001", Data: map[string]any{"name": "银行转账"}}, nil
	}
	var versionID, code string
	var raw []byte
	if err := tx.QueryRow(ctx, `
		SELECT entry.id,object.code,payload.data
		FROM aux_objects object
		JOIN approval_entries entry ON entry.domain='aux' AND entry.entity=object.entity
		  AND entry.subject_id=object.id AND entry.status='APPROVED'
		JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
		WHERE object.id=$1 AND object.entity=$2 AND object.enabled
		ORDER BY entry.version_no DESC LIMIT 1
	`, objectID, entity).Scan(&versionID, &code, &raw); err != nil {
		return bobdomain.AuxiliaryReference{}, err
	}
	data := map[string]any{}
	if err := json.Unmarshal(raw, &data); err != nil {
		return bobdomain.AuxiliaryReference{}, err
	}
	return bobdomain.AuxiliaryReference{ObjectID: objectID, ApprovalEntryID: versionID, Entity: entity, Code: code, Data: data}, nil
}

func (vouCustomerAuxiliaryResolver) ResolveAuxiliaryCode(
	_ context.Context, _ pgx.Tx, entity, code string,
) (bobdomain.AuxiliaryReference, error) {
	return bobdomain.AuxiliaryReference{ObjectID: "01J00000000000000000000092",
		ApprovalEntryID: "01J00000000000000000000093", Entity: entity, Code: code,
		Data: map[string]any{"dictionaryTypeCode": "DCT-0001", "name": "终端客户"}}, nil
}

func createApprovedCustomer(
	t *testing.T, pool *pgxpool.Pool, data bobdomain.CreateDetailInput,
) ReferenceInput {
	t.Helper()
	service := bobdomain.NewService(pool, vouCustomerAuxiliaryResolver{}, authorization.Func(nil), txevent.NewBus())
	operating := createApprovedBOB(t, service, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{
		Name: "VOU 客户经营主体", TaxNumber: "TAX" + newID()[3:],
	})
	if data.SettlementMethodID == "" {
		data.SettlementMethodID = "01JSMT00000000000000000017"
	}
	created, err := service.CustomerCreate(t.Context(), bobdomain.CustomerCreateInput{
		NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: data.Name + "主体" + newID()[20:]},
		Data: bobdomain.CustomerAccountData{
			Name: data.Name, CustomerTypeCode: bobdomain.CustomerTypeEndUser,
			ContactName: data.ContactName, ContactPhone: data.ContactPhone, Address: data.Address,
			OperatingEntityID: operating.ObjectID, SettlementMethodID: data.SettlementMethodID,
			PaymentMethodID:            "01J00000000000000000000082",
			DefaultTransportMethodCode: "SELF_PICKUP", DefaultTransportMethodName: "客户自提",
			TransportSurcharge: "0.00", PricingPolicy: bobdomain.PricingPolicy{
				DefaultPremiumUnitPrice: "0.00", DefaultDiscountUnitPrice: "0.00", CostItems: []bobdomain.PricingCostItem{},
				ThirdPartyIntermediaryFixedUnitCost: "0.00", ThirdPartyIntermediaryVariableUnitCost: "0.00",
			}, CreditLimits: []bobdomain.CustomerCreditLimit{}, PrimarySalesAttribution: bobdomain.CustomerSalesAttributionInput{
				Type: bobdomain.SalesAttributionInternalEmployee, SubjectObjectID: data.SalespersonEmployeeID,
			},
		},
	}, trustedIntegrationActor(t, "vou-customer-create"), true)
	if err != nil {
		t.Fatalf("create customer reference: %v", err)
	}
	submitted, err := service.Submit(t.Context(), bobdomain.EntityCustomer, bobdomain.VersionRevisionInput{
		ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision,
	}, trustedIntegrationActor(t, "vou-customer-submit"))
	if err != nil {
		t.Fatalf("submit customer reference: %v", err)
	}
	if _, err = service.Approve(t.Context(), bobdomain.EntityCustomer, bobdomain.ReviewInput{
		ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: submitted.Approval.Revision,
	}, trustedIntegrationActor(t, "vou-customer-approve")); err != nil {
		t.Fatalf("approve customer relationship: %v", err)
	}
	accountSubmitted, err := service.Submit(t.Context(), bobdomain.EntityCustomerAccount, bobdomain.VersionRevisionInput{
		ObjectID: created.DefaultAccount.ObjectID, ApprovalEntryID: created.DefaultAccount.OpenVersion.Approval.ApprovalEntryID,
		ApprovalRevision: created.DefaultAccount.OpenVersion.Approval.Revision,
	}, trustedIntegrationActor(t, "vou-customer-account-submit"))
	if err != nil {
		t.Fatalf("submit customer account: %v", err)
	}
	accountApproved, err := service.Approve(t.Context(), bobdomain.EntityCustomerAccount, bobdomain.ReviewInput{
		ObjectID: created.DefaultAccount.ObjectID, ApprovalEntryID: accountSubmitted.Approval.ApprovalEntryID, ApprovalRevision: accountSubmitted.Approval.Revision,
	}, trustedIntegrationActor(t, "vou-customer-account-approve"))
	if err != nil {
		t.Fatalf("approve customer account: %v", err)
	}
	return ReferenceInput{ObjectID: accountApproved.ObjectID, ApprovalEntryID: accountApproved.Approval.ApprovalEntryID}
}

func prepareReferences(t *testing.T, pool *pgxpool.Pool) integrationReferences {
	t.Helper()
	service := newBOBIntegrationService(pool)
	suffix := newID()
	settlement := fixedSettlementReference(t, pool, bobdomain.SettlementTermMonthly30)
	employee := createApprovedBOB(t, service, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "VE" + suffix, Name: "VOU 员工",
	})
	carrier := createApprovedBOB(t, service, bobdomain.EntityOtherUnit, bobdomain.CreateDetailInput{
		Name: "VOU 承运服务单位", SettlementMethodID: settlement.ObjectID,
	})
	operating := createApprovedBOB(t, service, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{
		Name: "VOU 经营主体", TaxNumber: "TAX" + suffix[3:],
	})
	return integrationReferences{
		customer: createApprovedCustomer(t, pool, bobdomain.CreateDetailInput{
			Code: "VC" + suffix, Name: "VOU 客户", ContactName: "客户联系人",
			ContactPhone: "13800000000", Address: "深圳市测试路 1 号",
			SettlementMethodID:    settlement.ObjectID,
			SalespersonEmployeeID: employee.ObjectID,
		}),
		supplier: createApprovedBOB(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
			Code: "VS" + suffix, Name: "VOU 供应商",
			ContactName: "供应商联系人", ContactPhone: "13900000000",
			SettlementMethodID:         settlement.ObjectID,
			DefaultPurchaserEmployeeID: employee.ObjectID,
		}),
		employee: employee,
		product: createApprovedBOB(t, service, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
			Code: "VP" + suffix, Name: "VOU 产品", ProductTypeID: integrationRawProductTypeID,
			DefaultInputUnitID: integrationTonUnitID, PricingUnitID: integrationKGUnitID,
			UnitConversions: []bobdomain.ProductUnitConversion{
				{Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: integrationKGUnitID}, Factor: "1"},
				{Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: integrationTonUnitID}, Factor: "1000"},
			}, DefaultPackagingSpec: "1000",
		}),
		warehouse: createApprovedBOB(t, service, bobdomain.EntityWarehouse, bobdomain.CreateDetailInput{
			Code: "VW" + suffix, Name: "VOU 仓库",
		}),
		fundAccount: createApprovedBOB(t, service, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{
			Code: "VF" + suffix, Name: "VOU 资金账户", Currency: "CNY", OperatingEntityID: operating.ObjectID,
		}),
		settlement: settlement, carrier: carrier,
		vehicle: createApprovedBOB(t, service, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
			Code: "VV" + suffix, Name: "VOU 车辆", PlateNumber: "粤V" + suffix[len(suffix)-6:],
			VehicleType: "DIT-0003", CarrierAffiliation: &bobdomain.CarrierAffiliation{
				Type: "EXTERNAL", ServiceRelationshipObjectID: carrier.ObjectID,
			},
		}),
	}
}

func newIntegrationService(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	return newIntegrationServiceWithBus(t, pool, txevent.NewBus())
}

func newIntegrationServiceWithBus(t *testing.T, pool *pgxpool.Pool, bus *txevent.Bus) *Service {
	t.Helper()
	service, err := NewService(pool, newBOBIntegrationService(pool), auxiliaryrefs.New(auxdomain.NewService(pool, authorization.Func(nil), bus)), bus, AttachmentOptions{Root: t.TempDir()},
		slog.New(slog.NewTextHandler(io.Discard, nil)), WithAccountingControl(integrationAccountingControl{}),
		WithApprovalAuthorizer(authorization.Func(nil)))
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	return service
}

type integrationAccountingControl struct{}

func (integrationAccountingControl) PartyBalance(ctx context.Context, tx pgx.Tx, input PartyBalanceQuery) (int64, error) {
	var ready bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM acc_books book
		JOIN approval_entries approval ON approval.domain='acc' AND approval.entity='opening'
			AND approval.subject_id=book.id AND approval.version_no IS NULL AND approval.status='APPROVED'
		WHERE book.control_book
	)`).Scan(&ready); err != nil {
		return 0, err
	}
	if !ready {
		return 0, errors.New("accounting control book is not ready")
	}
	if input.SourceDocumentIDs != nil && len(input.SourceDocumentIDs) == 0 {
		return 0, nil
	}
	creditNature := input.SettlementPurpose == "PAYABLE" || input.SettlementPurpose == "ADVANCE_RECEIPT"
	multiplier := int64(1)
	if creditNature {
		multiplier = -1
	}
	var balance int64
	err := tx.QueryRow(ctx, `SELECT COALESCE(sum($1::bigint*(line.debit_minor-line.credit_minor)),0)::bigint
		FROM acc_voucher_lines line
		JOIN acc_vouchers voucher ON voucher.book_id=line.book_id AND voucher.id=line.voucher_id
		JOIN acc_subjects subject ON subject.book_id=line.book_id AND subject.id=line.subject_id
		JOIN acc_books book ON book.id=line.book_id AND book.control_book
		JOIN approval_entries approval ON approval.domain='acc' AND approval.entity='opening'
			AND approval.subject_id=book.id AND approval.version_no IS NULL AND approval.status='APPROVED'
		WHERE subject.settlement_purpose=$2 AND line.currency=$3
		  AND line.dimensions->>$4=$5 AND voucher.business_date<=$6::date
		  AND (COALESCE(cardinality($7::text[]),0)=0 OR voucher.source_id=ANY($7::text[]))`,
		multiplier, input.SettlementPurpose, input.Currency, input.CounterpartyDimension,
		input.CounterpartyObjectID, input.AsOfDate, input.SourceDocumentIDs).Scan(&balance)
	return balance, err
}
