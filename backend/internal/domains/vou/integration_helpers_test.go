//go:build integration

package vou

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
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
		TRUNCATE vou_audit_events, vou_download_tokens, vou_document_attachments,
			vou_files, wfl_audit_events, wfl_process_documents, wfl_process_instances,
			vou_signoff_note_lines, vou_signoff_note_details,
			vou_delivery_note_lines, vou_delivery_note_details,
			vou_goods_receipt_lines, vou_goods_receipt_details,
			vou_procurement_order_lines, vou_procurement_order_details,
			vou_customer_order_lines, vou_customer_order_details,
			vou_expense_lines, vou_product_lines, vou_other_income_details,
			vou_expense_reimbursement_details, vou_payment_details, vou_receipt_details,
			vou_intermediary_sale_order_details, vou_purchase_order_details,
			vou_sale_order_details, vou_documents, vou_number_counters`)
	if err != nil {
		t.Fatalf("truncate VOU: %v", err)
	}
}

func createApprovedBOB(
	t *testing.T, service *bobdomain.Service, entity string, data bobdomain.CreateDetailInput,
) ReferenceInput {
	t.Helper()
	created, err := service.Create(t.Context(), entity, bobdomain.CreateInput{Data: data},
		integrationActorOne, "vou-ref-create")
	if err != nil {
		t.Fatalf("create %s reference: %v", entity, err)
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

func int32IntegrationPointer(value int32) *int32 { return &value }

func prepareReferences(t *testing.T, pool *pgxpool.Pool) integrationReferences {
	t.Helper()
	service := bobdomain.NewService(pool)
	suffix := newID()
	general := bobdomain.SupplierTypeGeneral
	logistics := bobdomain.SupplierTypeLogisticsPlatform
	settlement := createApprovedBOB(t, service, bobdomain.EntitySettlementMethod, bobdomain.CreateDetailInput{
		Code: "VSM" + suffix, Name: "次月十五日", RuleType: bobdomain.SettlementRuleFixedDay,
		MonthOffset: 1, DayOfMonth: int32IntegrationPointer(15), DayOffset: 0,
		Description: "按自然日计算",
	})
	employee := createApprovedBOB(t, service, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "VE" + suffix, Name: "VOU 员工",
	})
	platform := createApprovedBOB(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
		Code: "VLP" + suffix, Name: "VOU 物流平台", SupplierType: &logistics,
		SalespersonEmployeeID: employee.ObjectID,
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
			Code: "VF" + suffix, Name: "VOU 资金账户", Currency: "CNY",
		}),
		settlement: settlement, platform: platform,
		vehicle: createApprovedBOB(t, service, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
			Code: "VV" + suffix, Name: "VOU 车辆", PlateNumber: "粤V" + suffix[len(suffix)-6:],
			VehicleType: "厢式货车", PlatformObjectID: platform.ObjectID,
		}),
	}
}

func newIntegrationService(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	service, err := NewService(pool, bobdomain.NewService(pool), txevent.NewBus(), AttachmentOptions{Root: t.TempDir()},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	return service
}
