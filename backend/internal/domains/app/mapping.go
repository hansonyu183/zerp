package app

import (
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5/pgtype"
)

func userSummary(user dbsqlc.AppUser, avatarURL *string) UserSummary {
	return UserSummary{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName, AvatarURL: avatarURL}
}

func profileView(user dbsqlc.AppUser, avatarURL *string) ProfileView {
	return ProfileView{
		ID: user.ID, Username: user.Username, DisplayName: user.DisplayName, AvatarURL: avatarURL,
		PasswordChangedAt: user.PasswordChangedAt.Time, Revision: user.Revision,
	}
}

func userView(user dbsqlc.AppUser) UserView {
	return UserView{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName, Status: user.Status, System: systemidentity.IsUser(user.ID),
		FailedSigninCount: user.FailedSigninCount, LockedUntil: nullableTime(user.LockedUntil),
		PasswordChangedAt: user.PasswordChangedAt.Time, CreatedAt: user.CreatedAt.Time, UpdatedAt: user.UpdatedAt.Time, Revision: user.Revision}
}

func userListView(user dbsqlc.ListAppUsersRow) UserView {
	return UserView{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName, Status: user.Status, System: systemidentity.IsUser(user.ID),
		FailedSigninCount: user.FailedSigninCount, LockedUntil: nullableTime(user.LockedUntil),
		PasswordChangedAt: user.PasswordChangedAt.Time, CreatedAt: user.CreatedAt.Time, UpdatedAt: user.UpdatedAt.Time, Revision: user.Revision}
}

func userListItem(user UserView) UserListItem {
	return UserListItem{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName,
		Status: user.Status, System: user.System, CreatedAt: user.CreatedAt, UpdatedAt: user.UpdatedAt, Revision: user.Revision}
}

func permissionView(permission dbsqlc.AppPermission) PermissionView {
	return PermissionView{ID: permission.ID, Path: permission.Path, Domain: permission.Domain, Entity: permission.Entity,
		Action: permission.Action, Description: permission.Description, Status: permission.Status, Revision: permission.Revision}
}

func nullableTime(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	timeValue := value.Time
	return &timeValue
}
