package aux

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

// AUX graphs use JSONB references, so a transaction-level domain lock keeps
// validation and mutation atomic across concurrent AUX writes.
const auxiliaryWriteLockKey int64 = 0x5a455250415558

type dbtx interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	if pool == nil {
		panic("aux: database is required")
	}
	return &Service{pool: pool}
}

func (s *Service) QueryReferenceCandidates(ctx context.Context, input ReferenceQueryInput, actor approval.Actor) ([]ReferenceCandidate, error) {
	if input.Entity != EntitySettlementMethod && input.Entity != EntityPaymentMethod && input.Entity != EntityDictionaryItem {
		return nil, domainError(ErrorValidation, "invalid AUX reference entity", nil, nil)
	}
	keyword := strings.TrimSpace(input.Keyword)
	dictionaryTypeCode := strings.TrimSpace(input.DictionaryTypeCode)
	rows, err := s.pool.Query(ctx, `SELECT id,code,COALESCE(data->>'name','') FROM aux_objects
		WHERE entity=$1 AND enabled AND ($2='' OR code ILIKE '%'||$2||'%' OR COALESCE(data->>'name','') ILIKE '%'||$2||'%')
		AND ($3='' OR data->>'dictionaryTypeCode'=$3) ORDER BY COALESCE((data->>'sortOrder')::integer,2147483647),code,id LIMIT 20`, input.Entity, keyword, dictionaryTypeCode)
	if err != nil {
		return nil, s.internal("query AUX reference candidates", err)
	}
	defer rows.Close()
	result := make([]ReferenceCandidate, 0)
	for rows.Next() {
		var row ReferenceCandidate
		if err := rows.Scan(&row.ObjectID, &row.Code, &row.Name); err != nil {
			return nil, s.internal("scan AUX reference candidates", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, s.internal("query AUX reference candidates", err)
	}
	return result, nil
}

func validEntity(entity string) bool { return slices.Contains(entities[:], entity) }

func (s *Service) Query(ctx context.Context, entity string, input QueryInput, actor approval.Actor) (Page[QueryItem], error) {
	if !validEntity(entity) || input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	if input.Filters.BehaviorProfile != "" {
		profile, valid := productBehaviorProfileValue(input.Filters.BehaviorProfile)
		if entity != EntityProductType || !valid || !isProductBehaviorProfile(profile) {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
		}
	}
	sortField, sortOrder := "o.updated_at", "DESC"
	if len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "only one sort item is allowed", nil, nil)
	}
	if len(input.Sort) == 1 {
		fields := map[string]string{
			"updatedAt": "o.updated_at", "code": "o.code",
			"name": "COALESCE(o.data->>'name', '')",
		}
		var ok bool
		sortField, ok = fields[input.Sort[0].Field]
		sortOrder = strings.ToUpper(input.Sort[0].Order)
		if !ok || (sortOrder != "ASC" && sortOrder != "DESC") {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid sort", nil, nil)
		}
	}
	where, args := queryWhere(entity, input.Filters)
	var total int64
	from := auxObjectReadFrom()
	if err := s.pool.QueryRow(ctx, "SELECT count(*) "+from+" "+where, args...).Scan(&total); err != nil {
		return Page[QueryItem]{}, s.internal("count auxiliary objects", err)
	}
	args = append(args, int32(input.PageSize), int32((input.Page-1)*input.PageSize))
	query := fmt.Sprintf(`SELECT %s %s %s ORDER BY %s %s,o.id %s LIMIT $%d OFFSET $%d`,
		auxObjectReadColumns(), from, where, sortField, sortOrder, sortOrder, len(args)-1, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return Page[QueryItem]{}, s.internal("list auxiliary objects", err)
	}
	defer rows.Close()
	items := make([]QueryItem, 0)
	for rows.Next() {
		view, scanErr := scanAuxObject(rows)
		if scanErr != nil {
			return Page[QueryItem]{}, s.internal("scan auxiliary object", scanErr)
		}
		items = append(items, view)
	}
	if err = rows.Err(); err != nil {
		return Page[QueryItem]{}, s.internal("list auxiliary objects", err)
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func queryWhere(entity string, filters QueryFilters) (string, []any) {
	args := []any{entity}
	parts := []string{"WHERE o.entity=$1"}
	add := func(clause string, value any) {
		args = append(args, value)
		parts = append(parts, fmt.Sprintf(clause, len(args)))
	}
	if keyword := strings.TrimSpace(filters.Keyword); keyword != "" {
		args = append(args, keyword)
		placeholder := len(args)
		parts = append(parts, fmt.Sprintf(
			"(o.code ILIKE '%%'||$%d||'%%' OR COALESCE(o.data->>'name','') ILIKE '%%'||$%d||'%%')",
			placeholder, placeholder,
		))
	}
	if filters.Enabled != nil {
		add("o.enabled=$%d", *filters.Enabled)
	}
	if filters.BehaviorProfile != "" {
		add("o.data->>'behaviorProfile'=$%d", filters.BehaviorProfile)
	}
	if filters.ParentID != "" {
		add("o.data->>'parentId'=$%d", filters.ParentID)
	}
	if filters.RootOnly {
		parts = append(parts, "COALESCE(o.data->>'parentId','')=''")
	}
	if filters.DictionaryTypeCode != "" {
		add("o.data->>'dictionaryTypeCode'=$%d", strings.ToUpper(filters.DictionaryTypeCode))
	}
	if filters.Direction != "" {
		add("o.data->>'direction'=$%d", strings.ToUpper(filters.Direction))
	}
	return strings.Join(parts, " AND "), args
}

type rowScanner interface{ Scan(...any) error }

func auxObjectReadFrom() string {
	return `FROM aux_objects o`
}

func auxObjectReadColumns() string {
	return `o.id,o.entity,o.code,o.enabled,o.revision,o.updated_at,o.updated_by,o.data`
}

func scanAuxObject(row rowScanner) (ObjectView, error) {
	var result ObjectView
	targets := []any{&result.ObjectID, &result.Entity, &result.Code, &result.Enabled,
		&result.ObjectRevision, &result.UpdatedAt, &result.UpdatedBy}
	var raw []byte
	targets = append(targets, &raw)
	if err := row.Scan(targets...); err != nil {
		return ObjectView{}, err
	}
	if err := json.Unmarshal(raw, &result.Data); err != nil {
		return ObjectView{}, err
	}
	return result, nil
}

func (s *Service) Get(ctx context.Context, entity string, input GetInput, actor approval.Actor) (ObjectView, error) {
	if !validEntity(entity) || !validID(input.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid object", nil, nil)
	}
	row := s.pool.QueryRow(ctx, `SELECT `+auxObjectReadColumns()+` `+auxObjectReadFrom()+`
		WHERE o.id=$1 AND o.entity=$2`, input.ObjectID, entity)
	view, err := scanAuxObject(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get auxiliary object", err)
	}
	return view, nil
}

func (s *Service) Create(ctx context.Context, entity string, input CreateInput, actor approval.Actor) (MutationResult, error) {
	if entity == EntitySettlementMethod {
		return MutationResult{}, domainError(ErrorValidation, "settlement methods are system-defined", nil, nil)
	}
	if !validEntity(entity) {
		return MutationResult{}, domainError(ErrorValidation, "invalid create request", nil, nil)
	}
	objectID := ulid.Make().String()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = lockAuxiliaryWrites(ctx, tx); err != nil {
		return MutationResult{}, s.internal("lock auxiliary writes", err)
	}
	var counter int32
	err = tx.QueryRow(ctx, `INSERT INTO object_number_counters(domain,entity,last_value)
		VALUES('aux',$1,1)
		ON CONFLICT(domain,entity) DO UPDATE
		SET last_value=object_number_counters.last_value+1
		WHERE object_number_counters.last_value<9999
		RETURNING last_value`, entity).Scan(&counter)
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("allocate object number", err)
	}
	code := fmt.Sprintf("%s-%04d", objectPrefix(entity), counter)
	data, err := s.validateData(ctx, tx, entity, "", input.Data.Data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid create request", nil, err)
	}
	raw, _ := json.Marshal(data)
	if _, err = tx.Exec(ctx, `INSERT INTO aux_objects
		(id,entity,code,data,created_by,updated_by)
		VALUES($1,$2,$3,$4,$5,$5)`, objectID, entity, code, raw, actor.ID()); err != nil {
		return MutationResult{}, s.writeError("insert auxiliary object", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit auxiliary create", err)
	}
	return MutationResult{ObjectID: objectID, ObjectRevision: 1, Enabled: true}, nil
}

func (s *Service) Save(ctx context.Context, entity string, input SaveInput, actor approval.Actor) (MutationResult, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || input.ObjectRevision < 1 {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = lockAuxiliaryWrites(ctx, tx); err != nil {
		return MutationResult{}, s.internal("lock auxiliary writes", err)
	}
	var object struct {
		code     string
		enabled  bool
		revision int64
	}
	var currentRaw []byte
	err = tx.QueryRow(ctx, `SELECT code,enabled,revision,data
		FROM aux_objects WHERE id=$1 AND entity=$2 FOR UPDATE`, input.ObjectID, entity).
		Scan(&object.code, &object.enabled, &object.revision, &currentRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock auxiliary object", err)
	}
	if object.revision != input.ObjectRevision {
		return MutationResult{}, domainError(ErrorConflict, "object changed before save", map[string]any{"objectRevision": object.revision}, nil)
	}
	var currentData map[string]any
	if entity == EntitySettlementMethod || entity == EntityProductType {
		if err = json.Unmarshal(currentRaw, &currentData); err != nil {
			return MutationResult{}, s.internal("decode current settlement method", err)
		}
	}
	data, err := s.validateData(ctx, tx, entity, input.ObjectID, input.Data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
	}
	if entity == EntitySettlementMethod {
		if err = validateSettlementMethodUpdate(currentData, data); err != nil {
			return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
		}
	}
	if entity == EntityProductType {
		referenced, referenceErr := productTypeReferenced(ctx, tx, input.ObjectID)
		if referenceErr != nil {
			return MutationResult{}, s.internal("check product type references", referenceErr)
		}
		if referenced {
			if err = validateReferencedProductTypeUpdate(currentData, data); err != nil {
				return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
			}
		}
	}
	raw, _ := json.Marshal(data)
	if _, err = tx.Exec(ctx, `UPDATE aux_objects SET data=$1,revision=revision+1,updated_at=now(),updated_by=$2
		WHERE id=$3 AND entity=$4`, raw, actor.ID(), input.ObjectID, entity); err != nil {
		return MutationResult{}, s.writeError("touch auxiliary object", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit auxiliary save", err)
	}
	return MutationResult{
		ObjectID: input.ObjectID, ObjectRevision: object.revision + 1, Enabled: object.enabled,
	}, nil
}

func objectPrefix(entity string) string {
	return map[string]string{
		EntityProductCategory: "PCT", EntityProductType: "PTP", EntityDepartment: "DEP", EntityPosition: "POS",
		EntitySettlementMethod: "STM", EntityPaymentMethod: "PAY", EntityDictionaryType: "DCT", EntityDictionaryItem: "DIT",
		EntityMeasurementUnit: "UNT", EntityIncomeExpense: "IET", EntityAssetCategory: "ACT", EntityEmployeeCategory: "ECT",
	}[entity]
}

func (s *Service) Enable(ctx context.Context, entity string, input ObjectRevisionInput, actor approval.Actor) (MutationResult, error) {
	return s.setEnabled(ctx, entity, input, true, actor)
}

func (s *Service) Disable(ctx context.Context, entity string, input ObjectRevisionInput, actor approval.Actor) (MutationResult, error) {
	return s.setEnabled(ctx, entity, input, false, actor)
}

func (s *Service) setEnabled(ctx context.Context, entity string, input ObjectRevisionInput, enabled bool, actor approval.Actor) (MutationResult, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || input.ObjectRevision < 1 {
		return MutationResult{}, domainError(ErrorValidation, "invalid state request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin auxiliary state change", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = lockAuxiliaryWrites(ctx, tx); err != nil {
		return MutationResult{}, s.internal("lock auxiliary writes", err)
	}
	var current bool
	var revision int64
	err = tx.QueryRow(ctx, `SELECT enabled,revision
		FROM aux_objects WHERE id=$1 AND entity=$2 FOR UPDATE`, input.ObjectID, entity).
		Scan(&current, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock auxiliary object", err)
	}
	if revision != input.ObjectRevision || current == enabled {
		return MutationResult{}, domainError(ErrorConflict, "object state changed", map[string]any{"objectRevision": revision, "enabled": current}, nil)
	}
	tag, err := tx.Exec(ctx, `UPDATE aux_objects SET enabled=$1,revision=revision+1,updated_at=now(),updated_by=$2
		WHERE id=$3 AND entity=$4 AND revision=$5`, enabled, actor.ID(), input.ObjectID, entity, input.ObjectRevision)
	if err != nil || tag.RowsAffected() != 1 {
		return MutationResult{}, s.writeError("change auxiliary state", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit auxiliary state", err)
	}
	return MutationResult{ObjectID: input.ObjectID, ObjectRevision: input.ObjectRevision + 1,
		Enabled: enabled}, nil
}

func (s *Service) Delete(ctx context.Context, entity string, input DeleteInput, actor approval.Actor) error {
	if entity == EntitySettlementMethod {
		return domainError(ErrorValidation, "settlement methods are system-defined", nil, nil)
	}
	if !validEntity(entity) || !validID(input.ObjectID) || input.ObjectRevision < 1 {
		return domainError(ErrorValidation, "invalid delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return s.internal("begin auxiliary delete", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = lockAuxiliaryWrites(ctx, tx); err != nil {
		return s.internal("lock auxiliary writes", err)
	}
	var revision int64
	if err = tx.QueryRow(ctx, `SELECT revision FROM aux_objects WHERE id=$1 AND entity=$2 FOR UPDATE`, input.ObjectID, entity).Scan(&revision); errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return s.internal("lock auxiliary object", err)
	}
	if revision != input.ObjectRevision {
		return domainError(ErrorConflict, "object changed before delete", map[string]any{"objectRevision": revision}, nil)
	}
	if blocked, blockerErr := auxObjectDeleteBlockers(ctx, tx, input.ObjectID); blockerErr != nil {
		return s.internal("check auxiliary references", blockerErr)
	} else if len(blocked) != 0 {
		return domainError(ErrorConflict, "auxiliary object has persisted references", map[string]any{"blockers": blocked}, nil)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM aux_objects WHERE id=$1 AND entity=$2`, input.ObjectID, entity); err != nil {
		return s.internal("delete auxiliary object", err)
	}
	return tx.Commit(ctx)
}

func auxObjectDeleteBlockers(ctx context.Context, q dbtx, objectID string) ([]map[string]any, error) {
	// Each source is deliberately named: deletion is blocked by any persisted
	// snapshot, irrespective of its DCL or VOU lifecycle state.
	checks := []struct{ source, query string }{
		{"dcl_employee_versions", `SELECT count(*) FROM dcl_employee_versions WHERE employee_category_id=$1 OR department_id=$1 OR position_id=$1`},
		{"dcl_product_versions", `SELECT count(*) FROM dcl_product_versions WHERE category_id=$1 OR pricing_unit_id=$1 OR product_type_id=$1 OR default_input_unit_id=$1`},
		{"dcl_product_formulas", `SELECT count(*) FROM dcl_product_formulas WHERE output_unit_object_id=$1`},
		{"dcl_product_formula_lines", `SELECT count(*) FROM dcl_product_formula_lines WHERE entered_unit_object_id=$1`},
		{"dcl_product_unit_conversions", `SELECT count(*) FROM dcl_product_unit_conversions WHERE unit_object_id=$1`},
		{"dcl_supplier_versions", `SELECT count(*) FROM dcl_supplier_versions WHERE settlement_method_id=$1`},
		{"dcl_other_unit_versions", `SELECT count(*) FROM dcl_other_unit_versions WHERE settlement_method_id=$1`},
		{"dcl_customer_account_versions", `SELECT count(*) FROM dcl_customer_account_versions WHERE settlement_method_id=$1 OR payment_method_id=$1`},
		{"dcl_vehicle_versions", `SELECT count(*) FROM dcl_vehicle_versions WHERE vehicle_type_object_id=$1`},
		{"dcl_warehouse_versions", `SELECT count(*) FROM dcl_warehouse_versions WHERE category_id=$1`},
		{"dcl_customer_attachments", `SELECT count(*) FROM dcl_customer_attachments WHERE category_object_id=$1`},
		{"dcl_customer_account_attachments", `SELECT count(*) FROM dcl_customer_account_attachments WHERE category_object_id=$1`},
		{"bob_warehouses", `SELECT count(*) FROM bob_warehouses WHERE category_id=$1`},
		{"bob_vehicles", `SELECT count(*) FROM bob_vehicles WHERE vehicle_type_object_id=$1`},
		{"vou_asset_acquisition_lines", `SELECT count(*) FROM vou_asset_acquisition_lines WHERE category_object_id=$1 OR department_object_id=$1`},
		{"vou_inventory_count_lines", `SELECT count(*) FROM vou_inventory_count_lines WHERE entered_unit_object_id=$1`},
		{"vou_price_lines", `SELECT count(*) FROM vou_price_lines WHERE product_type_object_id=$1`},
		{"vou_product_lines", `SELECT count(*) FROM vou_product_lines WHERE entered_unit_object_id=$1 OR product_type_object_id=$1`},
		{"vou_production_material_lines", `SELECT count(*) FROM vou_production_material_lines WHERE actual_entered_unit_object_id=$1`},
		{"vou_production_output_lines", `SELECT count(*) FROM vou_production_output_lines WHERE entered_unit_object_id=$1`},
		{"vou_purchase_order_details", `SELECT count(*) FROM vou_purchase_order_details WHERE settlement_method_object_id=$1`},
		{"vou_sale_order_details", `SELECT count(*) FROM vou_sale_order_details WHERE settlement_method_object_id=$1`},
		{"vou_sale_order_formula_lines", `SELECT count(*) FROM vou_sale_order_formula_lines WHERE entered_unit_object_id=$1`},
		{"vou_sale_order_formulas", `SELECT count(*) FROM vou_sale_order_formulas WHERE output_entered_unit_object_id=$1`},
		{"vou_service_contract_details", `SELECT count(*) FROM vou_service_contract_details WHERE settlement_method_object_id=$1`},
		{"acc_assets", `SELECT count(*) FROM acc_assets WHERE category_id=$1 OR department_id=$1`},
		{"acc_opening_assets", `SELECT count(*) FROM acc_opening_assets WHERE category_id=$1 OR department_id=$1`},
	}
	blockers := make([]map[string]any, 0)
	for _, check := range checks {
		var count int64
		if err := q.QueryRow(ctx, check.query, objectID).Scan(&count); err != nil {
			return nil, err
		}
		if count > 0 {
			blockers = append(blockers, map[string]any{"source": check.source, "count": count})
		}
	}
	return blockers, nil
}

func lockAuxiliaryWrites(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, auxiliaryWriteLockKey)
	return err
}

func (s *Service) ResolveCurrentReference(ctx context.Context, q dbtx, entity, objectID string) (Reference, error) {
	if q == nil {
		q = s.pool
	}
	if !validEntity(entity) || !validID(objectID) {
		return Reference{}, domainError(ErrorValidation, "invalid auxiliary reference", nil, nil)
	}
	var result Reference
	var raw []byte
	err := q.QueryRow(ctx, `SELECT id,entity,code,data FROM aux_objects WHERE id=$1 AND entity=$2 AND enabled FOR SHARE`, objectID, entity).Scan(&result.ObjectID, &result.Entity, &result.Code, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return Reference{}, domainError(ErrorConflict, "auxiliary reference is unavailable", nil, nil)
	}
	if err != nil {
		return Reference{}, s.internal("resolve auxiliary reference", err)
	}
	if err = json.Unmarshal(raw, &result.Data); err != nil {
		return Reference{}, s.internal("decode auxiliary reference", err)
	}
	return result, nil
}

func (s *Service) ResolveCode(ctx context.Context, q dbtx, entity, code string) (Reference, error) {
	if !validEntity(entity) {
		return Reference{}, errors.New("invalid auxiliary entity")
	}
	if q == nil {
		q = s.pool
	}
	var reference Reference
	var raw []byte
	err := q.QueryRow(ctx, `SELECT id,entity,code,data FROM aux_objects WHERE entity=$1 AND upper(code)=upper($2) AND enabled FOR SHARE`, entity, strings.TrimSpace(code)).Scan(&reference.ObjectID, &reference.Entity, &reference.Code, &raw)
	if err != nil {
		return Reference{}, err
	}
	if err = json.Unmarshal(raw, &reference.Data); err != nil {
		return Reference{}, err
	}
	return reference, nil
}

func (s *Service) validateData(ctx context.Context, q dbtx, entity, objectID string, source map[string]any) (map[string]any, error) {
	if source == nil {
		return nil, errors.New("data is required")
	}
	data := cloneData(source)
	name, _ := data["name"].(string)
	name = strings.TrimSpace(name)
	if len([]rune(name)) < 1 || len([]rune(name)) > 200 {
		return nil, errors.New("name must contain 1-200 characters")
	}
	data["name"] = name
	allowed := map[string]bool{"name": true}
	allow := func(keys ...string) {
		for _, key := range keys {
			allowed[key] = true
		}
	}
	switch entity {
	case EntityProductCategory, EntityDepartment:
		allow("parentId", "description")
		if err := s.validateParent(ctx, q, entity, objectID, stringValue(data["parentId"])); err != nil {
			return nil, err
		}
	case EntityProductType:
		allow("behaviorProfile", "description")
		if _, present := data["description"]; !present {
			data["description"] = ""
		}
		profile, ok := productBehaviorProfileValue(data["behaviorProfile"])
		if !ok {
			return nil, errors.New("behaviorProfile is required")
		}
		if !isProductBehaviorProfile(profile) {
			return nil, errors.New("behaviorProfile must be a supported product behavior profile")
		}
		data["behaviorProfile"] = profile
	case EntityEmployeeCategory, EntityPosition, EntityDictionaryType:
		allow("description")
	case EntityAssetCategory:
		allow("defaultUsefulLifeMonths", "defaultResidualRate", "description")
		months, monthsOK := intValue(data["defaultUsefulLifeMonths"])
		rate := strings.TrimSpace(stringValue(data["defaultResidualRate"]))
		if !monthsOK || months < 1 || months > 1200 || !validPercent(rate) {
			return nil, errors.New("defaultUsefulLifeMonths 1-1200 and defaultResidualRate 0-99.99 are required")
		}
		data["defaultUsefulLifeMonths"], data["defaultResidualRate"] = months, rate
	case EntityDictionaryItem:
		allow("dictionaryTypeCode", "sortOrder")
		typeCode := strings.ToUpper(strings.TrimSpace(stringValue(data["dictionaryTypeCode"])))
		if typeCode == "" {
			return nil, errors.New("dictionaryTypeCode is required")
		}
		data["dictionaryTypeCode"] = typeCode
		if err := s.requireEnabledCode(ctx, q, EntityDictionaryType, typeCode); err != nil {
			return nil, err
		}
		if _, ok := intValue(data["sortOrder"]); !ok {
			return nil, errors.New("sortOrder must be an integer")
		}
	case EntityMeasurementUnit:
		allow("symbol", "quantityScale")
		symbol := strings.TrimSpace(stringValue(data["symbol"]))
		scale, ok := intValue(data["quantityScale"])
		if symbol == "" || !ok || scale < 0 || scale > 6 {
			return nil, errors.New("symbol and quantityScale 0-6 are required")
		}
		data["symbol"], data["quantityScale"] = symbol, scale
	case EntitySettlementMethod:
		allow("termCode", "ruleType", "monthOffset", "dayOfMonth", "dayOffset", "defaultSalesSurcharge", "description")
		if err := validateSettlementMethodData(data); err != nil {
			return nil, err
		}
	case EntityPaymentMethod:
		allow("defaultSalesSurcharge", "description")
		if _, present := data["defaultSalesSurcharge"]; !present {
			data["defaultSalesSurcharge"] = "0.00"
		}
		if !validMoney(stringValue(data["defaultSalesSurcharge"])) {
			return nil, errors.New("defaultSalesSurcharge must be a non-negative amount")
		}
	case EntityIncomeExpense:
		allow("direction", "parentId", "description")
		direction := strings.ToUpper(strings.TrimSpace(stringValue(data["direction"])))
		if direction != "INCOME" && direction != "EXPENSE" {
			return nil, errors.New("direction must be INCOME or EXPENSE")
		}
		data["direction"] = direction
		if err := s.validateParent(ctx, q, entity, objectID, stringValue(data["parentId"])); err != nil {
			return nil, err
		}
		if parentID := stringValue(data["parentId"]); parentID != "" {
			parentData, err := s.enabledObjectData(ctx, q, EntityIncomeExpense, parentID)
			if err != nil || stringValue(parentData["direction"]) != direction {
				return nil, errors.New("parent income/expense direction must match")
			}
		}
	default:
		return nil, errors.New("invalid entity")
	}
	for key := range data {
		if !allowed[key] {
			return nil, fmt.Errorf("field %s is not allowed", key)
		}
	}
	for _, key := range []string{"description", "parentId"} {
		if value, ok := data[key]; ok {
			data[key] = strings.TrimSpace(stringValue(value))
		}
	}
	if description := stringValue(data["description"]); len([]rune(description)) > 1000 {
		return nil, errors.New("description must contain at most 1000 characters")
	}
	return data, nil
}

func (s *Service) validateParent(ctx context.Context, q dbtx, entity, objectID, parentID string) error {
	parentID = strings.TrimSpace(parentID)
	if parentID == "" {
		return nil
	}
	if !validID(parentID) || parentID == objectID {
		return errors.New("invalid parentId")
	}
	if q == nil {
		q = s.pool
	}
	current := parentID
	for depth := 0; depth < 100; depth++ {
		var next string
		err := q.QueryRow(ctx, `SELECT COALESCE(data->>'parentId','') FROM aux_objects WHERE id=$1 AND entity=$2 AND enabled`, current, entity).Scan(&next)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("parent is unavailable")
		}
		if err != nil {
			return err
		}
		if next == "" {
			return nil
		}
		if next == objectID {
			return errors.New("parent cycle is not allowed")
		}
		current = next
	}
	return errors.New("parent hierarchy is too deep")
}

func (s *Service) requireEnabledCode(ctx context.Context, q dbtx, entity, code string) error {
	if q == nil {
		q = s.pool
	}
	var exists bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM aux_objects WHERE entity=$1 AND code=$2 AND enabled)`, entity, code).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%s %s is unavailable", entity, code)
	}
	return nil
}

func (s *Service) enabledObjectData(
	ctx context.Context, q dbtx, entity, objectID string,
) (map[string]any, error) {
	if q == nil {
		q = s.pool
	}
	var raw []byte
	if err := q.QueryRow(ctx, `SELECT data FROM aux_objects WHERE entity=$1 AND id=$2 AND enabled`, entity, objectID).Scan(&raw); err != nil {
		return nil, err
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	return data, nil
}

func productTypeReferenced(ctx context.Context, q dbtx, objectID string) (bool, error) {
	var referenced bool
	err := q.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM dcl_product_versions WHERE product_type_id=$1
	)`, objectID).Scan(&referenced)
	return referenced, err
}

func validateReferencedProductTypeUpdate(current, updated map[string]any) error {
	if fmt.Sprint(current["behaviorProfile"]) != fmt.Sprint(updated["behaviorProfile"]) {
		return errors.New("referenced product type behaviorProfile cannot be changed")
	}
	return nil
}

func productBehaviorProfileValue(value any) (ProductBehaviorProfile, bool) {
	switch typed := value.(type) {
	case string:
		return ProductBehaviorProfile(typed), true
	case ProductBehaviorProfile:
		return typed, true
	default:
		return "", false
	}
}

func isProductBehaviorProfile(profile ProductBehaviorProfile) bool {
	_, ok := productBehaviorProfiles[profile]
	return ok
}

func validID(value string) bool {
	_, err := ulid.ParseStrict(value)
	return err == nil
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func intValue(value any) (int, bool) {
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Int64()
		return int(number), err == nil
	case float64:
		number := int(typed)
		return number, float64(number) == typed
	case int:
		return typed, true
	default:
		return 0, false
	}
}

func validMoney(value string) bool {
	if value == "" {
		return false
	}
	matched, _ := regexp.MatchString(`^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$`, value)
	return matched
}

func validPercent(value string) bool {
	matched, _ := regexp.MatchString(`^(0|[1-9][0-9]?)(\.[0-9]{1,2})?$`, value)
	if !matched {
		return false
	}
	return !strings.HasPrefix(value, "100")
}

func (s *Service) internal(operation string, err error) error {
	return domainError(ErrorInternal, "internal server error", nil, fmt.Errorf("%s: %w", operation, err))
}

func (s *Service) writeError(operation string, err error) error {
	if err == nil {
		return domainError(ErrorConflict, "object changed", nil, nil)
	}
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) && pgErr.SQLState() == "23505" {
		return domainError(ErrorConflict, "code already exists", nil, err)
	}
	return s.internal(operation, err)
}

var fixedSettlementMethods = map[string]settlementMethodRule{
	"PREPAID":          {name: "预付", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 0},
	"CASH_ON_DELIVERY": {name: "现结", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 0},
	"ARRIVAL_3":        {name: "货到3天", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 3},
	"ARRIVAL_5":        {name: "货到5天", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 5},
	"ARRIVAL_7":        {name: "货到7天", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 7},
	"ARRIVAL_15":       {name: "货到15天", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 15},
	"ARRIVAL_30":       {name: "货到30天", ruleType: "RELATIVE_DAYS", monthOffset: 0, dayOfMonth: 0, dayOffset: 30},
	"MONTHLY_CURRENT":  {name: "当月结", ruleType: "MONTH_END", monthOffset: 0, dayOfMonth: 0, dayOffset: 0},
	"MONTHLY_30":       {name: "月结30天", ruleType: "MONTH_END", monthOffset: 1, dayOfMonth: 0, dayOffset: 0},
	"MONTHLY_60":       {name: "月结60天", ruleType: "MONTH_END", monthOffset: 2, dayOfMonth: 0, dayOffset: 0},
	"MONTHLY_90":       {name: "月结90天", ruleType: "MONTH_END", monthOffset: 3, dayOfMonth: 0, dayOffset: 0},
}

type settlementMethodRule struct {
	name                               string
	ruleType                           string
	monthOffset, dayOfMonth, dayOffset int
}

func validateSettlementMethodData(data map[string]any) error {
	termCode := strings.ToUpper(strings.TrimSpace(stringValue(data["termCode"])))
	expected, ok := fixedSettlementMethods[termCode]
	if !ok {
		return errors.New("termCode must be one of the 11 fixed settlement terms")
	}
	monthOffset, monthOffsetOK := intValue(data["monthOffset"])
	dayOfMonth, dayOfMonthOK := intValue(data["dayOfMonth"])
	dayOffset, dayOffsetOK := intValue(data["dayOffset"])
	if strings.TrimSpace(stringValue(data["name"])) != expected.name ||
		strings.ToUpper(strings.TrimSpace(stringValue(data["ruleType"]))) != expected.ruleType ||
		!monthOffsetOK || monthOffset != expected.monthOffset ||
		!dayOfMonthOK || dayOfMonth != expected.dayOfMonth ||
		!dayOffsetOK || dayOffset != expected.dayOffset {
		return errors.New("settlement method facts do not match fixed term")
	}
	if !validMoney(stringValue(data["defaultSalesSurcharge"])) {
		return errors.New("defaultSalesSurcharge must be a non-negative amount")
	}
	data["termCode"] = termCode
	data["ruleType"] = expected.ruleType
	data["monthOffset"] = expected.monthOffset
	data["dayOfMonth"] = expected.dayOfMonth
	data["dayOffset"] = expected.dayOffset
	return nil
}

func validateSettlementMethodUpdate(current, updated map[string]any) error {
	for _, key := range []string{"name", "termCode", "ruleType", "monthOffset", "dayOfMonth", "dayOffset"} {
		if fmt.Sprint(current[key]) != fmt.Sprint(updated[key]) {
			return fmt.Errorf("settlement method %s is system-defined", key)
		}
	}
	return nil
}
