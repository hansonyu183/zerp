package rpt

import (
	"encoding/csv"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
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

func value(source *string) string {
	if source == nil {
		return ""
	}
	return *source
}

func versionDataFromAPI(source generated.RptVersionData) VersionData {
	parameters := make([]Parameter, len(source.Parameters))
	for index, parameter := range source.Parameters {
		var referenceType *ReferenceType
		if parameter.ReferenceType != nil {
			converted := ReferenceType(*parameter.ReferenceType)
			referenceType = &converted
		}
		parameters[index] = Parameter{
			DefaultValue:  parameter.DefaultValue,
			EnumValues:    parameter.EnumValues,
			Key:           parameter.Key,
			Name:          parameter.Name,
			ReferenceType: referenceType,
			Required:      parameter.Required,
			Type:          ParameterType(parameter.Type),
		}
	}
	columns := make([]ResultColumn, len(source.Columns))
	for index, column := range source.Columns {
		var drilldownEntity *string
		if column.DrilldownEntity != nil {
			converted := string(*column.DrilldownEntity)
			drilldownEntity = &converted
		}
		columns[index] = ResultColumn{
			Alias:           column.Alias,
			DrilldownEntity: drilldownEntity,
			Format:          column.Format,
			Name:            column.Name,
			Order:           column.Order,
			Type:            ResultType(column.Type),
			Visible:         column.Visible,
			Width:           column.Width,
		}
	}
	return VersionData{SQL: source.Sql, Parameters: parameters, Columns: columns}
}

func definitionQueryInput(source generated.RptDefinitionQueryRequest) DefinitionQueryInput {
	return DefinitionQueryInput{
		IncludeDisabled: source.IncludeDisabled != nil && *source.IncludeDisabled,
		Keyword:         value(source.Keyword),
		Page:            source.Page,
		PageSize:        source.PageSize,
	}
}

func versionRevisionInput(source generated.RptVersionRevisionRequest) VersionRevisionInput {
	parameters := map[string]any{}
	if source.ValidationParameters != nil {
		parameters = *source.ValidationParameters
	}
	return VersionRevisionInput{Code: source.Code, VersionID: source.VersionId, Revision: source.Revision, ValidationParameters: parameters}
}

func executeInput(source generated.RptExecuteRequest) ExecuteInput {
	return ExecuteInput{Parameters: source.Parameters, Page: source.Page, PageSize: source.PageSize}
}

func (h *Handler) Register(router *gin.Engine) {
	management := map[string]gin.HandlerFunc{"query": h.definitionQuery, "get": h.definitionGet, "create": h.definitionCreate, "create-version": h.createVersion, "save": h.saveVersion, "approve": h.approve, "unapprove": h.unapprove, "enable": h.enable, "disable": h.disable, "delete": h.delete}
	for action, handle := range management {
		path := "/rpt/definition/" + action
		router.POST(path, authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError), handle)
	}
	directoryPath := "/rpt/directory/query"
	router.POST(directoryPath, authmiddleware.Require(h.authorizer, directoryPath, principalContextKey, h.writeAuthorizationError), h.directoryQuery)
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

func (h *Handler) directoryQuery(c *gin.Context) {
	var in generated.RptDirectoryQueryRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.QueryDirectory(c, DirectoryQueryInput{Page: in.Page, PageSize: in.PageSize}, h.principal(c).Permissions)
	h.result(c, result, err)
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
	result, err := h.service.QueryDefinitions(c, definitionQueryInput(in))
	h.result(c, result, err)
}
func (h *Handler) definitionGet(c *gin.Context) {
	var in generated.RptDefinitionGetRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.GetDefinition(c, DefinitionGetInput{Code: in.Code, VersionID: value(in.VersionId)})
	h.result(c, result, err)
}
func (h *Handler) definitionCreate(c *gin.Context) {
	var in generated.RptDefinitionCreateRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.CreateDefinition(c, DefinitionCreateInput{Code: in.Code, Name: in.Name, Description: in.Description, Data: versionDataFromAPI(in.Data)}, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) createVersion(c *gin.Context) {
	var in generated.RptVersionCreateRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.CreateVersion(c, VersionCreateInput{Code: in.Code, Data: versionDataFromAPI(in.Data)}, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) saveVersion(c *gin.Context) {
	var in generated.RptVersionSaveRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.SaveVersion(c, VersionSaveInput{Code: in.Code, VersionID: in.VersionId, Revision: in.Revision, Name: in.Name, Description: in.Description, Data: versionDataFromAPI(in.Data)}, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) approve(c *gin.Context) {
	var in generated.RptVersionRevisionRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.ApproveVersion(c, versionRevisionInput(in), h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) unapprove(c *gin.Context) {
	var in generated.RptVersionRevisionRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.UnapproveVersion(c, versionRevisionInput(in), h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) definitionState(c *gin.Context, enabled bool) {
	var in generated.RptDefinitionRevisionRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.SetEnabled(c, DefinitionRevisionInput{Code: in.Code, Revision: in.Revision}, enabled, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) enable(c *gin.Context)  { h.definitionState(c, true) }
func (h *Handler) disable(c *gin.Context) { h.definitionState(c, false) }
func (h *Handler) delete(c *gin.Context) {
	var in generated.RptDefinitionRevisionRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.DeleteDefinition(c, DefinitionRevisionInput{Code: in.Code, Revision: in.Revision}, h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) reportQuery(c *gin.Context) {
	var in generated.RptExecuteRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.Execute(c, c.Param("report"), executeInput(in), h.principal(c).ActorID, response.RequestID(c))
	h.result(c, result, err)
}
func (h *Handler) reportExport(c *gin.Context) {
	var in generated.RptExecuteRequest
	if !h.bind(c, &in) {
		return
	}
	name := c.Param("report") + ".csv"
	err := h.service.StreamExport(c, c.Param("report"), executeInput(in), h.principal(c).ActorID, response.RequestID(c), func(columns []ResultColumn, rows pgx.Rows) error {
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
				record[index] = csvCell(value, columns[index])
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

func csvCell(value any, column ResultColumn) string {
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
		if column.Type == ResultTypeDate {
			text = typed.Format(time.DateOnly)
		} else if column.Type == ResultTypeDateTime {
			text = typed.Format("2006/1/2 15:04:05")
		} else {
			text = typed.Format(time.RFC3339Nano)
		}
	case []byte:
		text = string(typed)
	default:
		text = fmt.Sprint(value)
	}
	if column.Type == ResultTypeBoolean {
		if text == "true" {
			return "是"
		}
		if text == "false" {
			return "否"
		}
	}
	if column.Type == ResultTypeDecimal || column.Type == ResultTypeInteger {
		format := ""
		if column.Format != nil {
			format = *column.Format
		}
		if formatted, ok := formatNumber(text, format); ok {
			return formatted
		}
	}
	if (column.Type == ResultTypeText || column.Type == ResultTypeID) && text != "" && strings.ContainsRune("=+-@", rune(text[0])) {
		return "'" + text
	}
	return text
}

func formatNumber(text, format string) (string, bool) {
	value, ok := new(big.Rat).SetString(text)
	if !ok {
		return "", false
	}
	digits := 0
	trim := false
	switch format {
	case "money":
		digits = 2
	case "quantity":
		digits, trim = 6, true
	case "":
		digits, trim = 20, true
	default:
		return "", false
	}
	formatted := value.FloatString(digits)
	if trim && strings.Contains(formatted, ".") {
		formatted = strings.TrimRight(strings.TrimRight(formatted, "0"), ".")
	}
	sign := ""
	if strings.HasPrefix(formatted, "-") {
		sign, formatted = "-", formatted[1:]
	}
	parts := strings.SplitN(formatted, ".", 2)
	for index := len(parts[0]) - 3; index > 0; index -= 3 {
		parts[0] = parts[0][:index] + "," + parts[0][index:]
	}
	return sign + strings.Join(parts, "."), true
}

func (h *Handler) referenceQuery(c *gin.Context) {
	var in generated.RptReferenceQueryRequest
	if !h.bind(c, &in) {
		return
	}
	result, err := h.service.QueryReferences(c, c.Param("report"), ReferenceQueryInput{ParameterKey: in.ParameterKey, Keyword: value(in.Keyword), SelectedID: value(in.SelectedId), Page: in.Page, PageSize: in.PageSize})
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
