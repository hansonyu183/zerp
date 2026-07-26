package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/hansonyu183/zerp-back/internal/config"
	"github.com/hansonyu183/zerp-back/internal/database"
	appdomain "github.com/hansonyu183/zerp-back/internal/domains/app"
)

func main() {
	username := flag.String("username", "admin", "initial administrator username")
	displayName := flag.String("display-name", "Administrator", "initial administrator display name")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	password := os.Getenv("APP_BOOTSTRAP_PASSWORD")
	if strings.TrimSpace(password) == "" {
		logger.Error("APP_BOOTSTRAP_PASSWORD is required")
		os.Exit(2)
	}
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
	user, err := appdomain.NewService(pool, cfg, logger).BootstrapAdmin(context.Background(), *username, *displayName, password)
	if err != nil {
		logger.Error("bootstrap administrator", "error", err)
		os.Exit(1)
	}
	fmt.Printf("created initial administrator %s (%s)\n", user.Username, user.ID)
}
