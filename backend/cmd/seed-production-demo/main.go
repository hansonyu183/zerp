package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/hansonyu183/zerp/backend/internal/config"
	"github.com/hansonyu183/zerp/backend/internal/database"
	"github.com/hansonyu183/zerp/backend/internal/seed/productionseed"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}
	if cfg.Environment != config.EnvironmentDevelopment {
		logger.Error("production document demo data is enabled only in development")
		os.Exit(2)
	}

	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL, cfg.DatabaseConnectTimeout)
	if err != nil {
		logger.Error("connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	seeder, err := productionseed.New(pool, cfg.AttachmentStorageRoot, logger)
	if err != nil {
		logger.Error("initialize production document demo seeder", "error", err)
		os.Exit(1)
	}
	result, err := seeder.Seed(ctx)
	if err != nil {
		logger.Error(
			"seed production document demo data",
			"error",
			err,
			"cause",
			rootCause(err),
		)
		os.Exit(1)
	}
	fmt.Printf(
		"Production document demo data ready: created=%d resumed=%d skipped=%d total=%d\n",
		result.Created,
		result.Resumed,
		result.Skipped,
		result.Created+result.Resumed+result.Skipped,
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
