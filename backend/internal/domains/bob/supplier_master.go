package bob

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

type SupplierSettlementSnapshot struct {
	SourceObjectID  string `json:"sourceObjectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
	TermCode        string `json:"termCode"`
	RuleType        string `json:"ruleType"`
	MonthOffset     int32  `json:"monthOffset"`
	DayOfMonth      int32  `json:"dayOfMonth"`
	DayOffset       int32  `json:"dayOffset"`
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
	DefaultPurchaserApprovalID string                      `json:"-"`
	SettlementMethod           *SupplierSettlementSnapshot `json:"settlementMethod"`
	provided                   map[string]bool
}

type SupplierVersionView struct {
	Approval VersionMeta  `json:"approval"`
	Data     SupplierData `json:"data"`
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
	LatestApproved      *SupplierVersionView `json:"latestApproved"`
	OpenVersion         *SupplierVersionView `json:"openVersion"`
	UpdatedAt           time.Time            `json:"updatedAt"`
}

type SupplierListVersion struct {
	Approval             approval.VersionMeta `json:"approval"`
	DefaultPurchaserCode string               `json:"defaultPurchaserCode,omitempty"`
	DefaultPurchaserName string               `json:"defaultPurchaserName,omitempty"`
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
	LatestApproved      *SupplierListVersion `json:"latestApproved"`
	OpenVersion         *SupplierListVersion `json:"openVersion"`
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
	ObjectID         string       `json:"objectId"`
	ApprovalEntryID  string       `json:"approvalEntryId"`
	ApprovalRevision int64        `json:"approvalRevision"`
	Data             SupplierData `json:"data"`
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
	params := bobListParams(EntitySupplier, input.Filters, enabledFilter, statuses, "code", "asc", int32((input.Page-1)*input.PageSize), int32(input.PageSize))
	total, err := s.queries.CountBobObjects(ctx, bobCountParams(params))
	if err != nil {
		return Page[SupplierListItem]{}, s.internal("count suppliers", err)
	}
	rows, err := s.queries.ListBobObjects(ctx, params)
	if err != nil {
		return Page[SupplierListItem]{}, s.internal("list suppliers", err)
	}
	items := make([]SupplierListItem, 0, len(rows))
	for _, row := range rows {
		item := SupplierListItem{ObjectID: row.ObjectID, Code: row.Code, ObjectRevision: row.ObjectRevision, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time}
		identity, identityErr := s.supplierIdentity(ctx, row.ObjectID)
		if identityErr != nil {
			return Page[SupplierListItem]{}, identityErr
		}
		item.PartyID, item.PartyKind, item.PartyDisplayName = identity.PartyID, identity.PartyKind, identity.PartyDisplayName
		item.OperatingEntityID, item.OperatingEntityCode, item.OperatingEntityName = identity.OperatingEntityID, identity.OperatingEntityCode, identity.OperatingEntityName
		if row.ApprovalEntryID != "" {
			version, loadErr := s.loadSupplierVersion(ctx, row.ApprovalEntryID)
			if loadErr != nil {
				return Page[SupplierListItem]{}, loadErr
			}
			item.LatestApproved = &SupplierListVersion{Approval: version.Approval}
		}
		if row.OpenApprovalEntryID != "" {
			version, loadErr := s.loadSupplierVersion(ctx, row.OpenApprovalEntryID)
			if loadErr != nil {
				return Page[SupplierListItem]{}, loadErr
			}
			item.OpenVersion = &SupplierListVersion{Approval: version.Approval}
		}
		if len(statuses) > 0 && (item.OpenVersion == nil || !slices.Contains(statuses, string(item.OpenVersion.Approval.Status))) && (item.LatestApproved == nil || !slices.Contains(statuses, string(item.LatestApproved.Approval.Status))) {
			continue
		}
		items = append(items, item)
	}
	return Page[SupplierListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) SupplierCreate(ctx context.Context, input SupplierCreateInput, actor approval.Actor, canReadMatchedParty bool) (SupplierCreateResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
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
	if _, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, input.Data.OperatingEntityID); err != nil {
		return SupplierCreateResult{}, domainError(ErrorConflict, "经营主体不可用", nil, err)
	}
	party, err := s.resolveOrCreateRelationshipParty(ctx, qtx, input.PartyID, input.NewParty,
		actorID, requestID, canReadMatchedParty, tx)
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
	objectID := newID()
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: objectID, Entity: EntitySupplier,
		Code: fmt.Sprintf("SUP-%04d", counter), ActorID: actorID}); err != nil {
		return SupplierCreateResult{}, s.writeError("insert supplier", err)
	}
	entry, err := s.createFirstApproval(ctx, tx, EntitySupplier, objectID, fmt.Sprintf("SUP-%04d", counter), true, actor)
	if err != nil {
		return SupplierCreateResult{}, translateApprovalError(err)
	}
	if err = qtx.InsertBobSupplierRelationship(ctx, dbsqlc.InsertBobSupplierRelationshipParams{
		ObjectID: objectID, PartyID: party.ID, OperatingEntityID: input.Data.OperatingEntityID, ActorID: actorID,
	}); err != nil {
		return SupplierCreateResult{}, s.writeError("insert Supplier Relationship", err)
	}
	if err = insertDetail(ctx, qtx, EntitySupplier, entry.ID, supplierDetail(data)); err != nil {
		return SupplierCreateResult{}, s.writeError("insert supplier detail", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return SupplierCreateResult{}, s.writeError("commit supplier create", err)
	}
	return SupplierCreateResult{MutationResult: approvalMutation(objectID, 1, true, entry), PartyID: party.ID}, nil
}

func (s *Service) SupplierSave(ctx context.Context, input SupplierSaveInput, actor approval.Actor) (MutationResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
	if !validWriteInput(EntitySupplier, input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid supplier save", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin supplier save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: input.ObjectID, Entity: EntitySupplier})
	if err != nil {
		return MutationResult{}, s.internal("lock supplier", err)
	}
	entry, err := s.entryForObject(ctx, qtx, EntitySupplier, input.ObjectID, input.ApprovalEntryID)
	if err != nil {
		return MutationResult{}, err
	}
	if entry.Revision != input.ApprovalRevision {
		return MutationResult{}, domainError(ErrorConflict, "supplier changed before save", nil, nil)
	}
	target := approvalEntry(entry)
	if approval.Status(entry.Status) == approval.StatusApproved {
		target, err = s.createNextApproval(ctx, tx, EntitySupplier, input.ObjectID, object.Code, object.Enabled, actor)
		if err == nil {
			err = copyDetail(ctx, qtx, EntitySupplier, target.ID, entry.ID)
		}
		if err != nil {
			return MutationResult{}, s.writeError("copy supplier approval payload", err)
		}
	} else if approval.Status(entry.Status) != approval.StatusDraft {
		return MutationResult{}, domainError(ErrorConflict, "only a draft or latest approved version can be saved", nil, nil)
	}
	current, err := loadSupplierVersionWithQueries(ctx, qtx, target.ID)
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
	if err = updateDetail(ctx, qtx, EntitySupplier, target.ID, supplierDetail(data)); err != nil {
		return MutationResult{}, s.writeError("update supplier payload", err)
	}
	target, err = s.transitionApproval(ctx, tx, EntitySupplier, input.ObjectID, object.Code, object.Enabled, target.ID, target.Revision, approval.ActionSaved, "", actor)
	if err != nil {
		return MutationResult{}, translateApprovalError(err)
	}
	touched, err := qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: input.ObjectID, Entity: EntitySupplier})
	if err != nil {
		return MutationResult{}, s.writeError("touch supplier", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit supplier save", err)
	}
	return approvalMutation(touched.ID, touched.Revision, touched.Enabled, target), nil
}

func (s *Service) SupplierGet(ctx context.Context, input GetInput) (SupplierDetailView, error) {
	if !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) {
		return SupplierDetailView{}, domainError(ErrorValidation, "invalid supplier", nil, nil)
	}
	row, err := s.queries.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: input.ObjectID, Entity: EntitySupplier})
	if errors.Is(err, pgx.ErrNoRows) {
		return SupplierDetailView{}, domainError(ErrorValidation, "supplier not found", nil, nil)
	}
	if err != nil {
		return SupplierDetailView{}, s.internal("get supplier", err)
	}
	result := SupplierDetailView{ObjectID: row.ID, Code: row.Code, ObjectRevision: row.Revision,
		Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time}
	identity, err := s.supplierIdentity(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SupplierDetailView{}, domainError(ErrorConflict, "supplier relationship is unavailable", nil, nil)
	}
	if err != nil {
		return SupplierDetailView{}, s.internal("get Supplier Relationship identity", err)
	}
	result.PartyID, result.PartyKind, result.PartyDisplayName = identity.PartyID, identity.PartyKind, identity.PartyDisplayName
	result.OperatingEntityID, result.OperatingEntityCode, result.OperatingEntityName = identity.OperatingEntityID,
		identity.OperatingEntityCode, identity.OperatingEntityName
	entryID := input.ApprovalEntryID
	if entryID != "" {
		version, loadErr := s.loadSupplierVersion(ctx, entryID)
		if loadErr != nil {
			return SupplierDetailView{}, loadErr
		}
		if version.Approval.Status == approval.StatusApproved {
			result.LatestApproved = &version
		} else {
			result.OpenVersion = &version
		}
		return result, nil
	}
	if entry, latestErr := s.queries.GetBobLatestApprovedEntry(ctx, dbsqlc.GetBobLatestApprovedEntryParams{Entity: EntitySupplier, ObjectID: input.ObjectID}); latestErr == nil {
		version, loadErr := s.loadSupplierVersion(ctx, entry.ID)
		if loadErr != nil {
			return SupplierDetailView{}, loadErr
		}
		result.LatestApproved = &version
	} else if !errors.Is(latestErr, pgx.ErrNoRows) {
		return SupplierDetailView{}, s.internal("get latest approved supplier", latestErr)
	}
	if entry, openErr := s.queries.GetBobOpenEntry(ctx, dbsqlc.GetBobOpenEntryParams{Entity: EntitySupplier, ObjectID: input.ObjectID}); openErr == nil {
		version, loadErr := s.loadSupplierVersion(ctx, entry.ID)
		if loadErr != nil {
			return SupplierDetailView{}, loadErr
		}
		result.OpenVersion = &version
	} else if !errors.Is(openErr, pgx.ErrNoRows) {
		return SupplierDetailView{}, s.internal("get open supplier", openErr)
	}
	return result, nil
}

func (s *Service) resolveSupplierReferences(ctx context.Context, tx pgx.Tx, data SupplierData) (SupplierData, error) {
	if data.SettlementMethodID != "" {
		reference, err := s.resolveNamedAuxiliaryReference(ctx, tx, "settlement-method", data.SettlementMethodID, "")
		if err != nil {
			return SupplierData{}, domainError(ErrorConflict, "settlement-method reference is unavailable", nil, err)
		}
		data.SettlementMethod = &SupplierSettlementSnapshot{SourceObjectID: reference.ObjectID, ApprovalEntryID: reference.ApprovalEntryID, Code: reference.Code,
			Name: mapString(reference.Data, "name"), TermCode: mapString(reference.Data, "termCode"),
			RuleType: mapString(reference.Data, "ruleType"), MonthOffset: int32(mapInt(reference.Data, "monthOffset")),
			DayOfMonth: int32(mapInt(reference.Data, "dayOfMonth")), DayOffset: int32(mapInt(reference.Data, "dayOffset"))}
	}
	if data.DefaultPurchaserEmployeeID != "" {
		reference, err := s.ResolveLatestApprovedReference(ctx, tx, EntityEmployee, data.DefaultPurchaserEmployeeID)
		if err != nil {
			return SupplierData{}, domainError(ErrorConflict, "default purchaser reference is unavailable", nil, err)
		}
		data.DefaultPurchaserApprovalID = reference.ApprovalEntryID
	}
	return data, nil
}

func (s *Service) loadSupplierVersion(ctx context.Context, entryID string) (SupplierVersionView, error) {
	result, err := loadSupplierVersionWithQueries(ctx, s.queries, entryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SupplierVersionView{}, domainError(ErrorValidation, "supplier version not found", nil, nil)
	}
	if err != nil {
		return SupplierVersionView{}, s.internal("load supplier version", err)
	}
	return result, nil
}

func loadSupplierVersionWithQueries(ctx context.Context, q *dbsqlc.Queries, entryID string) (SupplierVersionView, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "bob", Entity: EntitySupplier})
	if err != nil {
		return SupplierVersionView{}, err
	}
	detail, err := loadDetail(ctx, q, EntitySupplier, entryID)
	if err != nil {
		return SupplierVersionView{}, err
	}
	data := SupplierData{Name: detail.Name, ShortName: detail.ShortName,
		TaxNumber: detail.TaxNumber, ContactName: detail.ContactName, ContactPhone: detail.ContactPhone, Email: detail.Email,
		Address: detail.Address, Remark: detail.Remark, SettlementMethodID: detail.SettlementMethodID,
		DefaultPurchaserEmployeeID: detail.DefaultPurchaserEmployeeID, DefaultPurchaserApprovalID: detail.DefaultPurchaserApprovalEntryID}
	if detail.SettlementMethodID != "" {
		data.SettlementMethod = &SupplierSettlementSnapshot{SourceObjectID: detail.SettlementMethodID, ApprovalEntryID: detail.SettlementMethodApprovalEntryID,
			Code: detail.SettlementMethodCode, Name: detail.SettlementMethodName, TermCode: detail.TermCode,
			RuleType: detail.RuleType, MonthOffset: detail.MonthOffset,
			DayOfMonth: derefInt32(detail.DayOfMonth), DayOffset: detail.DayOffset}
	}
	return SupplierVersionView{Approval: approvalMeta(entry), Data: data}, nil
}

func supplierDetail(data SupplierData) DetailView {
	result := DetailView{Name: data.Name, ShortName: data.ShortName, TaxNumber: data.TaxNumber, ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, Remark: data.Remark, SettlementMethodID: data.SettlementMethodID, DefaultPurchaserEmployeeID: data.DefaultPurchaserEmployeeID, DefaultPurchaserApprovalEntryID: data.DefaultPurchaserApprovalID}
	if data.SettlementMethod != nil {
		result.SettlementMethodApprovalEntryID = data.SettlementMethod.ApprovalEntryID
		result.SettlementMethodCode, result.SettlementMethodName, result.TermCode, result.RuleType, result.MonthOffset, result.DayOffset = data.SettlementMethod.Code, data.SettlementMethod.Name, data.SettlementMethod.TermCode, data.SettlementMethod.RuleType, data.SettlementMethod.MonthOffset, data.SettlementMethod.DayOffset
		result.DayOfMonth = &data.SettlementMethod.DayOfMonth
	}
	return result
}

func (s *Service) supplierIdentity(ctx context.Context, objectID string) (RelationshipIdentityView, error) {
	relationship, err := s.queries.GetBobSupplierRelationship(ctx, objectID)
	if err != nil {
		return RelationshipIdentityView{}, s.internal("get supplier relationship", err)
	}
	party, err := s.queries.GetBobParty(ctx, relationship.PartyID)
	if err != nil {
		return RelationshipIdentityView{}, s.internal("get supplier party", err)
	}
	return RelationshipIdentityView{PartyID: party.ID, PartyKind: party.Kind, PartyDisplayName: party.DisplayName, OperatingEntityID: relationship.OperatingEntityID}, nil
}
