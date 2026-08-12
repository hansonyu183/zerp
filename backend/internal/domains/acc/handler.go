package acc

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/generated"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

const principalContextKey = "accPrincipal"

type bookApplicationService interface {
	QueryBooks(context.Context, QueryBooksInput, string) (BookPage, error)
	GetBook(context.Context, string, string) (BookView, error)
	CreateBook(context.Context, CreateBookInput, string) (BookView, error)
	SaveBook(context.Context, SaveBookInput, string) (BookView, error)
	DeleteBook(context.Context, string, int64, string) error
}

type Handler struct {
	service    bookApplicationService
	authorizer authorization.Authorizer
	logger     *slog.Logger
}

func NewHandler(service bookApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *Handler {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{service: service, authorizer: authorizer, logger: logger}
}

func (h *Handler) Register(router *gin.Engine) {
	group := router.Group("/acc/book")
	group.POST("/query", h.authorize("/acc/book/query"), h.query)
	group.POST("/get", h.authorize("/acc/book/get"), h.get)
	group.POST("/create", h.authorize("/acc/book/create"), h.create)
	group.POST("/save", h.authorize("/acc/book/save"), h.save)
	group.POST("/delete", h.authorize("/acc/book/delete"), h.delete)
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError)
}

func (h *Handler) actorID(c *gin.Context) string {
	principal, _ := c.Get(principalContextKey)
	return principal.(authorization.Principal).ActorID
}

func optionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func optionalStrings(value *[]string) []string {
	if value == nil {
		return nil
	}
	return *value
}

func (h *Handler) query(c *gin.Context) {
	var body generated.BookQueryRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.QueryBooks(c.Request.Context(), QueryBooksInput{
		Page: body.Page, PageSize: body.PageSize, Keyword: optionalString(body.Keyword),
	}, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) get(c *gin.Context) {
	var body generated.BookGetRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.GetBook(c.Request.Context(), body.BookId, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) create(c *gin.Context) {
	var body generated.BookCreateRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.CreateBook(c.Request.Context(), CreateBookInput{
		Name: body.Name, Description: optionalString(body.Description),
		StartMonth: body.StartMonth, BaseCurrency: body.BaseCurrency,
		QueryUserIDs: optionalStrings(body.QueryUserIds), OperateUserIDs: optionalStrings(body.OperateUserIds),
	}, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) save(c *gin.Context) {
	var body generated.BookSaveRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.SaveBook(c.Request.Context(), SaveBookInput{
		BookID: body.BookId, Name: body.Name,
		Description: optionalString(body.Description), BaseCurrency: body.BaseCurrency,
		Revision: body.Revision, QueryUserIDs: optionalStrings(body.QueryUserIds),
		OperateUserIDs: optionalStrings(body.OperateUserIds),
	}, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) delete(c *gin.Context) {
	var body generated.BookDeleteRequest
	if !h.bind(c, &body) {
		return
	}
	h.result(c, nil, h.service.DeleteBook(c.Request.Context(), body.BookId, body.Revision, h.actorID(c)))
}

func (h *Handler) bind(c *gin.Context, target any) bool {
	if err := requestbody.DecodeJSON(c, target); err != nil {
		h.writeError(c, domainError(ErrorValidation, "invalid request", err))
		return false
	}
	return true
}

func (h *Handler) result(c *gin.Context, data any, err error) {
	if err != nil {
		h.writeError(c, err)
		return
	}
	response.OK(c, data)
}

func (h *Handler) writeAuthorizationError(c *gin.Context, err error) {
	code, message := response.CodeInternal, "internal server error"
	switch {
	case authorization.IsKind(err, authorization.ErrorUnauthenticated):
		code, message = response.CodeUnauthenticated, "session expired"
	case authorization.IsKind(err, authorization.ErrorForbidden):
		code, message = response.CodeForbidden, "permission denied"
	default:
		h.logger.Error("ACC authorization failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", err)
	}
	response.BusinessError(c, code, message, nil)
}

func (h *Handler) writeError(c *gin.Context, err error) {
	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		domainErr = &DomainError{Kind: ErrorInternal, Message: "internal server error", Cause: err}
	}
	code := response.CodeInternal
	switch domainErr.Kind {
	case ErrorValidation:
		code = response.CodeValidation
	case ErrorForbidden:
		code = response.CodeForbidden
	case ErrorConflict:
		code = response.CodeConflict
	}
	if domainErr.Kind == ErrorInternal {
		h.logger.Error("ACC handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	response.BusinessError(c, code, domainErr.Message, nil)
}
