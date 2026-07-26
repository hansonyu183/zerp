package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/hansonyu183/zerp/backend/internal/config"
	"github.com/hansonyu183/zerp/backend/internal/database"
	appdomain "github.com/hansonyu183/zerp/backend/internal/domains/app"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}
	pool, err := database.Open(context.Background(), cfg.DatabaseURL, cfg.DatabaseConnectTimeout)
	if err != nil {
		logger.Error("connect database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	service, err := voudomain.NewService(pool, bobdomain.NewService(pool), txevent.NewBus(), voudomain.AttachmentOptions{
		Root: cfg.AttachmentStorageRoot, UploadTTL: cfg.AttachmentUploadTTL, DownloadTTL: cfg.AttachmentDownloadTTL,
	}, logger)
	if err != nil {
		logger.Error("initialize attachment storage", "error", err)
		os.Exit(1)
	}
	removed, err := service.CleanupAttachments(context.Background(), 500)
	if err != nil {
		logger.Error("cleanup VOU attachments", "error", err)
		os.Exit(1)
	}
	appRemoved, err := appdomain.NewService(pool, cfg, logger).CleanupFeedbackAttachments(context.Background(), 500)
	if err != nil {
		logger.Error("cleanup APP feedback attachments", "error", err)
		os.Exit(1)
	}
	logger.Info("attachment cleanup completed", "vouRemoved", removed, "feedbackRemoved", appRemoved)
}
