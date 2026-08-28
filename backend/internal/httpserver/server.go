package httpserver

import (
	"context"
	"fmt"
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
	accdomain "github.com/hansonyu183/zerp/backend/internal/domains/acc"
	appdomain "github.com/hansonyu183/zerp/backend/internal/domains/app"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	rptdomain "github.com/hansonyu183/zerp/backend/internal/domains/rpt"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/integrations/workflowactions"
	"github.com/hansonyu183/zerp/backend/internal/platform/attachmentstore"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	oapigin "github.com/oapi-codegen/gin-middleware"
)

type databasePinger interface {
	Ping(context.Context) error
}

func New(ctx context.Context, cfg config.Config, db *pgxpool.Pool, logger *slog.Logger) (*gin.Engine, error) {
	appService := appdomain.NewService(db, cfg, logger)
	if err := appService.SynchronizeMenuRoutes(ctx); err != nil {
		return nil, fmt.Errorf("synchronize menu routes: %w", err)
	}
	authorizer := appAuthorizer{service: appService, cfg: cfg}
	eventBus := txevent.NewBus()
	auxService := auxdomain.NewService(db, authorizer, eventBus)
	auxiliaryResolver := auxiliaryrefs.New(auxService)
	partyCurrentWriter := bobdomain.NewPartyCurrentWriter(db)
	partyCurrentReader := bobdomain.NewPartyCurrentReader(db)
	partyMergeEngine := bobdomain.NewPartyMergeEngine(db)
	dclPartyService := dcldomain.NewPartyService(db, partyCurrentWriter, partyCurrentReader, partyMergeEngine, authorizer, eventBus)
	bobService := bobdomain.NewService(db, auxiliaryResolver, authorizer, eventBus, dclPartyService)
	dclOperatingEntityService := dcldomain.NewOperatingEntityService(db, bobService, authorizer, eventBus)
	dclWarehouseService := dcldomain.NewWarehouseService(db, bobService, authorizer, eventBus)
	dclVehicleService := dcldomain.NewVehicleService(db, bobService, authorizer, eventBus)
	dclFundAccountService := dcldomain.NewFundAccountService(db, bobService, authorizer, eventBus)
	dclProductService := dcldomain.NewProductService(db, bobService, authorizer, eventBus)
	dclEmployeeService := dcldomain.NewEmployeeService(db, bobService, dclPartyService, partyCurrentReader, authorizer, eventBus)
	bobAttachmentService, err := bobdomain.NewCustomerAttachmentService(db, bobdomain.CustomerAttachmentOptions{
		Root: cfg.AttachmentStorageRoot, UploadTTL: cfg.AttachmentUploadTTL, DownloadTTL: cfg.AttachmentDownloadTTL,
	}, bobService)
	if err != nil {
		return nil, err
	}
	accService := accdomain.NewService(db, authorizer, eventBus)
	vouService, err := voudomain.NewService(db, bobService, auxiliaryResolver, eventBus, voudomain.AttachmentOptions{
		Root: cfg.AttachmentStorageRoot, UploadTTL: cfg.AttachmentUploadTTL, DownloadTTL: cfg.AttachmentDownloadTTL,
	}, logger, voudomain.WithAccountingControl(accService), voudomain.WithApprovalAuthorizer(authorizer))
	if err != nil {
		return nil, err
	}
	wflService, err := wfldomain.NewService(db, authorizer, eventBus, workflowactions.New(vouService), logger)
	if err != nil {
		return nil, err
	}
	if err = accService.RegisterSubscriptions(eventBus); err != nil {
		return nil, err
	}
	rptService, err := rptdomain.NewService(db, authorizer, eventBus)
	if err != nil {
		return nil, err
	}
	router := newRouter(cfg, db, logger, func(router *gin.Engine) {
		appdomain.NewHandler(appService, authorizer, cfg, logger).Register(router)
		accdomain.NewHandler(accService, authorizer, logger).Register(router)
		bobdomain.NewHandler(bobService, bobAttachmentService, authorizer, logger).Register(router)
		dcldomain.NewHandler(dclOperatingEntityService, authorizer, logger).Register(router)
		dcldomain.NewWarehouseHandler(dclWarehouseService, authorizer, logger).Register(router)
		dcldomain.NewVehicleHandler(dclVehicleService, authorizer, logger).Register(router)
		dcldomain.NewFundAccountHandler(dclFundAccountService, authorizer, logger).Register(router)
		dcldomain.NewProductHandler(dclProductService, authorizer, logger).Register(router)
		dcldomain.NewPartyHandler(dclPartyService, authorizer, logger).Register(router)
		dcldomain.NewEmployeeHandler(dclEmployeeService, authorizer, logger).Register(router)
		auxdomain.NewHandler(auxService, authorizer, logger).Register(router)
		voudomain.NewHandler(vouService, authorizer, logger).Register(router)
		wfldomain.NewHandler(wflService, authorizer, logger).Register(router)
		rptdomain.NewHandler(rptService, authorizer, logger).Register(router)
	})
	return router, nil
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

	swagger, err := generated.GetSpec()
	if err != nil {
		panic("load embedded OpenAPI contract: " + err.Error())
	}
	swagger.Servers = nil

	router := gin.New()
	router.Use(
		middleware.RequestID(),
		middleware.RequestLogger(logger),
		middleware.Recovery(logger),
		middleware.CORS(cfg.CORSAllowedOrigins),
		limitRequestBody(),
	)
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
				limit = attachmentstore.MaxFileBytes
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
	response.BusinessError(c, response.CodeValidation, response.ErrorKeyValidation, "invalid request", nil)
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
