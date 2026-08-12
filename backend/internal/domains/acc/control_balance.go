package acc

import (
	"context"
	"strings"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5"
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
	var bookID string
	if err := tx.QueryRow(ctx, `SELECT book.id
		FROM acc_books book
		JOIN acc_openings opening ON opening.book_id=book.id AND opening.state='APPROVED'
		WHERE book.control_book
		FOR SHARE OF book`).Scan(&bookID); err == pgx.ErrNoRows {
		return 0, domainError(ErrorConflict, "accounting control book is not ready", nil)
	} else if err != nil {
		return 0, databaseError("read accounting control book", err)
	}
	lockKey := "acc-party:" + bookID + ":" + dimension + ":" + input.CounterpartyObjectID + ":" + input.Currency + ":" + purpose
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, lockKey); err != nil {
		return 0, databaseError("lock accounting party balance", err)
	}
	if input.SourceDocumentIDs != nil && len(input.SourceDocumentIDs) == 0 {
		return 0, nil
	}
	debitMultiplier := int64(1)
	if creditNature {
		debitMultiplier = -1
	}
	var balance int64
	err := tx.QueryRow(ctx, `SELECT COALESCE(sum(($1::bigint) * (line.debit_minor-line.credit_minor)),0)::bigint
		FROM acc_voucher_lines line
		JOIN acc_vouchers voucher ON voucher.book_id=line.book_id AND voucher.id=line.voucher_id
		JOIN acc_subjects subject ON subject.book_id=line.book_id AND subject.id=line.subject_id
		WHERE line.book_id=$2 AND subject.settlement_purpose=$3
		  AND line.currency=$4 AND line.dimensions->>$5=$6
		  AND voucher.business_date<=$7::date
		  AND (COALESCE(cardinality($8::text[]),0)=0 OR voucher.source_id=ANY($8::text[]))`,
		debitMultiplier, bookID, purpose, input.Currency, dimension, input.CounterpartyObjectID,
		input.AsOfDate, input.SourceDocumentIDs).Scan(&balance)
	if err != nil {
		return 0, databaseError("read accounting party balance", err)
	}
	return balance, nil
}
