package bob

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const kilogramMeasurementUnitCode = "UNT-0001"

type Service struct {
	pool                   *pgxpool.Pool
	queries                *dbsqlc.Queries
	afterDeleteDetailsHook func() error
	auxiliaryResolver      AuxiliaryResolver
}

type AuxiliaryResolver interface {
	ResolveAuxiliaryReference(context.Context, pgx.Tx, string, string, string) (AuxiliaryReference, error)
	ResolveAuxiliaryCode(context.Context, pgx.Tx, string, string) (AuxiliaryReference, error)
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, queries: dbsqlc.New(pool)}
}

func (s *Service) SetAuxiliaryResolver(resolver AuxiliaryResolver) {
	s.auxiliaryResolver = resolver
}

func (s *Service) Query(ctx context.Context, entity string, input QueryInput) (Page[QueryItem], error) {
	if entity == EntityOperatingEntity {
		return s.queryOperatingEntities(ctx, input)
	}
	offset, validPage := pageOffset(input.Page, input.PageSize)
	if !validEntity(entity) || !validPage {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	filters, err := validateQueryFilters(entity, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	statuses := uniqueStrings(filters.Status)
	for _, status := range statuses {
		if !validStatus(status) {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid status filter", nil, nil)
		}
	}
	sortField, sortOrder := "updatedAt", "desc"
	if len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "only one sort item is allowed", nil, nil)
	}
	if len(input.Sort) == 1 {
		sortField, sortOrder = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if !slices.Contains([]string{"updatedAt", "code", "name", "status", "version"}, sortField) ||
			!slices.Contains([]string{"asc", "desc"}, sortOrder) {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid sort", nil, nil)
		}
	}
	if statuses == nil {
		statuses = []string{}
	}
	enabledFilter := int32(-1)
	if filters.Enabled != nil {
		if *filters.Enabled {
			enabledFilter = 1
		} else {
			enabledFilter = 0
		}
	}
	countParams := dbsqlc.CountBobObjectsParams{
		Entity: entity, Statuses: statuses, Keyword: filters.Keyword,
		EnabledFilter: enabledFilter,
		CustomerType:  filters.CustomerType, SupplierType: filters.SupplierType,
		CategoryID: filters.CategoryID, DepartmentID: filters.DepartmentID,
		PositionID: filters.PositionID, SalespersonEmployeeID: filters.SalespersonEmployeeID,
		Currency:     filters.Currency,
		ProductKind:  filters.ProductKind,
		TargetEntity: filters.TargetEntity, ParentID: filters.ParentID, RootOnly: filters.RootOnly,
	}
	total, err := s.queries.CountBobObjects(ctx, countParams)
	if err != nil {
		return Page[QueryItem]{}, s.internal("count objects", err)
	}
	rows, err := s.queries.ListBobObjects(ctx, dbsqlc.ListBobObjectsParams{
		Entity: entity, Statuses: statuses, Keyword: filters.Keyword, SortField: sortField, SortOrder: sortOrder,
		EnabledFilter: enabledFilter,
		CustomerType:  filters.CustomerType, SupplierType: filters.SupplierType,
		CategoryID: filters.CategoryID, DepartmentID: filters.DepartmentID,
		PositionID: filters.PositionID, SalespersonEmployeeID: filters.SalespersonEmployeeID,
		Currency:     filters.Currency,
		ProductKind:  filters.ProductKind,
		TargetEntity: filters.TargetEntity, ParentID: filters.ParentID, RootOnly: filters.RootOnly,
		PageOffset: offset, PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list objects", err)
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ObjectID)
	}
	enabledByID := make(map[string]bool, len(rows))
	if len(ids) > 0 {
		enabledRows, enabledErr := s.queries.ListBobObjectsEnabled(ctx, ids)
		if enabledErr != nil {
			return Page[QueryItem]{}, s.internal("read object availability", enabledErr)
		}
		for _, enabledRow := range enabledRows {
			enabledByID[enabledRow.ID] = enabledRow.Enabled
		}
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, queryItem(row, enabledByID[row.ObjectID]))
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) Get(ctx context.Context, entity string, input GetInput) (ObjectView, error) {
	if entity == EntityOperatingEntity {
		return s.getOperatingEntity(ctx, input)
	}
	if !validEntity(entity) || !validID(input.ObjectID) || (input.VersionID != "" && !validID(input.VersionID)) {
		return ObjectView{}, domainError(ErrorValidation, "invalid object or version", nil, nil)
	}
	row, err := s.queries.GetBobVersionView(ctx, dbsqlc.GetBobVersionViewParams{
		ObjectID: input.ObjectID, Entity: entity, VersionID: input.VersionID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "object or version not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get object", err)
	}
	enabled, err := s.queries.GetBobObjectEnabled(ctx, dbsqlc.GetBobObjectEnabledParams{
		ID: input.ObjectID, Entity: entity,
	})
	if err != nil {
		return ObjectView{}, s.internal("read object availability", err)
	}
	result := objectView(row, enabled)
	if entity == EntityFundAccount {
		if err = loadFundAccountOperating(ctx, s.queries, row.VersionID, &result.Data); err != nil {
			return ObjectView{}, s.internal("read fund account operating entity", err)
		}
	}
	if entity == EntityProduct {
		result.Data.Formula, err = loadProductFormula(ctx, s.queries, row.VersionID)
		if err != nil {
			return ObjectView{}, s.internal("read product formula", err)
		}
	}
	return result, nil
}

func (s *Service) Create(ctx context.Context, entity string, input CreateInput, actorID, requestID string) (MutationResult, error) {
	if entity == EntitySettlementMethod {
		return MutationResult{}, domainError(ErrorValidation, "settlement methods are system-defined", nil, nil)
	}
	if entity == EntitySupplier {
		supplierType := SupplierTypeGeneral
		if input.Data.SupplierType != nil {
			supplierType = *input.Data.SupplierType
		}
		return s.SupplierCreate(ctx, SupplierCreateInput{Data: SupplierData{
			Name: input.Data.Name, SupplierType: supplierType, ShortName: input.Data.ShortName,
			TaxNumber: input.Data.TaxNumber, ContactName: input.Data.ContactName,
			ContactPhone: input.Data.ContactPhone, Email: input.Data.Email, Address: input.Data.Address,
			Remark: input.Data.Remark, SettlementMethodID: input.Data.SettlementMethodID,
			DefaultPurchaserEmployeeID: input.Data.DefaultPurchaserEmployeeID,
		}}, actorID, requestID)
	}
	data, _, err := validateCreate(entity, input.Data)
	if err != nil || !validActorAndRequest(actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid create request", nil, err)
	}
	objectID, versionID := newID(), newID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	counter, err := qtx.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{
		Domain: "bob", Entity: entity,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("allocate object number", err)
	}
	code := fmt.Sprintf("%s-%04d", objectPrefix(entity), counter)
	if entity == EntityFundAccount {
		data, err = s.resolveFundAccountOperating(ctx, tx, data)
		if err != nil {
			return MutationResult{}, err
		}
	}
	if err = s.validateDetailReferences(ctx, tx, qtx, entity, objectID, data); err != nil {
		return MutationResult{}, err
	}
	if entity == EntityCustomer {
		data, err = s.resolveGenericCustomerSettlement(ctx, tx, data)
		if err != nil {
			return MutationResult{}, err
		}
	}
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{
		ID: objectID, Entity: entity, Code: code, CurrentVersionID: versionID, ActorID: actorID,
	}); err != nil {
		return MutationResult{}, s.writeError("insert object", err)
	}
	if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{
		ID: versionID, ObjectID: objectID, Entity: entity, VersionNo: 1, ActorID: actorID,
	}); err != nil {
		return MutationResult{}, s.writeError("insert version", err)
	}
	if err = insertDetail(ctx, qtx, entity, versionID, data); err != nil {
		return MutationResult{}, s.writeError("insert detail", err)
	}
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: objectID, VersionID: versionID, Entity: entity, Event: "CREATED", To: StatusDraft,
		ActorID: actorID, RequestID: requestID, Summary: map[string]any{"fields": append([]string{"code"}, detailFields(entity)...)},
	}); err != nil {
		return MutationResult{}, s.writeError("audit create", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit create", err)
	}
	return MutationResult{ObjectID: objectID, ObjectRevision: 1, Enabled: true, VersionID: versionID, Version: 1, Status: StatusDraft, Revision: 1}, nil
}

func objectPrefix(entity string) string {
	return map[string]string{
		EntityCustomer: "CUS", EntitySupplier: "SUP", EntityOtherParty: "OTP", EntityEmployee: "EMP",
		EntityProduct: "PRD", EntityService: "SVC", EntityWarehouse: "WHS",
		EntityVehicle: "VEH", EntityFundAccount: "FAC",
		EntityCategory: "PCT", EntityDepartment: "DEP", EntityPosition: "POS",
		EntitySettlementMethod: "STM", EntityOperatingEntity: "OPE",
	}[entity]
}

func (s *Service) Save(ctx context.Context, entity string, input SaveInput, actorID, requestID string) (MutationResult, error) {
	if entity == EntitySupplier {
		data := SupplierData{Name: input.Data.Name, provided: map[string]bool{"name": true}}
		if input.Data.SupplierType != nil {
			data.SupplierType = *input.Data.SupplierType
			data.provided["supplierType"] = true
		}
		copyOptional := func(key string, value OptionalString, target *string) {
			if value.Set {
				data.provided[key] = true
				*target = value.Value
			}
		}
		copyOptional("shortName", input.Data.ShortName, &data.ShortName)
		copyOptional("taxNumber", input.Data.TaxNumber, &data.TaxNumber)
		copyOptional("contactName", input.Data.ContactName, &data.ContactName)
		copyOptional("contactPhone", input.Data.ContactPhone, &data.ContactPhone)
		copyOptional("email", input.Data.Email, &data.Email)
		copyOptional("address", input.Data.Address, &data.Address)
		copyOptional("remark", input.Data.Remark, &data.Remark)
		copyOptional("settlementMethodId", input.Data.SettlementMethodID, &data.SettlementMethodID)
		copyOptional("defaultPurchaserEmployeeId", input.Data.DefaultPurchaserEmployeeID, &data.DefaultPurchaserEmployeeID)
		return s.SupplierSave(ctx, SupplierSaveInput{ObjectID: input.ObjectID, VersionID: input.VersionID,
			Revision: input.Revision, Data: data}, actorID, requestID)
	}
	if !validWriteInput(entity, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, nil)
	}
	if err := validateDetailInputFields(entity, input.Data); err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || object.EffectiveVersionID != nil || version.Revision != input.Revision ||
		version.Status != StatusDraft {
		return MutationResult{}, conflict(object, version, "version changed before save")
	}
	row, readErr := qtx.GetBobVersionView(ctx, dbsqlc.GetBobVersionViewParams{
		ObjectID: input.ObjectID, Entity: entity, VersionID: input.VersionID,
	})
	if readErr != nil {
		return MutationResult{}, s.internal("read current detail", readErr)
	}
	current := detailView(row)
	if entity == EntityFundAccount {
		if readErr = loadFundAccountOperating(ctx, qtx, input.VersionID, &current); readErr != nil {
			return MutationResult{}, s.internal("read fund account operating entity", readErr)
		}
	}
	if entity == EntityProduct {
		current.Formula, readErr = loadProductFormula(ctx, qtx, input.VersionID)
		if readErr != nil {
			return MutationResult{}, s.internal("read current product formula", readErr)
		}
	}
	merged := mergeDetailInput(current, input.Data)
	if entity == EntitySettlementMethod {
		merged = current
		if input.Data.DefaultSalesSurcharge != nil {
			merged.DefaultSalesSurcharge = *input.Data.DefaultSalesSurcharge
		}
	}
	data, err := validateDetailData(entity, merged)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
	}
	if entity == EntityFundAccount {
		data, err = s.resolveFundAccountOperating(ctx, tx, data)
		if err != nil {
			return MutationResult{}, err
		}
	}
	if entity == EntityCategory && data.TargetEntity != current.TargetEntity {
		referenced, referenceErr := qtx.BobObjectHasExternalReferences(ctx, dbsqlc.BobObjectHasExternalReferencesParams{
			TargetObjectID: input.ObjectID, TargetVersionID: input.VersionID,
		})
		if referenceErr != nil {
			return MutationResult{}, s.internal("check category target references", referenceErr)
		}
		if referenced {
			return MutationResult{}, domainError(ErrorConflict, "referenced category target cannot change", nil, nil)
		}
	}
	if err = s.validateDetailReferences(ctx, tx, qtx, entity, input.ObjectID, data); err != nil {
		return MutationResult{}, err
	}
	if entity == EntityCustomer {
		data, err = s.resolveGenericCustomerSettlement(ctx, tx, data)
		if err != nil {
			return MutationResult{}, err
		}
	}
	if err = updateDetail(ctx, qtx, entity, input.VersionID, data); err != nil {
		return MutationResult{}, s.writeError("update detail", err)
	}
	rows, err := qtx.MarkBobVersionSaved(ctx, dbsqlc.MarkBobVersionSavedParams{
		ActorID: actorID, ID: input.VersionID, ObjectID: input.ObjectID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("mark version saved", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "version changed before save")
	}
	if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: entity}); err != nil {
		return MutationResult{}, s.internal("touch object", err)
	}
	from := version.Status
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: entity, Event: "SAVED", From: &from, To: from,
		ActorID: actorID, RequestID: requestID, Summary: map[string]any{"fields": detailFields(entity)},
	}); err != nil {
		return MutationResult{}, s.writeError("audit save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit save", err)
	}
	return mutation(object, version, version.Status, input.Revision+1), nil
}

func (s *Service) Delete(ctx context.Context, entity string, input DeleteInput) error {
	if entity == EntitySettlementMethod {
		return domainError(ErrorValidation, "settlement methods are system-defined", nil, nil)
	}
	if !validDeleteInput(entity, input) {
		return domainError(ErrorValidation, "invalid delete request", nil, nil)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if hasEffectiveCandidate(entity, object) {
		return s.deleteEffectiveCandidate(ctx, tx, entity, object, version, input)
	}

	if object.Revision != input.ObjectRevision ||
		object.CurrentVersionID != input.VersionID ||
		object.EffectiveVersionID != nil ||
		object.NextVersionNo != 2 ||
		version.VersionNo != 1 ||
		version.Status != StatusDraft ||
		version.Revision != input.Revision ||
		version.SubmittedAt.Valid ||
		version.SubmittedBy != nil ||
		version.ReviewedAt.Valid ||
		version.ReviewedBy != nil {
		return conflict(object, version, "first draft cannot be deleted in its current state")
	}
	versionCount, err := qtx.CountBobVersions(ctx, dbsqlc.CountBobVersionsParams{
		ObjectID: input.ObjectID,
		Entity:   entity,
	})
	if err != nil {
		return s.internal("count versions before delete", err)
	}
	if versionCount != 1 {
		return conflict(object, version, "object has version history")
	}
	auditDeletable, err := qtx.BobDraftAuditIsDeletable(ctx, dbsqlc.BobDraftAuditIsDeletableParams{
		ObjectID:  input.ObjectID,
		VersionID: input.VersionID,
		Entity:    entity,
	})
	if err != nil {
		return s.internal("validate draft audit before delete", err)
	}
	if auditDeletable == nil || !*auditDeletable {
		return conflict(object, version, "object has lifecycle history")
	}
	referenced, err := qtx.BobObjectHasExternalReferences(ctx, dbsqlc.BobObjectHasExternalReferencesParams{
		TargetObjectID:  input.ObjectID,
		TargetVersionID: input.VersionID,
	})
	if err != nil {
		return s.internal("check external references before delete", err)
	}
	if referenced {
		return conflict(object, version, "object or version is referenced")
	}

	auditRows, err := qtx.DeleteBobAuditEventsForDraft(ctx, dbsqlc.DeleteBobAuditEventsForDraftParams{
		ObjectID:  input.ObjectID,
		VersionID: input.VersionID,
		Entity:    entity,
	})
	if err != nil {
		return s.writeError("delete draft audit events", err)
	}
	if auditRows < 1 {
		return conflict(object, version, "draft audit changed before delete")
	}
	detailRows, err := deleteDetail(ctx, qtx, entity, input.VersionID)
	if err != nil {
		return s.writeError("delete version detail", err)
	}
	if detailRows != 1 {
		return conflict(object, version, "version detail changed before delete")
	}
	if s.afterDeleteDetailsHook != nil {
		if err = s.afterDeleteDetailsHook(); err != nil {
			return s.internal("delete draft interrupted", err)
		}
	}
	versionRows, err := qtx.DeleteBobFirstVersion(ctx, dbsqlc.DeleteBobFirstVersionParams{
		VersionID: input.VersionID,
		ObjectID:  input.ObjectID,
		Entity:    entity,
		Revision:  input.Revision,
	})
	if err != nil {
		return s.writeError("delete first version", err)
	}
	if versionRows != 1 {
		return conflict(object, version, "version changed before delete")
	}
	objectRows, err := qtx.DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{
		ObjectID:       input.ObjectID,
		Entity:         entity,
		VersionID:      input.VersionID,
		ObjectRevision: input.ObjectRevision,
	})
	if err != nil {
		return s.writeError("delete object", err)
	}
	if objectRows != 1 {
		return conflict(object, version, "object changed before delete")
	}
	if err = tx.Commit(ctx); err != nil {
		return s.writeError("commit delete", err)
	}
	return nil
}

func (s *Service) deleteEffectiveCandidate(
	ctx context.Context, tx pgx.Tx, entity string, object dbsqlc.LockBobObjectRow, version dbsqlc.LockBobVersionRow, input DeleteInput,
) error {
	if object.EffectiveVersionID == nil || object.Revision != input.ObjectRevision ||
		object.CurrentVersionID != input.VersionID || version.Revision != input.Revision ||
		(version.Status != StatusDraft && version.Status != StatusPending) {
		return conflict(object, version, entity+" candidate changed before delete")
	}
	qtx := s.queries.WithTx(tx)
	var rows int64
	var err error
	if entity == EntityCustomer {
		rows, err = qtx.RestoreBobCustomerEffectiveVersion(ctx, dbsqlc.RestoreBobCustomerEffectiveVersionParams{ObjectID: input.ObjectID,
			Revision: input.ObjectRevision, VersionID: input.VersionID, EffectiveVersionID: object.EffectiveVersionID})
	} else {
		rows, err = qtx.RestoreBobSupplierEffectiveVersion(ctx, dbsqlc.RestoreBobSupplierEffectiveVersionParams{ObjectID: input.ObjectID,
			Revision: input.ObjectRevision, VersionID: input.VersionID, EffectiveVersionID: object.EffectiveVersionID})
	}
	if err != nil {
		return s.writeError("restore customer effective version", err)
	}
	if rows != 1 {
		return conflict(object, version, entity+" candidate changed before delete")
	}
	if err = qtx.DeleteBobAuditEventsForVersion(ctx, dbsqlc.DeleteBobAuditEventsForVersionParams{ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: entity}); err != nil {
		return s.writeError("delete candidate audit", err)
	}
	if entity == EntityCustomer {
		if err = qtx.DeleteBobCustomerCreditLimits(ctx, input.VersionID); err != nil {
			return s.writeError("delete customer candidate credit", err)
		}
		rows, err = qtx.DeleteBobCustomerDetail(ctx, input.VersionID)
	} else {
		rows, err = qtx.DeleteBobSupplierDetail(ctx, input.VersionID)
	}
	if err != nil || rows != 1 {
		return s.writeError("delete candidate detail", err)
	}
	if entity == EntityCustomer {
		rows, err = qtx.DeleteBobCustomerVersion(ctx, dbsqlc.DeleteBobCustomerVersionParams{VersionID: input.VersionID, ObjectID: input.ObjectID})
	} else {
		rows, err = qtx.DeleteBobSupplierVersion(ctx, dbsqlc.DeleteBobSupplierVersionParams{VersionID: input.VersionID, ObjectID: input.ObjectID})
	}
	if err != nil || rows != 1 {
		return s.writeError("delete candidate version", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return s.writeError("commit candidate delete", err)
	}
	return nil
}

func loadStoredSupplierReference(ctx context.Context, q *dbsqlc.Queries, versionID string, data *DetailView) error {
	row, err := q.GetStoredBobSupplierValidationData(ctx, versionID)
	if err != nil {
		return err
	}
	data.SettlementMethodID = row.SettlementMethodID
	data.SettlementMethodCode = row.SettlementMethodCode
	data.SettlementMethodName = row.SettlementMethodName
	data.TermCode = row.SettlementTermCode
	data.RuleType = row.SettlementRuleType
	data.MonthOffset = row.SettlementMonthOffset
	data.DayOffset = row.SettlementDayOffset
	data.DueDays = row.SettlementDayOffset
	data.CutoffDay = row.SettlementDayOfMonth
	data.DefaultPurchaserEmployeeID = row.DefaultPurchaserEmployeeID
	if row.SettlementDayOfMonth > 0 {
		data.DayOfMonth = &row.SettlementDayOfMonth
	}
	return nil
}

func (s *Service) Submit(ctx context.Context, entity string, input VersionRevisionInput, actorID, requestID string) (MutationResult, error) {
	if !validWriteInput(entity, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid submit request", nil, nil)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || (!hasEffectiveCandidate(entity, object) && object.EffectiveVersionID != nil) || version.Revision != input.Revision ||
		version.Status != StatusDraft {
		return MutationResult{}, conflict(object, version, "version changed before submit")
	}
	if err = s.validateStoredDetail(ctx, tx, qtx, entity, input.ObjectID, input.VersionID); err != nil {
		return MutationResult{}, err
	}
	rows, err := qtx.SubmitBobVersion(ctx, dbsqlc.SubmitBobVersionParams{
		ActorID: &actorID, ID: input.VersionID, ObjectID: input.ObjectID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("submit version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "version changed before submit")
	}
	if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: entity}); err != nil {
		return MutationResult{}, s.internal("touch object", err)
	}
	from := version.Status
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: entity, Event: "SUBMITTED", From: &from, To: StatusPending,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit submit", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit submit", err)
	}
	return mutation(object, version, StatusPending, input.Revision+1), nil
}

func (s *Service) Approve(ctx context.Context, entity string, input ReviewInput, actorID, requestID string) (MutationResult, error) {
	comment, err := optionalComment(input.Comment)
	if err != nil || !validWriteInput(entity, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid approval request", nil, err)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if hasEffectiveCandidate(entity, object) {
		return s.approveEffectiveCandidate(ctx, tx, qtx, entity, object, version, input, actorID, requestID, comment)
	}
	if object.CurrentVersionID != input.VersionID || object.EffectiveVersionID != nil || version.Status != StatusPending || version.Revision != input.Revision {
		return MutationResult{}, conflict(object, version, "version changed before approval")
	}
	if version.SubmittedBy == nil || (*version.SubmittedBy == actorID && !systemidentity.IsUser(actorID)) {
		return MutationResult{}, domainError(ErrorConflict, "submitter cannot review the same version", conflictData(object, version), nil)
	}
	if err = s.validateStoredDetail(ctx, tx, qtx, entity, input.ObjectID, input.VersionID); err != nil {
		return MutationResult{}, err
	}
	rows, err := qtx.ApproveBobVersion(ctx, dbsqlc.ApproveBobVersionParams{
		ActorID: &actorID, Comment: comment, ID: input.VersionID, ObjectID: input.ObjectID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("approve version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "version changed before approval")
	}
	rows, err = qtx.SetBobObjectEffective(ctx, dbsqlc.SetBobObjectEffectiveParams{
		VersionID: &input.VersionID, ActorID: actorID, ID: input.ObjectID, Entity: entity, Revision: object.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("set effective version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "object changed before approval")
	}
	from := StatusPending
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: entity, Event: "APPROVED", From: &from, To: StatusEffective,
		ActorID: actorID, RequestID: requestID, Comment: comment,
	}); err != nil {
		return MutationResult{}, s.writeError("audit approval", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit approval", err)
	}
	result := mutation(object, version, StatusEffective, input.Revision+1)
	result.ObjectRevision++
	return result, nil
}

func (s *Service) Reject(ctx context.Context, entity string, input ReviewInput, actorID, requestID string) (MutationResult, error) {
	comment, err := requiredComment(input.Comment)
	if err != nil || !validWriteInput(entity, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid rejection request", nil, err)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || (!hasEffectiveCandidate(entity, object) && object.EffectiveVersionID != nil) || version.Status != StatusPending || version.Revision != input.Revision {
		return MutationResult{}, conflict(object, version, "version changed before rejection")
	}
	if version.SubmittedBy == nil || (*version.SubmittedBy == actorID && !systemidentity.IsUser(actorID)) {
		return MutationResult{}, domainError(ErrorConflict, "submitter cannot review the same version", conflictData(object, version), nil)
	}
	rows, err := qtx.RejectBobVersion(ctx, dbsqlc.RejectBobVersionParams{
		ActorID: actorID, ID: input.VersionID, ObjectID: input.ObjectID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("reject version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "version changed before rejection")
	}
	if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: entity}); err != nil {
		return MutationResult{}, s.internal("touch object", err)
	}
	from := StatusPending
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: entity, Event: "REJECTED", From: &from, To: StatusDraft,
		ActorID: actorID, RequestID: requestID, Comment: comment,
	}); err != nil {
		return MutationResult{}, s.writeError("audit rejection", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit rejection", err)
	}
	return mutation(object, version, StatusDraft, input.Revision+1), nil
}

func (s *Service) Unsubmit(ctx context.Context, entity string, input ReverseInput, actorID, requestID string) (MutationResult, error) {
	reason, err := requiredComment(&input.Reason)
	if err != nil || !validReverseInput(entity, input, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid unsubmit request", nil, err)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.Revision != input.ObjectRevision || object.CurrentVersionID != input.VersionID ||
		(!hasEffectiveCandidate(entity, object) && object.EffectiveVersionID != nil) || version.Revision != input.Revision || version.Status != StatusPending {
		return MutationResult{}, conflict(object, version, "version changed before unsubmit")
	}
	rows, err := qtx.UnsubmitBobVersion(ctx, dbsqlc.UnsubmitBobVersionParams{
		ActorID: actorID, ID: input.VersionID, ObjectID: input.ObjectID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("unsubmit version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "version changed before unsubmit")
	}
	if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: entity}); err != nil {
		return MutationResult{}, s.internal("touch object", err)
	}
	from := StatusPending
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: entity, Event: "UNSUBMITTED",
		From: &from, To: StatusDraft, ActorID: actorID, RequestID: requestID, Comment: reason,
	}); err != nil {
		return MutationResult{}, s.writeError("audit unsubmit", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit unsubmit", err)
	}
	return mutation(object, version, StatusDraft, input.Revision+1), nil
}

func hasEffectiveCandidate(entity string, object dbsqlc.LockBobObjectRow) bool {
	return (entity == EntityCustomer || entity == EntitySupplier) && object.EffectiveVersionID != nil &&
		object.CurrentVersionID != *object.EffectiveVersionID
}

func (s *Service) approveEffectiveCandidate(
	ctx context.Context, tx pgx.Tx, qtx *dbsqlc.Queries, entity string, object dbsqlc.LockBobObjectRow,
	version dbsqlc.LockBobVersionRow, input ReviewInput, actorID, requestID string, comment *string,
) (MutationResult, error) {
	if object.CurrentVersionID != input.VersionID || object.EffectiveVersionID == nil ||
		version.Status != StatusPending || version.Revision != input.Revision {
		return MutationResult{}, conflict(object, version, entity+" changed before approval")
	}
	if version.SubmittedBy == nil || (*version.SubmittedBy == actorID && !systemidentity.IsUser(actorID)) {
		return MutationResult{}, domainError(ErrorConflict, "submitter cannot review the same version", conflictData(object, version), nil)
	}
	if err := s.validateStoredDetail(ctx, tx, qtx, entity, input.ObjectID, input.VersionID); err != nil {
		return MutationResult{}, err
	}
	oldVersion, err := qtx.LockBobVersion(ctx, dbsqlc.LockBobVersionParams{
		ID: *object.EffectiveVersionID, ObjectID: input.ObjectID, Entity: entity,
	})
	if err != nil || oldVersion.Status != StatusEffective {
		return MutationResult{}, conflict(object, version, entity+" effective version changed before approval")
	}
	rows, err := qtx.InvalidateBobVersion(ctx, dbsqlc.InvalidateBobVersionParams{
		ActorID: actorID, ID: oldVersion.ID, ObjectID: input.ObjectID, Entity: entity, Revision: oldVersion.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("freeze effective version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, entity+" effective version changed before approval")
	}
	rows, err = qtx.ApproveBobVersion(ctx, dbsqlc.ApproveBobVersionParams{
		ActorID: &actorID, Comment: comment, ID: input.VersionID, ObjectID: input.ObjectID,
		Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("approve candidate", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, entity+" changed before approval")
	}
	newVersionID, oldVersionID := input.VersionID, oldVersion.ID
	rows, err = qtx.SwitchBobEffectiveCandidate(ctx, dbsqlc.SwitchBobEffectiveCandidateParams{
		NewVersionID: &newVersionID, ActorID: actorID, ID: input.ObjectID,
		Entity: entity, OldVersionID: &oldVersionID, Revision: object.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("switch effective version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, entity+" changed before approval")
	}
	fromEffective := StatusEffective
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: input.ObjectID, VersionID: oldVersion.ID,
		Entity: entity, Event: "INVALIDATED", From: &fromEffective, To: StatusInvalid,
		ActorID: actorID, RequestID: requestID, Summary: map[string]any{"replacementVersionId": input.VersionID}}); err != nil {
		return MutationResult{}, s.writeError("audit replaced version", err)
	}
	fromPending := StatusPending
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: input.ObjectID, VersionID: input.VersionID,
		Entity: entity, Event: "APPROVED", From: &fromPending, To: StatusEffective,
		ActorID: actorID, RequestID: requestID, Comment: comment,
		Summary: map[string]any{"replacedVersionId": oldVersion.ID}}); err != nil {
		return MutationResult{}, s.writeError("audit candidate approval", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit candidate approval", err)
	}
	return MutationResult{ObjectID: input.ObjectID, ObjectRevision: object.Revision + 1, Enabled: object.Enabled,
		VersionID: input.VersionID, Version: version.VersionNo, Status: StatusEffective, Revision: input.Revision + 1}, nil
}

func (s *Service) Unapprove(ctx context.Context, entity string, input ReverseInput, actorID, requestID string) (MutationResult, error) {
	reason, err := requiredComment(&input.Reason)
	if err != nil || !validReverseInput(entity, input, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid unapprove request", nil, err)
	}
	if entity == EntityCustomer || entity == EntitySupplier {
		return MutationResult{}, domainError(ErrorConflict, "continuous-effective objects are edited through candidate save", nil, nil)
	}
	tx, qtx, object, oldVersion, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.Revision != input.ObjectRevision || object.CurrentVersionID != input.VersionID ||
		object.EffectiveVersionID == nil || *object.EffectiveVersionID != input.VersionID ||
		oldVersion.Revision != input.Revision || oldVersion.Status != StatusEffective ||
		!oldVersion.SubmittedAt.Valid || oldVersion.SubmittedBy == nil {
		return MutationResult{}, conflict(object, oldVersion, "version changed before unapprove")
	}
	newVersionID := newID()
	if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{
		ID: newVersionID, ObjectID: input.ObjectID, Entity: entity, VersionNo: object.NextVersionNo, ActorID: actorID,
	}); err != nil {
		return MutationResult{}, s.writeError("insert unapproved version", err)
	}
	if err = copyDetail(ctx, qtx, entity, newVersionID, oldVersion.ID); err != nil {
		return MutationResult{}, s.writeError("copy unapproved detail", err)
	}
	rows, err := qtx.MarkBobVersionPendingCopy(ctx, dbsqlc.MarkBobVersionPendingCopyParams{
		SubmittedAt: oldVersion.SubmittedAt, SubmittedBy: oldVersion.SubmittedBy,
		ActorID: actorID, ID: newVersionID, ObjectID: input.ObjectID, Entity: entity,
	})
	if err != nil {
		return MutationResult{}, s.writeError("mark unapproved version pending", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, oldVersion, "new version changed before unapprove")
	}
	rows, err = qtx.InvalidateBobVersion(ctx, dbsqlc.InvalidateBobVersionParams{
		ActorID: actorID, ID: oldVersion.ID, ObjectID: input.ObjectID, Entity: entity, Revision: oldVersion.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("freeze effective version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, oldVersion, "effective version changed before unapprove")
	}
	rows, err = qtx.AdvanceBobObjectForUnapprove(ctx, dbsqlc.AdvanceBobObjectForUnapproveParams{
		NewVersionID: newVersionID, ActorID: actorID, ID: input.ObjectID, Entity: entity,
		Revision: input.ObjectRevision, OldVersionID: oldVersion.ID,
	})
	if err != nil {
		return MutationResult{}, s.writeError("advance object for unapprove", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, oldVersion, "object changed before unapprove")
	}
	fromEffective := StatusEffective
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: oldVersion.ID, Entity: entity, Event: "INVALIDATED",
		From: &fromEffective, To: StatusInvalid, ActorID: actorID, RequestID: requestID, Comment: reason,
	}); err != nil {
		return MutationResult{}, s.writeError("audit frozen version", err)
	}
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: newVersionID, Entity: entity, Event: "UNAPPROVED",
		From: &fromEffective, To: StatusPending, ActorID: actorID, RequestID: requestID, Comment: reason,
		Summary: map[string]any{"sourceVersionId": oldVersion.ID},
	}); err != nil {
		return MutationResult{}, s.writeError("audit unapprove", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit unapprove", err)
	}
	return MutationResult{
		ObjectID: input.ObjectID, ObjectRevision: input.ObjectRevision + 1, Enabled: object.Enabled,
		VersionID: newVersionID, Version: object.NextVersionNo, Status: StatusPending, Revision: 2,
	}, nil
}

func (s *Service) SetEnabled(
	ctx context.Context, entity string, input ObjectRevisionInput, enabled bool, actorID, requestID string,
) (MutationResult, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || input.ObjectRevision < 1 || !validActorAndRequest(actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid availability request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin availability change", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ID: input.ObjectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock object", err)
	}
	if object.Revision != input.ObjectRevision || object.EffectiveVersionID == nil ||
		(!hasEffectiveCandidate(entity, object) && object.CurrentVersionID != *object.EffectiveVersionID) || object.Enabled == enabled {
		return MutationResult{}, domainError(ErrorConflict, "object availability changed", map[string]any{
			"objectRevision": object.Revision, "enabled": object.Enabled,
		}, nil)
	}
	version, err := qtx.LockBobVersion(ctx, dbsqlc.LockBobVersionParams{
		ID: *object.EffectiveVersionID, ObjectID: input.ObjectID, Entity: entity,
	})
	if err != nil {
		return MutationResult{}, s.internal("lock effective version", err)
	}
	if version.Status != StatusEffective {
		return MutationResult{}, conflict(object, version, "object is not effective")
	}
	if !enabled {
		uses, scanErr := listDirectReferenceUses(ctx, qtx, entity, input.ObjectID)
		if scanErr != nil {
			return MutationResult{}, s.internal("scan direct references before disable", scanErr)
		}
		if len(uses) > 0 {
			type referenceCount struct {
				Entity string `json:"entity"`
				Field  string `json:"field"`
				Count  int    `json:"count"`
			}
			grouped := make(map[string]*referenceCount)
			for _, use := range uses {
				key := use.entity + "\x00" + use.role
				if grouped[key] == nil {
					grouped[key] = &referenceCount{Entity: use.entity, Field: use.role}
				}
				grouped[key].Count++
			}
			counts := make([]referenceCount, 0, len(grouped))
			for _, count := range grouped {
				counts = append(counts, *count)
			}
			sort.Slice(counts, func(left, right int) bool {
				if counts[left].Entity != counts[right].Entity {
					return counts[left].Entity < counts[right].Entity
				}
				return counts[left].Field < counts[right].Field
			})
			return MutationResult{}, domainError(ErrorConflict, "object has active direct references", map[string]any{
				"references": counts,
			}, nil)
		}
	}
	rows, err := qtx.SetBobObjectEnabled(ctx, dbsqlc.SetBobObjectEnabledParams{
		Enabled: enabled, ActorID: actorID, ID: input.ObjectID, Entity: entity, Revision: input.ObjectRevision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("change object availability", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "object availability changed")
	}
	event := "DISABLED"
	if enabled {
		event = "ENABLED"
	}
	from := StatusEffective
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: version.ID, Entity: entity, Event: event,
		From: &from, To: StatusEffective, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"enabled": enabled},
	}); err != nil {
		return MutationResult{}, s.writeError("audit availability change", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit availability change", err)
	}
	result := mutation(object, version, StatusEffective, version.Revision)
	result.ObjectRevision++
	result.Enabled = enabled
	return result, nil
}

func (s *Service) Enable(
	ctx context.Context, entity string, input ObjectRevisionInput, actorID, requestID string,
) (MutationResult, error) {
	return s.SetEnabled(ctx, entity, input, true, actorID, requestID)
}

func (s *Service) Disable(
	ctx context.Context, entity string, input ObjectRevisionInput, actorID, requestID string,
) (MutationResult, error) {
	return s.SetEnabled(ctx, entity, input, false, actorID, requestID)
}

func (s *Service) Versions(ctx context.Context, entity string, input HistoryInput) (Page[VersionHistoryItem], error) {
	if !validHistoryInput(entity, input) {
		return Page[VersionHistoryItem]{}, domainError(ErrorValidation, "invalid versions request", nil, nil)
	}
	if _, err := s.Get(ctx, entity, GetInput{ObjectID: input.ObjectID}); err != nil {
		return Page[VersionHistoryItem]{}, err
	}
	total, err := s.queries.CountBobVersions(ctx, dbsqlc.CountBobVersionsParams{ObjectID: input.ObjectID, Entity: entity})
	if err != nil {
		return Page[VersionHistoryItem]{}, s.internal("count versions", err)
	}
	rows, err := s.queries.ListBobVersions(ctx, dbsqlc.ListBobVersionsParams{
		ObjectID: input.ObjectID, Entity: entity, PageOffset: mustPageOffset(input.Page, input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[VersionHistoryItem]{}, s.internal("list versions", err)
	}
	items := make([]VersionHistoryItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, versionHistoryItem(row))
	}
	return Page[VersionHistoryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) AuditHistory(ctx context.Context, entity string, input HistoryInput) (Page[AuditEventView], error) {
	if !validHistoryInput(entity, input) {
		return Page[AuditEventView]{}, domainError(ErrorValidation, "invalid audit history request", nil, nil)
	}
	if _, err := s.Get(ctx, entity, GetInput{ObjectID: input.ObjectID}); err != nil {
		return Page[AuditEventView]{}, err
	}
	total, err := s.queries.CountBobAuditEvents(ctx, dbsqlc.CountBobAuditEventsParams{ObjectID: input.ObjectID, Entity: entity})
	if err != nil {
		return Page[AuditEventView]{}, s.internal("count audit events", err)
	}
	rows, err := s.queries.ListBobAuditEvents(ctx, dbsqlc.ListBobAuditEventsParams{
		ObjectID: input.ObjectID, Entity: entity, PageOffset: mustPageOffset(input.Page, input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[AuditEventView]{}, s.internal("list audit events", err)
	}
	items := make([]AuditEventView, 0, len(rows))
	for _, row := range rows {
		items = append(items, auditEventView(row))
	}
	return Page[AuditEventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

// ResolveEffectiveReference must be called with the transaction that will write
// the consuming business record. The shared row lock is held until that
// transaction finishes, preventing a concurrent edit from invalidating the
// reference between validation and the consuming write.
func (s *Service) ResolveEffectiveReference(ctx context.Context, tx pgx.Tx, entity, objectID, versionID string) (EffectiveReference, error) {
	if !validEntity(entity) || !validID(objectID) || !validID(versionID) {
		return EffectiveReference{}, domainError(ErrorValidation, "invalid effective reference", nil, nil)
	}
	if auxiliaryEntity(entity) && s.auxiliaryResolver != nil {
		return s.resolveAuxiliaryReference(ctx, tx, entity, objectID, versionID)
	}
	row, err := s.queries.WithTx(tx).ResolveBobEffectiveReference(ctx, dbsqlc.ResolveBobEffectiveReferenceParams{
		ObjectID: objectID, Entity: entity, VersionID: versionID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "version is not currently effective", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve effective reference", err)
	}
	if entity == EntityVehicle {
		if err = s.validatePlatformReference(ctx, s.queries.WithTx(tx), deref(row.PlatformObjectID)); err != nil {
			return EffectiveReference{}, err
		}
	}
	data := effectiveReferenceDetail(row)
	if entity == EntityCustomer {
		if err = loadStoredCustomerSettlement(ctx, s.queries.WithTx(tx), row.ObjectID, row.VersionID, &data); err != nil {
			return EffectiveReference{}, s.internal("read customer settlement snapshot", err)
		}
	}
	if entity == EntitySupplier {
		if err = loadStoredSupplierReference(ctx, s.queries.WithTx(tx), row.VersionID, &data); err != nil {
			return EffectiveReference{}, s.internal("read supplier defaults", err)
		}
	}
	if entity == EntityFundAccount {
		if err = loadFundAccountOperating(ctx, s.queries.WithTx(tx), row.VersionID, &data); err != nil {
			return EffectiveReference{}, s.internal("read fund account operating entity", err)
		}
	}
	if entity == EntityProduct {
		data.Formula, err = loadProductFormula(ctx, s.queries.WithTx(tx), row.VersionID)
		if err != nil {
			return EffectiveReference{}, s.internal("read effective product formula", err)
		}
	}
	if entity == EntityCustomer || entity == EntityOtherParty {
		if err := s.validateDictionaryCode(ctx, tx, data.CustomerType, "DCT-0001"); err != nil {
			return EffectiveReference{}, err
		}
	}
	if entity == EntityVehicle {
		if err := s.validateDictionaryCode(ctx, tx, data.VehicleType, "DCT-0002"); err != nil {
			return EffectiveReference{}, err
		}
	}
	return EffectiveReference{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, VersionID: row.VersionID,
		Data: data,
	}, nil
}

func (s *Service) validateDictionaryCode(
	ctx context.Context, tx pgx.Tx, code, dictionaryTypeCode string,
) error {
	if s.auxiliaryResolver == nil {
		// Legacy/internal callers can construct BOB in isolation. The HTTP
		// server always configures AUX and therefore enforces dictionary codes.
		return nil
	}
	reference, err := s.auxiliaryResolver.ResolveAuxiliaryCode(ctx, tx, "dictionary-item", code)
	if err != nil || mapString(reference.Data, "dictionaryTypeCode") != dictionaryTypeCode {
		return domainError(ErrorConflict, "dictionary item is unavailable", nil, err)
	}
	return nil
}

// ResolveCurrentEffectiveReference resolves an object's current effective
// version without requiring callers to already know its version ID.
func (s *Service) ResolveCurrentEffectiveReference(
	ctx context.Context, tx pgx.Tx, entity, objectID string,
) (EffectiveReference, error) {
	if !validEntity(entity) || !validID(objectID) {
		return EffectiveReference{}, domainError(ErrorValidation, "invalid current effective reference", nil, nil)
	}
	if auxiliaryEntity(entity) {
		return s.resolveAuxiliaryReference(ctx, tx, entity, objectID, "")
	}
	row, err := s.queries.WithTx(tx).ResolveCurrentBobEffectiveReference(
		ctx,
		dbsqlc.ResolveCurrentBobEffectiveReferenceParams{ObjectID: objectID, Entity: entity},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "object is not currently effective", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve current effective reference", err)
	}
	if entity == EntityVehicle {
		if err = s.validatePlatformReference(ctx, s.queries.WithTx(tx), deref(row.PlatformObjectID)); err != nil {
			return EffectiveReference{}, err
		}
	}
	data := effectiveReferenceDetail(row)
	if entity == EntityCustomer {
		if err = loadStoredCustomerSettlement(ctx, s.queries.WithTx(tx), row.ObjectID, row.VersionID, &data); err != nil {
			return EffectiveReference{}, s.internal("read customer settlement snapshot", err)
		}
	}
	if entity == EntitySupplier {
		if err = loadStoredSupplierReference(ctx, s.queries.WithTx(tx), row.VersionID, &data); err != nil {
			return EffectiveReference{}, s.internal("read supplier defaults", err)
		}
	}
	if entity == EntityFundAccount {
		if err = loadFundAccountOperating(ctx, s.queries.WithTx(tx), row.VersionID, &data); err != nil {
			return EffectiveReference{}, s.internal("read fund account operating entity", err)
		}
	}
	if entity == EntityProduct {
		data.Formula, err = loadProductFormula(ctx, s.queries.WithTx(tx), row.VersionID)
		if err != nil {
			return EffectiveReference{}, s.internal("read current effective product formula", err)
		}
	}
	return EffectiveReference{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, VersionID: row.VersionID,
		Data: data,
	}, nil
}

func (s *Service) lockTarget(ctx context.Context, entity, objectID, versionID string) (
	pgx.Tx, *dbsqlc.Queries, dbsqlc.LockBobObjectRow, dbsqlc.LockBobVersionRow, error,
) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, dbsqlc.LockBobObjectRow{}, dbsqlc.LockBobVersionRow{}, s.internal("begin transaction", err)
	}
	qtx := s.queries.WithTx(tx)
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ID: objectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		tx.Rollback(ctx) //nolint:errcheck
		return nil, nil, object, dbsqlc.LockBobVersionRow{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		tx.Rollback(ctx) //nolint:errcheck
		return nil, nil, object, dbsqlc.LockBobVersionRow{}, s.internal("lock object", err)
	}
	version, err := qtx.LockBobVersion(ctx, dbsqlc.LockBobVersionParams{ID: versionID, ObjectID: objectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		tx.Rollback(ctx) //nolint:errcheck
		return nil, nil, object, version, domainError(ErrorValidation, "version not found", nil, nil)
	}
	if err != nil {
		tx.Rollback(ctx) //nolint:errcheck
		return nil, nil, object, version, s.internal("lock version", err)
	}
	return tx, qtx, object, version, nil
}

func (s *Service) validateStoredDetail(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, entity, objectID, versionID string) error {
	if entity == EntityCustomer {
		specialized, err := q.BobObjectIsCustomerAccount(ctx, objectID)
		if err != nil {
			return s.internal("classify stored customer", err)
		}
		if specialized {
			return s.validateStoredCustomer(ctx, tx, versionID)
		}
	}
	if entity == EntitySupplier {
		return s.validateStoredSupplier(ctx, tx, q, versionID)
	}
	if entity == EntityOperatingEntity {
		row, err := q.GetStoredBobOperatingEntityDetail(ctx, versionID)
		if err != nil {
			return s.internal("read stored operating entity", err)
		}
		data := DetailView{Name: row.LegalName, ShortName: row.ShortName, TaxNumber: row.TaxNumber, Address: row.Address, Phone: row.Phone, Remark: row.Remark}
		_, err = validateDetailData(entity, data)
		return err
	}
	row, err := q.GetBobVersionView(ctx, dbsqlc.GetBobVersionViewParams{ObjectID: objectID, Entity: entity, VersionID: versionID})
	if err != nil {
		return s.internal("read stored detail", err)
	}
	data := detailView(row)
	if entity == EntityFundAccount {
		if err = loadFundAccountOperating(ctx, q, versionID, &data); err != nil {
			return s.internal("read stored fund account operating entity", err)
		}
	}
	if entity == EntityProduct {
		data.Formula, err = loadProductFormula(ctx, q, versionID)
		if err != nil {
			return s.internal("read stored product formula", err)
		}
	}
	data, err = validateDetailData(entity, data)
	if err != nil {
		return err
	}
	return s.validateDetailReferences(ctx, tx, q, entity, objectID, data)
}

func (s *Service) validateStoredSupplier(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, versionID string) error {
	row, err := q.GetStoredBobSupplierValidationData(ctx, versionID)
	if err != nil {
		return s.internal("read stored supplier", err)
	}
	data := SupplierData{SettlementMethodID: row.SettlementMethodID,
		DefaultPurchaserEmployeeID: row.DefaultPurchaserEmployeeID}
	if row.SettlementMethodID != "" {
		data.SettlementMethod = &SupplierSettlementSnapshot{SourceObjectID: row.SettlementMethodID,
			Code: row.SettlementMethodCode, Name: row.SettlementMethodName, TermCode: row.SettlementTermCode,
			RuleType: row.SettlementRuleType, MonthOffset: row.SettlementMonthOffset,
			DayOfMonth: row.SettlementDayOfMonth, DayOffset: row.SettlementDayOffset}
	}
	if err = validateSupplierEffective(data); err != nil {
		return domainError(ErrorConflict, "supplier transaction defaults are incomplete", nil, err)
	}
	if _, err = s.ResolveCurrentEffectiveReference(ctx, tx, EntityEmployee, row.DefaultPurchaserEmployeeID); err != nil {
		return domainError(ErrorConflict, "default purchaser reference is unavailable", nil, err)
	}
	return nil
}

func (s *Service) validateStoredCustomer(ctx context.Context, tx pgx.Tx, versionID string) error {
	row, err := s.queries.WithTx(tx).GetStoredBobCustomerValidationData(ctx, versionID)
	if err != nil {
		return s.internal("read stored customer", err)
	}
	var policy PricingPolicy
	if err = json.Unmarshal(row.PricingPolicy, &policy); err != nil {
		return domainError(ErrorValidation, "invalid customer pricing policy", nil, err)
	}
	if _, err = normalizePricingPolicy(policy); err != nil {
		return domainError(ErrorValidation, "invalid customer pricing policy", nil, err)
	}
	if row.OperatingEntityID == "" || row.OperatingEntityCode == "" || row.OperatingEntityName == "" || row.SettlementMethodID == "" || row.SettlementMethodCode == "" || row.SettlementMethodName == "" || row.PaymentMethodID == "" || row.PaymentMethodCode == "" || row.PaymentMethodName == "" || row.DefaultTransportMethodCode == "" || row.DefaultTransportMethodName == "" {
		return domainError(ErrorConflict, "customer transaction defaults are incomplete", nil, nil)
	}
	if err = s.validateDictionaryCode(ctx, tx, row.CustomerType, "DCT-0001"); err != nil {
		return err
	}
	targetEntity := EntityEmployee
	if deref(row.PrimarySalesAttributionType) != SalesAttributionInternalEmployee {
		targetEntity = EntityOtherParty
	}
	_, err = s.ResolveCurrentEffectiveReference(ctx, tx, targetEntity, deref(row.PrimarySalesSubjectID))
	return err
}

func effectiveReferenceDetail(row dbsqlc.BobVersionView) DetailView {
	data := detailView(row)
	data.AccountNumber = ""
	return data
}

func (s *Service) validateDetailReferences(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	entity string,
	objectID string,
	data DetailView,
) error {
	if entity == EntityVehicle {
		if err := s.validatePlatformReference(ctx, q, data.PlatformObjectID); err != nil {
			return err
		}
	}
	if entity == EntityCustomer || entity == EntityOtherParty {
		if err := s.validateDictionaryCode(ctx, tx, data.CustomerType, "DCT-0001"); err != nil {
			return err
		}
	}
	if entity == EntityVehicle {
		if err := s.validateDictionaryCode(ctx, tx, data.VehicleType, "DCT-0002"); err != nil {
			return err
		}
	}
	if data.CategoryID != "" {
		if entity != EntityProduct {
			return domainError(ErrorValidation, "category is only supported for products", nil, nil)
		}
		if s.auxiliaryResolver != nil {
			if _, err := s.resolveAuxiliaryReference(ctx, tx, EntityCategory, data.CategoryID, ""); err != nil {
				return err
			}
		} else if _, err := q.LockEffectiveBobReference(ctx, dbsqlc.LockEffectiveBobReferenceParams{
			ObjectID: data.CategoryID, Entity: EntityCategory,
		}); err != nil {
			return domainError(ErrorConflict, "category reference is unavailable", nil, err)
		}
	}
	if entity == EntityProduct && data.Formula != nil {
		for _, component := range data.Formula.Components {
			if component.Material.ObjectID == objectID {
				return domainError(ErrorValidation, "product formula cannot reference itself", nil, nil)
			}
			material, referenceErr := s.ResolveEffectiveReference(
				ctx, tx, EntityProduct,
				component.Material.ObjectID, component.Material.VersionID,
			)
			if referenceErr != nil {
				return referenceErr
			}
			if material.Data.ProductKind != ProductKindRawMaterial {
				return domainError(ErrorConflict, "formula component must reference a raw material", nil, nil)
			}
		}
	}
	if (entity == EntityProduct || entity == EntityService) && s.auxiliaryResolver != nil {
		inventoryUnit, err := s.resolveNamedAuxiliaryReference(
			ctx, tx, "measurement-unit", data.InventoryUnitID, "",
		)
		if err != nil {
			return err
		}
		if entity == EntityProduct {
			pricingUnit, resolveErr := s.resolveNamedAuxiliaryReference(
				ctx, tx, "measurement-unit", data.PricingUnitID, "",
			)
			if resolveErr != nil {
				return resolveErr
			}
			if data.ProductKind != ProductKindPackaging && pricingUnit.Code != kilogramMeasurementUnitCode {
				return domainError(ErrorConflict, "goods pricing unit must be KG", nil, nil)
			}
			if data.ProductKind == ProductKindPackaging && pricingUnit.ObjectID != inventoryUnit.ObjectID {
				return domainError(ErrorConflict, "packaging pricing unit must match inventory unit", nil, nil)
			}
			for _, spec := range data.PackagingSpecs {
				if spec.PackagingProductObjectID == objectID {
					return domainError(ErrorValidation, "product cannot package itself", nil, nil)
				}
				packaging, referenceErr := s.ResolveEffectiveReference(
					ctx, tx, EntityProduct,
					spec.PackagingProductObjectID, spec.PackagingProductVersionID,
				)
				if referenceErr != nil {
					return referenceErr
				}
				if packaging.Data.ProductKind != ProductKindPackaging {
					return domainError(ErrorConflict, "packaging specification must reference a packaging product", nil, nil)
				}
			}
		}
	}
	type reference struct {
		entity string
		id     string
	}
	references := make([]reference, 0, 4)
	add := func(targetEntity, id string) {
		if id != "" {
			references = append(references, reference{entity: targetEntity, id: id})
		}
	}
	add(EntityDepartment, data.DepartmentID)
	add(EntityPosition, data.PositionID)
	add(EntityEmployee, data.ManagerEmployeeID)
	add(EntityOperatingEntity, data.OperatingEntityID)
	add(EntitySettlementMethod, data.SettlementMethodID)
	add(EntityEmployee, data.SalespersonEmployeeID)
	add(EntityEmployee, data.DefaultPurchaserEmployeeID)
	add(EntityOtherParty, data.IntermediaryOtherPartyID)
	if entity == EntityDepartment {
		add(EntityDepartment, data.ParentID)
	}
	slices.SortFunc(references, func(left, right reference) int {
		if compared := strings.Compare(left.id, right.id); compared != 0 {
			return compared
		}
		return strings.Compare(left.entity, right.entity)
	})
	for _, target := range references {
		if target.id == objectID {
			return domainError(ErrorValidation, "object cannot reference itself", nil, nil)
		}
		if auxiliaryEntity(target.entity) {
			if s.auxiliaryResolver != nil {
				if _, err := s.resolveAuxiliaryReference(ctx, tx, target.entity, target.id, ""); err != nil {
					return err
				}
				continue
			}
		}
		if _, err := q.LockEffectiveBobReference(ctx, dbsqlc.LockEffectiveBobReferenceParams{
			ObjectID: target.id, Entity: target.entity,
		}); errors.Is(err, pgx.ErrNoRows) {
			return domainError(ErrorConflict, target.entity+" reference is not currently effective", nil, nil)
		} else if err != nil {
			return s.internal("lock "+target.entity+" reference", err)
		}
	}
	return nil
}

func loadFundAccountOperating(ctx context.Context, q *dbsqlc.Queries, versionID string, data *DetailView) error {
	row, err := q.GetFundAccountOperatingDetail(ctx, versionID)
	if err != nil {
		return err
	}
	data.OperatingEntityID, data.OperatingEntityVersionID, data.OperatingEntityCode, data.OperatingEntityName = row.OperatingEntityID, row.OperatingEntityVersionID, row.OperatingEntityCode, row.OperatingEntityName
	return nil
}

func loadStoredCustomerSettlement(ctx context.Context, q *dbsqlc.Queries, objectID, versionID string, data *DetailView) error {
	row, err := q.GetStoredCustomerSettlement(ctx, dbsqlc.GetStoredCustomerSettlementParams{ObjectID: objectID, VersionID: versionID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	data.SettlementMethodID, data.SettlementMethodCode, data.SettlementMethodName, data.TermCode, data.RuleType = row.SettlementMethodID, row.SettlementMethodCode, row.SettlementMethodName, row.SettlementTermCode, row.SettlementRuleType
	data.DueDays, data.MonthOffset, data.CutoffDay = row.SettlementDueDays, row.SettlementMonthOffset, row.SettlementCutoffDay
	data.DayOffset = data.DueDays
	data.DefaultSalesSurcharge = formatMoneyCents(row.SettlementSalesSurchargeCents)
	data.SettlementMethodVersionID = ""
	return nil
}

func (s *Service) resolveGenericCustomerSettlement(
	ctx context.Context, tx pgx.Tx, data DetailView,
) (DetailView, error) {
	if data.SettlementMethodID == "" {
		return data, nil
	}
	var reference EffectiveReference
	var err error
	if s.auxiliaryResolver != nil {
		reference, err = s.resolveAuxiliaryReference(
			ctx, tx, EntitySettlementMethod, data.SettlementMethodID, "",
		)
	} else {
		var row dbsqlc.BobVersionView
		row, err = s.queries.WithTx(tx).ResolveCurrentBobEffectiveReference(
			ctx,
			dbsqlc.ResolveCurrentBobEffectiveReferenceParams{
				ObjectID: data.SettlementMethodID,
				Entity:   EntitySettlementMethod,
			},
		)
		if err == nil {
			reference = EffectiveReference{
				ObjectID:  row.ObjectID,
				VersionID: row.VersionID,
				Entity:    row.Entity,
				Code:      row.Code,
				Data:      effectiveReferenceDetail(row),
			}
		}
	}
	if err != nil {
		return DetailView{}, domainError(ErrorConflict, "settlement-method reference is unavailable", nil, err)
	}
	data.SettlementMethodCode = reference.Code
	data.SettlementMethodName = reference.Data.Name
	data.TermCode = reference.Data.TermCode
	data.RuleType = reference.Data.RuleType
	data.MonthOffset = reference.Data.MonthOffset
	data.DayOfMonth = reference.Data.DayOfMonth
	data.DayOffset = reference.Data.DayOffset
	data.DueDays = reference.Data.DueDays
	data.CutoffDay = reference.Data.CutoffDay
	data.DefaultSalesSurcharge = reference.Data.DefaultSalesSurcharge
	return data, nil
}

func (s *Service) resolveFundAccountOperating(
	ctx context.Context, tx pgx.Tx, data DetailView,
) (DetailView, error) {
	row, err := s.queries.WithTx(tx).ResolveFundAccountOperatingEntity(ctx, data.OperatingEntityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DetailView{}, domainError(ErrorConflict, "operating-entity reference is unavailable", nil, nil)
	}
	if err != nil {
		return DetailView{}, s.internal("resolve fund account operating entity", err)
	}
	data.OperatingEntityID, data.OperatingEntityVersionID, data.OperatingEntityCode, data.OperatingEntityName = row.ID, row.ID_2, row.Code, row.LegalName
	return data, nil
}

func auxiliaryEntity(entity string) bool {
	return slices.Contains([]string{EntityCategory, EntityDepartment, EntityPosition, EntitySettlementMethod}, entity)
}

func auxiliaryEntityName(entity string) string {
	if entity == EntityCategory {
		return "product-category"
	}
	return entity
}

func (s *Service) resolveAuxiliaryReference(
	ctx context.Context, tx pgx.Tx, entity, objectID, versionID string,
) (EffectiveReference, error) {
	if s.auxiliaryResolver == nil {
		return EffectiveReference{}, domainError(ErrorInternal, "internal server error", nil, errors.New("auxiliary resolver is not configured"))
	}
	reference, err := s.auxiliaryResolver.ResolveAuxiliaryReference(
		ctx, tx, auxiliaryEntityName(entity), objectID, versionID,
	)
	if err != nil {
		return EffectiveReference{}, domainError(ErrorConflict, auxiliaryEntityName(entity)+" reference is unavailable", nil, err)
	}
	dayOfMonth := int32(mapInt(reference.Data, "dayOfMonth"))
	var dayOfMonthPointer *int32
	if dayOfMonth > 0 {
		dayOfMonthPointer = &dayOfMonth
	}
	data := DetailView{
		Name:                  mapString(reference.Data, "name"),
		ParentID:              mapString(reference.Data, "parentId"),
		Description:           mapString(reference.Data, "description"),
		TermCode:              mapString(reference.Data, "termCode"),
		RuleType:              mapString(reference.Data, "ruleType"),
		MonthOffset:           int32(mapInt(reference.Data, "monthOffset")),
		DayOfMonth:            dayOfMonthPointer,
		DayOffset:             int32(mapInt(reference.Data, "dayOffset")),
		DueDays:               int32(mapInt(reference.Data, "dayOffset")),
		CutoffDay:             int32(mapInt(reference.Data, "dayOfMonth")),
		DefaultSalesSurcharge: mapString(reference.Data, "defaultSalesSurcharge"),
	}
	if data.RuleType == "DUE_DAYS" {
		data.DayOffset = data.DueDays
	}
	return EffectiveReference{
		ObjectID: reference.ObjectID, Entity: entity, Code: reference.Code,
		VersionID: reference.VersionID, Data: data,
	}, nil
}

func (s *Service) resolveNamedAuxiliaryReference(
	ctx context.Context, tx pgx.Tx, entity, objectID, versionID string,
) (AuxiliaryReference, error) {
	if s.auxiliaryResolver == nil {
		return AuxiliaryReference{}, domainError(ErrorInternal, "internal server error", nil, errors.New("auxiliary resolver is not configured"))
	}
	reference, err := s.auxiliaryResolver.ResolveAuxiliaryReference(ctx, tx, entity, objectID, versionID)
	if err != nil {
		return AuxiliaryReference{}, domainError(ErrorConflict, entity+" reference is unavailable", nil, err)
	}
	return reference, nil
}

func mapString(data map[string]any, key string) string {
	value, _ := data[key].(string)
	return value
}

func mapInt(data map[string]any, key string) int {
	switch value := data[key].(type) {
	case int:
		return value
	case int32:
		return int(value)
	case int64:
		return int(value)
	case float64:
		return int(value)
	case json.Number:
		number, _ := value.Int64()
		return int(number)
	default:
		return 0
	}
}

func (s *Service) validatePlatformReference(ctx context.Context, q *dbsqlc.Queries, platformObjectID string) error {
	if !validID(platformObjectID) {
		return domainError(ErrorValidation, "invalid logistics platform reference", nil, nil)
	}
	_, err := q.LockEffectiveLogisticsPlatform(ctx, platformObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "logistics platform is not currently effective", nil, nil)
	}
	if err != nil {
		return s.internal("lock logistics platform", err)
	}
	return nil
}
