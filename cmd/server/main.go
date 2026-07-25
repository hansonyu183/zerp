package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/hansonyu183/zerp-back/internal/config"
	"github.com/hansonyu183/zerp-back/internal/database"
	"github.com/hansonyu183/zerp-back/internal/httpserver"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}

	db, err := database.Open(context.Background(), cfg.DatabaseURL, cfg.DatabaseConnectTimeout)
	if err != nil {
		logger.Error("connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	router, feedbackPublisher, err := httpserver.New(cfg, db, logger)
	if err != nil {
		logger.Error("initialize HTTP server", "error", err)
		os.Exit(1)
	}

	httpServer := &http.Server{
		Addr:              cfg.HTTPAddress,
		Handler:           router,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("http server started", "address", cfg.HTTPAddress, "environment", cfg.Environment)
		serverErrors <- httpServer.ListenAndServe()
	}()

	workerContext, stopWorkers := context.WithCancel(context.Background())
	defer stopWorkers()
	var workerErrors <-chan error
	var workerDone <-chan struct{}
	if feedbackPublisher != nil {
		errorsChannel := make(chan error, 1)
		doneChannel := make(chan struct{})
		workerErrors = errorsChannel
		workerDone = doneChannel
		go func() {
			defer close(doneChannel)
			errorsChannel <- feedbackPublisher.Run(workerContext)
		}()
		logger.Info("feedback publisher started", "repository", cfg.FeedbackGitHubRepository)
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(signals)

	var fatalError error
	select {
	case sig := <-signals:
		logger.Info("shutdown signal received", "signal", sig.String())
	case err = <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server stopped unexpectedly", "error", err)
			fatalError = err
		}
	case err = <-workerErrors:
		if err != nil {
			logger.Error("feedback publisher stopped unexpectedly", "error", err)
			fatalError = err
		}
	}

	stopWorkers()
	shutdownContext, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err = httpServer.Shutdown(shutdownContext); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}
	if workerDone != nil {
		select {
		case <-workerDone:
		case <-shutdownContext.Done():
			logger.Error("feedback publisher shutdown timed out", "error", shutdownContext.Err())
			os.Exit(1)
		}
	}

	logger.Info("http server stopped")
	if fatalError != nil {
		os.Exit(1)
	}
}
