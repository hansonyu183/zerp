package app

import (
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/config"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/attachmentstore"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool                    *pgxpool.Pool
	queries                 *dbsqlc.Queries
	cfg                     config.Config
	logger                  *slog.Logger
	dummyPassword           string
	storage                 *attachmentstore.Store
	runtimeMu               sync.RWMutex
	runtimeSystemParameters map[string]runtimeSystemParameterSnapshot
}

type runtimeSystemParameterSnapshot struct {
	value    string
	revision int64
}

func NewService(pool *pgxpool.Pool, cfg config.Config, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	if cfg.AttachmentUploadTTL <= 0 {
		cfg.AttachmentUploadTTL = 15 * time.Minute
	}
	if cfg.FeedbackAttachmentOrphanTTL <= 0 {
		cfg.FeedbackAttachmentOrphanTTL = 24 * time.Hour
	}
	if strings.TrimSpace(cfg.AttachmentStorageRoot) == "" {
		cfg.AttachmentStorageRoot = "./var/attachments"
	}
	dummy, err := hashPassword("Dummy-login-password-1!")
	if err != nil {
		panic(fmt.Sprintf("initialize password verifier: %v", err))
	}
	storage, err := attachmentstore.New(cfg.AttachmentStorageRoot)
	if err != nil {
		panic(fmt.Sprintf("initialize feedback attachment storage: %v", err))
	}
	return &Service{
		pool: pool, queries: dbsqlc.New(pool), cfg: cfg, logger: logger,
		dummyPassword: dummy, storage: storage,
		runtimeSystemParameters: make(map[string]runtimeSystemParameterSnapshot),
	}
}
