package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"net/url"
	"os"
	"strconv"

	"github.com/hansonyu183/zerp/backend/internal/config"
	"github.com/hansonyu183/zerp/backend/internal/database"
	"github.com/hansonyu183/zerp/backend/internal/seed/testseed"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}
	if cfg.Environment != config.EnvironmentTest {
		logger.Error("test data requires the test runtime")
		os.Exit(2)
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL, cfg.DatabaseConnectTimeout)
	if err != nil {
		logger.Error("connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	var databaseName, databaseUser string
	if err = pool.QueryRow(ctx, `
		SELECT current_database(),current_user
	`).Scan(&databaseName, &databaseUser); err != nil {
		logger.Error("identify test database", "error", err)
		os.Exit(1)
	}
	if !isManagedTestDatabase(databaseName, databaseUser, cfg.DatabaseURL) {
		logger.Error(
			"refusing to seed a non-test database",
			"database", databaseName,
			"databaseUser", databaseUser,
		)
		os.Exit(2)
	}
	seeder, err := testseed.New(pool, cfg, testseed.AccountSeed{
		AdminUsername:    os.Getenv("TEST_SEED_ADMIN_USERNAME"),
		AdminDisplayName: os.Getenv("TEST_SEED_ADMIN_DISPLAY_NAME"),
		AdminPassword:    os.Getenv("TEST_SEED_ADMIN_PASSWORD"),
		UserUsername:     os.Getenv("TEST_SEED_USER_USERNAME"),
		UserDisplayName:  os.Getenv("TEST_SEED_USER_DISPLAY_NAME"),
		UserPassword:     os.Getenv("TEST_SEED_USER_PASSWORD"),
	}, cfg.AttachmentStorageRoot, logger)
	if err != nil {
		logger.Error("initialize test data", "error", err)
		os.Exit(1)
	}
	result, err := seeder.Seed(ctx)
	if err != nil {
		logger.Error("seed test data", "error", err, "cause", rootCause(err))
		os.Exit(1)
	}
	fmt.Printf(
		"Test data ready: accounts=%d auxiliary=%d business=%d vouchers=%d accounting=%d "+
			"created=%d resumed=%d skipped=%d\n",
		result.Accounts.Total(),
		result.Auxiliary.Total(),
		result.Business.Total(),
		result.Vouchers.Total(),
		result.Accounting.Total(),
		result.Auxiliary.Created+result.Business.Created+result.Vouchers.Created+result.Accounting.Created,
		result.Auxiliary.Resumed+result.Business.Resumed+result.Vouchers.Resumed+result.Accounting.Resumed,
		result.Auxiliary.Skipped+result.Business.Skipped+result.Vouchers.Skipped+result.Accounting.Skipped,
	)
}

func isManagedTestDatabase(database, user, databaseURL string) bool {
	parsed, err := url.Parse(databaseURL)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") {
		return false
	}
	port, err := strconv.Atoi(parsed.Port())
	return err == nil &&
		database == "zerp_e2e" &&
		user == "zerp_e2e" &&
		parsed.User != nil && parsed.User.Username() == "zerp_e2e" &&
		parsed.EscapedPath() == "/zerp_e2e" &&
		isTestDatabaseHost(parsed.Hostname()) &&
		port == 55435
}

func isTestDatabaseHost(host string) bool {
	testHost := netip.MustParseAddr("127.0.0.1")
	if address, err := netip.ParseAddr(host); err == nil {
		return address == testHost
	}
	prefix, err := netip.ParsePrefix(host)
	return err == nil && prefix.Bits() == testHost.BitLen() && prefix.Addr() == testHost
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
