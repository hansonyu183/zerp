package acc

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/accapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

var (
	monthPattern    = regexp.MustCompile(`^[0-9]{4}-(0[1-9]|1[0-2])$`)
	currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)
)

type Service struct {
	pool            *pgxpool.Pool
	queries         *dbsqlc.Queries
	openingApproval *approval.Coordinator[accapproval.Payload]
	references      historicalReferenceResolver
}

type historicalReferenceResolver interface {
	ValidateHistoricalReference(context.Context, pgx.Tx, string, string, string) (bob.EffectiveReference, error)
	ResolveCurrentReference(context.Context, pgx.Tx, string, string) (bob.EffectiveReference, error)
}

func NewService(pool *pgxpool.Pool, references historicalReferenceResolver, authorizer authorization.Authorizer, bus *txevent.Bus) *Service {
	if pool == nil || references == nil || authorizer == nil || bus == nil {
		panic("acc: database, historical reference resolver, authorizer, and transactional event bus are required")
	}
	opening, err := approval.NewCoordinator("acc", "opening", authorizer, bus, accapproval.Topic("opening"))
	if err != nil {
		panic(err)
	}
	return &Service{pool: pool, queries: dbsqlc.New(pool), openingApproval: opening, references: references}
}

func mapApprovalError(err error) error {
	var approvalErr *approval.Error
	if !errors.As(err, &approvalErr) {
		return err
	}
	kind := ErrorInternal
	switch approvalErr.Kind {
	case approval.ErrorValidation, approval.ErrorNotFound:
		kind = ErrorValidation
	case approval.ErrorForbidden:
		kind = ErrorForbidden
	case approval.ErrorConflict:
		kind = ErrorConflict
	}
	return domainErrorWithKey(kind, approvalErr.ErrorKey, approvalErr.Message, approvalErr)
}

func normalizeBookFields(name, description, currency string) (string, string, string, error) {
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if name == "" || utf8.RuneCountInString(name) > 200 || utf8.RuneCountInString(description) > 1000 || !currencyPattern.MatchString(currency) {
		return "", "", "", domainError(ErrorValidation, "invalid accounting book", nil)
	}
	return name, description, currency, nil
}

func validateMonth(month string) error {
	if !monthPattern.MatchString(strings.TrimSpace(month)) {
		return domainError(ErrorValidation, "invalid start month", nil)
	}
	return nil
}

func databaseError(message string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && (pgErr.Code == "23505" || pgErr.Code == "23503" || pgErr.Code == "23514") {
		return domainError(ErrorConflict, message, err)
	}
	return domainError(ErrorInternal, "internal server error", err)
}

func (s *Service) requireAccess(ctx context.Context, q *dbsqlc.Queries, bookID, actorID string, operate bool) error {
	var allowed bool
	var err error
	if operate {
		allowed, err = q.HasAccountingBookOperateAccess(ctx, dbsqlc.HasAccountingBookOperateAccessParams{
			BookID: bookID, UserID: actorID,
		})
	} else {
		allowed, err = q.HasAccountingBookQueryAccess(ctx, dbsqlc.HasAccountingBookQueryAccessParams{
			BookID: bookID, UserID: actorID,
		})
	}
	if err != nil {
		return databaseError("check accounting book access", err)
	}
	if !allowed {
		return domainError(ErrorForbidden, "没有该会计账簿的访问范围", nil)
	}
	return nil
}

func (s *Service) requireApprovalAccess(ctx context.Context, q *dbsqlc.Queries, bookID string, actor approval.Actor, operate bool) error {
	if actor.Trusted() {
		return nil
	}
	return s.requireAccess(ctx, q, bookID, actor.ID(), operate)
}

type accessGrant struct {
	query   bool
	operate bool
}

func accessMap(queryIDs, operateIDs []string) map[string]accessGrant {
	result := map[string]accessGrant{}
	for _, id := range queryIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		access := result[id]
		access.query = true
		result[id] = access
	}
	for _, id := range operateIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		access := result[id]
		access.operate = true
		result[id] = access
	}
	return result
}

func replaceAccess(ctx context.Context, q *dbsqlc.Queries, bookID, actorID string, accesses map[string]accessGrant) error {
	if err := q.DeleteAccountingBookScopes(ctx, bookID); err != nil {
		return databaseError("replace accounting book access", err)
	}
	ids := make([]string, 0, len(accesses))
	for id := range accesses {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		access := accesses[id]
		enabled, err := q.GetAccountingAccessUserEnabled(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) || !enabled {
			return domainError(ErrorValidation, "所选账簿访问用户不存在或已停用", err)
		}
		if err != nil {
			return databaseError("validate accounting book access user", err)
		}
		if err := q.CreateAccountingBookScope(ctx, dbsqlc.CreateAccountingBookScopeParams{
			BookID: bookID, UserID: id, QueryAccess: access.query,
			OperateAccess: access.operate, ActorID: actorID,
		}); err != nil {
			return databaseError("save accounting book access", err)
		}
	}
	return nil
}

func (s *Service) CreateBook(ctx context.Context, input CreateBookInput, actorID string) (BookView, error) {
	name, description, currency, err := normalizeBookFields(input.Name, input.Description, input.BaseCurrency)
	if err != nil {
		return BookView{}, err
	}
	if err = validateMonth(input.StartMonth); err != nil {
		return BookView{}, err
	}
	templateLines, ok := subjectTemplateLines(input.SubjectTemplate)
	if !ok {
		return BookView{}, domainError(ErrorValidation, "invalid accounting subject template", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return BookView{}, databaseError("begin accounting book creation", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.LockAccountingBooksForCreate(ctx); err != nil {
		return BookView{}, databaseError("lock accounting books", err)
	}
	exists, err := qtx.AccountingBookExists(ctx)
	if err != nil {
		return BookView{}, databaseError("check accounting books", err)
	}
	counter, err := qtx.NextAccountingBookNumber(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return BookView{}, domainError(ErrorConflict, "accounting book number exhausted", nil)
	}
	if err != nil {
		return BookView{}, databaseError("allocate accounting book number", err)
	}
	code := fmt.Sprintf("ACC-%04d", counter)
	bookID := ulid.Make().String()
	err = qtx.CreateAccountingBook(ctx, dbsqlc.CreateAccountingBookParams{
		ID: bookID, Code: code, Name: name, Description: description,
		StartMonth: input.StartMonth, BaseCurrency: currency,
		ControlBook: !exists, SubjectTemplate: input.SubjectTemplate, ActorID: actorID,
	})
	if err != nil {
		return BookView{}, databaseError("accounting book cannot be created", err)
	}
	accesses := accessMap(input.QueryUserIDs, input.OperateUserIDs)
	accesses[actorID] = accessGrant{query: true, operate: true}
	if err = replaceAccess(ctx, qtx, bookID, actorID, accesses); err != nil {
		return BookView{}, err
	}
	if err = copySubjectTemplate(ctx, qtx, bookID, actorID, templateLines); err != nil {
		return BookView{}, err
	}
	result, err := loadBook(ctx, qtx, bookID)
	if err != nil {
		return BookView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return BookView{}, databaseError("commit accounting book creation", err)
	}
	return result, nil
}

func (s *Service) QueryBooks(ctx context.Context, input QueryBooksInput, actorID string) (BookPage, error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return BookPage{}, domainError(ErrorValidation, "invalid accounting book query", nil)
	}
	keyword := strings.TrimSpace(input.Keyword)
	rows, err := s.queries.ListAccountingBooks(ctx, dbsqlc.ListAccountingBooksParams{
		UserID: actorID, Keyword: keyword,
		PageOffset: int32((input.Page - 1) * input.PageSize),
		PageSize:   int32(input.PageSize),
	})
	if err != nil {
		return BookPage{}, databaseError("query accounting books", err)
	}
	page := BookPage{Items: []BookView{}, Page: input.Page, PageSize: input.PageSize}
	for _, row := range rows {
		item := BookView{QueryUserIDs: []string{}, OperateUserIDs: []string{}}
		item.ID, item.Code, item.Name = row.ID, row.Code, row.Name
		item.Description, item.StartMonth = row.Description, row.StartMonth
		item.BaseCurrency, item.SubjectTemplate = row.BaseCurrency, row.SubjectTemplate
		item.ControlBook = row.ControlBook
		item.Revision, page.Total = row.Revision, row.Total
		page.Items = append(page.Items, item)
	}
	return page, nil
}

func (s *Service) GetBook(ctx context.Context, bookID, actorID string) (BookView, error) {
	if err := s.requireAccess(ctx, s.queries, bookID, actorID, false); err != nil {
		return BookView{}, err
	}
	return loadBook(ctx, s.queries, bookID)
}

func loadBook(ctx context.Context, q *dbsqlc.Queries, bookID string) (BookView, error) {
	row, err := q.GetAccountingBook(ctx, bookID)
	if errors.Is(err, pgx.ErrNoRows) {
		return BookView{}, domainError(ErrorConflict, "accounting book not found", err)
	}
	if err != nil {
		return BookView{}, databaseError("get accounting book", err)
	}
	result := BookView{
		ID: row.ID, Code: row.Code, Name: row.Name, Description: row.Description,
		StartMonth: row.StartMonth, BaseCurrency: row.BaseCurrency,
		SubjectTemplate: row.SubjectTemplate, ControlBook: row.ControlBook, Revision: row.Revision,
		QueryUserIDs: []string{}, OperateUserIDs: []string{},
	}
	scopes, err := q.ListAccountingBookScopes(ctx, bookID)
	if err != nil {
		return BookView{}, databaseError("get accounting book access", err)
	}
	for _, scope := range scopes {
		if scope.QueryAccess {
			result.QueryUserIDs = append(result.QueryUserIDs, scope.UserID)
		}
		if scope.OperateAccess {
			result.OperateUserIDs = append(result.OperateUserIDs, scope.UserID)
		}
	}
	return result, nil
}

func (s *Service) SaveBook(ctx context.Context, input SaveBookInput, actorID string) (BookView, error) {
	name, description, currency, err := normalizeBookFields(input.Name, input.Description, input.BaseCurrency)
	if err != nil || input.Revision < 1 {
		return BookView{}, domainError(ErrorValidation, "invalid accounting book", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return BookView{}, databaseError("begin accounting book save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, qtx, input.BookID, actorID, true); err != nil {
		return BookView{}, err
	}
	currentAccess, err := qtx.GetAccountingBookUserScope(ctx, dbsqlc.GetAccountingBookUserScopeParams{
		BookID: input.BookID, UserID: actorID,
	})
	if err != nil {
		return BookView{}, databaseError("get accounting book actor access", err)
	}
	_, err = qtx.UpdateAccountingBook(ctx, dbsqlc.UpdateAccountingBookParams{
		Name: name, Description: description, BaseCurrency: currency,
		ActorID: actorID, BookID: input.BookID, Revision: input.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return BookView{}, domainError(ErrorConflict, "accounting book changed", err)
	}
	if err != nil {
		return BookView{}, databaseError("accounting book cannot be saved", err)
	}
	accesses := accessMap(input.QueryUserIDs, input.OperateUserIDs)
	actorAccess := accesses[actorID]
	actorAccess.query = actorAccess.query || currentAccess.QueryAccess
	actorAccess.operate = actorAccess.operate || currentAccess.OperateAccess
	accesses[actorID] = actorAccess
	if err = replaceAccess(ctx, qtx, input.BookID, actorID, accesses); err != nil {
		return BookView{}, err
	}
	result, err := loadBook(ctx, qtx, input.BookID)
	if err != nil {
		return BookView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return BookView{}, databaseError("commit accounting book save", err)
	}
	return result, nil
}

func (s *Service) DeleteBook(ctx context.Context, bookID string, revision int64, actorID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return databaseError("begin accounting book deletion", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, qtx, bookID, actorID, true); err != nil {
		return err
	}
	state, err := qtx.GetAccountingBookDeletionState(ctx, bookID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "accounting book not found", err)
	}
	if err != nil {
		return databaseError("get accounting book deletion state", err)
	}
	if state.ControlBook {
		return domainError(ErrorConflict, "业务控制账簿不能删除", nil)
	}
	if revision != state.Revision {
		return domainError(ErrorConflict, "accounting book changed", nil)
	}
	if err = qtx.DeleteAccountingBook(ctx, bookID); err != nil {
		return databaseError("accounting book cannot be deleted", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return databaseError("commit accounting book deletion", err)
	}
	return nil
}
