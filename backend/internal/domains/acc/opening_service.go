package acc

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"
)

type normalizedOpeningLine struct {
	id, subjectID, currency string
	debitMinor, creditMinor int64
	quantityMicros          *int64
	dimensions              map[string]string
	dimensionsJSON          []byte
}

func (s *Service) GetOpening(ctx context.Context, bookID, actorID string) (OpeningView, error) {
	if err := s.requireAccess(ctx, s.queries, bookID, actorID, false); err != nil {
		return OpeningView{}, err
	}
	return loadOpening(ctx, s.queries, s.pool, bookID)
}

func loadOpening(ctx context.Context, q *dbsqlc.Queries, registers interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, bookID string) (OpeningView, error) {
	row, err := q.GetAccountingOpening(ctx, bookID)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, bookErr := q.GetAccountingBook(ctx, bookID); errors.Is(bookErr, pgx.ErrNoRows) {
			return OpeningView{}, domainError(ErrorConflict, "accounting book not found", bookErr)
		} else if bookErr != nil {
			return OpeningView{}, databaseError("get accounting book", bookErr)
		}
		return OpeningView{BookID: bookID, State: OpeningStateDraft, Revision: 0, Lines: []OpeningLineView{}, Assets: []OpeningAssetView{}, Bills: []OpeningBillView{}, Containers: []OpeningContainerView{}}, nil
	}
	if err != nil {
		return OpeningView{}, databaseError("get accounting opening", err)
	}
	result := OpeningView{
		BookID: row.BookID, State: row.State, VoucherID: row.VoucherID,
		Revision: row.Revision, ApprovedBy: row.ApprovedBy, Lines: []OpeningLineView{},
	}
	if row.ApprovedAt.Valid {
		approvedAt := row.ApprovedAt.Time.Format(time.RFC3339Nano)
		result.ApprovedAt = &approvedAt
	}
	lines, err := q.ListAccountingOpeningLines(ctx, bookID)
	if err != nil {
		return OpeningView{}, databaseError("get accounting opening lines", err)
	}
	for _, line := range lines {
		dimensions := map[string]string{}
		if err := json.Unmarshal(line.Dimensions, &dimensions); err != nil {
			return OpeningView{}, domainError(ErrorInternal, "invalid stored accounting opening dimensions", err)
		}
		view := OpeningLineView{
			ID: line.ID, SubjectID: line.SubjectID, Currency: line.Currency,
			DebitAmount:  fixeddecimal.Format(line.DebitMinor, 2, false),
			CreditAmount: fixeddecimal.Format(line.CreditMinor, 2, false),
			Dimensions:   dimensions,
		}
		if line.QuantityMicros != nil {
			quantity := fixeddecimal.Format(*line.QuantityMicros, 6, true)
			view.Quantity = &quantity
		}
		result.Lines = append(result.Lines, view)
	}
	if err = loadOpeningRegisters(ctx, registers, &result); err != nil {
		return OpeningView{}, err
	}
	return result, nil
}

func (s *Service) SaveOpening(ctx context.Context, input SaveOpeningInput, actorID string) (OpeningView, error) {
	if input.Revision < 0 || len(input.Lines) > 2000 || len(input.Assets) > 1000 || len(input.Bills) > 1000 || len(input.Containers) > 1000 {
		return OpeningView{}, domainError(ErrorValidation, "invalid accounting opening", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OpeningView{}, databaseError("begin accounting opening save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, qtx, input.BookID, actorID, true); err != nil {
		return OpeningView{}, err
	}
	lines, err := normalizeOpeningLines(ctx, qtx, input.BookID, input.Lines)
	if err != nil {
		return OpeningView{}, err
	}
	state, err := qtx.GetAccountingOpeningForUpdate(ctx, input.BookID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if input.Revision != 0 {
			return OpeningView{}, domainError(ErrorConflict, "accounting opening changed", nil)
		}
		if err = qtx.CreateAccountingOpening(ctx, dbsqlc.CreateAccountingOpeningParams{BookID: input.BookID, ActorID: actorID}); err != nil {
			return OpeningView{}, databaseError("accounting opening cannot be created", err)
		}
	case err != nil:
		return OpeningView{}, databaseError("get accounting opening state", err)
	case state.State != OpeningStateDraft:
		return OpeningView{}, domainError(ErrorConflict, "approved accounting opening cannot be edited", nil)
	case state.Revision != input.Revision:
		return OpeningView{}, domainError(ErrorConflict, "accounting opening changed", nil)
	default:
		if _, err = qtx.TouchAccountingOpeningDraft(ctx, dbsqlc.TouchAccountingOpeningDraftParams{
			ActorID: actorID, BookID: input.BookID, Revision: input.Revision,
		}); errors.Is(err, pgx.ErrNoRows) {
			return OpeningView{}, domainError(ErrorConflict, "accounting opening changed", err)
		} else if err != nil {
			return OpeningView{}, databaseError("accounting opening cannot be saved", err)
		}
	}
	if err = qtx.DeleteAccountingOpeningLines(ctx, input.BookID); err != nil {
		return OpeningView{}, databaseError("replace accounting opening lines", err)
	}
	for index, line := range lines {
		if err = qtx.InsertAccountingOpeningLine(ctx, dbsqlc.InsertAccountingOpeningLineParams{
			ID: line.id, BookID: input.BookID, SubjectID: line.subjectID, Currency: line.currency,
			DebitMinor: line.debitMinor, CreditMinor: line.creditMinor,
			QuantityMicros: line.quantityMicros, Dimensions: line.dimensionsJSON, LineOrder: int32(index),
		}); err != nil {
			return OpeningView{}, databaseError("accounting opening line cannot be saved", err)
		}
	}
	if err = saveOpeningRegisters(ctx, tx, input); err != nil {
		return OpeningView{}, err
	}
	result, err := loadOpening(ctx, qtx, tx, input.BookID)
	if err != nil {
		return OpeningView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return OpeningView{}, databaseError("commit accounting opening save", err)
	}
	return result, nil
}

func normalizeOpeningLines(ctx context.Context, q *dbsqlc.Queries, bookID string, inputs []OpeningLineInput) ([]normalizedOpeningLine, error) {
	result := make([]normalizedOpeningLine, 0, len(inputs))
	identities := make(map[string]struct{}, len(inputs))
	for _, input := range inputs {
		subject, err := loadSubject(ctx, q, bookID, strings.TrimSpace(input.SubjectID))
		if err != nil {
			if IsKind(err, ErrorConflict) {
				return nil, domainError(ErrorValidation, "opening accounting subject not found", err)
			}
			return nil, err
		}
		if !subject.Enabled || !subject.Leaf {
			return nil, domainError(ErrorValidation, "期初只能使用启用的末级科目", nil)
		}
		currency := strings.ToUpper(strings.TrimSpace(input.Currency))
		if !currencyPattern.MatchString(currency) {
			return nil, domainError(ErrorValidation, "invalid accounting opening currency", nil)
		}
		debitMinor, debitErr := fixeddecimal.ParsePositive(input.DebitAmount, 2, true)
		creditMinor, creditErr := fixeddecimal.ParsePositive(input.CreditAmount, 2, true)
		if debitErr != nil || creditErr != nil || (debitMinor == 0) == (creditMinor == 0) {
			return nil, domainError(ErrorValidation, "期初行必须且只能填写借方或贷方金额", nil)
		}
		dimensions, canonicalDimensions, err := normalizeOpeningDimensions(subject.RequiredDimensions, input.Dimensions)
		if err != nil {
			return nil, err
		}
		var quantityMicros *int64
		if subject.InventoryQuantity {
			if input.Quantity == nil || creditMinor != 0 {
				return nil, domainError(ErrorValidation, "库存期初必须填写正数量和借方金额", nil)
			}
			quantity, err := fixeddecimal.ParsePositive(*input.Quantity, 6, false)
			if err != nil {
				return nil, domainError(ErrorValidation, "invalid accounting opening quantity", err)
			}
			quantityMicros = &quantity
		} else if input.Quantity != nil {
			return nil, domainError(ErrorValidation, "非库存科目不能填写期初数量", nil)
		}
		identity := subject.ID + "|" + currency + "|" + canonicalDimensions
		if _, exists := identities[identity]; exists {
			return nil, domainError(ErrorValidation, "duplicate accounting opening line", nil)
		}
		identities[identity] = struct{}{}
		dimensionsJSON, err := json.Marshal(dimensions)
		if err != nil {
			return nil, domainError(ErrorInternal, "encode accounting opening dimensions", err)
		}
		result = append(result, normalizedOpeningLine{
			id: ulid.Make().String(), subjectID: subject.ID, currency: currency,
			debitMinor: debitMinor, creditMinor: creditMinor, quantityMicros: quantityMicros,
			dimensions: dimensions, dimensionsJSON: dimensionsJSON,
		})
	}
	return result, nil
}

func normalizeOpeningDimensions(required []string, supplied map[string]string) (map[string]string, string, error) {
	if supplied == nil {
		supplied = map[string]string{}
	}
	if len(required) != len(supplied) {
		return nil, "", domainError(ErrorValidation, "期初辅助核算必须与科目要求完全一致", nil)
	}
	requiredSet := make(map[string]struct{}, len(required))
	for _, dimension := range required {
		requiredSet[dimension] = struct{}{}
	}
	keys := make([]string, 0, len(supplied))
	result := make(map[string]string, len(supplied))
	for dimension, value := range supplied {
		if _, ok := requiredSet[dimension]; !ok {
			return nil, "", domainError(ErrorValidation, "期初辅助核算必须与科目要求完全一致", nil)
		}
		value = strings.TrimSpace(value)
		if _, err := ulid.ParseStrict(value); err != nil {
			return nil, "", domainError(ErrorValidation, "invalid accounting opening dimension value", err)
		}
		result[dimension] = value
		keys = append(keys, dimension)
	}
	sort.Strings(keys)
	var identity strings.Builder
	for _, key := range keys {
		identity.WriteString(key)
		identity.WriteByte('=')
		identity.WriteString(result[key])
		identity.WriteByte(';')
	}
	return result, identity.String(), nil
}

func validateOpeningTrialBalance(lines []normalizedOpeningLine) error {
	type totals struct{ debit, credit int64 }
	byCurrency := map[string]totals{}
	for _, line := range lines {
		total := byCurrency[line.currency]
		if line.debitMinor > math.MaxInt64-total.debit || line.creditMinor > math.MaxInt64-total.credit {
			return domainError(ErrorValidation, "accounting opening amount total out of range", nil)
		}
		total.debit += line.debitMinor
		total.credit += line.creditMinor
		byCurrency[line.currency] = total
	}
	for _, total := range byCurrency {
		if total.debit != total.credit {
			return domainError(ErrorConflict, "账簿期初按原币试算不平衡", nil)
		}
	}
	return nil
}

func (s *Service) ApproveOpening(ctx context.Context, bookID string, revision int64, actorID string) (OpeningView, error) {
	if revision < 0 {
		return OpeningView{}, domainError(ErrorValidation, "invalid accounting opening", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OpeningView{}, databaseError("begin accounting opening approval", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, qtx, bookID, actorID, true); err != nil {
		return OpeningView{}, err
	}
	book, err := qtx.GetAccountingBook(ctx, bookID)
	if err != nil {
		return OpeningView{}, databaseError("get accounting book", err)
	}
	startDate, err := time.Parse("2006-01-02", book.StartMonth+"-01")
	if err != nil {
		return OpeningView{}, domainError(ErrorInternal, "invalid stored accounting book start month", err)
	}
	state, stateErr := qtx.GetAccountingOpeningForUpdate(ctx, bookID)
	var lines []normalizedOpeningLine
	if errors.Is(stateErr, pgx.ErrNoRows) {
		if revision != 0 {
			return OpeningView{}, domainError(ErrorConflict, "accounting opening changed", nil)
		}
	} else if stateErr != nil {
		return OpeningView{}, databaseError("get accounting opening state", stateErr)
	} else {
		if state.State != OpeningStateDraft || state.Revision != revision {
			return OpeningView{}, domainError(ErrorConflict, "accounting opening changed", nil)
		}
		stored, err := qtx.ListAccountingOpeningLines(ctx, bookID)
		if err != nil {
			return OpeningView{}, databaseError("get accounting opening lines", err)
		}
		inputs := make([]OpeningLineInput, 0, len(stored))
		for _, line := range stored {
			dimensions := map[string]string{}
			if err = json.Unmarshal(line.Dimensions, &dimensions); err != nil {
				return OpeningView{}, domainError(ErrorInternal, "invalid stored accounting opening dimensions", err)
			}
			input := OpeningLineInput{
				SubjectID: line.SubjectID, Currency: line.Currency,
				DebitAmount:  fixeddecimal.Format(line.DebitMinor, 2, false),
				CreditAmount: fixeddecimal.Format(line.CreditMinor, 2, false), Dimensions: dimensions,
			}
			if line.QuantityMicros != nil {
				quantity := fixeddecimal.Format(*line.QuantityMicros, 6, true)
				input.Quantity = &quantity
			}
			inputs = append(inputs, input)
		}
		lines, err = normalizeOpeningLines(ctx, qtx, bookID, inputs)
		if err != nil {
			return OpeningView{}, err
		}
		for index := range lines {
			lines[index].id = stored[index].ID
		}
	}
	if err = validateOpeningTrialBalance(lines); err != nil {
		return OpeningView{}, err
	}
	voucherID := ulid.Make().String()
	if err = qtx.CreateAccountingVoucher(ctx, dbsqlc.CreateAccountingVoucherParams{
		ID: voucherID, BookID: bookID, SourceType: "OPENING", SourceID: bookID,
		BusinessDate: pgtype.Date{Time: startDate, Valid: true}, ActorID: actorID,
	}); err != nil {
		return OpeningView{}, databaseError("create accounting opening voucher", err)
	}
	for index, line := range lines {
		lineID := ulid.Make().String()
		if err = qtx.InsertAccountingVoucherLine(ctx, dbsqlc.InsertAccountingVoucherLineParams{
			ID: lineID, BookID: bookID, VoucherID: voucherID, SubjectID: line.subjectID,
			Currency: line.currency, DebitMinor: line.debitMinor, CreditMinor: line.creditMinor,
			QuantityMicros: line.quantityMicros, Dimensions: line.dimensionsJSON,
			SourceLineID: line.id, LineOrder: int32(index),
		}); err != nil {
			return OpeningView{}, databaseError("create accounting opening voucher line", err)
		}
		if line.quantityMicros != nil {
			if err = qtx.InsertAccountingInventoryEntry(ctx, dbsqlc.InsertAccountingInventoryEntryParams{
				ID: ulid.Make().String(), BookID: bookID, VoucherID: voucherID, VoucherLineID: lineID,
				SubjectID: line.subjectID, ProductID: line.dimensions[DimensionProduct], WarehouseID: line.dimensions[DimensionWarehouse],
				BusinessDate: pgtype.Date{Time: startDate, Valid: true}, QuantityDeltaMicros: *line.quantityMicros, SourceLineID: line.id,
				CostCounterpartDimensions: []byte(`{}`),
			}); err != nil {
				return OpeningView{}, databaseError("create opening inventory entry", err)
			}
		}
		if err = qtx.RegisterAccountingSubjectUsage(ctx, dbsqlc.RegisterAccountingSubjectUsageParams{
			SubjectID: line.subjectID, UsageType: "OPENING", UsageID: bookID,
		}); err != nil {
			return OpeningView{}, databaseError("register accounting opening subject usage", err)
		}
	}
	if err = approveOpeningRegisters(ctx, tx, bookID, lines); err != nil {
		return OpeningView{}, err
	}
	if errors.Is(stateErr, pgx.ErrNoRows) {
		err = qtx.CreateApprovedZeroAccountingOpening(ctx, dbsqlc.CreateApprovedZeroAccountingOpeningParams{
			BookID: bookID, VoucherID: &voucherID, ActorID: &actorID,
		})
	} else {
		_, err = qtx.ApproveAccountingOpening(ctx, dbsqlc.ApproveAccountingOpeningParams{
			VoucherID: &voucherID, ActorID: &actorID, BookID: bookID, Revision: revision,
		})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return OpeningView{}, domainError(ErrorConflict, "accounting opening changed", err)
	}
	if err != nil {
		return OpeningView{}, databaseError("accounting opening cannot be approved", err)
	}
	result, err := loadOpening(ctx, qtx, tx, bookID)
	if err != nil {
		return OpeningView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return OpeningView{}, databaseError("commit accounting opening approval", err)
	}
	return result, nil
}

func (s *Service) UnapproveOpening(ctx context.Context, bookID string, revision int64, actorID string) (OpeningView, error) {
	if revision < 1 {
		return OpeningView{}, domainError(ErrorValidation, "invalid accounting opening", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OpeningView{}, databaseError("begin accounting opening unapproval", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, qtx, bookID, actorID, true); err != nil {
		return OpeningView{}, err
	}
	state, err := qtx.GetAccountingOpeningForUpdate(ctx, bookID)
	if errors.Is(err, pgx.ErrNoRows) {
		return OpeningView{}, domainError(ErrorConflict, "accounting opening changed", err)
	}
	if err != nil {
		return OpeningView{}, databaseError("get accounting opening state", err)
	}
	if state.State != OpeningStateApproved || state.Revision != revision || state.VoucherID == nil {
		return OpeningView{}, domainError(ErrorConflict, "accounting opening changed", nil)
	}
	hasLaterFacts, err := qtx.AccountingBookHasLaterFacts(ctx, bookID)
	if err != nil {
		return OpeningView{}, databaseError("check accounting facts after opening", err)
	}
	if hasLaterFacts {
		return OpeningView{}, domainError(ErrorConflict, "账簿已有后续会计事实，不能反批准期初", nil)
	}
	if err = unapproveOpeningRegisters(ctx, tx, bookID); err != nil {
		return OpeningView{}, err
	}
	if err = qtx.DeleteAccountingSubjectUsages(ctx, dbsqlc.DeleteAccountingSubjectUsagesParams{
		UsageType: "OPENING", UsageID: bookID,
	}); err != nil {
		return OpeningView{}, databaseError("release accounting opening subject usage", err)
	}
	if _, err = qtx.UnapproveAccountingOpening(ctx, dbsqlc.UnapproveAccountingOpeningParams{
		ActorID: actorID, BookID: bookID, Revision: revision,
	}); errors.Is(err, pgx.ErrNoRows) {
		return OpeningView{}, domainError(ErrorConflict, "accounting opening changed", err)
	} else if err != nil {
		return OpeningView{}, databaseError("accounting opening cannot be unapproved", err)
	}
	if err = qtx.DeleteAccountingVoucher(ctx, dbsqlc.DeleteAccountingVoucherParams{
		BookID: bookID, VoucherID: *state.VoucherID,
	}); err != nil {
		return OpeningView{}, databaseError("delete accounting opening voucher", err)
	}
	result, err := loadOpening(ctx, qtx, tx, bookID)
	if err != nil {
		return OpeningView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return OpeningView{}, databaseError("commit accounting opening unapproval", err)
	}
	return result, nil
}

func (s *Service) IsBookReadyForPosting(ctx context.Context, bookID string) (bool, error) {
	ready, err := s.queries.IsAccountingBookReadyForPosting(ctx, bookID)
	if err != nil {
		return false, databaseError("check accounting book opening", err)
	}
	return ready, nil
}
