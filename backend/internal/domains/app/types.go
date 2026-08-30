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
	changePasswordPath = "/app/user/change-password"
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
	Kind     ErrorKind
	ErrorKey string
	Message  string
	Cause    error
}

func (e *DomainError) Error() string { return e.Message }
func (e *DomainError) Unwrap() error { return e.Cause }

func domainError(kind ErrorKind, message string, cause error) error {
	return domainErrorWithKey(kind, defaultErrorKey(kind), message, cause)
}

func domainErrorWithKey(kind ErrorKind, errorKey, message string, cause error) error {
	return &DomainError{Kind: kind, ErrorKey: errorKey, Message: message, Cause: cause}
}

func defaultErrorKey(kind ErrorKind) string {
	switch kind {
	case ErrorValidation:
		return "validation_failed"
	case ErrorUnauthenticated:
		return "unauthenticated"
	case ErrorForbidden:
		return "forbidden"
	case ErrorConflict:
		return "conflict"
	case ErrorNotFound:
		return "not_found"
	default:
		return "internal_error"
	}
}

func errorIsKind(err error, kind ErrorKind) bool {
	var target *DomainError
	return errors.As(err, &target) && target.Kind == kind
}

type UserSummary struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
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
	// Code is intentionally not deserializable. Role codes are server-assigned.
	Code          string   `json:"-"`
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
	User                   UserSummary `json:"user"`
	CSRFToken              string      `json:"csrfToken"`
	Permissions            []string    `json:"permissions"`
	PasswordChangeRequired bool        `json:"passwordChangeRequired"`
	PasswordMinLength      int         `json:"passwordMinLength"`
}

type SessionResult struct {
	Data         SessionData
	SessionToken string
	ExpiresAt    time.Time
}

type Principal struct {
	SessionID              string
	User                   UserSummary
	CSRFToken              string
	CSRFHash               []byte
	Permissions            []string
	PasswordChangeRequired bool
	IdleExpires            time.Time
	AbsoluteEnds           time.Time
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

	ObjectID        string `json:"objectId,omitempty"`
	ApprovalEntryID string `json:"versionId,omitempty"`
	Code            string `json:"code,omitempty"`
	Name            string `json:"name,omitempty"`
	BookID          string `json:"bookId,omitempty"`
	VouEntity       string `json:"vouEntity,omitempty"`

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
	ID                string
	Username          string
	DisplayName       string
	Status            string
	FailedSigninCount int32
	LockedUntil       *time.Time
	PasswordChangedAt time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
	Revision          int64
	RoleIDs           []string
	Roles             []UserRoleSummary
	System            bool
}

type UserListItem struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"displayName"`
	Status      string    `json:"status"`
	System      bool      `json:"system"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	Revision    int64     `json:"revision"`
	Manageable  bool      `json:"manageable"`
}

type UserDetail struct {
	UserListItem
	PasswordChangedAt      time.Time         `json:"passwordChangedAt"`
	Roles                  []UserRoleSummary `json:"roles"`
	RoleAssignmentEditable bool              `json:"roleAssignmentEditable"`
}

type UserRoleSummary struct {
	ID         string   `json:"id"`
	Code       string   `json:"code"`
	Name       string   `json:"name"`
	Status     string   `json:"status"`
	Type       RoleType `json:"type"`
	Assignable bool     `json:"assignable"`
}

type ResetPasswordInput struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}

type ResetPasswordResult struct {
	TemporaryPassword string `json:"temporaryPassword"`
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
	Assignable  bool    `json:"assignable"`
}

type PermissionDetail struct {
	Path        string  `json:"path"`
	Domain      string  `json:"domain"`
	Entity      string  `json:"entity"`
	Action      string  `json:"action"`
	Description *string `json:"description"`
	Status      string  `json:"status"`
	RoleCount   int64   `json:"roleCount"`
}

const (
	SystemParameterString  = "STRING"
	SystemParameterInteger = "INTEGER"
	SystemParameterDecimal = "DECIMAL"
	SystemParameterBoolean = "BOOLEAN"
)

type SystemParameterConstraints struct {
	Required      bool     `json:"required"`
	MinLength     *int32   `json:"minLength"`
	MaxLength     *int32   `json:"maxLength"`
	Minimum       *string  `json:"minimum"`
	Maximum       *string  `json:"maximum"`
	AllowedValues []string `json:"allowedValues"`
}

type SystemParameterView struct {
	Key             string                      `json:"key"`
	Name            string                      `json:"name"`
	Description     *string                     `json:"description"`
	ValueType       string                      `json:"valueType"`
	ConfiguredValue string                      `json:"configuredValue"`
	DefaultValue    string                      `json:"defaultValue"`
	Editable        bool                        `json:"editable"`
	Constraints     *SystemParameterConstraints `json:"constraints"`
	Revision        int64                       `json:"revision"`
}

type SaveSystemParameterInput struct {
	Key             string `json:"key"`
	ConfiguredValue string `json:"configuredValue"`
	Revision        int64  `json:"revision"`
}

type ResetSystemParameterInput struct {
	Key      string `json:"key"`
	Revision int64  `json:"revision"`
}

const (
	MenuModeDefault  = "DEFAULT"
	MenuModeBusiness = "BUSINESS"
	MenuItemGroup    = "GROUP"
	MenuItemRoute    = "ROUTE"
)

type MenuItemView struct {
	ID             string  `json:"id"`
	ParentID       *string `json:"parentId"`
	Type           string  `json:"type"`
	Level          int32   `json:"level"`
	Order          int32   `json:"order"`
	DisplayName    string  `json:"displayName"`
	Icon           *string `json:"icon"`
	Enabled        bool    `json:"enabled"`
	RouteKey       *string `json:"routeKey"`
	RoutePath      *string `json:"routePath"`
	PermissionCode *string `json:"permissionCode"`
}

type MenuTree struct {
	Items []MenuItemView `json:"items"`
}

type MenuRouteOption struct {
	RouteKey       string  `json:"routeKey"`
	RoutePath      string  `json:"routePath"`
	DisplayName    string  `json:"displayName"`
	PermissionCode *string `json:"permissionCode"`
}

type MenuGetData struct {
	Mode            string            `json:"mode"`
	Revision        int64             `json:"revision"`
	DefaultMenu     MenuTree          `json:"defaultMenu"`
	BusinessMenu    MenuTree          `json:"businessMenu"`
	Navigation      MenuTree          `json:"navigation"`
	AvailableRoutes []MenuRouteOption `json:"availableRoutes"`
}

type SaveMenuItemInput struct {
	ID          string  `json:"id"`
	ParentID    *string `json:"parentId"`
	Type        string  `json:"type"`
	Order       int32   `json:"order"`
	DisplayName string  `json:"displayName"`
	Icon        *string `json:"icon"`
	Enabled     bool    `json:"enabled"`
	RouteKey    *string `json:"routeKey"`
}

type SaveBusinessMenuInput struct {
	Revision int64               `json:"revision"`
	Items    []SaveMenuItemInput `json:"items"`
}

type ActivateMenuInput struct {
	Mode     string `json:"mode"`
	Revision int64  `json:"revision"`
}

type ResetBusinessMenuInput struct {
	Revision int64 `json:"revision"`
}

type RoleType string

const (
	RoleTypeNormal     RoleType = "NORMAL"
	RoleTypeSystem     RoleType = "SYSTEM"
	RoleTypeSuperadmin RoleType = "SUPERADMIN"
)

type RoleAction string

const (
	RoleActionView    RoleAction = "VIEW"
	RoleActionEdit    RoleAction = "EDIT"
	RoleActionEnable  RoleAction = "ENABLE"
	RoleActionDisable RoleAction = "DISABLE"
)

type RolePermission struct {
	ID          string  `json:"id"`
	Path        string  `json:"path"`
	Domain      string  `json:"domain"`
	Entity      string  `json:"entity"`
	Action      string  `json:"action"`
	Description *string `json:"description"`
	Status      string  `json:"status"`
}

type RoleListItem struct {
	ID               string       `json:"id"`
	Code             string       `json:"code"`
	Name             string       `json:"name"`
	Description      *string      `json:"description"`
	Status           string       `json:"status"`
	Type             RoleType     `json:"type"`
	Assignable       bool         `json:"assignable"`
	AvailableActions []RoleAction `json:"availableActions"`
	CreatedAt        time.Time    `json:"createdAt"`
	UpdatedAt        time.Time    `json:"updatedAt"`
	Revision         int64        `json:"revision"`
}

type RoleDetail struct {
	RoleListItem
	Permissions []RolePermission `json:"permissions"`
}
