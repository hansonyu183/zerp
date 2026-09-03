package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/hansonyu183/zerp/backend/internal/config"
	"github.com/hansonyu183/zerp/backend/internal/database"
	"github.com/hansonyu183/zerp/backend/internal/domains/rpt"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}
	pool, err := database.Open(context.Background(), cfg.DatabaseURL, cfg.DatabaseConnectTimeout)
	if err != nil {
		logger.Error("connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	service, err := rpt.NewService(pool)
	if err != nil {
		logger.Error("initialize report validation", "error", err)
		os.Exit(1)
	}
	if err = service.ValidatePublishedDefinitions(context.Background()); err != nil {
		logger.Error("published report validation failed", "error", err)
		os.Exit(1)
	}
	logger.Info("published report validation passed")
}
