package dcl

import (
	"time"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

const EntityOperatingEntity = "operating-entity"

type OperatingEntityData = bobdomain.OperatingEntityData

type OperatingEntityCreateInput struct {
	Data OperatingEntityData `json:"data"`
}

type OperatingEntitySaveInput struct {
	ObjectID         string              `json:"objectId"`
	ApprovalEntryID  string              `json:"approvalEntryId"`
	ApprovalRevision int64               `json:"approvalRevision"`
	Enabled          bool                `json:"enabled"`
	Data             OperatingEntityData `json:"data"`
}

type OperatingEntityVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

type OperatingEntityReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}

type OperatingEntityDeleteInput = OperatingEntityVersionInput

type OperatingEntityGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}

type OperatingEntityQueryFilters struct {
	Keyword string            `json:"keyword,omitempty"`
	Status  []approval.Status `json:"status,omitempty"`
	Enabled *bool             `json:"enabled,omitempty"`
}

type OperatingEntitySortItem struct {
	Field string `json:"field"`
	Order string `json:"order"`
}

type OperatingEntityQueryInput struct {
	Page     int                         `json:"page"`
	PageSize int                         `json:"pageSize"`
	Filters  OperatingEntityQueryFilters `json:"filters"`
	Sort     []OperatingEntitySortItem   `json:"sort"`
}

type OperatingEntityHistoryInput struct {
	ObjectID string `json:"objectId"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

type OperatingEntityMutation struct {
	ObjectID       string               `json:"objectId"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
}

type OperatingEntityView struct {
	ObjectID       string               `json:"objectId"`
	Entity         string               `json:"entity"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
	Data           OperatingEntityData  `json:"data"`
	UpdatedAt      time.Time            `json:"updatedAt"`
}

type OperatingEntityVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     OperatingEntityData  `json:"data"`
	Enabled  bool                 `json:"enabled"`
}

type OperatingEntityQueryItem struct {
	ObjectID       string                      `json:"objectId"`
	Entity         string                      `json:"entity"`
	Code           string                      `json:"code"`
	ObjectRevision int64                       `json:"objectRevision"`
	Enabled        bool                        `json:"enabled"`
	LatestApproved *OperatingEntityVersionView `json:"latestApproved"`
	OpenVersion    *OperatingEntityVersionView `json:"openVersion"`
	UpdatedAt      time.Time                   `json:"updatedAt"`
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}
