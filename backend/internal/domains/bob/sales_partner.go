package bob

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

type SalesPartnerData struct {
	OperatingEntityID string   `json:"operatingEntityId,omitempty"`
	Capabilities      []string `json:"capabilities"`
	ContactName       string   `json:"contactName,omitempty"`
	ContactPhone      string   `json:"contactPhone,omitempty"`
	Email             string   `json:"email,omitempty"`
	Address           string   `json:"address,omitempty"`
	Remark            string   `json:"remark,omitempty"`
}

type SalesPartnerCreateInput struct {
	PartyID  string           `json:"partyId,omitempty"`
	NewParty *PartyCreateData `json:"newParty,omitempty"`
	Data     SalesPartnerData `json:"data"`
}

type SalesPartnerSaveInput struct {
	ObjectID  string           `json:"objectId"`
	VersionID string           `json:"versionId"`
	Revision  int64            `json:"revision"`
	Data      SalesPartnerData `json:"data"`
}

type SalesPartnerCreateResult struct {
	MutationResult
	PartyID string `json:"partyId"`
}

type SalesPartnerVersionView struct {
	Version VersionMeta      `json:"version"`
	Data    SalesPartnerData `json:"data"`
}

type SalesPartnerDetailView struct {
	ObjectID            string                   `json:"objectId"`
	Code                string                   `json:"code"`
	ObjectRevision      int64                    `json:"objectRevision"`
	Enabled             bool                     `json:"enabled"`
	PartyID             string                   `json:"partyId"`
	PartyKind           string                   `json:"partyKind"`
	PartyDisplayName    string                   `json:"partyDisplayName"`
	OperatingEntityID   string                   `json:"operatingEntityId"`
	OperatingEntityCode string                   `json:"operatingEntityCode"`
	OperatingEntityName string                   `json:"operatingEntityName"`
	Effective           *SalesPartnerVersionView `json:"effective"`
	Candidate           *SalesPartnerVersionView `json:"candidate"`
	UpdatedAt           time.Time                `json:"updatedAt"`
}

type SalesPartnerListVersion struct {
	VersionID    string   `json:"versionId"`
	Version      int32    `json:"version"`
	Status       string   `json:"status"`
	Revision     int64    `json:"revision"`
	Capabilities []string `json:"capabilities"`
	SubmittedBy  *string  `json:"submittedBy"`
}

type SalesPartnerListItem struct {
	ObjectID            string                   `json:"objectId"`
	Code                string                   `json:"code"`
	ObjectRevision      int64                    `json:"objectRevision"`
	Enabled             bool                     `json:"enabled"`
	PartyID             string                   `json:"partyId"`
	PartyKind           string                   `json:"partyKind"`
	PartyDisplayName    string                   `json:"partyDisplayName"`
	OperatingEntityID   string                   `json:"operatingEntityId"`
	OperatingEntityCode string                   `json:"operatingEntityCode"`
	OperatingEntityName string                   `json:"operatingEntityName"`
	Effective           *SalesPartnerListVersion `json:"effective"`
	Candidate           *SalesPartnerListVersion `json:"candidate"`
	UpdatedAt           time.Time                `json:"updatedAt"`
}

func normalizeSalesPartnerCapabilities(input []string) ([]string, error) {
	seen := make(map[string]struct{}, len(input))
	for _, raw := range input {
		capability := strings.TrimSpace(raw)
		if capability != SalesCapabilityExternalPartTime && capability != SalesCapabilityChannelPartner {
			return nil, domainError(ErrorValidation, "invalid sales relationship capability", nil, nil)
		}
		seen[capability] = struct{}{}
	}
	result := make([]string, 0, len(seen))
	for capability := range seen {
		result = append(result, capability)
	}
	sort.Strings(result)
	return result, nil
}

func validateEffectiveSalesPartnerCapabilities(input []string) error {
	capabilities, err := normalizeSalesPartnerCapabilities(input)
	if err != nil {
		return err
	}
	if len(capabilities) == 0 {
		return domainError(ErrorValidation, "sales relationship requires at least one capability", nil, nil)
	}
	return nil
}

func normalizeSalesPartnerData(data SalesPartnerData) (SalesPartnerData, error) {
	var err error
	data.Capabilities, err = normalizeSalesPartnerCapabilities(data.Capabilities)
	if err != nil {
		return SalesPartnerData{}, err
	}
	data.ContactName = strings.TrimSpace(data.ContactName)
	data.ContactPhone = strings.TrimSpace(data.ContactPhone)
	data.Email = strings.TrimSpace(data.Email)
	data.Address = strings.TrimSpace(data.Address)
	data.Remark = strings.TrimSpace(data.Remark)
	if err = validateLengthsAndFormats(DetailView{ContactName: data.ContactName, ContactPhone: data.ContactPhone,
		Email: data.Email, Address: data.Address, Remark: data.Remark}); err != nil {
		return SalesPartnerData{}, err
	}
	if data.Capabilities == nil {
		data.Capabilities = []string{}
	}
	return data, nil
}

func (s *Service) SalesPartnerCreate(ctx context.Context, input SalesPartnerCreateInput, actorID, requestID string, canReadMatchedParty bool) (SalesPartnerCreateResult, error) {
	if !validActorAndRequest(actorID, requestID) || !validID(input.Data.OperatingEntityID) ||
		(input.PartyID == "") == (input.NewParty == nil) {
		return SalesPartnerCreateResult{}, domainError(ErrorValidation, "invalid sales relationship create", nil, nil)
	}
	data, err := normalizeSalesPartnerData(input.Data)
	if err != nil {
		return SalesPartnerCreateResult{}, domainError(ErrorValidation, "invalid sales relationship", nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SalesPartnerCreateResult{}, s.internal("begin sales relationship create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if _, err = qtx.ResolveCustomerOperatingEntity(ctx, data.OperatingEntityID); errors.Is(err, pgx.ErrNoRows) {
		return SalesPartnerCreateResult{}, domainError(ErrorConflict, "经营主体不可用", nil, nil)
	} else if err != nil {
		return SalesPartnerCreateResult{}, s.internal("resolve operating entity", err)
	}
	party, err := s.resolveOrCreateRelationshipParty(ctx, qtx, input.PartyID, input.NewParty,
		actorID, requestID, canReadMatchedParty)
	if err != nil {
		return SalesPartnerCreateResult{}, err
	}
	counter, err := qtx.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntitySalesPartner})
	if err != nil {
		return SalesPartnerCreateResult{}, s.writeError("allocate sales relationship number", err)
	}
	objectID, versionID := newID(), newID()
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: objectID, Entity: EntitySalesPartner,
		Code: fmt.Sprintf("SLP-%04d", counter), CurrentVersionID: versionID, ActorID: actorID}); err != nil {
		return SalesPartnerCreateResult{}, s.writeError("insert sales relationship", err)
	}
	if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: versionID, ObjectID: objectID,
		Entity: EntitySalesPartner, VersionNo: 1, ActorID: actorID}); err != nil {
		return SalesPartnerCreateResult{}, s.writeError("insert sales relationship version", err)
	}
	if err = qtx.InsertBobSalesRelationship(ctx, dbsqlc.InsertBobSalesRelationshipParams{ObjectID: objectID,
		PartyID: party.ID, OperatingEntityID: data.OperatingEntityID, ActorID: actorID}); err != nil {
		return SalesPartnerCreateResult{}, s.writeError("insert Sales Relationship", err)
	}
	if err = insertSalesPartnerData(ctx, qtx, versionID, data); err != nil {
		return SalesPartnerCreateResult{}, s.writeError("insert sales relationship detail", err)
	}
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: objectID, VersionID: versionID,
		Entity: EntitySalesPartner, Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fields": []string{"capabilities", "contactName", "contactPhone", "email", "address", "remark"}}}); err != nil {
		return SalesPartnerCreateResult{}, s.writeError("audit sales relationship create", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return SalesPartnerCreateResult{}, s.writeError("commit sales relationship create", err)
	}
	return SalesPartnerCreateResult{MutationResult: MutationResult{ObjectID: objectID, ObjectRevision: 1,
		Enabled: true, VersionID: versionID, Version: 1, Status: StatusDraft, Revision: 1}, PartyID: party.ID}, nil
}

func (s *Service) SalesPartnerSave(ctx context.Context, input SalesPartnerSaveInput, actorID, requestID string) (MutationResult, error) {
	if !validWriteInput(EntitySalesPartner, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid sales relationship save", nil, nil)
	}
	data, err := normalizeSalesPartnerData(input.Data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid sales relationship", nil, err)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, EntitySalesPartner, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || version.Revision != input.Revision {
		return MutationResult{}, conflict(object, version, "sales relationship changed before save")
	}
	targetVersionID, targetVersionNo := input.VersionID, version.VersionNo
	objectRevision, createdCandidate := object.Revision, false
	if version.Status == StatusEffective && object.EffectiveVersionID != nil && *object.EffectiveVersionID == input.VersionID {
		targetVersionID, targetVersionNo = newID(), object.NextVersionNo
		if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: targetVersionID, ObjectID: input.ObjectID,
			Entity: EntitySalesPartner, VersionNo: targetVersionNo, ActorID: actorID}); err != nil {
			return MutationResult{}, s.writeError("insert sales relationship candidate", err)
		}
		rows, advanceErr := qtx.AdvanceBobSalesPartnerCandidate(ctx, dbsqlc.AdvanceBobSalesPartnerCandidateParams{
			VersionID: targetVersionID, ActorID: actorID, ObjectID: input.ObjectID,
			Revision: object.Revision, CurrentVersionID: input.VersionID})
		if advanceErr != nil || rows != 1 {
			return MutationResult{}, conflict(object, version, "sales relationship changed before save")
		}
		objectRevision++
		createdCandidate = true
	} else if version.Status != StatusDraft || (object.EffectiveVersionID != nil && object.CurrentVersionID == *object.EffectiveVersionID) {
		return MutationResult{}, conflict(object, version, "sales relationship changed before save")
	}
	if createdCandidate {
		err = insertSalesPartnerData(ctx, qtx, targetVersionID, data)
	} else {
		var rows int64
		rows, err = updateSalesPartnerData(ctx, qtx, targetVersionID, data)
		if err == nil && rows != 1 {
			err = errors.New("sales relationship detail changed")
		}
		if err == nil {
			rows, err = qtx.MarkBobVersionSaved(ctx, dbsqlc.MarkBobVersionSavedParams{ActorID: actorID,
				ID: targetVersionID, ObjectID: input.ObjectID, Entity: EntitySalesPartner, Revision: input.Revision})
			if err == nil && rows != 1 {
				err = errors.New("sales relationship version changed")
			}
		}
		if err == nil {
			err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: EntitySalesPartner})
		}
	}
	if err != nil {
		return MutationResult{}, s.writeError("save sales relationship", err)
	}
	event := "SAVED"
	if createdCandidate {
		event = "CREATED"
	}
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: input.ObjectID, VersionID: targetVersionID,
		Entity: EntitySalesPartner, Event: event, To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fields": []string{"capabilities", "contactName", "contactPhone", "email", "address", "remark"}}}); err != nil {
		return MutationResult{}, s.writeError("audit sales relationship save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit sales relationship save", err)
	}
	revision := input.Revision + 1
	if createdCandidate {
		revision = 1
	}
	return MutationResult{ObjectID: input.ObjectID, ObjectRevision: objectRevision, Enabled: object.Enabled,
		VersionID: targetVersionID, Version: targetVersionNo, Status: StatusDraft, Revision: revision}, nil
}

func (s *Service) SalesPartnerQuery(ctx context.Context, input QueryInput) (Page[SalesPartnerListItem], error) {
	if input.Page < 1 || input.PageSize != 20 || len(input.Sort) > 1 ||
		(len(input.Sort) == 1 && (input.Sort[0].Field != "code" || strings.ToLower(input.Sort[0].Order) != "asc")) {
		return Page[SalesPartnerListItem]{}, domainError(ErrorValidation, "invalid sales relationship query", nil, nil)
	}
	statuses := uniqueStrings(input.Filters.Status)
	for _, status := range statuses {
		if !validStatus(status) {
			return Page[SalesPartnerListItem]{}, domainError(ErrorValidation, "invalid sales relationship status", nil, nil)
		}
	}
	capability := strings.TrimSpace(input.Filters.Capability)
	if capability != "" {
		if _, err := normalizeSalesPartnerCapabilities([]string{capability}); err != nil {
			return Page[SalesPartnerListItem]{}, err
		}
	}
	enabledFilter := int32(-1)
	if input.Filters.Enabled != nil {
		if *input.Filters.Enabled {
			enabledFilter = 1
		} else {
			enabledFilter = 0
		}
	}
	params := dbsqlc.CountBobSalesPartnersParams{Keyword: strings.TrimSpace(input.Filters.Keyword), Statuses: statuses,
		EnabledFilter: enabledFilter, OperatingEntityID: strings.TrimSpace(input.Filters.OperatingEntityID), Capability: capability}
	total, err := s.queries.CountBobSalesPartners(ctx, params)
	if err != nil {
		return Page[SalesPartnerListItem]{}, s.internal("count sales relationships", err)
	}
	rows, err := s.queries.ListBobSalesPartners(ctx, dbsqlc.ListBobSalesPartnersParams{Keyword: params.Keyword,
		Statuses: params.Statuses, EnabledFilter: params.EnabledFilter, OperatingEntityID: params.OperatingEntityID,
		Capability: params.Capability, RowOffset: int32((input.Page - 1) * input.PageSize), RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[SalesPartnerListItem]{}, s.internal("list sales relationships", err)
	}
	items := make([]SalesPartnerListItem, 0, len(rows))
	for _, row := range rows {
		item := SalesPartnerListItem{ObjectID: row.ObjectID, Code: row.Code, ObjectRevision: row.ObjectRevision,
			Enabled: row.Enabled, PartyID: row.PartyID, PartyKind: row.PartyKind, PartyDisplayName: row.PartyDisplayName,
			OperatingEntityID: row.OperatingEntityID, OperatingEntityCode: row.OperatingEntityCode,
			OperatingEntityName: row.OperatingEntityName, UpdatedAt: row.UpdatedAt.Time}
		if row.EffectiveVersionID != nil {
			item.Effective = &SalesPartnerListVersion{VersionID: *row.EffectiveVersionID,
				Version: *row.EffectiveVersionNo, Status: deref(row.EffectiveStatus), Revision: *row.EffectiveRevision,
				Capabilities: row.EffectiveCapabilities, SubmittedBy: row.EffectiveSubmittedBy}
		}
		if row.CandidateVersionID != nil {
			item.Candidate = &SalesPartnerListVersion{VersionID: *row.CandidateVersionID,
				Version: *row.CandidateVersionNo, Status: deref(row.CandidateStatus), Revision: *row.CandidateRevision,
				Capabilities: row.CandidateCapabilities, SubmittedBy: row.CandidateSubmittedBy}
		}
		items = append(items, item)
	}
	return Page[SalesPartnerListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) SalesPartnerGet(ctx context.Context, input GetInput) (SalesPartnerDetailView, error) {
	if !validID(input.ObjectID) || (input.VersionID != "" && !validID(input.VersionID)) {
		return SalesPartnerDetailView{}, domainError(ErrorValidation, "invalid sales relationship", nil, nil)
	}
	row, err := s.queries.GetBobSalesPartner(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SalesPartnerDetailView{}, domainError(ErrorValidation, "sales relationship not found", nil, nil)
	}
	if err != nil {
		return SalesPartnerDetailView{}, s.internal("get sales relationship", err)
	}
	result := SalesPartnerDetailView{ObjectID: row.ObjectID, Code: row.Code, ObjectRevision: row.ObjectRevision,
		Enabled: row.Enabled, PartyID: row.PartyID, PartyKind: row.PartyKind, PartyDisplayName: row.PartyDisplayName,
		OperatingEntityID: row.OperatingEntityID, OperatingEntityCode: row.OperatingEntityCode,
		OperatingEntityName: row.OperatingEntityName, UpdatedAt: row.UpdatedAt.Time}
	load := func(versionID string) (*SalesPartnerVersionView, error) {
		versionRow, loadErr := s.queries.GetBobSalesPartnerVersion(ctx, dbsqlc.GetBobSalesPartnerVersionParams{ObjectID: input.ObjectID, VersionID: versionID})
		if loadErr != nil {
			return nil, loadErr
		}
		return &SalesPartnerVersionView{Version: VersionMeta{VersionID: versionRow.ID, Version: versionRow.VersionNo,
			Status: versionRow.Status, Revision: versionRow.Revision, CreatedAt: versionRow.CreatedAt.Time, CreatedBy: versionRow.CreatedBy,
			UpdatedAt: versionRow.UpdatedAt.Time, UpdatedBy: versionRow.UpdatedBy, SubmittedAt: timePointer(versionRow.SubmittedAt),
			SubmittedBy: versionRow.SubmittedBy, ReviewedAt: timePointer(versionRow.ReviewedAt), ReviewedBy: versionRow.ReviewedBy,
			ReviewComment: versionRow.ReviewComment}, Data: SalesPartnerData{Capabilities: versionRow.Capabilities,
			ContactName: versionRow.ContactName, ContactPhone: versionRow.ContactPhone, Email: versionRow.Email,
			Address: versionRow.Address, Remark: versionRow.Remark}}, nil
	}
	if input.VersionID != "" {
		version, loadErr := load(input.VersionID)
		if loadErr != nil {
			return SalesPartnerDetailView{}, s.internal("load sales relationship version", loadErr)
		}
		if version.Version.Status == StatusEffective || version.Version.Status == StatusInvalid {
			result.Effective = version
		} else {
			result.Candidate = version
		}
		return result, nil
	}
	if row.EffectiveVersionID != nil {
		result.Effective, err = load(*row.EffectiveVersionID)
		if err != nil {
			return SalesPartnerDetailView{}, s.internal("load effective sales relationship", err)
		}
	}
	if row.EffectiveVersionID == nil || row.CurrentVersionID != *row.EffectiveVersionID {
		result.Candidate, err = load(row.CurrentVersionID)
		if err != nil {
			return SalesPartnerDetailView{}, s.internal("load candidate sales relationship", err)
		}
	}
	return result, nil
}

func insertSalesPartnerData(ctx context.Context, q *dbsqlc.Queries, versionID string, data SalesPartnerData) error {
	return q.InsertBobSalesPartnerDetail(ctx, dbsqlc.InsertBobSalesPartnerDetailParams{VersionID: versionID,
		Capabilities: data.Capabilities, ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone),
		Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address), Remark: nilIfEmpty(data.Remark)})
}

func updateSalesPartnerData(ctx context.Context, q *dbsqlc.Queries, versionID string, data SalesPartnerData) (int64, error) {
	return q.UpdateBobSalesPartnerDetail(ctx, dbsqlc.UpdateBobSalesPartnerDetailParams{VersionID: versionID,
		Capabilities: data.Capabilities, ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone),
		Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address), Remark: nilIfEmpty(data.Remark)})
}
