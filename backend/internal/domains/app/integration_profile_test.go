//go:build integration

package app

import (
	"slices"
	"strings"
	"sync"
	"testing"
)

func TestProfileSelfSaveIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	before, err := service.GetUserDetail(t.Context(), admin.ID, integrationPrincipal(admin.ID))
	if err != nil {
		t.Fatalf("get initial user: %v", err)
	}
	var passwordHash string
	if err = pool.QueryRow(
		t.Context(),
		"SELECT password_hash FROM app_users WHERE id = $1",
		admin.ID,
	).Scan(&passwordHash); err != nil {
		t.Fatalf("read initial password hash: %v", err)
	}
	signin, err := service.Signin(t.Context(), "admin", integrationAdminPassword, "profile-signin")
	if err != nil {
		t.Fatalf("signin: %v", err)
	}
	principal, err := authorizeForTest(
		service,
		t.Context(),
		signin.SessionToken,
		signin.Data.CSRFToken,
		"/app/user/profile",
		"profile-authorize",
	)
	if err != nil {
		t.Fatalf("authorize profile: %v", err)
	}
	avatarURL := "https://images.example.com/private/avatar.png?version=1"
	saved, err := service.SaveProfile(t.Context(), principal.User.ID, SaveProfileInput{
		DisplayName: " 新显示名称 ",
		AvatarURL:   &avatarURL,
	}, "profile-save")
	if err != nil {
		t.Fatalf("save profile: %v", err)
	}
	if saved.DisplayName != "新显示名称" || saved.AvatarURL == nil ||
		*saved.AvatarURL != avatarURL || saved.Revision != before.Revision+1 {
		t.Fatalf("saved profile = %#v", saved)
	}

	restored, err := restoreSessionForTest(service, t.Context(), signin.SessionToken)
	if err != nil {
		t.Fatalf("restore updated profile session: %v", err)
	}
	if restored.Data.User.DisplayName != saved.DisplayName ||
		restored.Data.User.AvatarURL == nil || *restored.Data.User.AvatarURL != avatarURL {
		t.Fatalf("restored session user = %#v", restored.Data.User)
	}
	freshSignin, err := service.Signin(t.Context(), "admin", integrationAdminPassword, "profile-fresh-signin")
	if err != nil {
		t.Fatalf("signin with updated profile: %v", err)
	}
	if freshSignin.Data.User.DisplayName != saved.DisplayName ||
		freshSignin.Data.User.AvatarURL == nil || *freshSignin.Data.User.AvatarURL != avatarURL {
		t.Fatalf("fresh signin user = %#v", freshSignin.Data.User)
	}
	if _, err = service.SaveUser(t.Context(), SaveUserInput{
		ID: admin.ID, DisplayName: "过期管理员保存", RoleIDs: userRoleIDs(before), Revision: before.Revision,
	}, integrationPrincipal(admin.ID), "stale-admin-save"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("stale administrator save error=%v, want conflict", err)
	}

	var auditSummary string
	if err = pool.QueryRow(t.Context(), `
		SELECT summary::text
		FROM app_audit_events
		WHERE event_type = 'USER_PROFILE_SAVE' AND target_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, admin.ID).Scan(&auditSummary); err != nil {
		t.Fatalf("read profile audit: %v", err)
	}
	if strings.Contains(auditSummary, avatarURL) ||
		!strings.Contains(auditSummary, `"displayNameChanged": true`) ||
		!strings.Contains(auditSummary, `"avatarChanged": true`) {
		t.Fatalf("profile audit summary = %s", auditSummary)
	}
	var auditCount int
	if err = pool.QueryRow(
		t.Context(),
		"SELECT count(*) FROM app_audit_events WHERE event_type = 'USER_PROFILE_SAVE'",
	).Scan(&auditCount); err != nil {
		t.Fatalf("count profile audits: %v", err)
	}
	unchanged, err := service.SaveProfile(t.Context(), admin.ID, SaveProfileInput{
		DisplayName: saved.DisplayName,
		AvatarURL:   &avatarURL,
	}, "profile-noop")
	if err != nil {
		t.Fatalf("save unchanged profile: %v", err)
	}
	if unchanged.Revision != saved.Revision {
		t.Fatalf("unchanged revision=%d, want %d", unchanged.Revision, saved.Revision)
	}
	var unchangedAuditCount int
	if err = pool.QueryRow(
		t.Context(),
		"SELECT count(*) FROM app_audit_events WHERE event_type = 'USER_PROFILE_SAVE'",
	).Scan(&unchangedAuditCount); err != nil {
		t.Fatalf("count unchanged profile audits: %v", err)
	}
	if unchangedAuditCount != auditCount {
		t.Fatalf("unchanged save audit count=%d, want %d", unchangedAuditCount, auditCount)
	}

	cleared, err := service.SaveProfile(t.Context(), admin.ID, SaveProfileInput{
		DisplayName: saved.DisplayName,
	}, "profile-clear-avatar")
	if err != nil {
		t.Fatalf("clear profile avatar: %v", err)
	}
	if cleared.AvatarURL != nil || cleared.Revision != saved.Revision+1 {
		t.Fatalf("cleared profile = %#v", cleared)
	}
	current, err := service.GetUserDetail(t.Context(), admin.ID, integrationPrincipal(admin.ID))
	if err != nil {
		t.Fatalf("get user after profile saves: %v", err)
	}
	if !slices.Equal(userRoleIDs(current), userRoleIDs(before)) || current.Status != before.Status {
		t.Fatalf("profile save changed authorization: before=%#v after=%#v", before, current)
	}
	var afterPasswordHash string
	var activeSessions int
	if err = pool.QueryRow(
		t.Context(),
		"SELECT password_hash FROM app_users WHERE id = $1",
		admin.ID,
	).Scan(&afterPasswordHash); err != nil {
		t.Fatalf("read updated password hash: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `
		SELECT count(*) FROM app_sessions
		WHERE user_id = $1 AND revoked_at IS NULL
	`, admin.ID).Scan(&activeSessions); err != nil {
		t.Fatalf("count active sessions: %v", err)
	}
	if afterPasswordHash != passwordHash || activeSessions != 2 {
		t.Fatalf(
			"profile save changed credentials: passwordChanged=%t activeSessions=%d, want 2",
			afterPasswordHash != passwordHash, activeSessions,
		)
	}
}

func TestProfileSelfSaveConcurrencyIntegration(t *testing.T) {
	service, _, admin := appIntegrationService(t)
	before, err := service.GetProfile(t.Context(), admin.ID)
	if err != nil {
		t.Fatalf("get initial profile: %v", err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for _, displayName := range []string{"并发资料一", "并发资料二"} {
		wait.Add(1)
		go func(name string) {
			defer wait.Done()
			<-start
			_, saveErr := service.SaveProfile(
				t.Context(),
				admin.ID,
				SaveProfileInput{DisplayName: name},
				"profile-concurrent",
			)
			results <- saveErr
		}(displayName)
	}
	close(start)
	wait.Wait()
	close(results)
	for result := range results {
		if result != nil {
			t.Fatalf("concurrent profile save: %v", result)
		}
	}
	after, err := service.GetProfile(t.Context(), admin.ID)
	if err != nil {
		t.Fatalf("get concurrent profile: %v", err)
	}
	if after.DisplayName != "并发资料一" && after.DisplayName != "并发资料二" {
		t.Fatalf("concurrent display name=%q", after.DisplayName)
	}
	if after.Revision != before.Revision+2 {
		t.Fatalf("concurrent revision=%d, want %d", after.Revision, before.Revision+2)
	}
}
