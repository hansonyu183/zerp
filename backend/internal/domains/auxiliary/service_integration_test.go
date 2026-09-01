//go:build integration

package aux

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func directIntegrationService(t *testing.T) (*Service, *pgxpool.Pool, approval.Actor) {
	t.Helper()
	url, db := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL")), strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if url == "" || !strings.HasSuffix(db, "_test") {
		t.Fatal("safe integration database required")
	}
	pool, err := pgxpool.New(t.Context(), url)
	if err != nil {
		t.Fatalf("connect test database: %v", err)
	}
	t.Cleanup(pool.Close)
	actor, err := approval.TrustedSystemActor("aux-direct-" + ulid.Make().String())
	if err != nil {
		t.Fatal(err)
	}
	return NewService(pool), pool, actor
}

func TestDirectCRUDIntegration(t *testing.T) {
	s, pool, actor := directIntegrationService(t)
	suffix := ulid.Make().String()
	created, err := s.Create(t.Context(), EntityPaymentMethod, CreateInput{Data: CreateData{Data: map[string]any{"name": "直接创建-" + suffix}}}, actor)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	view, err := s.Get(t.Context(), EntityPaymentMethod, GetInput{ObjectID: created.ObjectID}, actor)
	if err != nil || stringValue(view.Data["name"]) != "直接创建-"+suffix {
		t.Fatalf("read created current data: %+v %v", view, err)
	}
	page, err := s.Query(t.Context(), EntityPaymentMethod, QueryInput{Page: 1, PageSize: 20, Filters: QueryFilters{Keyword: "直接创建-" + suffix}}, actor)
	if err != nil || len(page.Items) != 1 || page.Items[0].ObjectID != created.ObjectID {
		t.Fatalf("query created current data: %+v %v", page, err)
	}
	renamed, err := s.Save(t.Context(), EntityPaymentMethod, SaveInput{ObjectID: created.ObjectID, ObjectRevision: created.ObjectRevision, Data: map[string]any{"name": "直接改名-" + suffix}}, actor)
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.ObjectID != created.ObjectID {
		t.Fatalf("stable identity changed on rename: created=%s renamed=%s", created.ObjectID, renamed.ObjectID)
	}
	if _, err = s.Save(t.Context(), EntityPaymentMethod, SaveInput{ObjectID: created.ObjectID, ObjectRevision: created.ObjectRevision, Data: map[string]any{"name": "stale"}}, actor); !errorKind(err, ErrorConflict) {
		t.Fatalf("stale save = %v", err)
	}
	disabled, err := s.Disable(t.Context(), EntityPaymentMethod, ObjectRevisionInput{ObjectID: created.ObjectID, ObjectRevision: renamed.ObjectRevision}, actor)
	if err != nil || disabled.Enabled {
		t.Fatalf("disable: %+v %v", disabled, err)
	}
	if _, err = s.ResolveCurrentReference(t.Context(), nil, EntityPaymentMethod, created.ObjectID); !errorKind(err, ErrorConflict) {
		t.Fatalf("disabled new reference = %v", err)
	}
	enabled, err := s.Enable(t.Context(), EntityPaymentMethod, ObjectRevisionInput{ObjectID: created.ObjectID, ObjectRevision: disabled.ObjectRevision}, actor)
	if err != nil || !enabled.Enabled {
		t.Fatalf("enable: %+v %v", enabled, err)
	}
	disabled, err = s.Disable(t.Context(), EntityPaymentMethod, ObjectRevisionInput{ObjectID: created.ObjectID, ObjectRevision: enabled.ObjectRevision}, actor)
	if err != nil || disabled.Enabled {
		t.Fatalf("disable again: %+v %v", disabled, err)
	}
	var approvalCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='aux' AND subject_id=$1`, created.ObjectID).Scan(&approvalCount); err != nil || approvalCount != 0 {
		t.Fatalf("AUX approval rows=%d err=%v", approvalCount, err)
	}
	if err = s.Delete(t.Context(), EntityPaymentMethod, DeleteInput{ObjectID: created.ObjectID, ObjectRevision: disabled.ObjectRevision}, actor); err != nil {
		t.Fatalf("delete unreferenced object: %v", err)
	}
}

func TestDirectDeleteBlockerAndDisabledHistoryIntegration(t *testing.T) {
	s, pool, actor := directIntegrationService(t)
	suffix := ulid.Make().String()
	created, err := s.Create(t.Context(), EntityDepartment, CreateInput{Data: CreateData{Data: map[string]any{"name": "历史部门-" + suffix}}}, actor)
	if err != nil {
		t.Fatalf("create department: %v", err)
	}
	disabled, err := s.Disable(t.Context(), EntityDepartment, ObjectRevisionInput{ObjectID: created.ObjectID, ObjectRevision: created.ObjectRevision}, actor)
	if err != nil {
		t.Fatalf("disable department: %v", err)
	}
	historical, err := s.Get(t.Context(), EntityDepartment, GetInput{ObjectID: created.ObjectID}, actor)
	if err != nil || historical.Enabled || stringValue(historical.Data["name"]) != "历史部门-"+suffix {
		t.Fatalf("disabled historical read: %+v %v", historical, err)
	}

	operatingID, operatingEntryID := ulid.Make().String(), ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'operating-entity','OPE-9001',$2)`, operatingID, actor.ID()); err != nil {
		t.Fatalf("insert DCL operating subject: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO approval_entries
		(id,domain,entity,subject_id,version_no,status,created_by,created_at,updated_by,updated_at)
		VALUES($1,'dcl','operating-entity',$2,1,'DRAFT',$3,now(),$3,now())`, operatingEntryID, operatingID, actor.ID()); err != nil {
		t.Fatalf("insert DCL operating approval entry: %v", err)
	}
	employeeID, entryID := ulid.Make().String(), ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'employee','EMP-9001',$2)`, employeeID, actor.ID()); err != nil {
		t.Fatalf("insert DCL employee subject: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO approval_entries
		(id,domain,entity,subject_id,version_no,status,created_by,created_at,updated_by,updated_at)
		VALUES($1,'dcl','employee',$2,1,'DRAFT',$3,now(),$3,now())`, entryID, employeeID, actor.ID()); err != nil {
		t.Fatalf("insert DCL approval entry: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_employee_versions
		(approval_entry_id,kind,legal_name,display_name,department_id,department_code,department_name,current_operating_entity_id,current_operating_entity_approval_entry_id,current_operating_entity_code,current_operating_entity_name,enabled)
		VALUES($1,'PERSON','辅助引用员工','辅助引用员工',$2,$3,$4,$5,$6,'OPE-9001','辅助引用经营主体',true)`, entryID, created.ObjectID, historical.Code, stringValue(historical.Data["name"]), operatingID, operatingEntryID); err != nil {
		t.Fatalf("insert historical DCL snapshot: %v", err)
	}

	err = s.Delete(t.Context(), EntityDepartment, DeleteInput{ObjectID: created.ObjectID, ObjectRevision: disabled.ObjectRevision}, actor)
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict {
		t.Fatalf("delete referenced department = %v", err)
	}
	data, ok := domainErr.Data.(map[string]any)
	blockers, blockersOK := data["blockers"].([]map[string]any)
	if !ok || !blockersOK || len(blockers) != 1 || blockers[0]["source"] != "dcl_employee_versions" {
		t.Fatalf("delete blockers = %#v", domainErr.Data)
	}

	if _, err = pool.Exec(t.Context(), `DELETE FROM dcl_employee_versions WHERE approval_entry_id=$1`, entryID); err != nil {
		t.Fatalf("delete DCL snapshot: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `DELETE FROM approval_entries WHERE id=$1`, entryID); err != nil {
		t.Fatalf("delete DCL approval entry: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `DELETE FROM approval_entries WHERE id=$1`, operatingEntryID); err != nil {
		t.Fatalf("delete DCL operating approval entry: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `DELETE FROM dcl_subjects WHERE id IN ($1,$2)`, employeeID, operatingID); err != nil {
		t.Fatalf("delete DCL typed archive subjects: %v", err)
	}
	if err = s.Delete(t.Context(), EntityDepartment, DeleteInput{ObjectID: created.ObjectID, ObjectRevision: disabled.ObjectRevision}, actor); err != nil {
		t.Fatalf("delete after blocker removal: %v", err)
	}
}

func TestReferencedProductTypeBehaviorChangeIsRejectedWithoutMutationIntegration(t *testing.T) {
	s, pool, actor := directIntegrationService(t)
	suffix := ulid.Make().String()
	created, err := s.Create(t.Context(), EntityProductType, CreateInput{Data: CreateData{Data: map[string]any{
		"name": "被引用产品类型-" + suffix, "behaviorProfile": ProductBehaviorRawMaterial,
		"description": "原始说明",
	}}}, actor)
	if err != nil {
		t.Fatalf("create product type: %v", err)
	}
	entryID, subjectID := ulid.Make().String(), ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `INSERT INTO approval_entries
		(id,domain,entity,subject_id,version_no,status,created_by,created_at,updated_by,updated_at)
		VALUES($1,'dcl','product',$2,1,'DRAFT',$3,now(),$3,now())`, entryID, subjectID, actor.ID()); err != nil {
		t.Fatalf("insert product approval entry: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_product_versions
		(approval_entry_id,name,product_type_id,product_type_code,product_type_name,behavior_profile)
		VALUES($1,$2,$3,'',$2,$4)`, entryID, "被引用产品", created.ObjectID, ProductBehaviorRawMaterial); err != nil {
		t.Fatalf("insert product snapshot: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM dcl_product_versions WHERE approval_entry_id=$1`, entryID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM approval_entries WHERE id=$1`, entryID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM aux_objects WHERE id=$1`, created.ObjectID)
	})

	before, err := s.Get(t.Context(), EntityProductType, GetInput{ObjectID: created.ObjectID}, actor)
	if err != nil {
		t.Fatalf("get product type before rejected save: %v", err)
	}
	_, err = s.Save(t.Context(), EntityProductType, SaveInput{
		ObjectID: created.ObjectID, ObjectRevision: created.ObjectRevision,
		Data: map[string]any{
			"name": "不应落库的名称", "behaviorProfile": ProductBehaviorPackaging,
			"description": "不应落库的说明",
		},
	}, actor)
	if !errorKind(err, ErrorValidation) {
		t.Fatalf("referenced behaviorProfile save = %v", err)
	}
	after, err := s.Get(t.Context(), EntityProductType, GetInput{ObjectID: created.ObjectID}, actor)
	if err != nil {
		t.Fatalf("get product type after rejected save: %v", err)
	}
	if after.ObjectRevision != before.ObjectRevision || stringValue(after.Data["name"]) != stringValue(before.Data["name"]) ||
		fmt.Sprint(after.Data["behaviorProfile"]) != fmt.Sprint(before.Data["behaviorProfile"]) ||
		stringValue(after.Data["description"]) != stringValue(before.Data["description"]) {
		t.Fatalf("rejected save mutated product type: before=%+v after=%+v", before, after)
	}
}

func TestDeleteBlocksEnabledAndDisabledAuxiliaryChildrenIntegration(t *testing.T) {
	s, _, actor := directIntegrationService(t)
	suffix := ulid.Make().String()
	parent, err := s.Create(t.Context(), EntityProductCategory, CreateInput{Data: CreateData{Data: map[string]any{"name": "父分类-" + suffix}}}, actor)
	if err != nil {
		t.Fatal(err)
	}
	child, err := s.Create(t.Context(), EntityProductCategory, CreateInput{Data: CreateData{Data: map[string]any{"name": "子分类-" + suffix, "parentId": parent.ObjectID}}}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(t.Context(), EntityProductCategory, DeleteInput{ObjectID: parent.ObjectID, ObjectRevision: parent.ObjectRevision}, actor); !errorKind(err, ErrorConflict) {
		t.Fatalf("enabled child must block parent delete: %v", err)
	}
	disabled, err := s.Disable(t.Context(), EntityProductCategory, ObjectRevisionInput{ObjectID: child.ObjectID, ObjectRevision: child.ObjectRevision}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(t.Context(), EntityProductCategory, DeleteInput{ObjectID: parent.ObjectID, ObjectRevision: parent.ObjectRevision}, actor); !errorKind(err, ErrorConflict) {
		t.Fatalf("disabled child must block parent delete: %v", err)
	}
	if err = s.Delete(t.Context(), EntityProductCategory, DeleteInput{ObjectID: child.ObjectID, ObjectRevision: disabled.ObjectRevision}, actor); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(t.Context(), EntityProductCategory, DeleteInput{ObjectID: parent.ObjectID, ObjectRevision: parent.ObjectRevision}, actor); err != nil {
		t.Fatal(err)
	}

	dictionaryType, err := s.Create(t.Context(), EntityDictionaryType, CreateInput{Data: CreateData{Data: map[string]any{"name": "字典类型-" + suffix}}}, actor)
	if err != nil {
		t.Fatal(err)
	}
	item, err := s.Create(t.Context(), EntityDictionaryItem, CreateInput{Data: CreateData{Data: map[string]any{
		"name": "字典项-" + suffix, "dictionaryTypeId": dictionaryType.ObjectID, "sortOrder": 10,
	}}}, actor)
	if err != nil {
		t.Fatal(err)
	}
	itemView, err := s.Get(t.Context(), EntityDictionaryItem, GetInput{ObjectID: item.ObjectID}, actor)
	if err != nil || itemView.Data["dictionaryTypeId"] != dictionaryType.ObjectID {
		t.Fatalf("dictionary item stable owner = %#v, err = %v", itemView.Data, err)
	}
	if err = s.Delete(t.Context(), EntityDictionaryType, DeleteInput{ObjectID: dictionaryType.ObjectID, ObjectRevision: dictionaryType.ObjectRevision}, actor); !errorKind(err, ErrorConflict) {
		t.Fatalf("dictionary item must block type delete: %v", err)
	}
	if err = s.Delete(t.Context(), EntityDictionaryItem, DeleteInput{ObjectID: item.ObjectID, ObjectRevision: item.ObjectRevision}, actor); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(t.Context(), EntityDictionaryType, DeleteInput{ObjectID: dictionaryType.ObjectID, ObjectRevision: dictionaryType.ObjectRevision}, actor); err != nil {
		t.Fatal(err)
	}
}

func errorKind(err error, kind ErrorKind) bool {
	var domainErr *DomainError
	return errors.As(err, &domainErr) && domainErr.Kind == kind
}
