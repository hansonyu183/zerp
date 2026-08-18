package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/config"
	"github.com/hansonyu183/zerp/backend/internal/database"
	appdomain "github.com/hansonyu183/zerp/backend/internal/domains/app"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
)

type options struct {
	input appdomain.ConfirmSystemParameterAdoptionInput
}

func parseOptions(arguments []string) (options, error) {
	flags := flag.NewFlagSet("confirm-system-parameter-adoption", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	key := flags.String("key", "", "registered system parameter key")
	revision := flags.Int64("revision", 0, "latest configured revision")
	scope := flags.String("scope", "", "deployment scope")
	expected := flags.String("expected-instances", "", "comma-separated exact runtime instance inventory")
	reports := flags.String("reports", "", "comma-separated instance:revision adoption reports")
	if err := flags.Parse(arguments); err != nil {
		return options{}, err
	}
	if flags.NArg() != 0 {
		return options{}, errors.New("positional arguments are not supported")
	}
	input := appdomain.ConfirmSystemParameterAdoptionInput{
		Key: *key, Revision: *revision, DeploymentScope: *scope,
		ExpectedInstanceIDs: splitList(*expected),
	}
	for _, report := range splitList(*reports) {
		instanceID, revisionText, found := strings.Cut(report, ":")
		if !found || instanceID == "" || revisionText == "" {
			return options{}, fmt.Errorf("invalid adoption report %q", report)
		}
		reportedRevision, err := strconv.ParseInt(revisionText, 10, 64)
		if err != nil {
			return options{}, fmt.Errorf("invalid adoption report %q: %w", report, err)
		}
		input.Reports = append(input.Reports, appdomain.RuntimeInstanceAdoption{
			InstanceID: instanceID, Revision: reportedRevision,
		})
	}
	if input.Key == "" || input.Revision < 1 || input.DeploymentScope == "" ||
		len(input.ExpectedInstanceIDs) == 0 || len(input.Reports) == 0 {
		return options{}, errors.New("key, positive revision, scope, expected-instances, and reports are required")
	}
	return options{input: input}, nil
}

func splitList(value string) []string {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	for index := range parts {
		parts[index] = strings.TrimSpace(parts[index])
	}
	return parts
}

func run(ctx context.Context, arguments []string, logger *slog.Logger) error {
	parsed, err := parseOptions(arguments)
	if err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	db, err := database.Open(ctx, cfg.DatabaseURL, cfg.DatabaseConnectTimeout)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer db.Close()
	service := appdomain.NewService(db, cfg, logger)
	result, err := service.ConfirmSystemParameterAdoption(
		ctx, parsed.input, systemidentity.UserID, "runtime-adoption-cli",
	)
	if err != nil {
		return err
	}
	logger.Info("system parameter runtime adoption confirmed",
		"key", result.Key,
		"revision", result.Revision,
		"deploymentScope", parsed.input.DeploymentScope,
		"instanceCount", len(parsed.input.ExpectedInstanceIDs),
	)
	return nil
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(context.Background(), os.Args[1:], logger); err != nil {
		logger.Error("confirm system parameter runtime adoption", "error", err)
		os.Exit(1)
	}
}
