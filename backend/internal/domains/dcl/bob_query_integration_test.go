//go:build integration

package dcl

import (
	"context"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type bobQueryNameKey struct{}

type bobQueryTracer struct {
	mu    sync.Mutex
	names []string
	after func(string)
}

func (t *bobQueryTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	firstLine := strings.SplitN(strings.TrimSpace(data.SQL), "\n", 2)[0]
	fields := strings.Fields(firstLine)
	if len(fields) < 3 || fields[0] != "--" || fields[1] != "name:" {
		return ctx
	}
	return context.WithValue(ctx, bobQueryNameKey{}, fields[2])
}

func (t *bobQueryTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	name, _ := ctx.Value(bobQueryNameKey{}).(string)
	if name == "" {
		return
	}
	t.mu.Lock()
	t.names = append(t.names, name)
	after := t.after
	t.mu.Unlock()
	if after != nil {
		after(name)
	}
}

func (t *bobQueryTracer) reset(after func(string)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.names = nil
	t.after = after
}

func (t *bobQueryTracer) recorded() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]string(nil), t.names...)
}

func tracedBOBIntegrationPool(t *testing.T, tracer pgx.QueryTracer) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	databaseName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || databaseName == "" || !strings.HasSuffix(databaseName, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse BOB integration database config: %v", err)
	}
	config.ConnConfig.Tracer = tracer
	pool, err := pgxpool.NewWithConfig(t.Context(), config)
	if err != nil {
		t.Fatalf("connect traced BOB integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type bobQueryFixture struct {
	objectID string
	entryID  string
}

func seedBOBQueryFixtures(t *testing.T, pool *pgxpool.Pool) map[string]bobQueryFixture {
	t.Helper()
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	fixtures := map[string]bobQueryFixture{}
	insertSubject := func(entity, code string) bobQueryFixture {
		fixture := bobQueryFixture{objectID: ulid.Make().String(), entryID: ulid.Make().String()}
		if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,$2,$3,$4)`, fixture.objectID, entity, code, creatorID); err != nil {
			t.Fatalf("insert %s subject: %v", entity, err)
		}
		insertApprovedBOBEntry(t, pool, fixture.entryID, entity, fixture.objectID, creatorID, reviewerID)
		fixtures[entity] = fixture
		return fixture
	}

	operating := insertSubject(bobdomain.EntityOperatingEntity, "OPE-0001")
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_operating_entity_versions(approval_entry_id,legal_name,short_name,tax_number,address,phone,remark,enabled) VALUES($1,'查询经营主体','主体简称','TAX-QUERY','经营地址','0755-1000','经营备注',true)`, operating.entryID); err != nil {
		t.Fatalf("insert operating entity snapshot: %v", err)
	}
	warehouse := insertSubject(bobdomain.EntityWarehouse, "WHS-0001")
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_warehouse_versions(approval_entry_id,name,address,contact_name,contact_phone,remark,enabled) VALUES($1,'查询仓库','仓库地址','仓库联系人','13800000001','仓库备注',true)`, warehouse.entryID); err != nil {
		t.Fatalf("insert warehouse snapshot: %v", err)
	}
	fund := insertSubject(bobdomain.EntityFundAccount, "FAC-0001")
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_fund_account_versions(approval_entry_id,name,currency,account_name,bank_name,bank_branch,account_number,remark,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,enabled) VALUES($1,'查询资金账户','CNY','账户名','银行','支行','6222000000000000','资金备注',$2,$3,'OPE-0001','查询经营主体',true)`, fund.entryID, operating.objectID, operating.entryID); err != nil {
		t.Fatalf("insert fund account snapshot: %v", err)
	}

	for _, entity := range []string{bobdomain.EntitySupplier, bobdomain.EntityEmployee, bobdomain.EntityOtherUnit, bobdomain.EntitySalesPartner} {
		codes := map[string]string{bobdomain.EntitySupplier: "SUP-0001", bobdomain.EntityEmployee: "EMP-0001", bobdomain.EntityOtherUnit: "OTU-0001", bobdomain.EntitySalesPartner: "SLP-0001"}
		fixture := insertSubject(entity, codes[entity])
		fixtures[entity] = fixture
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_supplier_versions(approval_entry_id,kind,legal_name,display_name,short_name,legal_identifier,contact_name,contact_phone,email,address,remark,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,enabled) VALUES($1,'ORGANIZATION','查询供应商法定名','查询供应商','供应简称','91350211M00010001X','供应联系人','13800000003','supplier@example.test','供应地址','供应备注',$2,$3,'OPE-0001','查询经营主体',true)`, fixtures[bobdomain.EntitySupplier].entryID, operating.objectID, operating.entryID); err != nil {
		t.Fatalf("insert supplier snapshot: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_employee_versions(approval_entry_id,kind,legal_name,display_name,legal_identifier,phone,email,hire_date,current_operating_entity_id,current_operating_entity_approval_entry_id,current_operating_entity_code,current_operating_entity_name,remark,enabled) VALUES($1,'PERSON','查询员工法定名','查询员工','110105199001010010','13800000004','employee@example.test','2026-08-30',$2,$3,'OPE-0001','查询经营主体','员工备注',true)`, fixtures[bobdomain.EntityEmployee].entryID, operating.objectID, operating.entryID); err != nil {
		t.Fatalf("insert employee snapshot: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_other_unit_versions(approval_entry_id,kind,legal_name,display_name,legal_identifier,contact_name,contact_phone,email,address,remark,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,enabled) VALUES($1,'ORGANIZATION','查询其他往来单位法定名','查询其他往来单位','91350211M000100021','其他联系人','13800000005','other@example.test','其他地址','其他备注',$2,$3,'OPE-0001','查询经营主体',true)`, fixtures[bobdomain.EntityOtherUnit].entryID, operating.objectID, operating.entryID); err != nil {
		t.Fatalf("insert other unit snapshot: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_sales_partner_versions(approval_entry_id,kind,legal_name,display_name,legal_identifier,capabilities,contact_name,contact_phone,email,address,remark,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,enabled) VALUES($1,'ORGANIZATION','查询销售伙伴法定名','查询销售伙伴','91350211M000100034',ARRAY['CHANNEL_PARTNER']::varchar[],'销售联系人','13800000006','sales@example.test','销售地址','销售备注',$2,$3,'OPE-0001','查询经营主体',true)`, fixtures[bobdomain.EntitySalesPartner].entryID, operating.objectID, operating.entryID); err != nil {
		t.Fatalf("insert sales partner snapshot: %v", err)
	}
	for _, archive := range []struct {
		table   string
		entryID string
	}{
		{"dcl_supplier_version_operating_entities", fixtures[bobdomain.EntitySupplier].entryID},
		{"dcl_other_unit_version_operating_entities", fixtures[bobdomain.EntityOtherUnit].entryID},
		{"dcl_sales_partner_version_operating_entities", fixtures[bobdomain.EntitySalesPartner].entryID},
	} {
		if _, err := pool.Exec(t.Context(), `INSERT INTO `+archive.table+`(approval_entry_id,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name) VALUES($1,$2,$3,'OPE-0001','查询经营主体')`, archive.entryID, operating.objectID, operating.entryID); err != nil {
			t.Fatalf("insert %s operating entity scope: %v", archive.table, err)
		}
	}
	return fixtures
}

func insertApprovedBOBEntry(t *testing.T, pool *pgxpool.Pool, entryID, entity, subjectID, creatorID, reviewerID string) {
	t.Helper()
	if _, err := pool.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'dcl',$2,$3,1,'APPROVED',3,$4,now(),$5,now(),$4,now(),$5,now())`, entryID, entity, subjectID, creatorID, reviewerID); err != nil {
		t.Fatalf("insert approved %s entry: %v", entity, err)
	}
}

func TestBOBQueriesUseTwoBusinessSQLStatementsIntegration(t *testing.T) {
	basePool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, basePool)
	fixtures := seedBOBQueryFixtures(t, basePool)
	tracer := &bobQueryTracer{}
	pool := tracedBOBIntegrationPool(t, tracer)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))

	tests := []struct {
		entity string
		want   []string
	}{
		{bobdomain.EntityOperatingEntity, []string{"ListBobOperatingEntities", "CountBobOperatingEntities"}},
		{bobdomain.EntityWarehouse, []string{"ListBobWarehouses", "CountBobWarehouses"}},
		{bobdomain.EntityFundAccount, []string{"ListBobFundAccounts", "CountBobFundAccounts"}},
		{bobdomain.EntitySupplier, []string{"ListBobSupplierCurrentsTyped", "CountBobSupplierCurrentsTyped"}},
		{bobdomain.EntityEmployee, []string{"ListBobEmployeeCurrentsTyped", "CountBobEmployeeCurrentsTyped"}},
		{bobdomain.EntityOtherUnit, []string{"ListBobOtherUnitCurrentsTyped", "CountBobOtherUnitCurrentsTyped"}},
		{bobdomain.EntitySalesPartner, []string{"ListBobSalesPartnerCurrentsTyped", "CountBobSalesPartnerCurrentsTyped"}},
	}
	for _, test := range tests {
		t.Run(test.entity, func(t *testing.T) {
			pageSizes := []int{1, 20}
			if test.entity == bobdomain.EntitySupplier {
				pageSizes = []int{20}
			}
			for _, pageSize := range pageSizes {
				tracer.reset(nil)
				page, err := business.Query(t.Context(), test.entity, bobdomain.QueryInput{Page: 1, PageSize: pageSize})
				if err != nil {
					t.Fatalf("query %s with page size %d: %v", test.entity, pageSize, err)
				}
				if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ObjectID != fixtures[test.entity].objectID {
					t.Fatalf("%s page = %+v", test.entity, page)
				}
				if got := tracer.recorded(); !reflect.DeepEqual(got, test.want) {
					t.Fatalf("%s page-size-%d business SQL = %v, want %v", test.entity, pageSize, got, test.want)
				}
				assertBOBQueryResult(t, test.entity, page.Items[0])
			}
		})
	}
}

func TestBOBTypedArchiveOperatingEntityFiltersIsolateListAndCountIntegration(t *testing.T) {
	basePool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, basePool)
	seedBOBQueryFixtures(t, basePool)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	unrelatedOperatingID, unrelatedEntryID := ulid.Make().String(), ulid.Make().String()
	if _, err := basePool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'operating-entity','OPE-0002',$2)`, unrelatedOperatingID, creatorID); err != nil {
		t.Fatalf("insert unrelated operating entity: %v", err)
	}
	insertApprovedBOBEntry(t, basePool, unrelatedEntryID, bobdomain.EntityOperatingEntity, unrelatedOperatingID, creatorID, reviewerID)
	if _, err := basePool.Exec(t.Context(), `INSERT INTO dcl_operating_entity_versions(approval_entry_id,legal_name,enabled) VALUES($1,'未关联经营主体',true)`, unrelatedEntryID); err != nil {
		t.Fatalf("insert unrelated operating entity snapshot: %v", err)
	}

	tracer := &bobQueryTracer{}
	pool := tracedBOBIntegrationPool(t, tracer)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	for _, test := range []struct {
		entity string
		want   []string
	}{
		{bobdomain.EntitySupplier, []string{"ListBobSupplierCurrentsTyped", "CountBobSupplierCurrentsTyped"}},
		{bobdomain.EntityOtherUnit, []string{"ListBobOtherUnitCurrentsTyped", "CountBobOtherUnitCurrentsTyped"}},
		{bobdomain.EntitySalesPartner, []string{"ListBobSalesPartnerCurrentsTyped", "CountBobSalesPartnerCurrentsTyped"}},
	} {
		t.Run(test.entity, func(t *testing.T) {
			tracer.reset(nil)
			page, err := business.Query(t.Context(), test.entity, bobdomain.QueryInput{
				Page:     1,
				PageSize: 20,
				Filters:  bobdomain.QueryFilters{OperatingEntityID: unrelatedOperatingID},
			})
			if err != nil {
				t.Fatalf("query %s: %v", test.entity, err)
			}
			if page.Total != 0 || len(page.Items) != 0 {
				t.Fatalf("%s operating entity isolation page = %+v", test.entity, page)
			}
			if got := tracer.recorded(); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("%s operating entity isolation SQL = %v, want %v", test.entity, got, test.want)
			}
		})
	}
}

func assertBOBQueryResult(t *testing.T, entity string, item bobdomain.QueryItem) {
	t.Helper()
	if item.SourceApprovalEntryID == "" || item.SourceVersionNo != 1 || !item.Enabled {
		t.Fatalf("%s source result = %+v", entity, item)
	}
	switch entity {
	case bobdomain.EntityOperatingEntity:
		if item.Data.Name != "查询经营主体" || item.Data.TaxNumber != "TAX-QUERY" {
			t.Fatalf("operating entity query result = %+v", item.Data)
		}
	case bobdomain.EntityWarehouse:
		if item.Data.Name != "查询仓库" || item.Data.ContactName != "仓库联系人" {
			t.Fatalf("warehouse query result = %+v", item.Data)
		}
	case bobdomain.EntityFundAccount:
		if item.Data.Name != "查询资金账户" || item.Data.BankName != "银行" || item.Data.AccountNumber != "" {
			t.Fatalf("fund account query result = %+v", item.Data)
		}
	case bobdomain.EntitySupplier:
		if item.Data.LegalName != "查询供应商法定名" || item.Data.DisplayName != "查询供应商" || item.Data.OperatingEntityName != "查询经营主体" {
			t.Fatalf("supplier typed archive query result = %+v", item.Data)
		}
	case bobdomain.EntityEmployee:
		if item.Data.LegalName != "查询员工法定名" || item.Data.DisplayName != "查询员工" || item.Data.CurrentOperatingEntity.Name != "查询经营主体" {
			t.Fatalf("employee typed archive query result = %+v", item.Data)
		}
	case bobdomain.EntityOtherUnit:
		if item.Data.LegalName != "查询其他往来单位法定名" || item.Data.DisplayName != "查询其他往来单位" || item.Data.DefaultOperatingEntityID == "" {
			t.Fatalf("other-unit typed archive query result = %+v", item.Data)
		}
	case bobdomain.EntitySalesPartner:
		if item.Data.LegalName != "查询销售伙伴法定名" || item.Data.DisplayName != "查询销售伙伴" || item.Data.DefaultOperatingEntityID == "" {
			t.Fatalf("sales-partner typed archive query result = %+v", item.Data)
		}
	}
}

func TestBOBReferenceCandidatesReturnLatestApprovedEnabledOnly(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	fixtures := seedBOBQueryFixtures(t, pool)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))

	candidates, err := business.QueryReferenceCandidates(t.Context(), bobdomain.ReferenceQueryInput{
		Entity: bobdomain.EntitySalesPartner,
	})
	if err != nil {
		t.Fatalf("query sales partner reference candidates first: %v", err)
	}
	if len(candidates) != 1 || candidates[0].ObjectID != fixtures[bobdomain.EntitySalesPartner].objectID {
		t.Fatalf("sales partner candidates initial result = %+v", candidates)
	}

	disabledEntryID := ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'dcl',$2,$3,2,'APPROVED',$4,$5,now(),$5,now(),$5,now(),$6,now())`, disabledEntryID, bobdomain.EntitySalesPartner, fixtures[bobdomain.EntitySalesPartner].objectID, 4, ulid.Make().String(), ulid.Make().String()); err != nil {
		t.Fatalf("insert disabled approved entry: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_sales_partner_versions(approval_entry_id,kind,legal_name,display_name,capabilities,contact_name,contact_phone,email,address,remark,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,enabled) VALUES($1,'ORGANIZATION','查询销售伙伴法定名','候选销售伙伴',ARRAY['CHANNEL_PARTNER']::varchar[],'候选联系人','13900139000','sales2@example.test','地址','说明',$2,$3,'OPE-0001','查询经营主体',false)`, disabledEntryID, fixtures[bobdomain.EntityOperatingEntity].objectID, fixtures[bobdomain.EntityOperatingEntity].entryID); err != nil {
		t.Fatalf("insert disabled sales partner snapshot: %v", err)
	}

	candidates, err = business.QueryReferenceCandidates(t.Context(), bobdomain.ReferenceQueryInput{
		Entity: bobdomain.EntitySalesPartner,
	})
	if err != nil {
		t.Fatalf("query sales partner reference candidates disabled latest: %v", err)
	}
	if len(candidates) != 0 {
		t.Fatalf("sales partner candidates after disabled latest should be empty, got=%+v", candidates)
	}

	enabledEntryID := ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'dcl',$2,$3,3,'APPROVED',$4,$5,now(),$5,now(),$5,now(),$6,now())`, enabledEntryID, bobdomain.EntitySalesPartner, fixtures[bobdomain.EntitySalesPartner].objectID, 4, ulid.Make().String(), ulid.Make().String()); err != nil {
		t.Fatalf("insert enabled approved entry: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_sales_partner_versions(approval_entry_id,kind,legal_name,display_name,capabilities,contact_name,contact_phone,email,address,remark,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,enabled) VALUES($1,'ORGANIZATION','查询销售伙伴法定名','最新版销售伙伴',ARRAY['EXTERNAL_PART_TIME']::varchar[],'最新版联系人','13900139001','sales3@example.test','地址','说明',$2,$3,'OPE-0001','查询经营主体',true)`, enabledEntryID, fixtures[bobdomain.EntityOperatingEntity].objectID, fixtures[bobdomain.EntityOperatingEntity].entryID); err != nil {
		t.Fatalf("insert enabled sales partner snapshot: %v", err)
	}

	candidates, err = business.QueryReferenceCandidates(t.Context(), bobdomain.ReferenceQueryInput{
		Entity: bobdomain.EntitySalesPartner,
	})
	if err != nil {
		t.Fatalf("query sales partner reference candidates re-enabled latest: %v", err)
	}
	if len(candidates) != 1 || candidates[0].ObjectID != fixtures[bobdomain.EntitySalesPartner].objectID || candidates[0].ApprovalEntryID != enabledEntryID {
		t.Fatalf("sales partner candidates after re-enabled latest = %+v", candidates)
	}
}

func TestBOBQueryListAndCountShareRepeatableReadSnapshotIntegration(t *testing.T) {
	basePool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, basePool)
	seedBOBQueryFixtures(t, basePool)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	pendingSubjectID, pendingEntryID := ulid.Make().String(), ulid.Make().String()
	if _, err := basePool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'operating-entity','OPE-0002',$2)`, pendingSubjectID, creatorID); err != nil {
		t.Fatalf("insert pending concurrent subject: %v", err)
	}
	if _, err := basePool.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at) VALUES($1,'dcl','operating-entity',$2,1,'PENDING',2,$3,now(),$3,now(),$3,now())`, pendingEntryID, pendingSubjectID, creatorID); err != nil {
		t.Fatalf("insert pending concurrent entry: %v", err)
	}
	if _, err := basePool.Exec(t.Context(), `INSERT INTO dcl_operating_entity_versions(approval_entry_id,legal_name,enabled) VALUES($1,'并发批准经营主体',true)`, pendingEntryID); err != nil {
		t.Fatalf("insert pending concurrent snapshot: %v", err)
	}

	tracer := &bobQueryTracer{}
	pool := tracedBOBIntegrationPool(t, tracer)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	approved := false
	tracer.reset(func(name string) {
		if name != "ListBobOperatingEntities" || approved {
			return
		}
		approved = true
		if _, err := basePool.Exec(t.Context(), `UPDATE approval_entries SET status='APPROVED',revision=3,updated_by=$2,updated_at=now(),approved_by=$2,approved_at=now() WHERE id=$1`, pendingEntryID, reviewerID); err != nil {
			t.Fatalf("approve concurrent fixture: %v", err)
		}
	})
	page, err := business.Query(t.Context(), bobdomain.EntityOperatingEntity, bobdomain.QueryInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("query across concurrent approve: %v", err)
	}
	if !approved || page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("approve snapshot page = %+v, approved=%v", page, approved)
	}

	unapproved := false
	tracer.reset(func(name string) {
		if name != "ListBobOperatingEntities" || unapproved {
			return
		}
		unapproved = true
		if _, err := basePool.Exec(t.Context(), `UPDATE approval_entries SET status='DRAFT',revision=4,updated_by=$2,updated_at=now(),submitted_by=NULL,submitted_at=NULL,approved_by=NULL,approved_at=NULL WHERE id=$1`, pendingEntryID, creatorID); err != nil {
			t.Fatalf("unapprove concurrent fixture: %v", err)
		}
	})
	page, err = business.Query(t.Context(), bobdomain.EntityOperatingEntity, bobdomain.QueryInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("query across concurrent unapprove: %v", err)
	}
	if !unapproved || page.Total != 2 || len(page.Items) != 2 {
		t.Fatalf("unapprove snapshot page = %+v, unapproved=%v", page, unapproved)
	}
}

func TestWarehouseAndEmployeeAcceptEveryExactSortCombinationIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	fixtures := seedBOBQueryFixtures(t, pool)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()

	warehouse2 := bobQueryFixture{objectID: ulid.Make().String(), entryID: ulid.Make().String()}
	if _, err := pool.Exec(t.Context(), `UPDATE dcl_warehouse_versions SET name='Bravo' WHERE approval_entry_id=$1`, fixtures[bobdomain.EntityWarehouse].entryID); err != nil {
		t.Fatalf("prepare first warehouse sort row: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE approval_entries SET updated_at='2026-01-01T00:00:00Z' WHERE id=$1`, fixtures[bobdomain.EntityWarehouse].entryID); err != nil {
		t.Fatalf("set first warehouse sort time: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'warehouse','WHS-0002',$2)`, warehouse2.objectID, creatorID); err != nil {
		t.Fatalf("insert second warehouse subject: %v", err)
	}
	insertApprovedBOBEntry(t, pool, warehouse2.entryID, bobdomain.EntityWarehouse, warehouse2.objectID, creatorID, reviewerID)
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_warehouse_versions(approval_entry_id,name,enabled) VALUES($1,'Alpha',true)`, warehouse2.entryID); err != nil {
		t.Fatalf("insert second warehouse sort row: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE approval_entries SET updated_at='2026-01-02T00:00:00Z' WHERE id=$1`, warehouse2.entryID); err != nil {
		t.Fatalf("set second warehouse sort time: %v", err)
	}

	employee2 := bobQueryFixture{objectID: ulid.Make().String(), entryID: ulid.Make().String()}
	if _, err := pool.Exec(t.Context(), `UPDATE dcl_employee_versions SET display_name='Bravo' WHERE approval_entry_id=$1`, fixtures[bobdomain.EntityEmployee].entryID); err != nil {
		t.Fatalf("prepare first employee sort row: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE approval_entries SET updated_at='2026-01-01T00:00:00Z' WHERE id=$1`, fixtures[bobdomain.EntityEmployee].entryID); err != nil {
		t.Fatalf("set first employee sort time: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'employee','EMP-0002',$2)`, employee2.objectID, creatorID); err != nil {
		t.Fatalf("insert second employee subject: %v", err)
	}
	insertApprovedBOBEntry(t, pool, employee2.entryID, bobdomain.EntityEmployee, employee2.objectID, creatorID, reviewerID)
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_employee_versions(approval_entry_id,kind,legal_name,display_name,current_operating_entity_id,current_operating_entity_approval_entry_id,current_operating_entity_code,current_operating_entity_name,enabled) VALUES($1,'PERSON','Alpha','Alpha',$2,$3,'OPE-0001','查询经营主体',true)`, employee2.entryID, fixtures[bobdomain.EntityOperatingEntity].objectID, fixtures[bobdomain.EntityOperatingEntity].entryID); err != nil {
		t.Fatalf("insert second employee sort row: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE approval_entries SET updated_at='2026-01-02T00:00:00Z' WHERE id=$1`, employee2.entryID); err != nil {
		t.Fatalf("set second employee sort time: %v", err)
	}

	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	for _, test := range []struct {
		entity, field, order string
		want                 []string
	}{
		{bobdomain.EntityWarehouse, "updatedAt", "asc", []string{fixtures[bobdomain.EntityWarehouse].objectID, warehouse2.objectID}},
		{bobdomain.EntityWarehouse, "updatedAt", "desc", []string{warehouse2.objectID, fixtures[bobdomain.EntityWarehouse].objectID}},
		{bobdomain.EntityWarehouse, "code", "asc", []string{fixtures[bobdomain.EntityWarehouse].objectID, warehouse2.objectID}},
		{bobdomain.EntityWarehouse, "code", "desc", []string{warehouse2.objectID, fixtures[bobdomain.EntityWarehouse].objectID}},
		{bobdomain.EntityWarehouse, "name", "asc", []string{warehouse2.objectID, fixtures[bobdomain.EntityWarehouse].objectID}},
		{bobdomain.EntityWarehouse, "name", "desc", []string{fixtures[bobdomain.EntityWarehouse].objectID, warehouse2.objectID}},
		{bobdomain.EntityEmployee, "code", "asc", []string{fixtures[bobdomain.EntityEmployee].objectID, employee2.objectID}},
	} {
		t.Run(test.entity+"/"+test.field+"/"+test.order, func(t *testing.T) {
			page, err := business.Query(t.Context(), test.entity, bobdomain.QueryInput{Page: 1, PageSize: 20, Sort: []bobdomain.SortItem{{Field: test.field, Order: test.order}}})
			if err != nil {
				t.Fatalf("query sorted %s: %v", test.entity, err)
			}
			got := make([]string, 0, len(page.Items))
			for _, item := range page.Items {
				got = append(got, item.ObjectID)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("sorted IDs = %v, want %v", got, test.want)
			}
		})
	}
}
