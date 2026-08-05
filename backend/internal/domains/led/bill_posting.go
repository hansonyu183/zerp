package led

import (
	"context"
	"math"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) postBillReceipt(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, p postingContext) error {
	doc := p.Document
	include, err := requireEffectiveDate(p, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouBillDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill receipt detail", err)
	}
	lines, err := q.ListVouBillLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill receipt lines", err)
	}
	var primary, change, cashIn, cashOut int64
	for _, l := range lines {
		if l.Purpose == "CHANGE" {
			b, lockErr := q.LockLedBill(ctx, l.BillID)
			if lockErr != nil {
				return s.writeError("lock bill for receipt", lockErr)
			}
			balance, balanceErr := q.GetLedBillAvailableBalance(ctx, dbsqlc.GetLedBillAvailableBalanceParams{BillID: b.ID, PositionType: l.PositionType})
			if balanceErr != nil || balance != 1 {
				return domainError(ErrorConflict, "source bill is not available", nil, balanceErr)
			}
		}
		if l.Purpose == "PRIMARY" {
			rows, ensureErr := q.EnsureLedBill(ctx, dbsqlc.EnsureLedBillParams{ID: l.BillID, PositionType: l.PositionType, BillType: l.BillType, BillNo: l.BillNo, Medium: l.Medium, Currency: l.Currency, FaceAmountCents: l.FaceAmountCents, IssueDate: l.IssueDate, MaturityDate: l.MaturityDate, Drawer: l.Drawer, Acceptor: l.Acceptor, Payee: l.Payee, AnnualRateBps: l.AnnualRateBps, InterestDays: l.InterestDays, InterestAmountCents: l.InterestAmountCents, CustomerCostAmountCents: l.CustomerCostAmountCents, OriginPartyEntity: detail.CounterpartyEntity, OriginPartyObjectID: detail.CounterpartyObjectID, OriginPartyVersionID: detail.CounterpartyVersionID, OriginPartyCode: detail.CounterpartyCode, OriginPartyName: detail.CounterpartyName, SourceDocumentID: doc.ID, SourceLineID: l.ID})
			if ensureErr != nil {
				return s.writeError("create bill ledger record", ensureErr)
			}
			if rows != 1 {
				return domainError(ErrorConflict, "bill ledger identity conflicts with different fixed facts", nil, nil)
			}
		}
		if err = q.InsertLedBillEntry(ctx, dbsqlc.InsertLedBillEntryParams{ID: newID(), GenerationID: p.GenerationID, BillID: l.BillID, SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceLineID: l.ID, PositionType: l.PositionType, Direction: l.Direction, Purpose: l.Purpose, EffectiveDate: doc.BusinessDate, OccurredAt: p.OccurredAt}); err != nil {
			return s.writeError("post bill ledger entry", err)
		}
		if l.Purpose == "PRIMARY" {
			primary, err = checkedBillAdd(primary, l.FaceAmountCents)
		} else {
			change, err = checkedBillAdd(change, l.FaceAmountCents)
		}
		if err != nil {
			return err
		}
	}
	cash, err := q.ListVouBillCashLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill receipt cash lines", err)
	}
	for _, l := range cash {
		delta := l.AmountCents
		if l.Direction == "OUT" {
			delta = -delta
			cashOut, err = checkedBillAdd(cashOut, l.AmountCents)
		} else {
			cashIn, err = checkedBillAdd(cashIn, l.AmountCents)
		}
		if err != nil {
			return err
		}
		fund := fundParams(p, doc, l.FundAccountObjectID, l.FundAccountVersionID, l.FundAccountCode, l.FundAccountName, delta)
		fund.SourceLineID = l.ID
		if err = q.InsertLedFundEntry(ctx, fund); err != nil {
			return s.writeError("post bill receipt fund", err)
		}
	}
	net, err := checkedBillAdd(primary, cashIn)
	if err == nil {
		net, err = checkedBillAdd(net, -change)
	}
	if err == nil {
		net, err = checkedBillAdd(net, -cashOut)
	}
	if err != nil {
		return err
	}
	if net <= 0 {
		return domainError(ErrorConflict, "bill receipt net settlement is invalid", nil, nil)
	}
	if err = q.InsertLedPartyEntry(ctx, partyParams(p, doc, "", doc.BusinessDate, deref(detail.CounterpartyObjectID), deref(detail.CounterpartyVersionID), deref(detail.CounterpartyCode), deref(detail.CounterpartyName), "customer", -net)); err != nil {
		return s.writeError("post bill receipt party", err)
	}
	return nil
}

func (s *Service) postBillPayment(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, p postingContext) error {
	doc := p.Document
	include, err := requireEffectiveDate(p, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouBillDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill payment detail", err)
	}
	lines, err := q.ListVouBillLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill payment lines", err)
	}
	var total int64
	for _, line := range lines {
		if line.Purpose != "PRIMARY" || line.PositionType != "ASSET" || line.Direction != "OUT" {
			return domainError(ErrorConflict, "bill payment line is invalid", nil, nil)
		}
		bill, lockErr := q.LockLedBill(ctx, line.BillID)
		if lockErr != nil {
			return s.writeError("lock bill for payment", lockErr)
		}
		balance, balanceErr := q.GetLedBillAvailableBalance(ctx, dbsqlc.GetLedBillAvailableBalanceParams{
			BillID: bill.ID, PositionType: "ASSET",
		})
		if balanceErr != nil || balance != 1 {
			return domainError(ErrorConflict, "source bill is not available", nil, balanceErr)
		}
		if err = q.InsertLedBillEntry(ctx, dbsqlc.InsertLedBillEntryParams{
			ID: newID(), GenerationID: p.GenerationID, BillID: bill.ID,
			SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceLineID: line.ID,
			PositionType: "ASSET", Direction: "OUT", Purpose: "PRIMARY",
			EffectiveDate: doc.BusinessDate, OccurredAt: p.OccurredAt,
		}); err != nil {
			return s.writeError("post bill payment ledger entry", err)
		}
		total, err = checkedBillAdd(total, line.FaceAmountCents)
		if err != nil {
			return err
		}
	}
	if total <= 0 {
		return domainError(ErrorConflict, "bill payment total is invalid", nil, nil)
	}
	if err = q.InsertLedPartyEntry(ctx, partyParams(
		p, doc, "", doc.BusinessDate,
		deref(detail.CounterpartyObjectID), deref(detail.CounterpartyVersionID),
		deref(detail.CounterpartyCode), deref(detail.CounterpartyName), "supplier", total,
	)); err != nil {
		return s.writeError("post bill payment supplier", err)
	}
	return nil
}

func (s *Service) postBillIssue(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, p postingContext) error {
	doc := p.Document
	include, err := requireEffectiveDate(p, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouBillDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill issue detail", err)
	}
	lines, err := q.ListVouBillLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill issue lines", err)
	}
	var faceTotal, interestTotal int64
	for _, line := range lines {
		if line.Purpose != "PRIMARY" || line.PositionType != "LIABILITY" || line.Direction != "IN" {
			return domainError(ErrorConflict, "bill issue line is invalid", nil, nil)
		}
		rows, ensureErr := q.EnsureLedBill(ctx, dbsqlc.EnsureLedBillParams{
			ID: line.BillID, PositionType: line.PositionType, BillType: line.BillType, BillNo: line.BillNo,
			Medium: line.Medium, Currency: line.Currency, FaceAmountCents: line.FaceAmountCents,
			IssueDate: line.IssueDate, MaturityDate: line.MaturityDate, Drawer: line.Drawer, Acceptor: line.Acceptor,
			Payee: line.Payee, AnnualRateBps: line.AnnualRateBps, InterestDays: line.InterestDays,
			InterestAmountCents: line.InterestAmountCents, CustomerCostAmountCents: line.CustomerCostAmountCents,
			OriginPartyEntity: detail.CounterpartyEntity, OriginPartyObjectID: detail.CounterpartyObjectID,
			OriginPartyVersionID: detail.CounterpartyVersionID, OriginPartyCode: detail.CounterpartyCode,
			OriginPartyName: detail.CounterpartyName, SourceDocumentID: doc.ID, SourceLineID: line.ID,
		})
		if ensureErr != nil {
			return s.writeError("create issued bill ledger record", ensureErr)
		}
		if rows != 1 {
			return domainError(ErrorConflict, "bill ledger identity conflicts with different fixed facts", nil, nil)
		}
		if err = q.InsertLedBillEntry(ctx, dbsqlc.InsertLedBillEntryParams{
			ID: newID(), GenerationID: p.GenerationID, BillID: line.BillID, SourceEntity: doc.Entity,
			SourceDocumentID: doc.ID, SourceLineID: line.ID, PositionType: "LIABILITY", Direction: "IN", Purpose: "PRIMARY",
			EffectiveDate: doc.BusinessDate, OccurredAt: p.OccurredAt,
		}); err != nil {
			return s.writeError("post bill issue ledger entry", err)
		}
		faceTotal, err = checkedBillAdd(faceTotal, line.FaceAmountCents)
		if err == nil {
			interestTotal, err = checkedBillAdd(interestTotal, line.InterestAmountCents)
		}
		if err != nil {
			return err
		}
	}
	if faceTotal <= 0 {
		return domainError(ErrorConflict, "bill issue total is invalid", nil, nil)
	}
	cash, err := q.ListVouBillCashLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill issue cash lines", err)
	}
	for _, line := range cash {
		delta := line.AmountCents
		if line.Direction == "OUT" {
			delta = -delta
		}
		fund := fundParams(p, doc, line.FundAccountObjectID, line.FundAccountVersionID, line.FundAccountCode, line.FundAccountName, delta)
		fund.SourceLineID = line.ID
		if err = q.InsertLedFundEntry(ctx, fund); err != nil {
			return s.writeError("post bill issue fund", err)
		}
	}
	if err = q.InsertLedPartyEntry(ctx, partyParams(
		p, doc, "", doc.BusinessDate, deref(detail.CounterpartyObjectID), deref(detail.CounterpartyVersionID),
		deref(detail.CounterpartyCode), deref(detail.CounterpartyName), "supplier", faceTotal,
	)); err != nil {
		return s.writeError("post bill issue supplier", err)
	}
	if detail.InterestMode == "THIRD_PARTY_PAYABLE" && interestTotal > 0 {
		if err = q.InsertLedPartyEntry(ctx, partyParams(
			p, doc, "interest", doc.BusinessDate, deref(detail.InterestPartyObjectID), deref(detail.InterestPartyVersionID),
			deref(detail.InterestPartyCode), deref(detail.InterestPartyName), "other-party", -interestTotal,
		)); err != nil {
			return s.writeError("post bill issue interest payable", err)
		}
	}
	return nil
}

func (s *Service) postBillDiscount(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, p postingContext) error {
	doc := p.Document
	include, err := requireEffectiveDate(p, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouBillDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill discount detail", err)
	}
	lines, err := q.ListVouBillLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill discount lines", err)
	}
	var faceTotal, interestTotal int64
	for _, line := range lines {
		if line.Purpose != "PRIMARY" || line.PositionType != "ASSET" || line.Direction != "OUT" {
			return domainError(ErrorConflict, "bill discount line is invalid", nil, nil)
		}
		bill, lockErr := q.LockLedBill(ctx, line.BillID)
		if lockErr != nil {
			return s.writeError("lock bill for discount", lockErr)
		}
		balance, balanceErr := q.GetLedBillAvailableBalance(ctx, dbsqlc.GetLedBillAvailableBalanceParams{BillID: bill.ID, PositionType: "ASSET"})
		if balanceErr != nil || balance != 1 {
			return domainError(ErrorConflict, "source bill is not available", nil, balanceErr)
		}
		if !bill.MaturityDate.Time.After(doc.BusinessDate.Time) {
			return domainError(ErrorConflict, "source bill is matured", nil, nil)
		}
		if err = q.InsertLedBillEntry(ctx, dbsqlc.InsertLedBillEntryParams{ID: newID(), GenerationID: p.GenerationID, BillID: bill.ID, SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceLineID: line.ID, PositionType: "ASSET", Direction: "OUT", Purpose: "PRIMARY", EffectiveDate: doc.BusinessDate, OccurredAt: p.OccurredAt}); err != nil {
			return s.writeError("post bill discount ledger entry", err)
		}
		faceTotal, err = checkedBillAdd(faceTotal, line.FaceAmountCents)
		if err == nil {
			interestTotal, err = checkedBillAdd(interestTotal, line.InterestAmountCents)
		}
		if err != nil {
			return err
		}
	}
	if faceTotal <= 0 {
		return domainError(ErrorConflict, "bill discount total is invalid", nil, nil)
	}
	cash, err := q.ListVouBillCashLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill discount cash lines", err)
	}
	for _, line := range cash {
		delta := line.AmountCents
		if line.Direction == "OUT" {
			delta = -delta
		}
		fund := fundParams(p, doc, line.FundAccountObjectID, line.FundAccountVersionID, line.FundAccountCode, line.FundAccountName, delta)
		fund.SourceLineID = line.ID
		if err = q.InsertLedFundEntry(ctx, fund); err != nil {
			return s.writeError("post bill discount fund", err)
		}
	}
	if detail.InterestMode == "THIRD_PARTY_PAYABLE" && interestTotal > 0 {
		if err = q.InsertLedPartyEntry(ctx, partyParams(p, doc, "interest", doc.BusinessDate, deref(detail.InterestPartyObjectID), deref(detail.InterestPartyVersionID), deref(detail.InterestPartyCode), deref(detail.InterestPartyName), "other-party", -interestTotal)); err != nil {
			return s.writeError("post bill discount interest payable", err)
		}
	}
	return nil
}

func (s *Service) postBillMaturity(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, p postingContext) error {
	doc := p.Document
	include, err := requireEffectiveDate(p, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouBillDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill maturity detail", err)
	}
	position, cashDirection := "ASSET", "IN"
	switch detail.MaturityType {
	case "RECEIPT":
	case "PAYMENT":
		position, cashDirection = "LIABILITY", "OUT"
	default:
		return domainError(ErrorConflict, "bill maturity type is invalid", nil, nil)
	}
	lines, err := q.ListVouBillLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill maturity lines", err)
	}
	if len(lines) == 0 {
		return domainError(ErrorConflict, "bill maturity requires bills", nil, nil)
	}
	for _, line := range lines {
		if line.Purpose != "PRIMARY" || line.PositionType != position || line.Direction != "OUT" {
			return domainError(ErrorConflict, "bill maturity line is invalid", nil, nil)
		}
		bill, lockErr := q.LockLedBill(ctx, line.BillID)
		if lockErr != nil {
			return s.writeError("lock bill for maturity", lockErr)
		}
		balance, balanceErr := q.GetLedBillAvailableBalance(ctx, dbsqlc.GetLedBillAvailableBalanceParams{BillID: bill.ID, PositionType: position})
		if balanceErr != nil || balance != 1 || bill.PositionType != position {
			return domainError(ErrorConflict, "source bill is not available", nil, balanceErr)
		}
		if bill.MaturityDate.Time.After(doc.BusinessDate.Time) {
			return domainError(ErrorConflict, "source bill is not matured", nil, nil)
		}
		if err = q.InsertLedBillEntry(ctx, dbsqlc.InsertLedBillEntryParams{
			ID: newID(), GenerationID: p.GenerationID, BillID: bill.ID,
			SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceLineID: line.ID,
			PositionType: position, Direction: "OUT", Purpose: "PRIMARY",
			EffectiveDate: doc.BusinessDate, OccurredAt: p.OccurredAt,
		}); err != nil {
			return s.writeError("post bill maturity ledger entry", err)
		}
	}
	cash, err := q.ListVouBillCashLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read bill maturity cash lines", err)
	}
	if len(cash) == 0 {
		return domainError(ErrorConflict, "bill maturity requires cash", nil, nil)
	}
	for _, line := range cash {
		if line.Direction != cashDirection {
			return domainError(ErrorConflict, "bill maturity cash direction is invalid", nil, nil)
		}
		delta := line.AmountCents
		if cashDirection == "OUT" {
			delta = -delta
		}
		fund := fundParams(p, doc, line.FundAccountObjectID, line.FundAccountVersionID, line.FundAccountCode, line.FundAccountName, delta)
		fund.SourceLineID = line.ID
		if err = q.InsertLedFundEntry(ctx, fund); err != nil {
			return s.writeError("post bill maturity fund", err)
		}
	}
	return nil
}

func checkedBillAdd(left, right int64) (int64, error) {
	if (right > 0 && left > math.MaxInt64-right) || (right < 0 && left < math.MinInt64-right) {
		return 0, domainError(ErrorConflict, "bill amount is out of range", nil, nil)
	}
	return left + right, nil
}
