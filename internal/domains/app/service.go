package app

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/hansonyu183/zerp-back/internal/config"
	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/jackc/pgx/v5/pgxpool"
)

type feedbackAttachmentResolver interface {
	ResolveFeedbackAttachments(context.Context, []string, string) ([]voudomain.FeedbackAttachmentMetadata, error)
}

type Service struct {
	pool                *pgxpool.Pool
	queries             *dbsqlc.Queries
	cfg                 config.Config
	logger              *slog.Logger
	dummyPassword       string
	feedbackAttachments feedbackAttachmentResolver
}

func NewService(pool *pgxpool.Pool, cfg config.Config, logger *slog.Logger) *Service {
	dummy, err := hashPassword("Dummy-login-password-1!")
	if err != nil {
		panic(fmt.Sprintf("initialize password verifier: %v", err))
	}
	return &Service{pool: pool, queries: dbsqlc.New(pool), cfg: cfg, logger: logger, dummyPassword: dummy}
}

func (s *Service) SetFeedbackAttachmentResolver(resolver feedbackAttachmentResolver) {
	s.feedbackAttachments = resolver
}
