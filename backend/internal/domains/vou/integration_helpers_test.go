//go:build integration

package vou

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	integrationActorOne = "01J00000000000000000000000"
	integrationActorTwo = "01J00000000000000000000001"
)

type integrationReferences struct {
	customer, supplier, employee, product, warehouse, fundAccount ReferenceInput
	settlement, platform, vehicle                                 ReferenceInput
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
			wfl_definition_instances, vou_audit_events, vou_download_tokens, vou_document_attachments,
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
			vou_purchase_order_details,
			vou_sale_order_details, vou_documents, vou_number_counters;
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
	if entity == bobdomain.EntityFundAccount && data.OperatingEntityID == "" {
		operating := createApprovedBOB(t, service, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{
			Name: "VOU 自动经营主体", TaxNumber: "TAX" + newID()[3:],
		})
		data.OperatingEntityID = operating.ObjectID
	}
	created, err := service.Create(t.Context(), entity, bobdomain.CreateInput{Data: data},
		integrationActorOne, "vou-ref-create")
	if err != nil {
		t.Fatalf("create %s reference: %v (cause: %v)", entity, err, errors.Unwrap(err))
	}
	submitted, err := service.Submit(t.Context(), entity, bobdomain.VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "vou-ref-submit")
	if err != nil {
		t.Fatalf("submit %s reference: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, bobdomain.ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "vou-ref-approve")
	if err != nil {
		t.Fatalf("approve %s reference: %v", entity, err)
	}
	return ReferenceInput{ObjectID: approved.ObjectID, VersionID: approved.VersionID}
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
		ObjectID: view.ObjectID, ObjectRevision: view.ObjectRevision,
		VersionID: view.Version.VersionID, Revision: view.Version.Revision, Reason: "integration update",
	}, integrationActorOne, requestID+"-unapprove")
	if err != nil {
		t.Fatalf("unapprove BOB reference: %v", err)
	}
	draft, err := service.Unsubmit(t.Context(), entity, bobdomain.ReverseInput{
		ObjectID: unapproved.ObjectID, ObjectRevision: unapproved.ObjectRevision,
		VersionID: unapproved.VersionID, Revision: unapproved.Revision, Reason: "integration update",
	}, integrationActorOne, requestID+"-unsubmit")
	if err != nil {
		t.Fatalf("unsubmit BOB reference: %v", err)
	}
	return draft
}

func fixedSettlementReference(t *testing.T, pool *pgxpool.Pool, termCode string) ReferenceInput {
	t.Helper()
	var result ReferenceInput
	if err := pool.QueryRow(t.Context(), `
		SELECT object.id,object.current_version_id
		FROM aux_objects object
		JOIN aux_versions version ON version.id=object.current_version_id
		WHERE object.entity='settlement-method' AND object.enabled AND version.data->>'termCode'=$1
	`, termCode).Scan(&result.ObjectID, &result.VersionID); err != nil {
		t.Fatalf("find fixed settlement method %s: %v", termCode, err)
	}
	return result
}

func newBOBIntegrationService(pool *pgxpool.Pool) *bobdomain.Service {
	service := bobdomain.NewService(pool)
	service.SetAuxiliaryResolver(auxiliaryrefs.New(auxdomain.NewService(pool)))
	return service
}

func prepareReferences(t *testing.T, pool *pgxpool.Pool) integrationReferences {
	t.Helper()
	service := newBOBIntegrationService(pool)
	suffix := newID()
	general := bobdomain.SupplierTypeGeneral
	logistics := bobdomain.SupplierTypeLogisticsPlatform
	settlement := fixedSettlementReference(t, pool, bobdomain.SettlementTermMonthly30)
	employee := createApprovedBOB(t, service, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "VE" + suffix, Name: "VOU 员工",
	})
	platform := createApprovedBOB(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
		Code: "VLP" + suffix, Name: "VOU 物流平台", SupplierType: &logistics,
		SalespersonEmployeeID: employee.ObjectID,
	})
	operating := createApprovedBOB(t, service, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{
		Name: "VOU 经营主体", TaxNumber: "TAX" + suffix[3:],
	})
	return integrationReferences{
		customer: createApprovedBOB(t, service, bobdomain.EntityCustomer, bobdomain.CreateDetailInput{
			Code: "VC" + suffix, Name: "VOU 客户", ContactName: "客户联系人",
			ContactPhone: "13800000000", Address: "深圳市测试路 1 号",
			SettlementMethodID:    settlement.ObjectID,
			SalespersonEmployeeID: employee.ObjectID,
		}),
		supplier: createApprovedBOB(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
			Code: "VS" + suffix, Name: "VOU 供应商", SupplierType: &general,
			ContactName: "供应商联系人", ContactPhone: "13900000000",
			SettlementMethodID:    settlement.ObjectID,
			SalespersonEmployeeID: employee.ObjectID,
		}),
		employee: employee,
		product: createApprovedBOB(t, service, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
			Code: "VP" + suffix, Name: "VOU 产品", Unit: "吨",
		}),
		warehouse: createApprovedBOB(t, service, bobdomain.EntityWarehouse, bobdomain.CreateDetailInput{
			Code: "VW" + suffix, Name: "VOU 仓库",
		}),
		fundAccount: createApprovedBOB(t, service, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{
			Code: "VF" + suffix, Name: "VOU 资金账户", Currency: "CNY", OperatingEntityID: operating.ObjectID,
		}),
		settlement: settlement, platform: platform,
		vehicle: createApprovedBOB(t, service, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
			Code: "VV" + suffix, Name: "VOU 车辆", PlateNumber: "粤V" + suffix[len(suffix)-6:],
			VehicleType: "DIT-0003", PlatformObjectID: platform.ObjectID,
		}),
	}
}

func newIntegrationService(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	return newIntegrationServiceWithBus(t, pool, txevent.NewBus())
}

func newIntegrationServiceWithBus(t *testing.T, pool *pgxpool.Pool, bus *txevent.Bus) *Service {
	t.Helper()
	service, err := NewService(pool, newBOBIntegrationService(pool), auxiliaryrefs.New(auxdomain.NewService(pool)), bus, AttachmentOptions{Root: t.TempDir()},
		slog.New(slog.NewTextHandler(io.Discard, nil)), WithAccountingControl(integrationAccountingControl{}))
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	return service
}

type integrationAccountingControl struct{}

func (integrationAccountingControl) PartyBalance(ctx context.Context, tx pgx.Tx, input PartyBalanceQuery) (int64, error) {
	var ready bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM acc_books book JOIN acc_openings opening ON opening.book_id=book.id
		WHERE book.control_book AND opening.state='APPROVED'
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
		JOIN acc_openings opening ON opening.book_id=book.id AND opening.state='APPROVED'
		WHERE subject.settlement_purpose=$2 AND line.currency=$3
		  AND line.dimensions->>$4=$5 AND voucher.business_date<=$6::date
		  AND (COALESCE(cardinality($7::text[]),0)=0 OR voucher.source_id=ANY($7::text[]))`,
		multiplier, input.SettlementPurpose, input.Currency, input.CounterpartyDimension,
		input.CounterpartyObjectID, input.AsOfDate, input.SourceDocumentIDs).Scan(&balance)
	return balance, err
}
