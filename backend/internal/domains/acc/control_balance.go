package acc

import (
	"context"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// PartyBalance returns a natural-sign settlement balance from the business
// control book. Debit-nature purposes return debit minus credit; credit-nature
// purposes return credit minus debit.
func (s *Service) PartyBalance(ctx context.Context, tx pgx.Tx, input voudomain.PartyBalanceQuery) (int64, error) {
	dimension := strings.TrimSpace(input.CounterpartyDimension)
	if dimension != DimensionCustomer && dimension != DimensionSupplier {
		return 0, domainError(ErrorValidation, "invalid accounting counterparty dimension", nil)
	}
	purpose := strings.TrimSpace(input.SettlementPurpose)
	creditNature := purpose == SettlementPurposePayable || purpose == SettlementPurposeAdvanceReceipt
	if purpose != SettlementPurposeReceivable && purpose != SettlementPurposePrepaid && !creditNature {
		return 0, domainError(ErrorValidation, "invalid accounting settlement purpose", nil)
	}
	if input.AsOfDate.IsZero() || strings.TrimSpace(input.CounterpartyObjectID) == "" || !currencyPattern.MatchString(input.Currency) {
		return 0, domainError(ErrorValidation, "invalid accounting party balance query", nil)
	}
	q := s.queries.WithTx(tx)
	bookID, err := q.GetReadyControlAccountingBookID(ctx)
	if err == pgx.ErrNoRows {
		return 0, domainError(ErrorConflict, "accounting control book is not ready", nil)
	} else if err != nil {
		return 0, databaseError("read accounting control book", err)
	}
	lockKey := "acc-party:" + bookID + ":" + dimension + ":" + input.CounterpartyObjectID + ":" + input.Currency + ":" + purpose
	if err = q.LockAccountingBalanceKey(ctx, lockKey); err != nil {
		return 0, databaseError("lock accounting party balance", err)
	}
	if input.SourceDocumentIDs != nil && len(input.SourceDocumentIDs) == 0 {
		return 0, nil
	}
	debitMultiplier := int64(1)
	if creditNature {
		debitMultiplier = -1
	}
	balance, err := q.GetAccountingPartyBalance(ctx, dbsqlc.GetAccountingPartyBalanceParams{
		DebitMultiplier: debitMultiplier, BookID: bookID, SettlementPurpose: purpose,
		Currency: input.Currency, Dimension: dimension, ObjectID: input.CounterpartyObjectID,
		AsOfDate: pgtype.Date{Time: input.AsOfDate, Valid: true}, SourceDocumentIds: input.SourceDocumentIDs,
	})
	if err != nil {
		return 0, databaseError("read accounting party balance", err)
	}
	return balance, nil
}
