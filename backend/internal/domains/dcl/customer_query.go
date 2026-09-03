package dcl

import (
	"context"
	"encoding/json"
	"errors"
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
	Keyword                  string            `json:"keyword,omitempty"`
	Status                   []approval.Status `json:"status,omitempty"`
	Enabled                  *bool             `json:"enabled,omitempty"`
	DefaultOperatingEntityID string            `json:"defaultOperatingEntityId,omitempty"`
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
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Approval                 approval.VersionMeta       `json:"approval"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
	Data                     CustomerData               `json:"data"`
	Attachments              []CustomerAttachmentView   `json:"attachments"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
}
type CustomerVersionView struct {
	Approval    approval.VersionMeta     `json:"approval"`
	Data        CustomerData             `json:"data"`
	Attachments []CustomerAttachmentView `json:"attachments"`
}
type CustomerVersionSummary struct {
	Approval    approval.VersionMeta `json:"approval"`
	DisplayName string               `json:"displayName"`
	Enabled     bool                 `json:"enabled"`
}
type CustomerQueryItem struct {
	ObjectID                   string                     `json:"objectId"`
	Entity                     string                     `json:"entity"`
	Code                       string                     `json:"code"`
	DisplayName                string                     `json:"displayName"`
	DefaultOperatingEntityCode string                     `json:"defaultOperatingEntityCode"`
	LatestApproved             *CustomerVersionSummary    `json:"latestApproved,omitempty"`
	OpenVersion                *CustomerVersionSummary    `json:"openVersion,omitempty"`
	UpdatedAt                  time.Time                  `json:"updatedAt"`
	AvailableApprovalActions   []approval.LifecycleAction `json:"availableApprovalActions"`
}

func (s *CustomerService) Query(ctx context.Context, in CustomerQueryInput, actor approval.Actor) (Page[CustomerQueryItem], error) {
	offset, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || in.PageSize != 20 || !validActor(actor) || len(in.Sort) > 1 || (in.Filters.DefaultOperatingEntityID != "" && !validID(in.Filters.DefaultOperatingEntityID)) {
		return Page[CustomerQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid customer query", nil, nil)
	}
	if len(in.Sort) == 1 && (in.Sort[0].Field != "code" || strings.ToLower(in.Sort[0].Order) != "asc") {
		return Page[CustomerQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid customer sort", nil, nil)
	}
	if err := s.authorizeCustomerRead(ctx, actor, "query"); err != nil {
		return Page[CustomerQueryItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(in.Filters.Status))
	for _, status := range in.Filters.Status {
		if status != approval.StatusDraft && status != approval.StatusPending && status != approval.StatusApproved {
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
	p := dbsqlc.ListDCLCustomerAggregatesParams{Keyword: strings.TrimSpace(in.Filters.Keyword), EnabledFilter: enabled, DefaultOperatingEntityID: strings.TrimSpace(in.Filters.DefaultOperatingEntityID), StatusFilter: statuses, RowOffset: offset, RowLimit: int32(in.PageSize)}
	rows, err := s.queries.ListDCLCustomerAggregates(ctx, p)
	if err != nil {
		return Page[CustomerQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLCustomerAggregates(ctx, dbsqlc.CountDCLCustomerAggregatesParams{Keyword: p.Keyword, EnabledFilter: p.EnabledFilter, DefaultOperatingEntityID: p.DefaultOperatingEntityID, StatusFilter: p.StatusFilter})
	if err != nil {
		return Page[CustomerQueryItem]{}, translateError(err)
	}
	items := make([]CustomerQueryItem, 0, len(rows))
	for _, row := range rows {
		var data CustomerData
		if err = json.Unmarshal(row.Data, &data); err != nil {
			return Page[CustomerQueryItem]{}, translateError(err)
		}
		code, codeErr := requiredSubjectCode(row.Code)
		if codeErr != nil {
			return Page[CustomerQueryItem]{}, codeErr
		}
		item := CustomerQueryItem{ObjectID: row.ObjectID, Entity: EntityCustomer, Code: code, DisplayName: data.DisplayName, DefaultOperatingEntityCode: data.DefaultOperatingEntity.Code, UpdatedAt: row.UpdatedAt.Time}
		if row.LatestApprovedEntryID != "" {
			v := CustomerVersionSummary{Approval: approval.VersionMeta{ApprovalEntryID: row.LatestApprovedEntryID, Status: approval.Status(row.LatestApprovedStatus), VersionNo: row.LatestApprovedVersionNo}, DisplayName: data.DisplayName, Enabled: data.Enabled}
			item.LatestApproved = &v
		}
		if row.OpenEntryID != "" {
			v := CustomerVersionSummary{Approval: approval.VersionMeta{ApprovalEntryID: row.OpenEntryID, Status: approval.Status(row.OpenStatus), VersionNo: row.OpenVersionNo}, DisplayName: data.DisplayName, Enabled: data.Enabled}
			item.OpenVersion = &v
		}
		entryID := row.OpenEntryID
		if entryID == "" {
			entryID = row.LatestApprovedEntryID
		}
		if entryID != "" {
			entry, e := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityCustomer})
			if e != nil {
				return Page[CustomerQueryItem]{}, translateError(e)
			}
			item.AvailableApprovalActions = s.coordinator.LifecycleActions(approvalEntry(entry), actor)
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
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	entryID := in.ApprovalEntryID
	var entry approval.Entry
	if entryID == "" {
		entry, err = s.getOpenCustomerVersion(ctx, tx, in.ObjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			entry, err = s.getLatestApprovedCustomer(ctx, tx, in.ObjectID, actor)
			entryID = entry.ID
		} else if err == nil {
			entryID = entry.ID
		}
	} else {
		entry, err = s.getCustomerEntry(ctx, tx, entryID, actor)
	}
	if err != nil || entry.SubjectID != in.ObjectID {
		return CustomerView{}, translateError(err)
	}
	data, err := s.loadCustomerData(ctx, q, entryID)
	if err != nil {
		return CustomerView{}, err
	}
	attachments, err := customerLevelAttachments(ctx, q, entryID)
	if err != nil {
		return CustomerView{}, err
	}
	id, err := lockSubject(ctx, tx, EntityCustomer, in.ObjectID)
	if err != nil {
		return CustomerView{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerView{}, translateError(err)
	}
	return CustomerView{ObjectID: id.ObjectID, Entity: EntityCustomer, Code: id.Code, Approval: approval.VersionMetaFromEntry(entry), AvailableApprovalActions: s.coordinator.LifecycleActions(entry, actor), Data: data, Attachments: attachments, UpdatedAt: entry.UpdatedAt}, nil
}

func (s *CustomerService) authorizeCustomerRead(ctx context.Context, actor approval.Actor, action string) error {
	err := s.coordinator.Authorize(ctx, actor, action)
	if approval.IsKind(err, approval.ErrorForbidden) {
		return s.coordinator.Authorize(ctx, actor, "approve")
	}
	return err
}

func (s *CustomerService) getCustomerEntry(ctx context.Context, tx pgx.Tx, entryID string, actor approval.Actor) (approval.Entry, error) {
	entry, err := s.coordinator.Get(ctx, tx, entryID, actor)
	if approval.IsKind(err, approval.ErrorForbidden) {
		return s.coordinator.GetForAction(ctx, tx, entryID, actor, "approve")
	}
	return entry, err
}

func (s *CustomerService) getOpenCustomerVersion(ctx context.Context, tx pgx.Tx, objectID string, actor approval.Actor) (approval.Entry, error) {
	entry, err := s.coordinator.GetOpenVersion(ctx, tx, objectID, actor)
	if approval.IsKind(err, approval.ErrorForbidden) {
		return s.coordinator.GetOpenVersionForAction(ctx, tx, objectID, actor, "approve")
	}
	return entry, err
}

func (s *CustomerService) getLatestApprovedCustomer(ctx context.Context, tx pgx.Tx, objectID string, actor approval.Actor) (approval.Entry, error) {
	entry, err := s.coordinator.GetLatestApproved(ctx, tx, objectID, actor)
	if approval.IsKind(err, approval.ErrorForbidden) {
		return s.coordinator.GetLatestApprovedForAction(ctx, tx, objectID, actor, "approve")
	}
	return entry, err
}

func (s *CustomerService) Versions(ctx context.Context, in CustomerHistoryInput, actor approval.Actor) (Page[CustomerVersionView], error) {
	if _, ok := dclPageOffset(in.Page, in.PageSize); !ok || in.PageSize != 20 || !validID(in.ObjectID) || !validActor(actor) {
		return Page[CustomerVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid customer history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[CustomerVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.coordinator.ListVersions(ctx, tx, in.ObjectID, actor)
	if err != nil {
		return Page[CustomerVersionView]{}, translateError(err)
	}
	start := min((in.Page-1)*in.PageSize, len(entries))
	end := min(start+in.PageSize, len(entries))
	q := s.queries.WithTx(tx)
	items := make([]CustomerVersionView, 0, end-start)
	for _, entry := range entries[start:end] {
		data, e := s.loadCustomerData(ctx, q, entry.ID)
		if e != nil {
			return Page[CustomerVersionView]{}, e
		}
		attachments, e := customerLevelAttachments(ctx, q, entry.ID)
		if e != nil {
			return Page[CustomerVersionView]{}, e
		}
		items = append(items, CustomerVersionView{Approval: approval.VersionMetaFromEntry(entry), Data: data, Attachments: attachments})
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
