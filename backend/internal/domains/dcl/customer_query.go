package dcl

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

type CustomerGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}

type CustomerQueryFilters struct {
	Keyword           string            `json:"keyword,omitempty"`
	Status            []approval.Status `json:"status,omitempty"`
	Enabled           *bool             `json:"enabled,omitempty"`
	OperatingEntityID string            `json:"operatingEntityId,omitempty"`
	PartyID           string            `json:"partyId,omitempty"`
}

type CustomerQueryInput struct {
	Page     int                       `json:"page"`
	PageSize int                       `json:"pageSize"`
	Filters  CustomerQueryFilters      `json:"filters"`
	Sort     []OperatingEntitySortItem `json:"sort"`
}

type CustomerHistoryInput struct {
	ObjectID string `json:"objectId"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

type CustomerView struct {
	ObjectID                       string                     `json:"objectId"`
	Entity                         string                     `json:"entity"`
	Code                           string                     `json:"code"`
	PartyID                        string                     `json:"partyId"`
	PartyKind                      string                     `json:"partyKind"`
	PartyDisplayName               string                     `json:"partyDisplayName"`
	OperatingEntityID              string                     `json:"operatingEntityId"`
	OperatingEntityApprovalEntryID string                     `json:"operatingEntityApprovalEntryId"`
	OperatingEntityCode            string                     `json:"operatingEntityCode"`
	OperatingEntityName            string                     `json:"operatingEntityName"`
	Enabled                        bool                       `json:"enabled"`
	Approval                       approval.VersionMeta       `json:"approval"`
	Attachments                    []CustomerAttachmentView   `json:"attachments"`
	UpdatedAt                      time.Time                  `json:"updatedAt"`
	AvailableApprovalActions       []approval.LifecycleAction `json:"availableApprovalActions"`
}

type CustomerVersionView struct {
	Approval    approval.VersionMeta     `json:"approval"`
	Enabled     bool                     `json:"enabled"`
	Attachments []CustomerAttachmentView `json:"attachments"`
}

type CustomerQueryItem struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	PartyID                  string                     `json:"partyId"`
	PartyKind                string                     `json:"partyKind"`
	PartyDisplayName         string                     `json:"partyDisplayName"`
	OperatingEntityID        string                     `json:"operatingEntityId"`
	OperatingEntityCode      string                     `json:"operatingEntityCode"`
	OperatingEntityName      string                     `json:"operatingEntityName"`
	Enabled                  bool                       `json:"enabled"`
	LatestApproved           *CustomerVersionView       `json:"latestApproved"`
	OpenVersion              *CustomerVersionView       `json:"openVersion"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}

func (s *CustomerService) Query(ctx context.Context, in CustomerQueryInput, actor approval.Actor) (Page[CustomerQueryItem], error) {
	offset, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || in.PageSize != 20 || !validActor(actor) || len(in.Sort) > 1 ||
		(in.Filters.OperatingEntityID != "" && !validID(in.Filters.OperatingEntityID)) ||
		(in.Filters.PartyID != "" && !validID(in.Filters.PartyID)) {
		return Page[CustomerQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid customer query", nil, nil)
	}
	if len(in.Sort) == 1 && (in.Sort[0].Field != "code" || strings.ToLower(in.Sort[0].Order) != "asc") {
		return Page[CustomerQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid customer sort", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[CustomerQueryItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(in.Filters.Status))
	for _, status := range in.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, status) || slices.Contains(statuses, string(status)) {
			return Page[CustomerQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid customer status", nil, nil)
		}
		statuses = append(statuses, string(status))
	}
	enabled := int32(-1)
	if in.Filters.Enabled != nil {
		if *in.Filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	p := dbsqlc.ListDCLCustomersParams{
		Keyword: strings.TrimSpace(in.Filters.Keyword), EnabledFilter: enabled,
		OperatingEntityID: strings.TrimSpace(in.Filters.OperatingEntityID), PartyID: strings.TrimSpace(in.Filters.PartyID),
		StatusFilter: statuses, RowOffset: offset, RowLimit: int32(in.PageSize),
	}
	rows, err := s.queries.ListDCLCustomers(ctx, p)
	if err != nil {
		return Page[CustomerQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLCustomers(ctx, dbsqlc.CountDCLCustomersParams{
		Keyword: p.Keyword, EnabledFilter: p.EnabledFilter, OperatingEntityID: p.OperatingEntityID, PartyID: p.PartyID, StatusFilter: p.StatusFilter,
	})
	if err != nil {
		return Page[CustomerQueryItem]{}, translateError(err)
	}
	items := make([]CustomerQueryItem, 0, len(rows))
	for _, row := range rows {
		item := CustomerQueryItem{
			ObjectID: row.ObjectID, Entity: EntityCustomer, Code: row.Code,
			PartyID: row.PartyID, PartyKind: row.PartyKind, PartyDisplayName: row.DisplayName,
			OperatingEntityID: row.OperatingEntityID, OperatingEntityCode: row.OperatingEntityCode,
			OperatingEntityName: row.OperatingEntityName, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time,
		}
		if row.LatestApprovedEntryID != "" {
			version, e := s.customerVersion(ctx, s.queries, row.LatestApprovedEntryID, row.ObjectID)
			if e != nil {
				return Page[CustomerQueryItem]{}, e
			}
			item.LatestApproved = &version
		}
		if row.OpenEntryID != "" {
			version, e := s.customerVersion(ctx, s.queries, row.OpenEntryID, row.ObjectID)
			if e != nil {
				return Page[CustomerQueryItem]{}, e
			}
			item.OpenVersion = &version
		}
		entry, ok, entryErr := dclActiveEntry(ctx, s.queries, EntityCustomer, row.OpenEntryID, row.LatestApprovedEntryID)
		if entryErr != nil {
			return Page[CustomerQueryItem]{}, entryErr
		}
		if ok {
			item.AvailableApprovalActions = s.coordinator.LifecycleActions(entry, actor)
		}
		items = append(items, item)
	}
	return Page[CustomerQueryItem]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *CustomerService) Get(ctx context.Context, in CustomerGetInput, actor approval.Actor) (CustomerView, error) {
	if !validID(in.ObjectID) || (in.ApprovalEntryID != "" && !validID(in.ApprovalEntryID)) || !validActor(actor) {
		return CustomerView{}, newError(ErrorValidation, "validation_failed", "invalid customer get", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerView{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	entryID := in.ApprovalEntryID
	var entry approval.Entry
	if entryID == "" {
		entry, err = s.coordinator.GetOpenVersion(ctx, tx, in.ObjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			row, lookup := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityCustomer, SubjectID: in.ObjectID})
			if lookup == nil {
				entryID = row.ID
				entry, err = s.coordinator.Get(ctx, tx, entryID, actor)
			} else {
				err = lookup
			}
		} else if err == nil {
			entryID = entry.ID
		}
	} else {
		entry, err = s.coordinator.Get(ctx, tx, entryID, actor)
	}
	if err != nil || entry.SubjectID != in.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "customer declaration not found", nil, nil)
		}
		return CustomerView{}, translateError(err)
	}
	identity, err := lockRelationshipIdentity(ctx, tx, EntityCustomer, in.ObjectID)
	if err != nil {
		return CustomerView{}, translateError(err)
	}
	party, err := s.partyReader.ResolveForRelationship(ctx, tx, identity.PartyID)
	if err != nil {
		return CustomerView{}, translateError(err)
	}
	stored, err := q.GetDCLCustomerVersion(ctx, entryID)
	if err != nil {
		return CustomerView{}, translateError(err)
	}
	attachments, err := ListCustomerAttachments(ctx, q, entryID)
	if err != nil {
		return CustomerView{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerView{}, translateError(err)
	}
	return CustomerView{
		ObjectID: identity.ObjectID, Entity: EntityCustomer, Code: identity.Code,
		PartyID: identity.PartyID, PartyKind: party.Kind, PartyDisplayName: party.DisplayName,
		OperatingEntityID: identity.OperatingEntityID, OperatingEntityApprovalEntryID: stored.OperatingEntityApprovalEntryID,
		OperatingEntityCode: stored.OperatingEntityCode, OperatingEntityName: stored.OperatingEntityName,
		Enabled: stored.Enabled, Approval: approval.VersionMetaFromEntry(entry), Attachments: attachments, UpdatedAt: entry.UpdatedAt,
		AvailableApprovalActions: s.coordinator.LifecycleActions(entry, actor),
	}, nil
}

func (s *CustomerService) Versions(ctx context.Context, in CustomerHistoryInput, actor approval.Actor) (Page[CustomerVersionView], error) {
	if _, ok := dclPageOffset(in.Page, in.PageSize); !ok || in.PageSize != 20 || !validID(in.ObjectID) || !validActor(actor) {
		return Page[CustomerVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid customer history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[CustomerVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	entries, err := s.coordinator.ListVersions(ctx, tx, in.ObjectID, actor)
	if err != nil {
		return Page[CustomerVersionView]{}, translateError(err)
	}
	start := (in.Page - 1) * in.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+in.PageSize, len(entries))
	items := make([]CustomerVersionView, 0, end-start)
	for _, entry := range entries[start:end] {
		view, e := s.customerVersion(ctx, s.queries.WithTx(tx), entry.ID, in.ObjectID)
		if e != nil {
			return Page[CustomerVersionView]{}, e
		}
		items = append(items, view)
	}
	return Page[CustomerVersionView]{Items: items, Total: int64(len(entries)), Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *CustomerService) AuditHistory(ctx context.Context, in CustomerHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || in.PageSize != 20 || !validID(in.ObjectID) || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid customer audit history", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	if _, err := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: in.ObjectID, Entity: EntityCustomer}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "customer declaration not found", nil, err)
		}
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLCustomerApprovalEvents(ctx, dbsqlc.ListDCLCustomerApprovalEventsParams{ObjectID: in.ObjectID, RowOffset: offset, RowLimit: int32(in.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLCustomerApprovalEvents(ctx, in.ObjectID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, row := range rows {
		items = append(items, approvalEventView(row))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *CustomerService) customerVersion(ctx context.Context, q *dbsqlc.Queries, entryID, objectID string) (CustomerVersionView, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityCustomer})
	if err != nil {
		return CustomerVersionView{}, translateError(err)
	}
	if entry.SubjectID != objectID {
		return CustomerVersionView{}, newError(ErrorValidation, "validation_failed", "customer version does not belong to subject", nil, nil)
	}
	stored, err := q.GetDCLCustomerVersion(ctx, entryID)
	if err != nil {
		return CustomerVersionView{}, translateError(err)
	}
	attachments, err := ListCustomerAttachments(ctx, q, entryID)
	if err != nil {
		return CustomerVersionView{}, translateError(err)
	}
	return CustomerVersionView{Approval: approval.VersionMetaFromEntry(approvalEntry(entry)), Enabled: stored.Enabled, Attachments: attachments}, nil
}
