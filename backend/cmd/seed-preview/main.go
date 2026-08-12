package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/hansonyu183/zerp/backend/internal/config"
	"github.com/hansonyu183/zerp/backend/internal/database"
	"github.com/hansonyu183/zerp/backend/internal/seed/previewseed"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}
	if cfg.Environment != config.EnvironmentDevelopment && cfg.Environment != config.EnvironmentTest {
		logger.Error("preview test data is enabled only in development or test")
		os.Exit(2)
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL, cfg.DatabaseConnectTimeout)
	if err != nil {
		logger.Error("connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	seeder, err := previewseed.New(pool, cfg.AttachmentStorageRoot, logger)
	if err != nil {
		logger.Error("initialize preview data", "error", err)
		os.Exit(1)
	}
	result, err := seeder.Seed(ctx)
	if err != nil {
		logger.Error("seed preview data", "error", err, "cause", rootCause(err))
		os.Exit(1)
	}
	fmt.Printf(
		"Preview test data ready: auxiliary=%d business=%d vouchers=%d "+
			"created=%d resumed=%d skipped=%d\n",
		result.Auxiliary.Total(),
		result.Business.Total(),
		result.Vouchers.Total(),
		result.Auxiliary.Created+result.Business.Created+result.Vouchers.Created,
		result.Auxiliary.Resumed+result.Business.Resumed+result.Vouchers.Resumed,
		result.Auxiliary.Skipped+result.Business.Skipped+result.Vouchers.Skipped,
	)
}

func rootCause(err error) error {
	for {
		next := errors.Unwrap(err)
		if next == nil {
			return err
		}
		err = next
	}
}
