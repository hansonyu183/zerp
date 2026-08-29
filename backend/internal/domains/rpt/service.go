package rpt

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	db "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

const reportTimeout = 5 * time.Second
const reportExportTimeout = 30 * time.Second

type Service struct {
	pool    *pgxpool.Pool
	queries *db.Queries
}

func NewService(pool *pgxpool.Pool) (*Service, error) {
	if pool == nil {
		return nil, errors.New("rpt persistence is required")
	}
	return &Service{pool: pool, queries: db.New(pool)}, nil
}

// RegisterDefinitionSubscriptions makes RPT the transactional owner of report
// validity and use permissions while DCL remains the declaration writer.
func (s *Service) RegisterDefinitionSubscriptions(bus *txevent.Bus) error {
	return dclapproval.RptDefinitionTopic.Subscribe(bus, "rpt-definition-lifecycle", s.handleDefinitionApproval)
}

func (s *Service) handleDefinitionApproval(ctx context.Context, tx pgx.Tx, event approval.Event[dclapproval.RptDefinitionPayload]) error {
	q := s.queries.WithTx(tx)
	switch event.Action {
	case approval.ActionCreated, approval.ActionSaved:
		if err := q.RptUpsertDefinitionValidity(ctx, db.RptUpsertDefinitionValidityParams{
			ApprovalEntryID: event.Entry.ID,
			ActorID:         event.ActorID,
		}); err != nil {
			return internal("initialize report validity", err)
		}
	}
	if err := s.syncUsePermissions(ctx, q, event.Entry.SubjectID, event.ActorID); err != nil {
		return internal("sync report permissions", err)
	}
	return nil
}

func newID() string                  { return ulid.Make().String() }
func stringPointer(v string) *string { return &v }
func permissionPath(code, action string) string {
	return "/rpt/" + code + "/" + action
}

func derefVersionNo(value *int32) int32 {
	if value == nil {
		return 0
	}
	return *value
}

func decodeData(sqlText string, p, c []byte) (VersionData, error) {
	d := VersionData{SQL: sqlText}
	if e := json.Unmarshal(p, &d.Parameters); e != nil {
		return d, internal("decode report parameters", e)
	}
	if e := json.Unmarshal(c, &d.Columns); e != nil {
		return d, internal("decode report columns", e)
	}
	return d, nil
}

func (s *Service) ValidateDefinitionShape(sqlText string, parameters, columns json.RawMessage) error {
	data, err := decodeData(sqlText, parameters, columns)
	if err != nil {
		return err
	}
	return validateVersionData(data)
}

func (s *Service) ValidateDefinition(ctx context.Context, sqlText string, parameters, columns json.RawMessage, values map[string]any) error {
	data, err := decodeData(sqlText, parameters, columns)
	if err != nil {
		return err
	}
	if err = validateVersionData(data); err != nil {
		return err
	}
	args, err := bindParameters(data.Parameters, values)
	if err != nil {
		return err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return internal("begin report validation", err)
	}
	defer tx.Rollback(ctx)
	if err = configureReadOnlyTransaction(ctx, tx, "2s"); err != nil {
		return internal("configure report validation", err)
	}
	prepared, err := tx.Prepare(ctx, "rpt_validate", data.SQL)
	if err != nil {
		return validation("report SQL database validation failed", nil)
	}
	defer tx.Conn().Deallocate(ctx, prepared.Name) //nolint:errcheck
	rows, err := tx.Query(ctx, `EXPLAIN `+data.SQL, args...)
	if err != nil {
		return validation("report SQL database validation failed", nil)
	}
	rows.Close()
	rows, err = tx.Query(ctx, `SELECT * FROM (`+data.SQL+`) rpt_validation LIMIT 1`, args...)
	if err != nil {
		return validation("report SQL database validation failed", nil)
	}
	fields := rows.FieldDescriptions()
	rows.Close()
	if !fieldsMatchContract(fields, data.Columns) {
		return validation("report result columns do not match contract", nil)
	}
	return nil
}

func submittedAtPtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	x := t.Time
	return &x
}
func approvedAtPtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	x := t.Time
	return &x
}

func (s *Service) QueryDirectory(ctx context.Context, in DirectoryQueryInput, permissions []string) (Page, error) {
	if in.Page < 1 || in.PageSize < 1 || in.PageSize > 200 {
		return Page{}, validation("invalid report directory pagination", nil)
	}
	allowed := []string{}
	access := map[string]map[string]bool{}
	for _, p := range permissions {
		parts := strings.Split(strings.Trim(p, "/"), "/")
		if len(parts) == 3 && parts[0] == "rpt" && (parts[2] == "query" || parts[2] == "export") {
			if access[parts[1]] == nil {
				access[parts[1]] = map[string]bool{}
			}
			access[parts[1]][parts[2]] = true
		}
	}
	for code := range access {
		allowed = append(allowed, code)
	}
	rows, e := s.queries.RptQueryDirectory(ctx, db.RptQueryDirectoryParams{AllowedCodes: allowed, RowOffset: int32((in.Page - 1) * in.PageSize), RowLimit: int32(in.PageSize)})
	if e != nil {
		return Page{}, internal("query report directory", e)
	}
	items := []ReportMetadata{}
	var total int64
	for _, r := range rows {
		var p []Parameter
		var c []ResultColumn
		if e = json.Unmarshal(r.Parameters, &p); e != nil {
			return Page{}, internal("decode report parameters", e)
		}
		if e = json.Unmarshal(r.Columns, &c); e != nil {
			return Page{}, internal("decode report columns", e)
		}
		items = append(items, ReportMetadata{Code: r.Code, Name: r.Name, Description: r.Description, Parameters: p, Columns: c, CanQuery: access[r.Code]["query"], CanExport: access[r.Code]["export"]})
		total = r.Total
	}
	return Page{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *Service) QueryReferences(ctx context.Context, code string, in ReferenceQueryInput) (Page, error) {
	definition, err := s.loadActive(ctx, code)
	if err != nil {
		return Page{}, err
	}
	var kind ReferenceType
	for _, parameter := range definition.Data.Parameters {
		if parameter.Key == in.ParameterKey && parameter.Type == ParameterTypeReference && parameter.ReferenceType != nil {
			kind = *parameter.ReferenceType
			break
		}
	}
	if kind == "" {
		return Page{}, validation("report reference parameter is invalid", nil)
	}
	page, size := 1, 20
	if in.Page != nil {
		page = *in.Page
	}
	if in.PageSize != nil {
		size = *in.PageSize
	}
	if page < 1 || size < 1 || size > 50 {
		return Page{}, validation("invalid reference pagination", nil)
	}
	keyword, selected := strings.TrimSpace(in.Keyword), in.SelectedID
	offset, limit := int32((page-1)*size), int32(size)
	items := []ReferenceItem{}
	var total int64
	appendRows := func(rows []ReferenceItem, count int64) { items = append(items, rows...); total = count }
	switch kind {
	case ReferenceTypeAccountingBook:
		rows, e := s.queries.RptListBookReferences(ctx, db.RptListBookReferencesParams{SelectedID: selected, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if e != nil {
			return Page{}, internal("query report reference", e)
		}
		values := make([]ReferenceItem, len(rows))
		for i, r := range rows {
			values[i] = ReferenceItem{ID: r.ID, Code: r.Code, Name: r.Name}
		}
		if len(rows) > 0 {
			appendRows(values, rows[0].Total)
		}
	case ReferenceTypeAccountSubject:
		rows, e := s.queries.RptListSubjectReferences(ctx, db.RptListSubjectReferencesParams{SelectedID: selected, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if e != nil {
			return Page{}, internal("query report reference", e)
		}
		values := make([]ReferenceItem, len(rows))
		for i, r := range rows {
			values[i] = ReferenceItem{ID: r.ID, Code: r.Code, Name: r.Name}
		}
		if len(rows) > 0 {
			appendRows(values, rows[0].Total)
		}
	case ReferenceTypeAsset:
		rows, e := s.queries.RptListAssetReferences(ctx, db.RptListAssetReferencesParams{SelectedID: selected, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if e != nil {
			return Page{}, internal("query report reference", e)
		}
		values := make([]ReferenceItem, len(rows))
		for i, r := range rows {
			values[i] = ReferenceItem{ID: r.ID, Code: r.Code, Name: r.Name}
		}
		if len(rows) > 0 {
			appendRows(values, rows[0].Total)
		}
	case ReferenceTypeBill:
		rows, e := s.queries.RptListBillReferences(ctx, db.RptListBillReferencesParams{SelectedID: selected, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if e != nil {
			return Page{}, internal("query report reference", e)
		}
		values := make([]ReferenceItem, len(rows))
		for i, r := range rows {
			values[i] = ReferenceItem{ID: r.ID, Code: r.Code, Name: r.Name}
		}
		if len(rows) > 0 {
			appendRows(values, rows[0].Total)
		}
	default:
		entity := map[ReferenceType]string{
			ReferenceTypeCustomerAccount:        "customer-account",
			ReferenceTypeSupplierRelationship:   "supplier",
			ReferenceTypeServiceRelationship:    "other-unit",
			ReferenceTypeEmploymentRelationship: "employee",
			ReferenceTypeSalesRelationship:      "sales-partner",
			ReferenceTypeDepartment:             "department",
			ReferenceTypeProduct:                "product",
			ReferenceTypeWarehouse:              "warehouse",
			ReferenceTypeFundAccount:            "fund-account",
		}[kind]
		if entity == "" {
			return Page{}, validation("report reference type is unsupported", nil)
		}
		rows, e := s.queries.RptListBOBReferences(ctx, db.RptListBOBReferencesParams{Entity: entity, SelectedID: selected, Keyword: &keyword, RowOffset: offset, RowLimit: limit})
		if e != nil {
			return Page{}, internal("query report reference", e)
		}
		values := make([]ReferenceItem, len(rows))
		for i, r := range rows {
			values[i] = ReferenceItem{ID: r.ID, Code: value(r.Code), Name: value(r.Name)}
		}
		if len(rows) > 0 {
			appendRows(values, rows[0].Total)
		}
	}
	return Page{Items: items, Total: total, Page: page, PageSize: size}, nil
}

func bindParameters(definitions []Parameter, values map[string]any) ([]any, error) {
	known := make(map[string]bool, len(definitions))
	for _, definition := range definitions {
		known[definition.Key] = true
	}
	for key := range values {
		if !known[key] {
			return nil, validation("report parameters do not match definition", map[string]any{"key": key})
		}
	}
	result := make([]any, len(definitions))
	for index, p := range definitions {
		value, ok := values[p.Key]
		if !ok {
			if p.Required {
				return nil, validation("required report parameter is missing", map[string]any{"key": p.Key})
			}
			value = p.DefaultValue
		}
		if value == nil {
			result[index] = nil
			continue
		}
		switch p.Type {
		case ParameterTypeText, ParameterTypeReference:
			if _, ok = value.(string); !ok {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
		case ParameterTypeDate:
			text, valid := value.(string)
			parsed, parseErr := time.Parse(time.DateOnly, text)
			if !valid || parseErr != nil {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = parsed
		case ParameterTypeDateRange:
			pair, valid := value.([]any)
			if !valid || len(pair) != 2 {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			fromText, fromOK := pair[0].(string)
			toText, toOK := pair[1].(string)
			from, fromErr := time.Parse(time.DateOnly, fromText)
			to, toErr := time.Parse(time.DateOnly, toText)
			if !fromOK || !toOK || fromErr != nil || toErr != nil || from.After(to) {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = pgtype.Range[time.Time]{Lower: from, Upper: to.AddDate(0, 0, 1), LowerType: pgtype.Inclusive, UpperType: pgtype.Exclusive, Valid: true}
		case ParameterTypeEnum:
			text, textOK := value.(string)
			enumValid := false
			if textOK && p.EnumValues != nil {
				for _, candidate := range *p.EnumValues {
					if text == candidate {
						enumValid = true
					}
				}
			}
			if !enumValid {
				return nil, validation("report enum value is invalid", map[string]any{"key": p.Key})
			}
		case ParameterTypeInteger:
			number, valid := value.(float64)
			if !valid || math.Trunc(number) != number || number < math.MinInt64 || number > math.MaxInt64 {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = int64(number)
		case ParameterTypeDecimal:
			text, valid := value.(string)
			var number pgtype.Numeric
			if !valid || number.Scan(text) != nil || !number.Valid {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
			value = number
		case ParameterTypeBoolean:
			if _, ok = value.(bool); !ok {
				return nil, validation("report parameter type is invalid", map[string]any{"key": p.Key})
			}
		}
		result[index] = value
	}
	return result, nil
}

func configureReadOnlyTransaction(ctx context.Context, tx pgx.Tx, timeout string) error {
	for _, sql := range []string{`SET LOCAL ROLE zerp_report_reader`, `SET LOCAL TRANSACTION READ ONLY`, `SET LOCAL statement_timeout='` + timeout + `'`} {
		if _, e := tx.Exec(ctx, sql); e != nil {
			return e
		}
	}
	return nil
}

func resultTypeMatchesOID(t ResultType, oid uint32) bool {
	switch t {
	case ResultTypeBoolean:
		return oid == pgtype.BoolOID
	case ResultTypeInteger:
		return oid == pgtype.Int2OID || oid == pgtype.Int4OID || oid == pgtype.Int8OID
	case ResultTypeDecimal:
		return oid == pgtype.NumericOID || oid == pgtype.Float4OID || oid == pgtype.Float8OID
	case ResultTypeDate:
		return oid == pgtype.DateOID
	case ResultTypeDateTime:
		return oid == pgtype.TimestampOID || oid == pgtype.TimestamptzOID
	case ResultTypeText, ResultTypeID:
		return oid == pgtype.TextOID || oid == pgtype.VarcharOID || oid == pgtype.BPCharOID || oid == pgtype.UUIDOID
	}
	return false
}

func fieldsMatchContract(fields []pgconn.FieldDescription, columns []ResultColumn) bool {
	if len(fields) != len(columns) {
		return false
	}
	for i, f := range fields {
		if string(f.Name) != columns[i].Alias || !resultTypeMatchesOID(columns[i].Type, f.DataTypeOID) {
			return false
		}
	}
	return true
}

func isStructuralError(err error) bool {
	var p *pgconn.PgError
	if !errors.As(err, &p) {
		return false
	}
	return strings.Contains("42P01 42703 42883 42804 42P18 42601", p.Code)
}

func (s *Service) loadActive(ctx context.Context, code string) (DefinitionView, error) {
	return loadActiveWithQueries(ctx, s.queries, code)
}

func loadActiveWithQueries(ctx context.Context, queries *db.Queries, code string) (DefinitionView, error) {
	r, e := queries.RptGetActiveDefinition(ctx, code)
	if e != nil {
		return DefinitionView{}, domainError(ErrorConflict, "report is unavailable", nil, e)
	}
	data, e := decodeData(r.SqlText, r.Parameters, r.Columns)
	if e != nil {
		return DefinitionView{}, e
	}
	return DefinitionView{
		DefinitionID: r.DefinitionID,
		Code:         r.Code,
		Name:         r.Name,
		Description:  r.Description,
		Enabled:      r.Enabled,
		Approval: approval.VersionMeta{
			ApprovalEntryID: r.ApprovalEntryID,
			VersionNo:       derefVersionNo(r.VersionNo),
			Status:          approval.Status(r.Status),
			Revision:        r.ApprovalRevision,
			CreatedBy:       r.ApprovalCreatedBy,
			CreatedAt:       r.ApprovalCreatedAt.Time,
			UpdatedBy:       r.ApprovalUpdatedBy,
			UpdatedAt:       r.ApprovalUpdatedAt.Time,
			SubmittedBy:     r.ApprovalSubmittedBy,
			SubmittedAt:     submittedAtPtr(r.ApprovalSubmittedAt),
			ApprovedBy:      r.ApprovalApprovedBy,
			ApprovedAt:      approvedAtPtr(r.ApprovalApprovedAt),
		},
		Validity: r.Validity,
		Data:     data,
	}, nil
}

func (s *Service) syncUsePermissions(ctx context.Context, q *db.Queries, definitionID, actorID string) error {
	state, e := q.RptLatestApprovedUseState(ctx, definitionID)
	if e != nil {
		return internal("load report permission state", e)
	}
	if !state.Enabled || state.ApprovalEntryID == "" || state.Validity == nil || *state.Validity != "VALID" {
		return q.RptDisableUsePermissions(ctx, db.RptDisableUsePermissionsParams{ActorID: stringPointer(actorID), Code: state.Code})
	}
	for _, a := range []string{"query", "export"} {
		d := map[string]string{"query": "查询", "export": "导出"}[a] + state.Name + "报表"
		if e = q.RptUpsertUsePermission(ctx, db.RptUpsertUsePermissionParams{ID: newID(), Path: permissionPath(state.Code, a), Code: state.Code, Action: a, Description: &d, ActorID: stringPointer(actorID)}); e != nil {
			return internal("sync report permission", e)
		}
	}
	return nil
}

func (s *Service) markInvalid(ctx context.Context, definition DefinitionView, actorID, requestID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	if err = q.RptInvalidateVersion(ctx, db.RptInvalidateVersionParams{ActorID: actorID, ApprovalEntryID: definition.Approval.ApprovalEntryID}); err != nil {
		return err
	}
	if err = s.syncUsePermissions(ctx, q, definition.DefinitionID, actorID); err != nil {
		return err
	}
	summary := []byte(`{}`)
	if err = q.RptInsertRuntimeAuditEvent(ctx, db.RptInsertRuntimeAuditEventParams{ID: newID(), DefinitionID: stringPointer(definition.DefinitionID), ReportCode: definition.Code, ApprovalEntryID: stringPointer(definition.Approval.ApprovalEntryID), EventType: "INVALIDATED", ActorID: actorID, RequestID: requestID, Summary: summary}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) executionError(ctx context.Context, definition DefinitionView, actorID, requestID, operation string, err error) error {
	if isStructuralError(err) {
		if invalidateErr := s.markInvalid(context.WithoutCancel(ctx), definition, actorID, requestID); invalidateErr != nil {
			return internal("invalidate report", invalidateErr)
		}
		return domainError(ErrorConflict, "report is invalid", nil, nil)
	}
	return internal(operation, err)
}

func (s *Service) recordRuntimeAudit(ctx context.Context, definition DefinitionView, eventType, actorID, requestID string, summary any) error {
	payload, err := json.Marshal(summary)
	if err != nil {
		return internal("encode report runtime audit", err)
	}
	if err = s.queries.RptInsertRuntimeAuditEvent(ctx, db.RptInsertRuntimeAuditEventParams{
		ID: newID(), DefinitionID: stringPointer(definition.DefinitionID), ReportCode: definition.Code,
		ApprovalEntryID: stringPointer(definition.Approval.ApprovalEntryID), EventType: eventType,
		ActorID: actorID, RequestID: requestID, Summary: payload,
	}); err != nil {
		return internal("record report runtime audit", err)
	}
	return nil
}

func (s *Service) Execute(ctx context.Context, code string, in ExecuteInput, actorID, requestID string) (QueryResult, error) {
	page, size := 1, 50
	if in.Page != nil {
		page = *in.Page
	}
	if in.PageSize != nil {
		size = *in.PageSize
	}
	if page < 1 || size < 1 || size > 100 {
		return QueryResult{}, validation("invalid report pagination", nil)
	}
	run, cancel := context.WithTimeout(ctx, reportTimeout)
	defer cancel()
	tx, e := s.pool.BeginTx(run, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return QueryResult{}, internal("begin report query", e)
	}
	defer tx.Rollback(run)
	if e = configureReadOnlyTransaction(run, tx, "5s"); e != nil {
		return QueryResult{}, internal("prepare report query", e)
	}
	d, e := loadActiveWithQueries(run, s.queries.WithTx(tx), code)
	if e != nil {
		return QueryResult{}, e
	}
	args, e := bindParameters(d.Data.Parameters, in.Parameters)
	if e != nil {
		return QueryResult{}, e
	}
	var total int64
	if e = tx.QueryRow(run, `SELECT count(*) FROM (`+d.Data.SQL+`) rpt_count`, args...).Scan(&total); e != nil {
		return QueryResult{}, s.executionError(ctx, d, actorID, requestID, "count report rows", e)
	}
	rows, e := tx.Query(run, fmt.Sprintf(`SELECT * FROM (%s) rpt_query LIMIT %d OFFSET %d`, d.Data.SQL, size, (page-1)*size), args...)
	if e != nil {
		return QueryResult{}, s.executionError(ctx, d, actorID, requestID, "run report query", e)
	}
	defer rows.Close()
	if !fieldsMatchContract(rows.FieldDescriptions(), d.Data.Columns) {
		if err := s.markInvalid(context.WithoutCancel(ctx), d, actorID, requestID); err != nil {
			return QueryResult{}, internal("invalidate report", err)
		}
		return QueryResult{}, domainError(ErrorConflict, "report is invalid", nil, nil)
	}
	items := []map[string]any{}
	for rows.Next() {
		v, e := rows.Values()
		if e != nil {
			return QueryResult{}, e
		}
		item := map[string]any{}
		for i, f := range rows.FieldDescriptions() {
			item[string(f.Name)] = v[i]
		}
		items = append(items, item)
	}
	if e = rows.Err(); e != nil {
		return QueryResult{}, s.executionError(ctx, d, actorID, requestID, "read report rows", e)
	}
	if e = tx.Commit(run); e != nil {
		return QueryResult{}, internal("finish report query", e)
	}
	if e = s.recordRuntimeAudit(ctx, d, "EXECUTED", actorID, requestID, map[string]any{
		"page": page, "pageSize": size, "returnedRows": len(items), "totalRows": total,
	}); e != nil {
		return QueryResult{}, e
	}
	return QueryResult{Columns: d.Data.Columns, Items: items, Total: total, Page: page, PageSize: size}, nil
}

func (s *Service) StreamExport(ctx context.Context, code string, in ExecuteInput, actorID, requestID string, consume func([]ResultColumn, pgx.Rows) error) error {
	run, cancel := context.WithTimeout(ctx, reportExportTimeout)
	defer cancel()
	tx, err := s.pool.BeginTx(run, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return internal("begin report export", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	if err = configureReadOnlyTransaction(run, tx, "30s"); err != nil {
		return internal("prepare report export", err)
	}
	d, err := loadActiveWithQueries(run, s.queries.WithTx(tx), code)
	if err != nil {
		return err
	}
	args, err := bindParameters(d.Data.Parameters, in.Parameters)
	if err != nil {
		return err
	}
	var total int64
	if err = tx.QueryRow(run, `SELECT count(*) FROM (`+d.Data.SQL+`) rpt_export_count`, args...).Scan(&total); err != nil {
		return internal("count report export rows", err)
	}
	if total > 100000 {
		return validation("report export exceeds row limit", map[string]any{"limit": 100000})
	}
	rows, err := tx.Query(run, `SELECT * FROM (`+d.Data.SQL+`) rpt_export`, args...)
	if err != nil {
		return internal("run report export", err)
	}
	defer rows.Close()
	if !fieldsMatchContract(rows.FieldDescriptions(), d.Data.Columns) {
		return domainError(ErrorConflict, "report is invalid", nil, nil)
	}
	if err = consume(d.Data.Columns, rows); err != nil {
		return internal("stream report export", err)
	}
	if err = rows.Err(); err != nil {
		return s.executionError(ctx, d, actorID, requestID, "read report export rows", err)
	}
	if err = tx.Commit(run); err != nil {
		return internal("finish report export", err)
	}
	return s.recordRuntimeAudit(ctx, d, "EXPORTED", actorID, requestID, map[string]any{"totalRows": total})
}
