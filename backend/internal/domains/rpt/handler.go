package rpt

import (
	"encoding/csv"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/generated"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const principalContextKey = "rptPrincipal"

type Handler struct {
	service    *Service
	authorizer authorization.Authorizer
	logger     *slog.Logger
}

func NewHandler(service *Service, authorizer authorization.Authorizer, logger *slog.Logger) *Handler {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{service: service, authorizer: authorizer, logger: logger}
}
func (h *Handler) Register(router *gin.Engine) {
	management := map[string]gin.HandlerFunc{"query": h.definitionQuery, "get": h.definitionGet, "create": h.definitionCreate, "create-version": h.createVersion, "save": h.saveVersion, "approve": h.approve, "unapprove": h.unapprove, "enable": h.enable, "disable": h.disable, "delete": h.delete}
	for action, handle := range management {
		path := "/rpt/definition/" + action
		router.POST(path, authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError), handle)
	}
	for _, route := range []struct {
		action string
		handle gin.HandlerFunc
	}{{"query", h.reportQuery}, {"export", h.reportExport}} {
		router.POST("/rpt/:report/"+route.action, func(action string, handle gin.HandlerFunc) gin.HandlerFunc {
			return func(c *gin.Context) {
				path := permissionPath(c.Param("report"), action)
				authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError)(c)
				if !c.IsAborted() {
					handle(c)
				}
			}
		}(route.action, route.handle))
	}
	router.POST("/rpt/:report/reference-query", h.requireReportAccess(h.referenceQuery))
}

func (h *Handler) requireReportAccess(next gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		var lastErr error
		for _, action := range []string{"query", "export"} {
			principal, err := h.authorizer.Authorize(c.Request.Context(), c.Request, permissionPath(c.Param("report"), action), response.RequestID(c))
			if err == nil && principal.ActorID != "" {
				c.Set(principalContextKey, principal)
				next(c)
				return
			}
			lastErr = err
			if err == nil || !authorization.IsKind(err, authorization.ErrorForbidden) {
				break
			}
		}
		h.writeAuthorizationError(c, lastErr)
		c.Abort()
	}
}
func (h *Handler) principal(c *gin.Context) authorization.Principal {
	value, _ := c.Get(principalContextKey)
	principal, _ := value.(authorization.Principal)
	return principal
}
func (h *Handler) bind(c *gin.Context, target any) bool {
	if err := requestbody.DecodeJSON(c, target); err != nil {
		h.writeError(c, domainError(ErrorValidation, "invalid request", nil, err))
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
func (h *Handler) definitionQuery(c *gin.Context) {
	var in generated.RptDefinitionQueryRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.QueryDefinitions(c, in, h.principal(c).Permissions)
	h.result(c, result, err)
}
func (h *Handler) definitionGet(c *gin.Context) {
	var in generated.RptDefinitionGetRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.GetDefinition(c, in, h.principal(c).Permissions)
	h.result(c, result, err)
}
func (h *Handler) definitionCreate(c *gin.Context) {
	var in generated.RptDefinitionCreateRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.CreateDefinition(c, in, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) createVersion(c *gin.Context) {
	var in generated.RptVersionCreateRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.CreateVersion(c, in, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) saveVersion(c *gin.Context) {
	var in generated.RptVersionSaveRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.SaveVersion(c, in, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) approve(c *gin.Context) {
	var in generated.RptVersionRevisionRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.ApproveVersion(c, in, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) unapprove(c *gin.Context) {
	var in generated.RptVersionRevisionRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.UnapproveVersion(c, in, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) definitionState(c *gin.Context, enabled bool) {
	var in generated.RptDefinitionRevisionRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.SetEnabled(c, in, enabled, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) enable(c *gin.Context)  { h.definitionState(c, true) }
func (h *Handler) disable(c *gin.Context) { h.definitionState(c, false) }
func (h *Handler) delete(c *gin.Context) {
	var in generated.RptDefinitionRevisionRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.DeleteDefinition(c, in, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) reportQuery(c *gin.Context) {
	var in generated.RptExecuteRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.Execute(c, c.Param("report"), in, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) reportExport(c *gin.Context) {
	var in generated.RptExecuteRequest
	if !h.bind(c, &in) {
		return
	}
	name := c.Param("report") + ".csv"
	err := h.service.StreamExport(c, c.Param("report"), in, h.principal(c).ActorID, response.RequestID(c), func(columns []generated.RptResultColumn, rows pgx.Rows) error {
		c.Header("Content-Type", "text/csv; charset=utf-8")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Cache-Control", "private, no-store")
		writer := csv.NewWriter(c.Writer)
		headings := make([]string, len(columns))
		for index, column := range columns {
			headings[index] = column.Name
		}
		if err := writer.Write(headings); err != nil {
			return err
		}
		for rows.Next() {
			values, err := rows.Values()
			if err != nil {
				return err
			}
			record := make([]string, len(values))
			for index, value := range values {
				record[index] = csvCell(value, columns[index].Type)
			}
			if err = writer.Write(record); err != nil {
				return err
			}
			writer.Flush()
			if err = writer.Error(); err != nil {
				return err
			}
		}
		return rows.Err()
	})
	if err != nil && !c.Writer.Written() {
		h.writeError(c, err)
	}
}

func csvCell(value any, resultType generated.RptResultType) string {
	if value == nil {
		return ""
	}
	var text string
	switch typed := value.(type) {
	case pgtype.Numeric:
		driverValue, err := typed.Value()
		if err == nil && driverValue != nil {
			text = fmt.Sprint(driverValue)
		}
	case time.Time:
		if resultType == generated.RptResultTypeDATE {
			text = typed.Format(time.DateOnly)
		} else {
			text = typed.Format(time.RFC3339Nano)
		}
	case []byte:
		text = string(typed)
	default:
		text = fmt.Sprint(value)
	}
	if (resultType == generated.RptResultTypeTEXT || resultType == generated.RptResultTypeID) && text != "" && strings.ContainsRune("=+-@", rune(text[0])) {
		return "'" + text
	}
	return text
}
func (h *Handler) referenceQuery(c *gin.Context) {
	var in generated.RptReferenceQueryRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.QueryReferences(c, c.Param("report"), in)
	h.result(c, result, err)
}
func (h *Handler) writeAuthorizationError(c *gin.Context, err error) {
	code, message := response.CodeInternal, "internal server error"
	if authorization.IsKind(err, authorization.ErrorUnauthenticated) {
		code, message = response.CodeUnauthenticated, "session expired"
	} else if authorization.IsKind(err, authorization.ErrorForbidden) {
		code, message = response.CodeForbidden, "permission denied"
	} else {
		h.logger.Error("rpt authorization failure", "requestId", response.RequestID(c), "error", err)
	}
	response.BusinessError(c, code, message, nil)
}
func (h *Handler) writeError(c *gin.Context, err error) {
	var target *DomainError
	if !errors.As(err, &target) {
		target = &DomainError{Kind: ErrorInternal, Message: "internal server error", Cause: err}
	}
	code := response.CodeInternal
	switch target.Kind {
	case ErrorValidation:
		code = response.CodeValidation
	case ErrorConflict:
		code = response.CodeConflict
	case ErrorForbidden:
		code = response.CodeForbidden
	}
	if target.Kind == ErrorInternal {
		h.logger.Error("rpt handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", target.Cause)
	}
	response.BusinessError(c, code, target.Message, target.Data)
}
