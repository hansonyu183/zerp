package httpserver

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/middleware"
	"github.com/hansonyu183/zerp-back/internal/config"
	appdomain "github.com/hansonyu183/zerp-back/internal/domains/app"
	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	leddomain "github.com/hansonyu183/zerp-back/internal/domains/led"
	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/hansonyu183/zerp-back/internal/integrations/githubissues"
	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
)

type databasePinger interface {
	Ping(context.Context) error
}

func New(cfg config.Config, db *pgxpool.Pool, logger *slog.Logger) (*gin.Engine, *appdomain.FeedbackPublisher, error) {
	if err := validateFeedbackRuntimeConfig(cfg); err != nil {
		return nil, nil, err
	}
	bobService := bobdomain.NewService(db)
	eventBus := txevent.NewBus()
	vouService, err := voudomain.NewService(db, bobService, eventBus, voudomain.AttachmentOptions{
		Root: cfg.AttachmentStorageRoot, UploadTTL: cfg.AttachmentUploadTTL, DownloadTTL: cfg.AttachmentDownloadTTL,
	}, logger)
	if err != nil {
		return nil, nil, err
	}
	appService := appdomain.NewService(db, cfg, logger)
	appService.SetFeedbackAttachmentResolver(vouService)
	ledService, err := leddomain.NewService(db, bobService)
	if err != nil {
		return nil, nil, err
	}
	if err = ledService.RegisterSubscriptions(eventBus); err != nil {
		return nil, nil, err
	}
	var publisher *appdomain.FeedbackPublisher
	if cfg.FeedbackGitHubEnabled {
		issueClient, clientErr := githubissues.New(cfg.FeedbackGitHubRepository, cfg.FeedbackGitHubToken)
		if clientErr != nil {
			return nil, nil, clientErr
		}
		publisher = appdomain.NewFeedbackPublisher(db, issueClient, logger)
	}
	router := newRouter(cfg, db, logger, func(router *gin.Engine) {
		appdomain.NewHandler(appService, cfg, logger).Register(router)
		authorizer := appAuthorizer{service: appService, cfg: cfg}
		bobdomain.NewHandler(bobService, authorizer, logger).Register(router)
		voudomain.NewHandler(vouService, authorizer, logger).Register(router)
		leddomain.NewHandler(ledService, authorizer, logger).Register(router)
	})
	return router, publisher, nil
}

func validateFeedbackRuntimeConfig(cfg config.Config) error {
	if cfg.Environment == config.EnvironmentProduction && !cfg.FeedbackGitHubEnabled {
		return errors.New("FEEDBACK_GITHUB_ENABLED must be true in production")
	}
	return nil
}

func newRouter(
	cfg config.Config,
	db databasePinger,
	logger *slog.Logger,
	registerBusinessRoutes func(*gin.Engine),
) *gin.Engine {
	if cfg.Environment == config.EnvironmentProduction {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(
		middleware.RequestID(),
		middleware.RequestLogger(logger),
		middleware.Recovery(logger),
		middleware.CORS(cfg.CORSAllowedOrigins),
	)

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/readyz", readinessHandler(db, cfg.DatabaseHealthTimeout))
	if registerBusinessRoutes != nil {
		registerBusinessRoutes(router)
	}

	router.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{
			"error":     "route not found",
			"requestId": c.GetString("requestId"),
		})
	})

	return router
}
