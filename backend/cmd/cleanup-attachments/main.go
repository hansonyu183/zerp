package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/config"
	"github.com/hansonyu183/zerp/backend/internal/database"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
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
	events := txevent.NewBus()
	authorizer := authorization.FailClosed{}
	auxiliaryResolver := auxiliaryrefs.New(auxdomain.NewService(pool, authorizer, events))
	bobService := bobdomain.NewService(pool, auxiliaryResolver, authorizer, events)
	service, err := voudomain.NewService(pool, bobService, auxiliaryResolver, events, voudomain.AttachmentOptions{
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
	customerAttachments, err := dcldomain.NewCustomerAttachmentService(pool, dcldomain.CustomerAttachmentOptions{
		Root: cfg.AttachmentStorageRoot, UploadTTL: cfg.AttachmentUploadTTL, DownloadTTL: cfg.AttachmentDownloadTTL,
	}, authorizer, events)
	if err != nil {
		logger.Error("initialize customer attachment storage", "error", err)
		os.Exit(1)
	}
	customerRemoved, err := customerAttachments.CleanupOrphanFiles(context.Background())
	if err != nil {
		logger.Error("cleanup DCL customer attachments", "error", err)
		os.Exit(1)
	}
	logger.Info("attachment cleanup completed", "vouRemoved", removed, "customerRemoved", customerRemoved)
}
