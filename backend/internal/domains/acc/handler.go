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

type bookApplicationService interface {
	QueryBooks(context.Context, QueryBooksInput, string) (BookPage, error)
	GetBook(context.Context, string, string) (BookView, error)
	CreateBook(context.Context, CreateBookInput, string) (BookView, error)
	SaveBook(context.Context, SaveBookInput, string) (BookView, error)
	DeleteBook(context.Context, string, int64, string) error
	QuerySubjects(context.Context, QuerySubjectsInput, string) (SubjectPage, error)
	GetSubject(context.Context, string, string, string) (SubjectView, error)
	CreateSubject(context.Context, CreateSubjectInput, string) (SubjectView, error)
	SaveSubject(context.Context, SaveSubjectInput, string) (SubjectView, error)
	DeleteSubject(context.Context, string, string, int64, string) error
	GetOpening(context.Context, string, string) (OpeningView, error)
	SaveOpening(context.Context, SaveOpeningInput, string) (OpeningView, error)
	ApproveOpening(context.Context, string, int64, string) (OpeningView, error)
	UnapproveOpening(context.Context, string, int64, string) (OpeningView, error)
	QueryMappings(context.Context, QueryMappingsInput, string) (MappingPage, error)
	GetMapping(context.Context, string, string, string) (MappingView, error)
	CreateMapping(context.Context, CreateMappingInput, string) (MappingView, error)
	SaveMapping(context.Context, SaveMappingInput, string) (MappingView, error)
	ApproveMapping(context.Context, string, string, int64, string) (MappingView, error)
	UnapproveMapping(context.Context, string, string, int64, string) (MappingView, error)
	QueryPeriods(context.Context, string, string) ([]PeriodView, error)
	LockPeriod(context.Context, PeriodActionInput, string) (PeriodView, error)
	UnlockPeriod(context.Context, PeriodActionInput, string) (PeriodView, error)
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
	books := router.Group("/acc/book")
	books.POST("/query", h.authorize("/acc/book/query"), h.query)
	books.POST("/get", h.authorize("/acc/book/get"), h.get)
	books.POST("/create", h.authorize("/acc/book/create"), h.create)
	books.POST("/save", h.authorize("/acc/book/save"), h.save)
	books.POST("/delete", h.authorize("/acc/book/delete"), h.delete)

	subjects := router.Group("/acc/subject")
	subjects.POST("/query", h.authorize("/acc/subject/query"), h.querySubjects)
	subjects.POST("/get", h.authorize("/acc/subject/get"), h.getSubject)
	subjects.POST("/create", h.authorize("/acc/subject/create"), h.createSubject)
	subjects.POST("/save", h.authorize("/acc/subject/save"), h.saveSubject)
	subjects.POST("/delete", h.authorize("/acc/subject/delete"), h.deleteSubject)

	openings := router.Group("/acc/opening")
	openings.POST("/query", h.authorize("/acc/opening/query"), h.queryOpening)
	openings.POST("/save", h.authorize("/acc/opening/save"), h.saveOpening)
	openings.POST("/approve", h.authorize("/acc/opening/approve"), h.approveOpening)
	openings.POST("/unapprove", h.authorize("/acc/opening/unapprove"), h.unapproveOpening)

	mappings := router.Group("/acc/mapping")
	mappings.POST("/query", h.authorize("/acc/mapping/query"), h.queryMappings)
	mappings.POST("/get", h.authorize("/acc/mapping/get"), h.getMapping)
	mappings.POST("/create", h.authorize("/acc/mapping/create"), h.createMapping)
	mappings.POST("/save", h.authorize("/acc/mapping/save"), h.saveMapping)
	mappings.POST("/approve", h.authorize("/acc/mapping/approve"), h.approveMapping)
	mappings.POST("/unapprove", h.authorize("/acc/mapping/unapprove"), h.unapproveMapping)
	mappings.POST("/catalog", h.authorize("/acc/mapping/catalog"), h.mappingCatalog)

	periods := router.Group("/acc/period")
	periods.POST("/query", h.authorize("/acc/period/query"), h.queryPeriods)
	periods.POST("/lock", h.authorize("/acc/period/lock"), h.lockPeriod)
	periods.POST("/unlock", h.authorize("/acc/period/unlock"), h.unlockPeriod)
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError)
}

func (h *Handler) actorID(c *gin.Context) string {
	return authmiddleware.Principal(c).ActorID
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
		SubjectTemplate: string(body.SubjectTemplate),
		QueryUserIDs:    optionalStrings(body.QueryUserIds), OperateUserIDs: optionalStrings(body.OperateUserIds),
	}, h.actorID(c))
	h.result(c, result, err)
}

func subjectDimensions(values []generated.SubjectDimension) []string {
	result := make([]string, len(values))
	for index, value := range values {
		result[index] = string(value)
	}
	return result
}

func subjectInput(bookID, code, name string, parentSubjectID *string, balanceDirection generated.BalanceDirection, enabled bool, dimensions []generated.SubjectDimension, inventoryQuantity bool, settlementPurpose generated.SettlementPurpose) CreateSubjectInput {
	return CreateSubjectInput{
		BookID: bookID, Code: code, Name: name, ParentSubjectID: parentSubjectID,
		BalanceDirection: string(balanceDirection), Enabled: enabled,
		RequiredDimensions: subjectDimensions(dimensions), InventoryQuantity: inventoryQuantity,
		SettlementPurpose: string(settlementPurpose),
	}
}

func (h *Handler) querySubjects(c *gin.Context) {
	var body generated.SubjectQueryRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.QuerySubjects(c.Request.Context(), QuerySubjectsInput{
		BookID: body.BookId, Page: body.Page, PageSize: body.PageSize, Keyword: optionalString(body.Keyword),
	}, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) getSubject(c *gin.Context) {
	var body generated.SubjectGetRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.GetSubject(c.Request.Context(), body.BookId, body.SubjectId, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) createSubject(c *gin.Context) {
	var body generated.SubjectCreateRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.CreateSubject(c.Request.Context(), subjectInput(
		body.BookId, body.Code, body.Name, body.ParentSubjectId, body.BalanceDirection,
		body.Enabled, body.RequiredDimensions, body.InventoryQuantity, body.SettlementPurpose,
	), h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) saveSubject(c *gin.Context) {
	var body generated.SubjectSaveRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.SaveSubject(c.Request.Context(), SaveSubjectInput{
		CreateSubjectInput: subjectInput(
			body.BookId, body.Code, body.Name, body.ParentSubjectId, body.BalanceDirection,
			body.Enabled, body.RequiredDimensions, body.InventoryQuantity, body.SettlementPurpose,
		),
		SubjectID: body.SubjectId, Revision: body.Revision,
	}, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) deleteSubject(c *gin.Context) {
	var body generated.SubjectDeleteRequest
	if !h.bind(c, &body) {
		return
	}
	h.result(c, struct{}{}, h.service.DeleteSubject(c.Request.Context(), body.BookId, body.SubjectId, body.Revision, h.actorID(c)))
}

func (h *Handler) queryOpening(c *gin.Context) {
	var body generated.OpeningQueryRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.GetOpening(c.Request.Context(), body.BookId, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) saveOpening(c *gin.Context) {
	var body generated.OpeningSaveRequest
	if !h.bind(c, &body) {
		return
	}
	lines := make([]OpeningLineInput, 0, len(body.Lines))
	for _, line := range body.Lines {
		lines = append(lines, OpeningLineInput{
			SubjectID: line.SubjectId, Currency: line.Currency,
			DebitAmount: line.DebitAmount, CreditAmount: line.CreditAmount,
			Quantity: line.Quantity, Dimensions: line.Dimensions,
		})
	}
	result, err := h.service.SaveOpening(c.Request.Context(), SaveOpeningInput{
		BookID: body.BookId, Revision: body.Revision, Lines: lines,
	}, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) approveOpening(c *gin.Context) {
	var body generated.OpeningActionRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.ApproveOpening(c.Request.Context(), body.BookId, body.Revision, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) unapproveOpening(c *gin.Context) {
	var body generated.OpeningActionRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.UnapproveOpening(c.Request.Context(), body.BookId, body.Revision, h.actorID(c))
	h.result(c, result, err)
}

func mappingDefinition(input generated.MappingDefinition) MappingDefinition {
	rules := make([]MappingRule, 0, len(input.Rules))
	for _, rule := range input.Rules {
		conditions := make([]MappingCondition, 0, len(rule.Conditions))
		for _, condition := range rule.Conditions {
			conditions = append(conditions, MappingCondition{Field: condition.Field, Operator: string(condition.Operator), Values: condition.Values})
		}
		rules = append(rules, MappingRule{Conditions: conditions, Result: string(rule.Result), TemplateID: rule.TemplateId})
	}
	templates := make([]PostingTemplate, 0, len(input.Templates))
	for _, template := range input.Templates {
		lines := make([]PostingLineTemplate, 0, len(template.Lines))
		for _, line := range template.Lines {
			lines = append(lines, PostingLineTemplate{
				SubjectSource: string(line.SubjectSource), SubjectValue: line.SubjectValue,
				Direction: string(line.Direction), AmountField: line.AmountField,
				CurrencyField: line.CurrencyField, Dimensions: line.Dimensions,
				QuantityField: line.QuantityField, CostCounterpartSubjectID: line.CostCounterpartSubjectId,
				CostCounterpartDimensions: line.CostCounterpartDimensions,
			})
		}
		templates = append(templates, PostingTemplate{ID: template.TemplateId, Collection: template.Collection, Lines: lines})
	}
	definition := MappingDefinition{DefaultTemplateID: input.DefaultTemplateId, Rules: rules, Templates: templates}
	if input.AssetConfiguration != nil {
		definition.AssetConfiguration = &AssetAccountingConfiguration{
			AssetSubjectID: input.AssetConfiguration.AssetSubjectId, AssetDimensions: input.AssetConfiguration.AssetDimensions,
			AccumulatedDepreciationSubjectID:  input.AssetConfiguration.AccumulatedDepreciationSubjectId,
			AccumulatedDepreciationDimensions: input.AssetConfiguration.AccumulatedDepreciationDimensions,
			DepreciationExpenseSubjectID:      input.AssetConfiguration.DepreciationExpenseSubjectId,
			DepreciationExpenseDimensions:     input.AssetConfiguration.DepreciationExpenseDimensions,
		}
	}
	return definition
}

func (h *Handler) queryMappings(c *gin.Context) {
	var body generated.MappingQueryRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.QueryMappings(c.Request.Context(), QueryMappingsInput{BookID: body.BookId, VouEntity: optionalString(body.VouEntity), Page: body.Page, PageSize: body.PageSize}, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) getMapping(c *gin.Context) {
	var body generated.MappingGetRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.GetMapping(c.Request.Context(), body.BookId, body.MappingId, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) createMapping(c *gin.Context) {
	var body generated.MappingCreateRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.CreateMapping(c.Request.Context(), CreateMappingInput{BookID: body.BookId, VouEntity: body.VouEntity, DefaultResult: string(body.DefaultResult), Definition: mappingDefinition(body.Definition)}, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) saveMapping(c *gin.Context) {
	var body generated.MappingSaveRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.SaveMapping(c.Request.Context(), SaveMappingInput{BookID: body.BookId, MappingID: body.MappingId, DefaultResult: string(body.DefaultResult), Definition: mappingDefinition(body.Definition), Revision: body.Revision}, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) approveMapping(c *gin.Context) {
	var body generated.MappingActionRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.ApproveMapping(c.Request.Context(), body.BookId, body.MappingId, body.Revision, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) unapproveMapping(c *gin.Context) {
	var body generated.MappingActionRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.UnapproveMapping(c.Request.Context(), body.BookId, body.MappingId, body.Revision, h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) mappingCatalog(c *gin.Context) {
	var body generated.MappingCatalogRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := MappingFieldCatalog(body.VouEntity)
	h.result(c, result, err)
}

func (h *Handler) queryPeriods(c *gin.Context) {
	var body generated.PeriodQueryRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.QueryPeriods(c.Request.Context(), body.BookId, h.actorID(c))
	h.result(c, result, err)
}

func periodActionInput(body generated.PeriodActionRequest) PeriodActionInput {
	return PeriodActionInput{BookID: body.BookId, Month: body.Month, Revision: body.Revision}
}

func (h *Handler) lockPeriod(c *gin.Context) {
	var body generated.PeriodActionRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.LockPeriod(c.Request.Context(), periodActionInput(body), h.actorID(c))
	h.result(c, result, err)
}

func (h *Handler) unlockPeriod(c *gin.Context) {
	var body generated.PeriodActionRequest
	if !h.bind(c, &body) {
		return
	}
	result, err := h.service.UnlockPeriod(c.Request.Context(), periodActionInput(body), h.actorID(c))
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
	h.result(c, struct{}{}, h.service.DeleteBook(c.Request.Context(), body.BookId, body.Revision, h.actorID(c)))
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
	response.BusinessError(c, code, response.ErrorKeyForCode(code), message, nil)
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
	errorKey := domainErr.ErrorKey
	if errorKey == "" {
		errorKey = response.ErrorKeyForCode(code)
	}
	response.BusinessError(c, code, errorKey, domainErr.Message, nil)
}
