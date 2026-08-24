package bob

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

type SupplierSettlementSnapshot struct {
	SourceObjectID string `json:"sourceObjectId"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	TermCode       string `json:"termCode"`
	RuleType       string `json:"ruleType"`
	MonthOffset    int32  `json:"monthOffset"`
	DayOfMonth     int32  `json:"dayOfMonth"`
	DayOffset      int32  `json:"dayOffset"`
}

type SupplierData struct {
	OperatingEntityID          string                      `json:"operatingEntityId,omitempty"`
	Name                       string                      `json:"-"`
	ShortName                  string                      `json:"-"`
	TaxNumber                  string                      `json:"-"`
	ContactName                string                      `json:"contactName,omitempty"`
	ContactPhone               string                      `json:"contactPhone,omitempty"`
	Email                      string                      `json:"email,omitempty"`
	Address                    string                      `json:"address,omitempty"`
	Remark                     string                      `json:"remark,omitempty"`
	SettlementMethodID         string                      `json:"settlementMethodId,omitempty"`
	DefaultPurchaserEmployeeID string                      `json:"defaultPurchaserEmployeeId,omitempty"`
	SettlementMethod           *SupplierSettlementSnapshot `json:"settlementMethod"`
	provided                   map[string]bool
}

type SupplierVersionView struct {
	Version VersionMeta  `json:"version"`
	Data    SupplierData `json:"data"`
}

type SupplierDetailView struct {
	ObjectID            string               `json:"objectId"`
	Code                string               `json:"code"`
	ObjectRevision      int64                `json:"objectRevision"`
	Enabled             bool                 `json:"enabled"`
	PartyID             string               `json:"partyId"`
	PartyKind           string               `json:"partyKind"`
	PartyDisplayName    string               `json:"partyDisplayName"`
	OperatingEntityID   string               `json:"operatingEntityId"`
	OperatingEntityCode string               `json:"operatingEntityCode"`
	OperatingEntityName string               `json:"operatingEntityName"`
	Effective           *SupplierVersionView `json:"effective"`
	Candidate           *SupplierVersionView `json:"candidate"`
	UpdatedAt           time.Time            `json:"updatedAt"`
}

type SupplierListVersion struct {
	VersionID            string  `json:"versionId"`
	Version              int32   `json:"version"`
	Status               string  `json:"status"`
	Revision             int64   `json:"revision"`
	DefaultPurchaserCode string  `json:"defaultPurchaserCode,omitempty"`
	DefaultPurchaserName string  `json:"defaultPurchaserName,omitempty"`
	SubmittedBy          *string `json:"submittedBy"`
}

type SupplierListItem struct {
	ObjectID            string               `json:"objectId"`
	Code                string               `json:"code"`
	ObjectRevision      int64                `json:"objectRevision"`
	Enabled             bool                 `json:"enabled"`
	PartyID             string               `json:"partyId"`
	PartyKind           string               `json:"partyKind"`
	PartyDisplayName    string               `json:"partyDisplayName"`
	OperatingEntityID   string               `json:"operatingEntityId"`
	OperatingEntityCode string               `json:"operatingEntityCode"`
	OperatingEntityName string               `json:"operatingEntityName"`
	Effective           *SupplierListVersion `json:"effective"`
	Candidate           *SupplierListVersion `json:"candidate"`
	UpdatedAt           time.Time            `json:"updatedAt"`
}

type SupplierCreateInput struct {
	PartyID  string           `json:"partyId,omitempty"`
	NewParty *PartyCreateData `json:"newParty,omitempty"`
	Data     SupplierData     `json:"data"`
}

type SupplierCreateResult struct {
	MutationResult
	PartyID string `json:"partyId"`
}

type SupplierSaveInput struct {
	ObjectID  string       `json:"objectId"`
	VersionID string       `json:"versionId"`
	Revision  int64        `json:"revision"`
	Data      SupplierData `json:"data"`
}

func (data *SupplierData) UnmarshalJSON(raw []byte) error {
	type supplierDataAlias SupplierData
	var decoded supplierDataAlias
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("supplier data must contain exactly one JSON value")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	if _, submitted := fields["settlementMethod"]; submitted {
		return errors.New("settlementMethod is read-only")
	}
	*data = SupplierData(decoded)
	data.provided = make(map[string]bool, len(fields))
	for field := range fields {
		data.provided[field] = true
	}
	return nil
}

func normalizeSupplier(data SupplierData) (SupplierData, error) {
	data.Name = strings.TrimSpace(data.Name)
	data.ShortName = strings.TrimSpace(data.ShortName)
	data.TaxNumber = strings.ToUpper(strings.TrimSpace(data.TaxNumber))
	data.ContactName = strings.TrimSpace(data.ContactName)
	data.ContactPhone = strings.TrimSpace(data.ContactPhone)
	data.Email = strings.TrimSpace(data.Email)
	data.Address = strings.TrimSpace(data.Address)
	data.Remark = strings.TrimSpace(data.Remark)
	data.SettlementMethodID = strings.TrimSpace(data.SettlementMethodID)
	data.DefaultPurchaserEmployeeID = strings.TrimSpace(data.DefaultPurchaserEmployeeID)
	data.SettlementMethod = nil
	if err := validateLengthsAndFormats(DetailView{
		ContactName:  data.ContactName,
		ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, Remark: data.Remark,
	}); err != nil {
		return SupplierData{}, err
	}
	if data.SettlementMethodID != "" && !validID(data.SettlementMethodID) {
		return SupplierData{}, errors.New("invalid settlement method")
	}
	if data.DefaultPurchaserEmployeeID != "" && !validID(data.DefaultPurchaserEmployeeID) {
		return SupplierData{}, errors.New("invalid default purchaser")
	}
	return data, nil
}

func validateSupplierEffective(data SupplierData) error {
	if data.SettlementMethodID == "" || data.SettlementMethod == nil ||
		data.SettlementMethod.SourceObjectID != data.SettlementMethodID ||
		data.SettlementMethod.Code == "" || data.SettlementMethod.Name == "" ||
		!validSettlementTerm(data.SettlementMethod.TermCode) {
		return errors.New("complete settlement method snapshot is required")
	}
	rule := DetailView{TermCode: data.SettlementMethod.TermCode, RuleType: data.SettlementMethod.RuleType,
		MonthOffset: data.SettlementMethod.MonthOffset, DayOffset: data.SettlementMethod.DayOffset}
	if data.SettlementMethod.DayOfMonth != 0 {
		rule.DayOfMonth = &data.SettlementMethod.DayOfMonth
	}
	if err := validateSettlementRule(rule); err != nil {
		return errors.New("invalid settlement method snapshot")
	}
	if !validID(data.DefaultPurchaserEmployeeID) {
		return errors.New("default purchaser is required")
	}
	return nil
}

func mergeSupplierData(current, update SupplierData) SupplierData {
	if update.provided == nil {
		return update
	}
	result := current
	set := func(key string, target *string, value string) {
		if update.provided[key] {
			*target = value
		}
	}
	set("contactName", &result.ContactName, update.ContactName)
	set("contactPhone", &result.ContactPhone, update.ContactPhone)
	set("email", &result.Email, update.Email)
	set("address", &result.Address, update.Address)
	set("remark", &result.Remark, update.Remark)
	if update.provided["settlementMethodId"] {
		result.SettlementMethodID = update.SettlementMethodID
		result.SettlementMethod = nil
	}
	if update.provided["defaultPurchaserEmployeeId"] {
		result.DefaultPurchaserEmployeeID = update.DefaultPurchaserEmployeeID
	}
	return result
}

func (s *Service) SupplierQuery(ctx context.Context, input QueryInput) (Page[SupplierListItem], error) {
	if input.Page < 1 || input.PageSize != 20 || len(input.Sort) > 1 {
		return Page[SupplierListItem]{}, domainError(ErrorValidation, "invalid supplier query", nil, nil)
	}
	if len(input.Sort) == 1 && (input.Sort[0].Field != "code" || strings.ToLower(input.Sort[0].Order) != "asc") {
		return Page[SupplierListItem]{}, domainError(ErrorValidation, "invalid supplier sort", nil, nil)
	}
	statuses := uniqueStrings(input.Filters.Status)
	if statuses == nil {
		statuses = []string{}
	}
	for _, status := range statuses {
		if !validStatus(status) {
			return Page[SupplierListItem]{}, domainError(ErrorValidation, "invalid supplier status", nil, nil)
		}
	}
	if input.Filters.DefaultPurchaserEmployeeID != "" && !validID(input.Filters.DefaultPurchaserEmployeeID) {
		return Page[SupplierListItem]{}, domainError(ErrorValidation, "invalid default purchaser", nil, nil)
	}
	enabledFilter := int32(-1)
	if input.Filters.Enabled != nil {
		if *input.Filters.Enabled {
			enabledFilter = 1
		} else {
			enabledFilter = 0
		}
	}
	params := dbsqlc.CountBobSuppliersParams{Keyword: strings.TrimSpace(input.Filters.Keyword), Statuses: statuses,
		EnabledFilter:              enabledFilter,
		DefaultPurchaserEmployeeID: input.Filters.DefaultPurchaserEmployeeID}
	total, err := s.queries.CountBobSuppliers(ctx, params)
	if err != nil {
		return Page[SupplierListItem]{}, s.internal("count suppliers", err)
	}
	rows, err := s.queries.ListBobSuppliers(ctx, dbsqlc.ListBobSuppliersParams{Keyword: params.Keyword,
		Statuses: statuses, EnabledFilter: enabledFilter,
		DefaultPurchaserEmployeeID: params.DefaultPurchaserEmployeeID,
		RowOffset:                  int32((input.Page - 1) * input.PageSize), RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[SupplierListItem]{}, s.internal("list suppliers", err)
	}
	items := make([]SupplierListItem, 0, len(rows))
	for _, row := range rows {
		item := SupplierListItem{ObjectID: row.ObjectID, Code: row.Code, ObjectRevision: row.ObjectRevision,
			Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time, PartyID: row.PartyID,
			PartyKind: row.PartyKind, PartyDisplayName: row.PartyDisplayName,
			OperatingEntityID: row.OperatingEntityID, OperatingEntityCode: row.OperatingEntityCode,
			OperatingEntityName: row.OperatingEntityName}
		if row.EffectiveVersionID != nil {
			item.Effective = &SupplierListVersion{VersionID: *row.EffectiveVersionID, Version: *row.EffectiveVersionNo,
				Status: deref(row.EffectiveStatus), Revision: *row.EffectiveRevision,
				DefaultPurchaserCode: row.EffectiveDefaultPurchaserCode,
				DefaultPurchaserName: row.EffectiveDefaultPurchaserName, SubmittedBy: row.EffectiveSubmittedBy}
		}
		if row.CandidateVersionID != nil {
			item.Candidate = &SupplierListVersion{VersionID: *row.CandidateVersionID, Version: *row.CandidateVersionNo,
				Status: deref(row.CandidateStatus), Revision: *row.CandidateRevision,
				DefaultPurchaserCode: row.CandidateDefaultPurchaserCode,
				DefaultPurchaserName: row.CandidateDefaultPurchaserName, SubmittedBy: row.CandidateSubmittedBy}
		}
		items = append(items, item)
	}
	return Page[SupplierListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) SupplierCreate(ctx context.Context, input SupplierCreateInput, actorID, requestID string, canReadMatchedParty bool) (SupplierCreateResult, error) {
	if !validActorAndRequest(actorID, requestID) || !validID(input.Data.OperatingEntityID) ||
		(input.PartyID == "") == (input.NewParty == nil) {
		return SupplierCreateResult{}, domainError(ErrorValidation, "invalid supplier create", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SupplierCreateResult{}, s.internal("begin supplier create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if _, err = qtx.ResolveCustomerOperatingEntity(ctx, input.Data.OperatingEntityID); errors.Is(err, pgx.ErrNoRows) {
		return SupplierCreateResult{}, domainError(ErrorConflict, "经营主体不可用", nil, nil)
	} else if err != nil {
		return SupplierCreateResult{}, s.internal("resolve operating entity", err)
	}
	party, err := s.resolveOrCreateRelationshipParty(ctx, qtx, input.PartyID, input.NewParty,
		actorID, requestID, canReadMatchedParty)
	if err != nil {
		return SupplierCreateResult{}, err
	}
	input.Data.Name = party.DisplayName
	data, err := normalizeSupplier(input.Data)
	if err != nil {
		return SupplierCreateResult{}, domainError(ErrorValidation, "invalid supplier create", nil, err)
	}
	data, err = s.resolveSupplierReferences(ctx, tx, data)
	if err != nil {
		return SupplierCreateResult{}, err
	}
	counter, err := qtx.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntitySupplier})
	if err != nil {
		return SupplierCreateResult{}, s.writeError("allocate supplier number", err)
	}
	objectID, versionID := newID(), newID()
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: objectID, Entity: EntitySupplier,
		Code: fmt.Sprintf("SUP-%04d", counter), CurrentVersionID: versionID, ActorID: actorID}); err != nil {
		return SupplierCreateResult{}, s.writeError("insert supplier", err)
	}
	if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: versionID, ObjectID: objectID,
		Entity: EntitySupplier, VersionNo: 1, ActorID: actorID}); err != nil {
		return SupplierCreateResult{}, s.writeError("insert supplier version", err)
	}
	if err = qtx.InsertBobSupplierRelationship(ctx, dbsqlc.InsertBobSupplierRelationshipParams{
		ObjectID: objectID, PartyID: party.ID, OperatingEntityID: input.Data.OperatingEntityID, ActorID: actorID,
	}); err != nil {
		return SupplierCreateResult{}, s.writeError("insert Supplier Relationship", err)
	}
	if err = insertSupplierData(ctx, qtx, versionID, data); err != nil {
		return SupplierCreateResult{}, s.writeError("insert supplier detail", err)
	}
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: objectID, VersionID: versionID, Entity: EntitySupplier,
		Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fields": []string{"code", "settlementMethodId", "defaultPurchaserEmployeeId"}}}); err != nil {
		return SupplierCreateResult{}, s.writeError("audit supplier create", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return SupplierCreateResult{}, s.writeError("commit supplier create", err)
	}
	return SupplierCreateResult{MutationResult: MutationResult{ObjectID: objectID, ObjectRevision: 1, Enabled: true,
		VersionID: versionID, Version: 1, Status: StatusDraft, Revision: 1}, PartyID: party.ID}, nil
}

func (s *Service) SupplierSave(ctx context.Context, input SupplierSaveInput, actorID, requestID string) (MutationResult, error) {
	if !validWriteInput(EntitySupplier, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid supplier save", nil, nil)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, EntitySupplier, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || version.Revision != input.Revision {
		return MutationResult{}, conflict(object, version, "supplier changed before save")
	}
	current, err := loadSupplierVersionWithQueries(ctx, qtx, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, s.internal("load supplier before save", err)
	}
	data, err := normalizeSupplier(mergeSupplierData(current.Data, input.Data))
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid supplier save", nil, err)
	}
	if data.SettlementMethodID == current.Data.SettlementMethodID && current.Data.SettlementMethod != nil {
		data.SettlementMethod = current.Data.SettlementMethod
	}
	data, err = s.resolveSupplierReferences(ctx, tx, data)
	if err != nil {
		return MutationResult{}, err
	}
	targetVersionID, targetVersionNo := input.VersionID, version.VersionNo
	objectRevision := object.Revision
	createdCandidate := false
	if version.Status == StatusEffective && object.EffectiveVersionID != nil && *object.EffectiveVersionID == input.VersionID {
		targetVersionID, targetVersionNo = newID(), object.NextVersionNo
		if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: targetVersionID, ObjectID: input.ObjectID,
			Entity: EntitySupplier, VersionNo: targetVersionNo, ActorID: actorID}); err != nil {
			return MutationResult{}, s.writeError("insert supplier candidate", err)
		}
		rows, advanceErr := qtx.AdvanceBobSupplierCandidate(ctx, dbsqlc.AdvanceBobSupplierCandidateParams{VersionID: targetVersionID,
			ActorID: actorID, ObjectID: input.ObjectID, Revision: object.Revision, CurrentVersionID: input.VersionID})
		if advanceErr != nil || rows != 1 {
			return MutationResult{}, conflict(object, version, "supplier changed before save")
		}
		objectRevision++
		createdCandidate = true
	} else if version.Status != StatusDraft || (object.EffectiveVersionID != nil && object.CurrentVersionID == *object.EffectiveVersionID) {
		return MutationResult{}, conflict(object, version, "supplier changed before save")
	}
	if createdCandidate {
		if err = insertSupplierData(ctx, qtx, targetVersionID, data); err != nil {
			return MutationResult{}, s.writeError("insert supplier candidate detail", err)
		}
	} else {
		if err = updateSupplierData(ctx, qtx, targetVersionID, data); err != nil {
			return MutationResult{}, s.writeError("update supplier detail", err)
		}
		rows, saveErr := qtx.MarkBobVersionSaved(ctx, dbsqlc.MarkBobVersionSavedParams{ActorID: actorID,
			ID: targetVersionID, ObjectID: input.ObjectID, Entity: EntitySupplier, Revision: input.Revision})
		if saveErr != nil || rows != 1 {
			return MutationResult{}, conflict(object, version, "supplier changed before save")
		}
		if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: EntitySupplier}); err != nil {
			return MutationResult{}, s.internal("touch supplier", err)
		}
	}
	event := "SAVED"
	if createdCandidate {
		event = "CREATED"
	}
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: input.ObjectID, VersionID: targetVersionID,
		Entity: EntitySupplier, Event: event, To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fields": []string{"name", "settlementMethodId", "defaultPurchaserEmployeeId"}}}); err != nil {
		return MutationResult{}, s.writeError("audit supplier save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit supplier save", err)
	}
	revision := input.Revision + 1
	if createdCandidate {
		revision = 1
	}
	return MutationResult{ObjectID: input.ObjectID, ObjectRevision: objectRevision, Enabled: object.Enabled,
		VersionID: targetVersionID, Version: targetVersionNo, Status: StatusDraft, Revision: revision}, nil
}

func (s *Service) SupplierGet(ctx context.Context, input GetInput) (SupplierDetailView, error) {
	if !validID(input.ObjectID) || (input.VersionID != "" && !validID(input.VersionID)) {
		return SupplierDetailView{}, domainError(ErrorValidation, "invalid supplier", nil, nil)
	}
	row, err := s.queries.GetBobSupplierDetail(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SupplierDetailView{}, domainError(ErrorValidation, "supplier not found", nil, nil)
	}
	if err != nil {
		return SupplierDetailView{}, s.internal("get supplier", err)
	}
	result := SupplierDetailView{ObjectID: row.ID, Code: row.Code, ObjectRevision: row.Revision,
		Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time}
	identity, err := s.queries.GetBobSupplierRelationshipIdentity(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SupplierDetailView{}, domainError(ErrorConflict, "supplier relationship is unavailable", nil, nil)
	}
	if err != nil {
		return SupplierDetailView{}, s.internal("get Supplier Relationship identity", err)
	}
	result.PartyID, result.PartyKind, result.PartyDisplayName = identity.PartyID, identity.PartyKind, identity.PartyDisplayName
	result.OperatingEntityID, result.OperatingEntityCode, result.OperatingEntityName = identity.OperatingEntityID,
		identity.OperatingEntityCode, identity.OperatingEntityName
	if input.VersionID != "" {
		version, loadErr := s.loadSupplierVersion(ctx, input.ObjectID, input.VersionID)
		if loadErr != nil {
			return SupplierDetailView{}, loadErr
		}
		if version.Version.Status == StatusEffective || version.Version.Status == StatusInvalid {
			result.Effective = &version
		} else {
			result.Candidate = &version
		}
		return result, nil
	}
	if row.EffectiveVersionID != nil {
		version, loadErr := s.loadSupplierVersion(ctx, input.ObjectID, *row.EffectiveVersionID)
		if loadErr != nil {
			return SupplierDetailView{}, loadErr
		}
		result.Effective = &version
	}
	if row.EffectiveVersionID == nil || row.CurrentVersionID != *row.EffectiveVersionID {
		version, loadErr := s.loadSupplierVersion(ctx, input.ObjectID, row.CurrentVersionID)
		if loadErr != nil {
			return SupplierDetailView{}, loadErr
		}
		result.Candidate = &version
	}
	return result, nil
}

func (s *Service) resolveSupplierReferences(ctx context.Context, tx pgx.Tx, data SupplierData) (SupplierData, error) {
	if data.SettlementMethodID != "" && data.SettlementMethod == nil {
		reference, err := s.auxiliaryResolver.ResolveAuxiliaryReference(ctx, tx, "settlement-method", data.SettlementMethodID, "")
		if err != nil {
			return SupplierData{}, domainError(ErrorConflict, "settlement-method reference is unavailable", nil, err)
		}
		data.SettlementMethod = &SupplierSettlementSnapshot{SourceObjectID: reference.ObjectID, Code: reference.Code,
			Name: mapString(reference.Data, "name"), TermCode: mapString(reference.Data, "termCode"),
			RuleType: mapString(reference.Data, "ruleType"), MonthOffset: int32(mapInt(reference.Data, "monthOffset")),
			DayOfMonth: int32(mapInt(reference.Data, "dayOfMonth")), DayOffset: int32(mapInt(reference.Data, "dayOffset"))}
	}
	if data.DefaultPurchaserEmployeeID != "" {
		if _, err := s.ResolveCurrentEffectiveReference(ctx, tx, EntityEmployee, data.DefaultPurchaserEmployeeID); err != nil {
			return SupplierData{}, domainError(ErrorConflict, "default purchaser reference is unavailable", nil, err)
		}
	}
	return data, nil
}

func insertSupplierData(ctx context.Context, q *dbsqlc.Queries, versionID string, data SupplierData) error {
	var snapshot SupplierSettlementSnapshot
	if data.SettlementMethod != nil {
		snapshot = *data.SettlementMethod
	}
	return q.InsertBobSupplierDetail(ctx, dbsqlc.InsertBobSupplierDetailParams{VersionID: versionID,
		Name: data.Name, ShortName: nilIfEmpty(data.ShortName), TaxNumber: nilIfEmpty(data.TaxNumber),
		ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone), Email: nilIfEmpty(data.Email),
		Address: nilIfEmpty(data.Address), Remark: nilIfEmpty(data.Remark), SettlementMethodID: nilIfEmpty(data.SettlementMethodID),
		SettlementMethodCode: nilIfEmpty(snapshot.Code), SettlementMethodName: nilIfEmpty(snapshot.Name),
		SettlementTermCode: nilIfEmpty(snapshot.TermCode), SettlementRuleType: nilIfEmpty(snapshot.RuleType),
		SettlementMonthOffset: snapshot.MonthOffset, SettlementDayOfMonth: snapshot.DayOfMonth,
		SettlementDayOffset: snapshot.DayOffset, DefaultPurchaserEmployeeID: nilIfEmpty(data.DefaultPurchaserEmployeeID)})
}

func updateSupplierData(ctx context.Context, q *dbsqlc.Queries, versionID string, data SupplierData) error {
	var snapshot SupplierSettlementSnapshot
	if data.SettlementMethod != nil {
		snapshot = *data.SettlementMethod
	}
	rows, err := q.UpdateBobSupplierDetail(ctx, dbsqlc.UpdateBobSupplierDetailParams{VersionID: versionID,
		Name: data.Name, ShortName: nilIfEmpty(data.ShortName), TaxNumber: nilIfEmpty(data.TaxNumber),
		ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone), Email: nilIfEmpty(data.Email),
		Address: nilIfEmpty(data.Address), Remark: nilIfEmpty(data.Remark), SettlementMethodID: nilIfEmpty(data.SettlementMethodID),
		SettlementMethodCode: nilIfEmpty(snapshot.Code), SettlementMethodName: nilIfEmpty(snapshot.Name),
		SettlementTermCode: nilIfEmpty(snapshot.TermCode), SettlementRuleType: nilIfEmpty(snapshot.RuleType),
		SettlementMonthOffset: snapshot.MonthOffset, SettlementDayOfMonth: snapshot.DayOfMonth,
		SettlementDayOffset: snapshot.DayOffset, DefaultPurchaserEmployeeID: nilIfEmpty(data.DefaultPurchaserEmployeeID)})
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("supplier detail changed")
	}
	return nil
}

func (s *Service) loadSupplierVersion(ctx context.Context, objectID, versionID string) (SupplierVersionView, error) {
	result, err := loadSupplierVersionWithQueries(ctx, s.queries, objectID, versionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SupplierVersionView{}, domainError(ErrorValidation, "supplier version not found", nil, nil)
	}
	if err != nil {
		return SupplierVersionView{}, s.internal("load supplier version", err)
	}
	return result, nil
}

func loadSupplierVersionWithQueries(ctx context.Context, q *dbsqlc.Queries, objectID, versionID string) (SupplierVersionView, error) {
	row, err := q.GetBobSupplierVersion(ctx, dbsqlc.GetBobSupplierVersionParams{ObjectID: objectID, VersionID: versionID})
	if err != nil {
		return SupplierVersionView{}, err
	}
	data := SupplierData{Name: row.Name, ShortName: row.ShortName,
		TaxNumber: row.TaxNumber, ContactName: row.ContactName, ContactPhone: row.ContactPhone, Email: row.Email,
		Address: row.Address, Remark: row.Remark, SettlementMethodID: row.SettlementMethodID,
		DefaultPurchaserEmployeeID: row.DefaultPurchaserEmployeeID}
	if row.SettlementMethodID != "" {
		data.SettlementMethod = &SupplierSettlementSnapshot{SourceObjectID: row.SettlementMethodID,
			Code: row.SettlementMethodCode, Name: row.SettlementMethodName, TermCode: row.SettlementTermCode,
			RuleType: row.SettlementRuleType, MonthOffset: row.SettlementMonthOffset,
			DayOfMonth: row.SettlementDayOfMonth, DayOffset: row.SettlementDayOffset}
	}
	return SupplierVersionView{Version: VersionMeta{VersionID: row.ID, Version: row.VersionNo, Status: row.Status,
		Revision: row.Revision, CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy, UpdatedAt: row.UpdatedAt.Time,
		UpdatedBy: row.UpdatedBy, SubmittedAt: timePointer(row.SubmittedAt), SubmittedBy: row.SubmittedBy,
		ReviewedAt: timePointer(row.ReviewedAt), ReviewedBy: row.ReviewedBy, ReviewComment: row.ReviewComment}, Data: data}, nil
}
