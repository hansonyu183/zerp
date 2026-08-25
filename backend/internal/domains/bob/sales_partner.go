package bob

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
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
	ObjectID         string           `json:"objectId"`
	ApprovalEntryID  string           `json:"approvalEntryId"`
	ApprovalRevision int64            `json:"approvalRevision"`
	Data             SalesPartnerData `json:"data"`
}

type SalesPartnerCreateResult struct {
	MutationResult
	PartyID string `json:"partyId"`
}

type SalesPartnerVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     SalesPartnerData     `json:"data"`
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
	LatestApproved      *SalesPartnerVersionView `json:"latestApproved"`
	OpenVersion         *SalesPartnerVersionView `json:"openVersion"`
	UpdatedAt           time.Time                `json:"updatedAt"`
}

type SalesPartnerListVersion struct {
	Approval     approval.VersionMeta `json:"approval"`
	Capabilities []string             `json:"capabilities"`
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
	LatestApproved      *SalesPartnerListVersion `json:"latestApproved"`
	OpenVersion         *SalesPartnerListVersion `json:"openVersion"`
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

func (s *Service) SalesPartnerCreate(ctx context.Context, input SalesPartnerCreateInput, actor approval.Actor, canReadMatchedParty bool) (SalesPartnerCreateResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
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
	if _, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, data.OperatingEntityID); err != nil {
		return SalesPartnerCreateResult{}, domainError(ErrorConflict, "经营主体不可用", nil, err)
	}
	party, err := s.resolveOrCreateRelationshipParty(ctx, qtx, input.PartyID, input.NewParty,
		actorID, requestID, canReadMatchedParty, tx)
	if err != nil {
		return SalesPartnerCreateResult{}, err
	}
	counter, err := qtx.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntitySalesPartner})
	if err != nil {
		return SalesPartnerCreateResult{}, s.writeError("allocate sales relationship number", err)
	}
	objectID := newID()
	code := fmt.Sprintf("SLP-%04d", counter)
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: objectID, Entity: EntitySalesPartner,
		Code: code, ActorID: actorID}); err != nil {
		return SalesPartnerCreateResult{}, s.writeError("insert sales relationship", err)
	}
	entry, err := s.createFirstApproval(ctx, tx, EntitySalesPartner, objectID, code, true, actor)
	if err != nil {
		return SalesPartnerCreateResult{}, translateApprovalError(err)
	}
	if err = qtx.InsertBobSalesPartnerRelationship(ctx, dbsqlc.InsertBobSalesPartnerRelationshipParams{ObjectID: objectID,
		PartyID: party.ID, OperatingEntityID: data.OperatingEntityID, ActorID: actorID}); err != nil {
		return SalesPartnerCreateResult{}, s.writeError("insert Sales Relationship", err)
	}
	if err = insertDetail(ctx, qtx, EntitySalesPartner, entry.ID, salesPartnerDetail(data)); err != nil {
		return SalesPartnerCreateResult{}, s.writeError("insert sales relationship detail", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return SalesPartnerCreateResult{}, s.writeError("commit sales relationship create", err)
	}
	return SalesPartnerCreateResult{MutationResult: approvalMutation(objectID, 1, true, entry), PartyID: party.ID}, nil
}

func (s *Service) SalesPartnerSave(ctx context.Context, input SalesPartnerSaveInput, actor approval.Actor) (MutationResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
	if !validWriteInput(EntitySalesPartner, input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid sales relationship save", nil, nil)
	}
	data, err := normalizeSalesPartnerData(input.Data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid sales relationship", nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin sales relationship save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: input.ObjectID, Entity: EntitySalesPartner})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "sales relationship not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock sales relationship", err)
	}
	entry, err := s.entryForObject(ctx, qtx, EntitySalesPartner, input.ObjectID, input.ApprovalEntryID)
	if err != nil {
		return MutationResult{}, err
	}
	if entry.Revision != input.ApprovalRevision {
		return MutationResult{}, domainErrorWithKey(ErrorConflict, "approval_stale_revision", "sales relationship changed before save", nil, nil)
	}
	target := approvalEntry(entry)
	if approval.Status(entry.Status) == approval.StatusApproved {
		target, err = s.createNextApproval(ctx, tx, EntitySalesPartner, input.ObjectID, object.Code, object.Enabled, actor)
		if err == nil {
			err = copyDetail(ctx, qtx, EntitySalesPartner, target.ID, entry.ID)
		}
		if err != nil {
			return MutationResult{}, s.writeError("copy sales relationship approval payload", err)
		}
	} else if approval.Status(entry.Status) != approval.StatusDraft {
		return MutationResult{}, domainError(ErrorConflict, "only a draft or latest approved version can be saved", nil, nil)
	}
	identity, err := qtx.GetBobSalesPartnerRelationship(ctx, input.ObjectID)
	if err != nil {
		return MutationResult{}, s.internal("load sales relationship identity", err)
	}
	if identity.OperatingEntityID != data.OperatingEntityID {
		return MutationResult{}, domainError(ErrorValidation, "sales relationship operating entity must match relationship", nil, nil)
	}
	err = updateDetail(ctx, qtx, EntitySalesPartner, target.ID, salesPartnerDetail(data))
	if err != nil {
		return MutationResult{}, s.writeError("save sales relationship", err)
	}
	target, err = s.transitionApproval(ctx, tx, EntitySalesPartner, input.ObjectID, object.Code, object.Enabled, target.ID, target.Revision, approval.ActionSaved, "", actor)
	if err != nil {
		return MutationResult{}, translateApprovalError(err)
	}
	touched, err := qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: input.ObjectID, Entity: EntitySalesPartner})
	if err != nil {
		return MutationResult{}, s.writeError("touch sales relationship", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit sales relationship save", err)
	}
	return approvalMutation(touched.ID, touched.Revision, touched.Enabled, target), nil
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
	if input.Filters.OperatingEntityID != "" && !validID(strings.TrimSpace(input.Filters.OperatingEntityID)) {
		return Page[SalesPartnerListItem]{}, domainError(ErrorValidation, "invalid operating entity filter", nil, nil)
	}
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
	params := bobListParams(EntitySalesPartner, input.Filters, enabledFilter, statuses, "code", "asc", int32((input.Page-1)*input.PageSize), int32(input.PageSize))
	total, err := s.queries.CountBobObjects(ctx, bobCountParams(params))
	if err != nil {
		return Page[SalesPartnerListItem]{}, s.internal("count sales relationships", err)
	}
	rows, err := s.queries.ListBobObjects(ctx, params)
	if err != nil {
		return Page[SalesPartnerListItem]{}, s.internal("list sales relationships", err)
	}
	items := make([]SalesPartnerListItem, 0, len(rows))
	for _, row := range rows {
		item := SalesPartnerListItem{ObjectID: row.ObjectID, Code: row.Code, ObjectRevision: row.ObjectRevision, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time}
		identity, identityErr := s.queries.GetBobSalesPartnerRelationship(ctx, row.ObjectID)
		if identityErr != nil {
			return Page[SalesPartnerListItem]{}, s.internal("get sales relationship identity", identityErr)
		}
		party, partyErr := s.queries.GetBobParty(ctx, identity.PartyID)
		if partyErr != nil {
			return Page[SalesPartnerListItem]{}, s.internal("get sales relationship party", partyErr)
		}
		item.PartyID, item.PartyKind, item.PartyDisplayName, item.OperatingEntityID = party.ID, party.Kind, party.DisplayName, identity.OperatingEntityID
		item.OperatingEntityCode, item.OperatingEntityName, identityErr = s.relationshipOperatingEntity(ctx, identity.OperatingEntityID)
		if identityErr != nil {
			return Page[SalesPartnerListItem]{}, s.internal("get sales relationship operating entity", identityErr)
		}
		if row.ApprovalEntryID != "" {
			version, entryErr := s.loadSalesPartnerVersion(ctx, s.queries, row.ObjectID, row.ApprovalEntryID)
			if entryErr != nil {
				return Page[SalesPartnerListItem]{}, entryErr
			}
			item.LatestApproved = &SalesPartnerListVersion{Approval: version.Approval, Capabilities: version.Data.Capabilities}
		}
		if row.OpenApprovalEntryID != "" {
			version, entryErr := s.loadSalesPartnerVersion(ctx, s.queries, row.ObjectID, row.OpenApprovalEntryID)
			if entryErr != nil {
				return Page[SalesPartnerListItem]{}, entryErr
			}
			item.OpenVersion = &SalesPartnerListVersion{Approval: version.Approval, Capabilities: version.Data.Capabilities}
		}
		if len(statuses) > 0 && (item.OpenVersion == nil || !slices.Contains(statuses, string(item.OpenVersion.Approval.Status))) && (item.LatestApproved == nil || !slices.Contains(statuses, string(item.LatestApproved.Approval.Status))) {
			continue
		}
		items = append(items, item)
	}
	return Page[SalesPartnerListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) SalesPartnerGet(ctx context.Context, input GetInput) (SalesPartnerDetailView, error) {
	if !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) {
		return SalesPartnerDetailView{}, domainError(ErrorValidation, "invalid sales relationship", nil, nil)
	}
	row, err := s.queries.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: input.ObjectID, Entity: EntitySalesPartner})
	if errors.Is(err, pgx.ErrNoRows) {
		return SalesPartnerDetailView{}, domainError(ErrorValidation, "sales relationship not found", nil, nil)
	}
	if err != nil {
		return SalesPartnerDetailView{}, s.internal("get sales relationship", err)
	}
	identity, err := s.queries.GetBobSalesPartnerRelationship(ctx, input.ObjectID)
	if err != nil {
		return SalesPartnerDetailView{}, s.internal("get sales relationship identity", err)
	}
	party, err := s.queries.GetBobParty(ctx, identity.PartyID)
	if err != nil {
		return SalesPartnerDetailView{}, s.internal("get sales relationship party", err)
	}
	result := SalesPartnerDetailView{ObjectID: row.ID, Code: row.Code, ObjectRevision: row.Revision, Enabled: row.Enabled,
		PartyID: party.ID, PartyKind: party.Kind, PartyDisplayName: party.DisplayName, OperatingEntityID: identity.OperatingEntityID, UpdatedAt: row.UpdatedAt.Time}
	result.OperatingEntityCode, result.OperatingEntityName, err = s.relationshipOperatingEntity(ctx, identity.OperatingEntityID)
	if err != nil {
		return SalesPartnerDetailView{}, s.internal("get sales relationship operating entity", err)
	}
	if input.ApprovalEntryID != "" {
		version, loadErr := s.loadSalesPartnerVersion(ctx, s.queries, input.ObjectID, input.ApprovalEntryID)
		if loadErr != nil {
			return SalesPartnerDetailView{}, loadErr
		}
		if version.Approval.Status == approval.StatusApproved {
			result.LatestApproved = &version
		} else {
			result.OpenVersion = &version
		}
		return result, nil
	}
	if entry, latestErr := s.queries.GetBobLatestApprovedEntry(ctx, dbsqlc.GetBobLatestApprovedEntryParams{Entity: EntitySalesPartner, ObjectID: input.ObjectID}); latestErr == nil {
		version, loadErr := s.loadSalesPartnerVersion(ctx, s.queries, input.ObjectID, entry.ID)
		if loadErr != nil {
			return SalesPartnerDetailView{}, loadErr
		}
		result.LatestApproved = &version
	} else if !errors.Is(latestErr, pgx.ErrNoRows) {
		return SalesPartnerDetailView{}, s.internal("get latest approved sales relationship", latestErr)
	}
	if entry, openErr := s.queries.GetBobOpenEntry(ctx, dbsqlc.GetBobOpenEntryParams{Entity: EntitySalesPartner, ObjectID: input.ObjectID}); openErr == nil {
		version, loadErr := s.loadSalesPartnerVersion(ctx, s.queries, input.ObjectID, entry.ID)
		if loadErr != nil {
			return SalesPartnerDetailView{}, loadErr
		}
		result.OpenVersion = &version
	} else if !errors.Is(openErr, pgx.ErrNoRows) {
		return SalesPartnerDetailView{}, s.internal("get open sales relationship", openErr)
	}
	return result, nil
}

func (s *Service) loadSalesPartnerVersion(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (SalesPartnerVersionView, error) {
	entry, err := s.entryForObject(ctx, q, EntitySalesPartner, objectID, entryID)
	if err != nil {
		return SalesPartnerVersionView{}, err
	}
	data, err := loadDetail(ctx, q, EntitySalesPartner, entry.ID)
	if err != nil {
		return SalesPartnerVersionView{}, s.internal("load sales relationship payload", err)
	}
	return SalesPartnerVersionView{Approval: approvalMeta(entry), Data: salesPartnerData(data)}, nil
}

func salesPartnerData(data DetailView) SalesPartnerData {
	return SalesPartnerData{Capabilities: data.SalesCapabilities, ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, Remark: data.Remark}
}

func salesPartnerDetail(data SalesPartnerData) DetailView {
	return DetailView{SalesCapabilities: data.Capabilities, ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, Remark: data.Remark}
}
