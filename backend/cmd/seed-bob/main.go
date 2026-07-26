package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/hansonyu183/zerp-back/internal/config"
	"github.com/hansonyu183/zerp-back/internal/database"
	"github.com/hansonyu183/zerp-back/internal/seed/bobseed"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}
	if cfg.Environment == config.EnvironmentProduction {
		logger.Error("BOB demo data is disabled in production")
		os.Exit(2)
	}

	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL, cfg.DatabaseConnectTimeout)
	if err != nil {
		logger.Error("connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	result, err := bobseed.New(pool).Seed(ctx)
	if err != nil {
		logger.Error("seed BOB demo data", "error", err)
		os.Exit(1)
	}
	fmt.Printf(
		"BOB demo data ready: created=%d resumed=%d skipped=%d total=%d\n",
		result.Created,
		result.Resumed,
		result.Skipped,
		result.Created+result.Resumed+result.Skipped,
	)
}
