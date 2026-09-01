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
	"github.com/hansonyu183/zerp/backend/internal/integrations/typedarchiverules"
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

func integrationErrorChain(err error) string {
	parts := make([]string, 0, 4)
	for current := err; current != nil; current = errors.Unwrap(current) {
		parts = append(parts, current.Error())
	}
	return strings.Join(parts, " -> ")
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
	customer, salesReceiptCustomer, salesReceiptOperatingEntity ReferenceInput
	supplier, employee, product, warehouse, fundAccount         ReferenceInput
	settlement, carrier, vehicle                                ReferenceInput
}

type integrationCustomerReferences struct {
	Customer, Account, OperatingEntity ReferenceInput
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

func salesReceiptDraft(refs integrationReferences, amount string) DraftInput {
	return DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY",
		Customer: &refs.salesReceiptCustomer, OperatingEntity: &refs.salesReceiptOperatingEntity,
		FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: amount,
		AccountAllocations: []SalesReceiptAccountAllocationInput{{
			Account: refs.customer, Amount: amount,
		}},
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
			vou_employee_loan_writeoff_details, vou_expense_payment_details, vou_expense_reimbursement_details, vou_payment_details,
			vou_sales_receipt_account_allocations, vou_receipt_details,
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
	if entity == bobdomain.EntityWarehouse {
		declarations := dcldomain.NewWarehouseService(vouIntegrationPool(t), service, authorization.Func(nil), txevent.NewBus())
		created, err := declarations.Create(t.Context(), dcldomain.WarehouseCreateInput{Data: dcldomain.WarehouseData{
			Name: data.Name, Address: data.Address, ContactName: data.ContactName,
			ContactPhone: data.ContactPhone, ManagerEmployeeID: data.ManagerEmployeeID, Remark: data.Remark,
		}}, trustedIntegrationActor(t, "vou-ref-create"))
		if err != nil {
			t.Fatalf("create warehouse reference: %v", err)
		}
		submitted, err := declarations.Submit(t.Context(), dcldomain.WarehouseVersionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, trustedIntegrationActor(t, "vou-ref-submit"))
		if err != nil {
			t.Fatalf("submit warehouse reference: %v", err)
		}
		approved, err := declarations.Approve(t.Context(), dcldomain.WarehouseVersionInput{
			ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID,
			ApprovalRevision: submitted.Approval.Revision,
		}, trustedIntegrationActor(t, "vou-ref-approve"))
		if err != nil {
			t.Fatalf("approve warehouse reference: %v", err)
		}
		return ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
	}
	if entity == bobdomain.EntityVehicle {
		declarations := dcldomain.NewVehicleService(vouIntegrationPool(t), service, authorization.Func(nil), txevent.NewBus())
		created, err := declarations.Create(t.Context(), dcldomain.VehicleCreateInput{Data: dcldomain.VehicleData{
			Name: data.Name, PlateNumber: data.PlateNumber, VehicleType: data.VehicleType,
			CarrierAffiliation: data.CarrierAffiliation, BulkLiquidCapable: data.BulkLiquidCapable,
			VIN: data.VIN, EngineNumber: data.EngineNumber, LoadCapacityKG: data.LoadCapacityKG, Remark: data.Remark,
		}}, trustedIntegrationActor(t, "vou-ref-create"))
		if err != nil {
			t.Fatalf("create vehicle reference: %v", err)
		}
		submitted, err := declarations.Submit(t.Context(), dcldomain.VehicleVersionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, trustedIntegrationActor(t, "vou-ref-submit"))
		if err != nil {
			t.Fatalf("submit vehicle reference: %v", err)
		}
		approved, err := declarations.Approve(t.Context(), dcldomain.VehicleVersionInput{
			ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID,
			ApprovalRevision: submitted.Approval.Revision,
		}, trustedIntegrationActor(t, "vou-ref-approve"))
		if err != nil {
			t.Fatalf("approve vehicle reference: %v", err)
		}
		return ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
	}
	if entity == bobdomain.EntityProduct {
		if data.ProductTypeID != "01JPTP00000000000000000007" && data.DefaultPackagingSpec == "" {
			data.DefaultPackagingSpec = "1"
		}
		declarations := dcldomain.NewProductService(vouIntegrationPool(t), service, authorization.Func(nil), txevent.NewBus())
		created, err := declarations.Create(t.Context(), dcldomain.ProductCreateInput{Data: dcldomain.ProductInputFromData(dcldomain.ProductData{
			Name: data.Name, CategoryID: data.CategoryID,
			Specification: data.Specification, Model: data.Model, Barcode: data.Barcode, Remark: data.Remark,
			ProductTypeID: data.ProductTypeID, DefaultInputUnitID: data.DefaultInputUnitID,
			PricingUnitID: data.PricingUnitID, UnitConversions: data.UnitConversions,
			Returnable: data.Returnable, DefaultPackagingSpec: data.DefaultPackagingSpec, Formula: data.Formula,
		})}, trustedIntegrationActor(t, "vou-ref-create"))
		if err != nil {
			t.Fatalf("create product reference: %v", err)
		}
		submitted, err := declarations.Submit(t.Context(), dcldomain.ProductVersionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, trustedIntegrationActor(t, "vou-ref-submit"))
		if err != nil {
			t.Fatalf("submit product reference: %v", err)
		}
		approved, err := declarations.Approve(t.Context(), dcldomain.ProductVersionInput{
			ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID,
			ApprovalRevision: submitted.Approval.Revision,
		}, trustedIntegrationActor(t, "vou-ref-approve"))
		if err != nil {
			t.Fatalf("approve product reference: %v", err)
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
	if entity == bobdomain.EntityEmployee {
		return createApprovedEmployeeDeclaration(t, vouIntegrationPool(t), service, data)
	}
	if entity == bobdomain.EntitySupplier {
		return createApprovedSupplierDeclaration(t, vouIntegrationPool(t), service, data)
	}
	if entity == bobdomain.EntityOtherUnit {
		return createApprovedOtherUnitDeclaration(t, vouIntegrationPool(t), service, data)
	}
	t.Fatalf("unsupported DCL integration reference entity %q", entity)
	return ReferenceInput{}
}

func createApprovedSupplierDeclaration(t *testing.T, pool *pgxpool.Pool, business *bobdomain.Service, data bobdomain.CreateDetailInput) ReferenceInput {
	t.Helper()
	bus := txevent.NewBus()
	authorizer := authorization.Func(nil)
	suppliers := dcldomain.NewSupplierService(pool, business, authorizer, bus)
	created, err := suppliers.Create(t.Context(), dcldomain.SupplierCreateInput{
		Data: dcldomain.SupplierInput{Kind: "ORGANIZATION", LegalName: data.Name,
			Enabled: true, DisplayName: data.ShortName, TaxNumber: data.TaxNumber,
			ShortName: data.ShortName, ContactName: data.ContactName, ContactPhone: data.ContactPhone,
			Email: data.Email, Address: data.Address, Remark: data.Remark, SettlementMethodID: data.SettlementMethodID,
			StrongIdentifiers:          []dcldomain.BusinessIdentifierInput{},
			OperatingEntityIDs:         []string{data.OperatingEntityID},
			DefaultOperatingEntityID:   data.OperatingEntityID,
			DefaultPurchaserEmployeeID: data.DefaultPurchaserEmployeeID},
	}, trustedIntegrationActor(t, "vou-supplier-create"))
	if err != nil {
		t.Fatalf("create supplier declaration: %v", err)
	}
	submitted, err := suppliers.Submit(t.Context(), dcldomain.SupplierVersionInput{ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision}, trustedIntegrationActor(t, "vou-supplier-submit"))
	if err != nil {
		t.Fatalf("submit supplier declaration: %v", err)
	}
	approved, err := suppliers.Approve(t.Context(), dcldomain.SupplierVersionInput{ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID, ApprovalRevision: submitted.Approval.Revision}, trustedIntegrationActor(t, "vou-supplier-approve"))
	if err != nil {
		t.Fatalf("approve supplier declaration: %v", err)
	}
	return ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
}

func createApprovedOtherUnitDeclaration(t *testing.T, pool *pgxpool.Pool, business *bobdomain.Service, data bobdomain.CreateDetailInput) ReferenceInput {
	t.Helper()
	bus := txevent.NewBus()
	authorizer := authorization.Func(nil)
	typedArchives := dcldomain.NewTypedArchiveService(pool, typedarchiverules.New(business), authorizer, bus)
	created, err := typedArchives.CreateOtherUnit(t.Context(), dcldomain.OtherUnitCreateInput{
		Data: dcldomain.OtherUnitData{
			Kind: "ORGANIZATION", LegalName: data.Name,
			ContactName: data.ContactName, ContactPhone: data.ContactPhone, SettlementMethodID: data.SettlementMethodID,
			StrongIdentifiers:        []dcldomain.BusinessIdentifierInput{},
			Enabled:                  true,
			OperatingEntityIDs:       []string{data.OperatingEntityID},
			DefaultOperatingEntityID: data.OperatingEntityID,
		},
	}, trustedIntegrationActor(t, "vou-other-unit-create"))
	if err != nil {
		t.Fatalf("create other-unit declaration: %v", err)
	}
	submitted, err := typedArchives.SubmitOtherUnit(t.Context(), dcldomain.TypedArchiveVersionInput{ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision}, trustedIntegrationActor(t, "vou-other-unit-submit"))
	if err != nil {
		t.Fatalf("submit other-unit declaration: %v", err)
	}
	approved, err := typedArchives.ApproveOtherUnit(t.Context(), dcldomain.TypedArchiveVersionInput{ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID, ApprovalRevision: submitted.Approval.Revision}, trustedIntegrationActor(t, "vou-other-unit-approve"))
	if err != nil {
		t.Fatalf("approve other-unit declaration: %v", err)
	}
	return ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
}

func createApprovedEmployeeDeclaration(t *testing.T, pool *pgxpool.Pool, business *bobdomain.Service, data bobdomain.CreateDetailInput) ReferenceInput {
	t.Helper()
	bus := txevent.NewBus()
	authorizer := authorization.Func(nil)
	employees := dcldomain.NewEmployeeService(pool, business, authorizer, bus)
	created, err := employees.Create(t.Context(), dcldomain.EmployeeCreateInput{
		Data: dcldomain.EmployeeInput{Kind: "PERSON", LegalName: data.Name, StrongIdentifiers: []dcldomain.BusinessIdentifierInput{}, Enabled: true, CurrentOperatingEntityID: data.OperatingEntityID, EmployeeCategoryID: data.CategoryID, DepartmentID: data.DepartmentID,
			PositionID: data.PositionID, Phone: data.Phone, Email: data.Email, HireDate: data.HireDate, Remark: data.Remark},
	}, trustedIntegrationActor(t, "vou-employee-create"))
	if err != nil {
		t.Fatalf("create employee declaration: %v", err)
	}
	pending, err := employees.Submit(t.Context(), dcldomain.EmployeeVersionInput{ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision}, trustedIntegrationActor(t, "vou-employee-submit"))
	if err != nil {
		t.Fatalf("submit employee declaration: %v", err)
	}
	approved, err := employees.Approve(t.Context(), dcldomain.EmployeeVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, trustedIntegrationActor(t, "vou-employee-approve"))
	if err != nil {
		t.Fatalf("approve employee declaration: %v", err)
	}
	return ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
}

func disableVehicleViaDCL(
	t *testing.T,
	pool *pgxpool.Pool,
	business *bobdomain.Service,
	vehicle ReferenceInput,
	requestID string,
) {
	t.Helper()
	declarations := dcldomain.NewVehicleService(pool, business, authorization.Func(nil), txevent.NewBus())
	view, err := declarations.Get(t.Context(), dcldomain.VehicleGetInput{
		ObjectID: vehicle.ObjectID, ApprovalEntryID: vehicle.ApprovalEntryID,
	}, integrationApprovalActor(t, integrationActorOne, requestID+"-get"))
	if err != nil {
		t.Fatalf("get vehicle declaration before disable: %v", err)
	}
	draft, err := declarations.Save(t.Context(), dcldomain.VehicleSaveInput{
		ObjectID: view.ObjectID, ApprovalEntryID: view.Approval.ApprovalEntryID,
		ApprovalRevision: view.Approval.Revision, Enabled: false, Data: view.Data,
	}, integrationApprovalActor(t, integrationActorOne, requestID+"-save"))
	if err != nil {
		t.Fatalf("save vehicle disable declaration: %v", err)
	}
	pending, err := declarations.Submit(t.Context(), dcldomain.VehicleVersionInput{
		ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID,
		ApprovalRevision: draft.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, requestID+"-submit"))
	if err != nil {
		t.Fatalf("submit vehicle disable declaration: %v", err)
	}
	if _, err = declarations.Approve(t.Context(), dcldomain.VehicleVersionInput{
		ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID,
		ApprovalRevision: pending.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorTwo, requestID+"-approve")); err != nil {
		t.Fatalf("approve vehicle disable declaration: %v", err)
	}
}

func fixedSettlementReference(t *testing.T, pool *pgxpool.Pool, termCode string) ReferenceInput {
	t.Helper()
	var result ReferenceInput
	if err := pool.QueryRow(t.Context(), `
		SELECT object.id
		FROM aux_objects object
		WHERE object.entity='settlement-method' AND object.enabled AND object.data->>'termCode'=$1
		ORDER BY object.code LIMIT 1
	`, termCode).Scan(&result.ObjectID); err != nil {
		t.Fatalf("find fixed settlement method %s: %v", termCode, err)
	}
	return result
}

func newBOBIntegrationService(pool *pgxpool.Pool) *bobdomain.Service {
	auxiliary := auxdomain.NewService(pool)
	return bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
}

type vouCustomerAuxiliaryResolver struct{}

func (resolver vouCustomerAuxiliaryResolver) ResolveCurrentAuxiliaryReference(
	ctx context.Context, tx pgx.Tx, entity, objectID string,
) (bobdomain.AuxiliaryReference, error) {
	if entity == "payment-method" {
		return bobdomain.AuxiliaryReference{ObjectID: objectID, Entity: entity, Code: "PAY-0001", Data: map[string]any{"name": "银行转账"}}, nil
	}
	var code string
	var raw []byte
	if err := tx.QueryRow(ctx, `
		SELECT object.code,object.data
		FROM aux_objects object
		WHERE object.id=$1 AND object.entity=$2 AND object.enabled
	`, objectID, entity).Scan(&code, &raw); err != nil {
		return bobdomain.AuxiliaryReference{}, err
	}
	data := map[string]any{}
	if err := json.Unmarshal(raw, &data); err != nil {
		return bobdomain.AuxiliaryReference{}, err
	}
	return bobdomain.AuxiliaryReference{ObjectID: objectID, Entity: entity, Code: code, Data: data}, nil
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
) integrationCustomerReferences {
	t.Helper()
	bus := txevent.NewBus()
	authorizer := authorization.Func(nil)
	service := bobdomain.NewService(pool, vouCustomerAuxiliaryResolver{})
	customers := dcldomain.NewCustomerService(pool, service, authorizer, bus)
	operating := createApprovedBOB(t, service, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{
		Name: "VOU 客户经营主体", TaxNumber: "TAX" + newID()[3:],
	})
	if data.SettlementMethodID == "" {
		data.SettlementMethodID = "01JSMT00000000000000000017"
	}
	created, err := customers.Create(t.Context(), dcldomain.CustomerCreateInput{
		Data: dcldomain.CustomerDataInput{
			Kind: "ORGANIZATION", LegalName: data.Name + "主体" + newID()[20:], DisplayName: data.Name,
			Phone: data.ContactPhone, Address: data.Address, DefaultOperatingEntityID: operating.ObjectID, Enabled: true,
			StrongIdentifiers:  []dcldomain.BusinessIdentifierInput{},
			RemittanceProfiles: []dcldomain.CustomerRemittanceProfile{},
			Accounts: []dcldomain.CustomerAccountDataInput{{
				Name: data.Name, Enabled: true, IsDefault: true, CustomerTypeID: bobdomain.CustomerTypeEndUserID,
				ContactName: data.ContactName, ContactPhone: data.ContactPhone, Address: data.Address,
				SettlementMethodID:         data.SettlementMethodID,
				DefaultTransportMethodCode: "SELF_PICKUP", DefaultTransportMethodName: "客户自提",
				TransportSurcharge: "0.00", PricingPolicy: dcldomain.CustomerPricingPolicy{
					DefaultPremiumUnitPrice: "0.00", DefaultDiscountUnitPrice: "0.00", CostItems: []dcldomain.CustomerPricingCostItem{},
					ThirdPartyIntermediaryFixedUnitCost: "0.00", ThirdPartyIntermediaryVariableUnitCost: "0.00",
				}, CreditLimits: []dcldomain.CustomerCreditLimit{}, PrimarySalesAttribution: dcldomain.CustomerSalesAttributionInput{
					Type: dcldomain.CustomerSalesAttributionInternalEmployee, SubjectObjectID: data.SalespersonEmployeeID,
				},
			}},
		},
	}, trustedIntegrationActor(t, "vou-customer-create"))
	if err != nil {
		t.Fatalf("create customer reference: %s", integrationErrorChain(err))
	}
	submitted, err := customers.Submit(t.Context(), dcldomain.CustomerVersionInput{
		ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision,
	}, trustedIntegrationActor(t, "vou-customer-submit"))
	if err != nil {
		t.Fatalf("submit customer reference: %v", err)
	}
	approved, err := customers.Approve(t.Context(), dcldomain.CustomerVersionInput{
		ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: submitted.Approval.Revision,
	}, trustedIntegrationActor(t, "vou-customer-approve"))
	if err != nil {
		t.Fatalf("approve customer relationship: %v", err)
	}
	view, err := customers.Get(t.Context(), dcldomain.CustomerGetInput{ObjectID: approved.ObjectID}, trustedIntegrationActor(t, "vou-customer-get"))
	if err != nil || len(view.Data.Accounts) != 1 {
		t.Fatalf("load default customer account: accounts=%d err=%v", len(view.Data.Accounts), err)
	}
	return integrationCustomerReferences{
		Customer:        ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID},
		Account:         ReferenceInput{ObjectID: view.Data.Accounts[0].AccountID, ApprovalEntryID: approved.Approval.ApprovalEntryID},
		OperatingEntity: operating,
	}
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
	customer := createApprovedCustomer(t, pool, bobdomain.CreateDetailInput{
		Code: "VC" + suffix, Name: "VOU 客户", ContactName: "客户联系人",
		ContactPhone: "13800000000", Address: "深圳市测试路 1 号",
		SettlementMethodID:    settlement.ObjectID,
		SalespersonEmployeeID: employee.ObjectID,
	})
	return integrationReferences{
		customer:                    customer.Account,
		salesReceiptCustomer:        customer.Customer,
		salesReceiptOperatingEntity: operating,
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
		fundAccount: createApprovedFundAccount(t, pool, dcldomain.FundAccountData{
			Name: "VOU 资金账户", Currency: "CNY", OperatingEntityID: operating.ObjectID,
		}),
		settlement: settlement, carrier: carrier,
		vehicle: createApprovedBOB(t, service, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
			Code: "VV" + suffix, Name: "VOU 车辆", PlateNumber: "粤V" + suffix[len(suffix)-6:],
			VehicleType: "DIT-0003", CarrierAffiliation: &bobdomain.CarrierAffiliation{
				Type: "EXTERNAL", OtherUnitObjectID: carrier.ObjectID,
			},
		}),
	}
}

func newFundAccountIntegrationService(t *testing.T, pool *pgxpool.Pool) *dcldomain.FundAccountService {
	t.Helper()
	return dcldomain.NewFundAccountService(
		pool,
		newBOBIntegrationService(pool),
		authorization.Func(nil),
		txevent.NewBus(),
	)
}

func createApprovedFundAccount(
	t *testing.T,
	pool *pgxpool.Pool,
	data dcldomain.FundAccountData,
) ReferenceInput {
	t.Helper()
	service := newFundAccountIntegrationService(t, pool)
	created, err := service.Create(t.Context(), dcldomain.FundAccountCreateInput{Data: data}, trustedIntegrationActor(t, "vou-fund-create"))
	if err != nil {
		t.Fatalf("create fund account: %v", err)
	}
	pending, err := service.Submit(t.Context(), dcldomain.FundAccountVersionInput{
		ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
		ApprovalRevision: created.Approval.Revision,
	}, trustedIntegrationActor(t, "vou-fund-submit"))
	if err != nil {
		t.Fatalf("submit fund account: %v", err)
	}
	approved, err := service.Approve(t.Context(), dcldomain.FundAccountVersionInput{
		ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID,
		ApprovalRevision: pending.Approval.Revision,
	}, trustedIntegrationActor(t, "vou-fund-approve"))
	if err != nil {
		t.Fatalf("approve fund account: %v", err)
	}
	return ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
}

func newIntegrationService(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	return newIntegrationServiceWithBus(t, pool, txevent.NewBus())
}

func newIntegrationServiceWithBus(t *testing.T, pool *pgxpool.Pool, bus *txevent.Bus) *Service {
	t.Helper()
	service, err := NewService(pool, newBOBIntegrationService(pool), auxiliaryrefs.New(auxdomain.NewService(pool)), bus, AttachmentOptions{Root: t.TempDir()},
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
