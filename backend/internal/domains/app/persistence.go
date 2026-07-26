package app

import (
	"context"
	"encoding/json"
	"time"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"
)

func newID() string { return ulid.Make().String() }

func (s *Service) auditAuthorizationDenied(ctx context.Context, principal Principal, path, requestID, reason string) {
	_ = s.audit(ctx, s.queries, "AUTHORIZATION_DENIED", &principal.User.ID, "api", nil, "FAILURE", requestID, map[string]any{
		"path": path, "reason": reason,
	})
}

func (s *Service) audit(ctx context.Context, q *dbsqlc.Queries, event string, actorID *string, targetType string, targetID *string, result, requestID string, summary map[string]any) error {
	if summary == nil {
		summary = map[string]any{}
	}
	payload, _ := json.Marshal(summary)
	err := q.CreateAppAuditEvent(ctx, dbsqlc.CreateAppAuditEventParams{
		ID: newID(), EventType: event, ActorUserID: actorID, TargetType: &targetType, TargetID: targetID,
		Result: result, RequestID: optionalTrimmed(requestID), Summary: payload, CreatedBy: actorID,
	})
	if err != nil {
		s.logger.Error("write app audit event", "event", event, "requestId", requestID, "error", err)
		return err
	}
	return nil
}

func timestamptz(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}

func stringPointer(value string) *string { return &value }
