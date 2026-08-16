package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"strings"

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
	if cfg.Environment != config.EnvironmentDevelopment {
		logger.Error("preview test data requires the preview development runtime")
		os.Exit(2)
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL, cfg.DatabaseConnectTimeout)
	if err != nil {
		logger.Error("connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	var databaseName, databaseUser, databaseHost string
	var databasePort int
	if err = pool.QueryRow(ctx, `
		SELECT current_database(),current_user,COALESCE(inet_server_addr()::text,''),inet_server_port()
	`).Scan(&databaseName, &databaseUser, &databaseHost, &databasePort); err != nil {
		logger.Error("identify preview database", "error", err)
		os.Exit(1)
	}
	if !isManagedPreviewDatabase(databaseName, databaseUser, databaseHost, databasePort) {
		logger.Error(
			"refusing to seed a non-preview database",
			"database", databaseName,
			"databaseUser", databaseUser,
			"databaseHost", databaseHost,
			"databasePort", databasePort,
		)
		os.Exit(2)
	}
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
		"Preview test data ready: auxiliary=%d business=%d vouchers=%d accounting=%d "+
			"created=%d resumed=%d skipped=%d\n",
		result.Auxiliary.Total(),
		result.Business.Total(),
		result.Vouchers.Total(),
		result.Accounting.Total(),
		result.Auxiliary.Created+result.Business.Created+result.Vouchers.Created+result.Accounting.Created,
		result.Auxiliary.Resumed+result.Business.Resumed+result.Vouchers.Resumed+result.Accounting.Resumed,
		result.Auxiliary.Skipped+result.Business.Skipped+result.Vouchers.Skipped+result.Accounting.Skipped,
	)
}

func isManagedPreviewDatabase(database, user, host string, port int) bool {
	if user != "zerp_preview" || !isPreviewDatabaseHost(host) || port != 55436 {
		return false
	}
	if database == "zerp_preview" {
		return true
	}
	const prefix = "zerp_preview_pr_"
	if !strings.HasPrefix(database, prefix) {
		return false
	}
	suffix := strings.TrimPrefix(database, prefix)
	if suffix == "" {
		return false
	}
	for _, character := range suffix {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func isPreviewDatabaseHost(host string) bool {
	previewHost := netip.MustParseAddr("127.0.0.1")
	if address, err := netip.ParseAddr(host); err == nil {
		return address == previewHost
	}
	prefix, err := netip.ParsePrefix(host)
	return err == nil && prefix.Bits() == previewHost.BitLen() && prefix.Addr() == previewHost
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
