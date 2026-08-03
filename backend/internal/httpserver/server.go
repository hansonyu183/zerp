package httpserver

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/generated"
	"github.com/hansonyu183/zerp/backend/internal/api/middleware"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	"github.com/hansonyu183/zerp/backend/internal/config"
	appdomain "github.com/hansonyu183/zerp/backend/internal/domains/app"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	leddomain "github.com/hansonyu183/zerp/backend/internal/domains/led"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/integrations/githubissues"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	oapigin "github.com/oapi-codegen/gin-middleware"
)

const maxFileRequestBodyBytes int64 = 10 << 20

type databasePinger interface {
	Ping(context.Context) error
}

func New(cfg config.Config, db *pgxpool.Pool, logger *slog.Logger) (*gin.Engine, *appdomain.FeedbackPublisher, error) {
	if err := validateFeedbackRuntimeConfig(cfg); err != nil {
		return nil, nil, err
	}
	bobService := bobdomain.NewService(db)
	auxService := auxdomain.NewService(db)
	bobService.SetAuxiliaryResolver(auxiliaryrefs.New(auxService))
	eventBus := txevent.NewBus()
	vouService, err := voudomain.NewService(db, bobService, eventBus, voudomain.AttachmentOptions{
		Root: cfg.AttachmentStorageRoot, UploadTTL: cfg.AttachmentUploadTTL, DownloadTTL: cfg.AttachmentDownloadTTL,
	}, logger)
	if err != nil {
		return nil, nil, err
	}
	wflService, err := wfldomain.NewService(db, eventBus, vouService, logger)
	if err != nil {
		return nil, nil, err
	}
	appService := appdomain.NewService(db, cfg, logger)
	ledService, err := leddomain.NewService(db, bobService)
	if err != nil {
		return nil, nil, err
	}
	if err = ledService.RegisterSubscriptions(eventBus); err != nil {
		return nil, nil, err
	}
	if err = ledService.EnsureReady(context.Background()); err != nil {
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
		auxdomain.NewHandler(auxService, authorizer, logger).Register(router)
		voudomain.NewHandler(vouService, authorizer, logger).Register(router)
		wfldomain.NewHandler(wflService, authorizer, logger).Register(router)
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
		limitRequestBody(),
	)
	swagger, err := generated.GetSpec()
	if err != nil {
		panic("load embedded OpenAPI contract: " + err.Error())
	}
	swagger.Servers = nil
	router.Use(oapigin.OapiRequestValidatorWithOptions(swagger, &oapigin.Options{
		Options: openapi3filter.Options{
			AuthenticationFunc: func(context.Context, *openapi3filter.AuthenticationInput) error {
				// Authentication and authorization remain in the domain middleware.
				// This hook only lets request-shape validation evaluate secured operations.
				return nil
			},
		},
		ErrorHandler: func(c *gin.Context, _ string, statusCode int) {
			writeOpenAPIError(c, statusCode)
		},
	}))

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/readyz", readinessHandler(db, cfg.DatabaseHealthTimeout))
	if registerBusinessRoutes != nil {
		registerBusinessRoutes(router)
	}

	router.NoRoute(writeRouteNotFound)

	return router
}

func limitRequestBody() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil && c.Request.Body != http.NoBody {
			limit := requestbody.MaxJSONBodyBytes
			if isFileEndpoint(c.Request.URL.Path) {
				limit = maxFileRequestBodyBytes
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		}
		c.Next()
	}
}

func writeOpenAPIError(c *gin.Context, statusCode int) {
	if statusCode == http.StatusNotFound {
		writeRouteNotFound(c)
		return
	}
	if isFileEndpoint(c.Request.URL.Path) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     "invalid request",
			"requestId": response.RequestID(c),
		})
		return
	}
	response.BusinessError(c, response.CodeValidation, "invalid request", nil)
}

func writeRouteNotFound(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{
		"error":     "route not found",
		"requestId": response.RequestID(c),
	})
}

func isFileEndpoint(path string) bool {
	return strings.HasPrefix(path, "/files/")
}
