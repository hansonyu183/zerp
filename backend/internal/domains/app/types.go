package app

import (
	"errors"
	"time"
)

const (
	StatusEnabled      = "ENABLED"
	StatusDisabled     = "DISABLED"
	superadminRoleCode = "superadmin"
	signoutPath        = "/app/user/signout"
)

type ErrorKind int

const (
	ErrorValidation ErrorKind = iota + 1
	ErrorUnauthenticated
	ErrorForbidden
	ErrorConflict
	ErrorNotFound
	ErrorInternal
)

type DomainError struct {
	Kind    ErrorKind
	Message string
	Cause   error
}

func (e *DomainError) Error() string { return e.Message }
func (e *DomainError) Unwrap() error { return e.Cause }

func domainError(kind ErrorKind, message string, cause error) error {
	return &DomainError{Kind: kind, Message: message, Cause: cause}
}

func errorIsKind(err error, kind ErrorKind) bool {
	var target *DomainError
	return errors.As(err, &target) && target.Kind == kind
}

type UserSummary struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
}

type ProfileView struct {
	ID                string    `json:"id"`
	Username          string    `json:"username"`
	DisplayName       string    `json:"displayName"`
	AvatarURL         *string   `json:"avatarUrl,omitempty"`
	PasswordChangedAt time.Time `json:"passwordChangedAt"`
	Revision          int64     `json:"revision"`
}

type SaveProfileInput struct {
	DisplayName string
	AvatarURL   *string
}

type ChangePasswordInput struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type CreateUserInput struct {
	Username    string   `json:"username"`
	DisplayName string   `json:"displayName"`
	Password    string   `json:"password"`
	RoleIDs     []string `json:"roleIds"`
}

type SaveUserInput struct {
	ID          string   `json:"id"`
	DisplayName string   `json:"displayName"`
	RoleIDs     []string `json:"roleIds"`
	Revision    int64    `json:"revision"`
}

type CreateRoleInput struct {
	Code          string   `json:"code"`
	Name          string   `json:"name"`
	Description   *string  `json:"description"`
	PermissionIDs []string `json:"permissionIds"`
}

type SaveRoleInput struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   *string  `json:"description"`
	PermissionIDs []string `json:"permissionIds"`
	Revision      int64    `json:"revision"`
}

type SessionData struct {
	User        UserSummary `json:"user"`
	CSRFToken   string      `json:"csrfToken"`
	Permissions []string    `json:"permissions"`
}

type SessionResult struct {
	Data         SessionData
	SessionToken string
	ExpiresAt    time.Time
}

type Principal struct {
	SessionID    string
	User         UserSummary
	CSRFHash     []byte
	Permissions  []string
	IdleExpires  time.Time
	AbsoluteEnds time.Time
}

type PageRequest struct {
	Page     int               `json:"page"`
	PageSize int               `json:"pageSize"`
	Filters  map[string]string `json:"filters"`
	Sort     []SortItem        `json:"sort"`
}

type SortItem struct {
	Field string `json:"field"`
	Order string `json:"order"`
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

const (
	WorkbenchCategoryBob = "BOB"
	WorkbenchCategoryVou = "VOU"
)

type WorkbenchQueryInput struct {
	Category      string   `json:"category"`
	Keyword       string   `json:"keyword,omitempty"`
	Entities      []string `json:"entities,omitempty"`
	PendingStages []string `json:"pendingStages,omitempty"`
	Page          int      `json:"page"`
	PageSize      int      `json:"pageSize"`
}

type WorkbenchItem struct {
	Category         string    `json:"category"`
	Entity           string    `json:"entity"`
	Status           string    `json:"status"`
	PendingStage     string    `json:"pendingStage"`
	AvailableActions []string  `json:"availableActions"`
	UpdatedAt        time.Time `json:"updatedAt"`

	ObjectID       string `json:"objectId,omitempty"`
	ObjectRevision int64  `json:"objectRevision,omitempty"`
	VersionID      string `json:"versionId,omitempty"`
	Code           string `json:"code,omitempty"`
	Name           string `json:"name,omitempty"`

	DocumentID   string  `json:"documentId,omitempty"`
	DocumentNo   string  `json:"documentNo,omitempty"`
	BusinessDate string  `json:"businessDate,omitempty"`
	PartyName    *string `json:"partyName,omitempty"`
	Currency     *string `json:"currency,omitempty"`
	Amount       string  `json:"amount,omitempty"`

	Revision int64 `json:"revision"`
}

type pageSpec struct {
	Page      int
	PageSize  int
	Offset    int32
	SortField string
	SortOrder string
}

type UserView struct {
	ID                string     `json:"id"`
	Username          string     `json:"username"`
	DisplayName       string     `json:"displayName"`
	Status            string     `json:"status"`
	FailedSigninCount int32      `json:"failedSigninCount"`
	LockedUntil       *time.Time `json:"lockedUntil"`
	PasswordChangedAt time.Time  `json:"passwordChangedAt"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	Revision          int64      `json:"revision"`
	RoleIDs           []string   `json:"roleIds,omitempty"`
}

type RoleView struct {
	ID            string    `json:"id"`
	Code          string    `json:"code"`
	Name          string    `json:"name"`
	Description   *string   `json:"description"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	Revision      int64     `json:"revision"`
	PermissionIDs []string  `json:"permissionIds,omitempty"`
}

type PermissionView struct {
	ID          string  `json:"id"`
	Path        string  `json:"path"`
	Domain      string  `json:"domain"`
	Entity      string  `json:"entity"`
	Action      string  `json:"action"`
	Description *string `json:"description"`
	Status      string  `json:"status"`
	Revision    int64   `json:"revision"`
	RoleCount   *int64  `json:"roleCount,omitempty"`
}
