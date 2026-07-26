//go:build integration

package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
)

func TestFeedbackSubmissionAndPublishingIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	role, err := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "feedback-user", Name: "反馈用户",
		PermissionIDs: permissionIDsByPath(t, pool, signoutPath),
	}, admin.ID, "feedback-role")
	if err != nil {
		t.Fatalf("create feedback role: %v", err)
	}
	user, err := service.CreateUser(t.Context(), CreateUserInput{
		Username: "feedback-user", DisplayName: "反馈用户",
		Password: integrationUserPassword, RoleIDs: []string{role.ID},
	}, admin.ID, "feedback-user")
	if err != nil {
		t.Fatalf("create feedback user: %v", err)
	}
	signin, err := service.Signin(t.Context(), user.Username, integrationUserPassword, "feedback-signin")
	if err != nil {
		t.Fatalf("signin feedback user: %v", err)
	}
	principal, err := service.AuthorizeSession(
		t.Context(), signin.SessionToken, signin.Data.CSRFToken,
		"/app/feedback/create", "feedback-authorize",
	)
	if err != nil {
		t.Fatalf("session-only feedback authorization: %v", err)
	}
	if _, err = service.Authorize(
		t.Context(), signin.SessionToken, signin.Data.CSRFToken,
		"/app/feedback/create", "feedback-permission-check",
	); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("permission authorization error = %v, want forbidden", err)
	}
	png := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, []byte("feedback screenshot")...)
	digest := sha256.Sum256(png)
	initiated, err := service.InitiateFeedbackAttachment(t.Context(), FeedbackAttachmentInitiateInput{
		FileName: "截图.png", ContentType: "image/png", Size: int64(len(png)),
		SHA256: hex.EncodeToString(digest[:]),
	}, principal.User.ID)
	if err != nil {
		t.Fatalf("initiate feedback attachment: %v", err)
	}
	uploadToken := strings.TrimPrefix(initiated.UploadURL, "/files/feedback/attachments/upload/")
	if err = service.UploadFeedbackAttachment(
		t.Context(), uploadToken, bytes.NewReader(png), int64(len(png)), "image/png",
	); err != nil {
		t.Fatalf("upload feedback attachment: %v", err)
	}
	created, err := service.CreateFeedback(t.Context(), CreateFeedbackInput{
		Category: FeedbackCategoryBug, Title: "保存失败",
		Content:  "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
		PagePath: "/vou/sale-order", ClientVersion: "1.0.0",
		AttachmentIDs: []string{initiated.FileID},
	}, principal.User.ID)
	if err != nil {
		t.Fatalf("create feedback: %v", err)
	}
	if created.Status != FeedbackStatusPending || !validID(created.FeedbackID) {
		t.Fatalf("created feedback = %#v", created)
	}
	if err = service.RemoveFeedbackAttachment(t.Context(), initiated.FileID, principal.User.ID); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("remove submitted feedback attachment error = %v, want conflict", err)
	}
	view, err := service.GetFeedback(t.Context(), created.FeedbackID, principal.User.ID)
	if err != nil || view.Status != FeedbackStatusPending || view.IssueURL != nil {
		t.Fatalf("pending feedback = %#v, error = %v", view, err)
	}
	if _, err = service.GetFeedback(t.Context(), created.FeedbackID, admin.ID); !errorIsKind(err, ErrorNotFound) {
		t.Fatalf("other owner error = %v", err)
	}

	client := &integrationIssueClient{}
	publisher := NewFeedbackPublisher(pool, client, slog.New(slog.NewTextHandler(io.Discard, nil)))
	processed, err := publisher.publishOne(t.Context())
	if err != nil || !processed {
		t.Fatalf("publishOne() processed=%t error=%v", processed, err)
	}
	view, err = service.GetFeedback(t.Context(), created.FeedbackID, principal.User.ID)
	if err != nil || view.Status != FeedbackStatusPublished || view.IssueURL == nil ||
		*view.IssueURL != "https://github.com/hansonyu183/zerp-back/issues/17" {
		t.Fatalf("published feedback = %#v, error = %v", view, err)
	}
	if !strings.Contains(client.body, "截图.png") ||
		strings.Contains(client.body, "abcdefghijklmnopqrstuvwxyz") ||
		strings.Contains(client.body, principal.User.ID) {
		t.Fatalf("published issue body = %s", client.body)
	}
	if len(client.labels) < 1 || client.labels[0] != "automation:blocked" {
		t.Fatalf("published labels = %#v", client.labels)
	}
}

func TestFeedbackAttachmentLimitsRemovalAndCleanupIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	content := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, []byte("cleanup")...)
	digest := sha256.Sum256(content)
	initiate := func(name string) FeedbackAttachmentInitiateResult {
		t.Helper()
		result, err := service.InitiateFeedbackAttachment(t.Context(), FeedbackAttachmentInitiateInput{
			FileName: name, ContentType: "image/png", Size: int64(len(content)),
			SHA256: hex.EncodeToString(digest[:]),
		}, admin.ID)
		if err != nil {
			t.Fatalf("initiate %s: %v", name, err)
		}
		return result
	}
	first := initiate("first.png")
	second := initiate("second.png")
	third := initiate("third.png")
	if _, err := service.InitiateFeedbackAttachment(t.Context(), FeedbackAttachmentInitiateInput{
		FileName: "fourth.png", ContentType: "image/png", Size: int64(len(content)),
		SHA256: hex.EncodeToString(digest[:]),
	}, admin.ID); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("fourth active attachment error=%v, want conflict", err)
	}
	if err := service.RemoveFeedbackAttachment(t.Context(), first.FileID, admin.ID); err != nil {
		t.Fatalf("remove pending attachment: %v", err)
	}
	fourth := initiate("fourth.png")
	secondToken := strings.TrimPrefix(second.UploadURL, "/files/feedback/attachments/upload/")
	if err := service.UploadFeedbackAttachment(
		t.Context(), secondToken, bytes.NewReader(content), int64(len(content)), "image/jpeg",
	); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("wrong upload content type error=%v, want validation", err)
	}
	if err := service.UploadFeedbackAttachment(
		t.Context(), secondToken, bytes.NewReader(content), int64(len(content)), "image/png",
	); err != nil {
		t.Fatalf("upload after rejected headers: %v", err)
	}
	if err := service.RemoveFeedbackAttachment(t.Context(), second.FileID, admin.ID); err != nil {
		t.Fatalf("remove ready attachment: %v", err)
	}
	if err := service.RemoveFeedbackAttachment(t.Context(), third.FileID, "01J00000000000000000000001"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("other owner removal error=%v, want conflict", err)
	}
	if _, err := pool.Exec(t.Context(), `
		UPDATE app_feedback_files
		SET upload_expires_at = now() - interval '1 hour'
		WHERE id = $1
	`, third.FileID); err != nil {
		t.Fatalf("expire pending feedback attachment: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		UPDATE app_feedback_files
		SET status = 'READY', stored_at = now(), created_at = now() - interval '25 hours'
		WHERE id = $1
	`, fourth.FileID); err != nil {
		t.Fatalf("age ready feedback attachment: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		UPDATE app_feedback_files
		SET removed_at = now() - interval '25 hours'
		WHERE id = ANY($1::text[])
	`, []string{first.FileID, second.FileID}); err != nil {
		t.Fatalf("age deleted feedback attachments: %v", err)
	}
	removed, err := service.CleanupFeedbackAttachments(t.Context(), 10)
	if err != nil || removed != 4 {
		t.Fatalf("cleanup removed=%d error=%v, want 4", removed, err)
	}
	var remaining int
	if err = pool.QueryRow(t.Context(), "SELECT count(*) FROM app_feedback_files").Scan(&remaining); err != nil {
		t.Fatalf("count remaining feedback files: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("remaining feedback files=%d, want 0", remaining)
	}
}

func TestFeedbackRollingDayLimitIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	const attempts = 25
	var group sync.WaitGroup
	errorsChannel := make(chan error, attempts)
	for range attempts {
		group.Add(1)
		go func() {
			defer group.Done()
			_, err := service.CreateFeedback(context.Background(), CreateFeedbackInput{
				Category: FeedbackCategoryOther, Title: "反馈", Content: "并发提交",
			}, admin.ID)
			errorsChannel <- err
		}()
	}
	group.Wait()
	close(errorsChannel)
	successes, limited := 0, 0
	for err := range errorsChannel {
		switch {
		case err == nil:
			successes++
		case errorIsKind(err, ErrorValidation):
			limited++
		default:
			t.Fatalf("unexpected feedback error: %v", err)
		}
	}
	if successes != maxFeedbackPerRollingDay || limited != attempts-maxFeedbackPerRollingDay {
		t.Fatalf("feedback results successes=%d limited=%d", successes, limited)
	}
	var stored int
	if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM app_feedback WHERE user_id = $1", admin.ID).Scan(&stored); err != nil {
		t.Fatalf("count feedback: %v", err)
	}
	if stored != maxFeedbackPerRollingDay {
		t.Fatalf("stored feedback = %d, want %d", stored, maxFeedbackPerRollingDay)
	}
}

func TestFeedbackPublishingRecoveryAndFailureIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	create := func(title string) FeedbackCreatedView {
		t.Helper()
		result, err := service.CreateFeedback(t.Context(), CreateFeedbackInput{
			Category: FeedbackCategoryOther, Title: title, Content: "发布状态测试",
		}, admin.ID)
		if err != nil {
			t.Fatalf("create %s feedback: %v", title, err)
		}
		return result
	}

	recovered := create("对账恢复")
	existingClient := &integrationExistingIssueClient{}
	publisher := NewFeedbackPublisher(pool, existingClient, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if processed, err := publisher.publishOne(t.Context()); err != nil || !processed {
		t.Fatalf("reconcile publish processed=%t error=%v", processed, err)
	}
	recoveredView, err := service.GetFeedback(t.Context(), recovered.FeedbackID, admin.ID)
	if err != nil || recoveredView.Status != FeedbackStatusPublished ||
		recoveredView.IssueURL == nil || !strings.HasSuffix(*recoveredView.IssueURL, "/18") ||
		existingClient.createCalls != 0 {
		t.Fatalf("recovered feedback=%#v createCalls=%d error=%v", recoveredView, existingClient.createCalls, err)
	}

	permanent := create("永久失败")
	publisher = NewFeedbackPublisher(pool, integrationFailingIssueClient{
		err: integrationPublishFailure{retryable: false},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if processed, err := publisher.publishOne(t.Context()); err != nil || !processed {
		t.Fatalf("permanent failure processed=%t error=%v", processed, err)
	}
	permanentView, err := service.GetFeedback(t.Context(), permanent.FeedbackID, admin.ID)
	if err != nil || permanentView.Status != FeedbackStatusFailed {
		t.Fatalf("permanent feedback=%#v error=%v", permanentView, err)
	}

	retrying := create("暂时失败")
	publisher = NewFeedbackPublisher(pool, integrationFailingIssueClient{
		err: integrationPublishFailure{retryable: true},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if processed, err := publisher.publishOne(t.Context()); err != nil || !processed {
		t.Fatalf("retrying failure processed=%t error=%v", processed, err)
	}
	retryingView, err := service.GetFeedback(t.Context(), retrying.FeedbackID, admin.ID)
	if err != nil || retryingView.Status != FeedbackStatusPending {
		t.Fatalf("retrying feedback=%#v error=%v", retryingView, err)
	}

	exhausted := create("重试耗尽")
	if _, err = pool.Exec(t.Context(), "UPDATE app_feedback SET attempt_count = 9 WHERE id = $1", exhausted.FeedbackID); err != nil {
		t.Fatalf("prepare exhausted feedback: %v", err)
	}
	publisher = NewFeedbackPublisher(pool, integrationFailingIssueClient{
		err: integrationPublishFailure{retryable: true},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if processed, err := publisher.publishOne(t.Context()); err != nil || !processed {
		t.Fatalf("exhausted failure processed=%t error=%v", processed, err)
	}
	exhaustedView, err := service.GetFeedback(t.Context(), exhausted.FeedbackID, admin.ID)
	if err != nil || exhaustedView.Status != FeedbackStatusFailed {
		t.Fatalf("exhausted feedback=%#v error=%v", exhaustedView, err)
	}
}
