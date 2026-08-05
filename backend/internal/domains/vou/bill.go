package vou

import (
	"context"
	"math"
	"math/big"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

type fixedBillLine struct {
	BillID, PositionType, Direction, Purpose, BillType, BillNo, Medium, Currency, Drawer, Acceptor, Payee string
	FaceAmount, InterestAmount, CustomerCostAmount                                                        int64
	IssueDate, MaturityDate                                                                               time.Time
	AnnualRateBps, InterestDays                                                                           int32
	Remark                                                                                                *string
}
type fixedBillCashLine struct {
	BillLineID            string
	FundAccount           ReferenceInput
	Direction, AmountType string
	Amount                int64
	Remark                *string
}

func validateBillReceiptDraft(input DraftInput, result validatedDraft) (validatedDraft, error) {
	if input.Counterparty == nil {
		return result, domainError(ErrorValidation, "bill receipt requires customer counterparty", nil, nil)
	}
	if err := validateReference(input.Counterparty, "counterparty", true); err != nil {
		return result, err
	}
	if err := validateReference(input.Handler, "handler", true); err != nil {
		return result, err
	}
	if input.Customer != nil || input.Supplier != nil || input.Employee != nil || input.FundAccount != nil || len(input.ProductLines) > 0 || len(input.ExpenseLines) > 0 {
		return result, domainError(ErrorValidation, "fields do not match entity", nil, nil)
	}
	if input.InternalCostRateBps < 0 || input.InternalCostRateBps > 100000 {
		return result, domainError(ErrorValidation, "invalid internalCostRateBps", nil, nil)
	}
	if len(input.BillLines) < 1 || len(input.BillLines) > 20 {
		return result, domainError(ErrorValidation, "billLines must contain 1 to 20 items", nil, nil)
	}
	result.Counterparty = input.Counterparty
	result.CounterpartyType = "customer"
	result.Handler = input.Handler
	result.InternalCostRateBps = input.InternalCostRateBps
	maturityType := strings.ToUpper(strings.TrimSpace(input.MaturityType))
	interestMode := strings.ToUpper(strings.TrimSpace(input.InterestMode))
	if (maturityType != "" && maturityType != "NONE") || (interestMode != "" && interestMode != "NONE") || input.InterestParty != nil || input.WithRecourse {
		return result, domainError(ErrorValidation, "fields do not match bill receipt", nil, nil)
	}
	result.MaturityType = "NONE"
	result.InterestMode = "NONE"
	var primary, cashIn, cashOut int64
	seenBillIDs := make(map[string]struct{}, len(input.BillLines))
	seenBusinessKeys := make(map[string]struct{}, len(input.BillLines))
	for _, raw := range input.BillLines {
		remark, remarkErr := lineRemark(raw.Remark)
		if remarkErr != nil {
			return result, remarkErr
		}
		l := fixedBillLine{BillID: strings.TrimSpace(raw.BillID), PositionType: strings.ToUpper(strings.TrimSpace(raw.PositionType)), Direction: strings.ToUpper(strings.TrimSpace(raw.Direction)), Purpose: strings.ToUpper(strings.TrimSpace(raw.Purpose)), BillType: strings.ToUpper(strings.TrimSpace(raw.BillType)), BillNo: strings.TrimSpace(raw.BillNo), Medium: strings.ToUpper(strings.TrimSpace(raw.Medium)), Currency: strings.ToUpper(strings.TrimSpace(raw.Currency)), Drawer: strings.TrimSpace(raw.Drawer), Acceptor: strings.TrimSpace(raw.Acceptor), Payee: strings.TrimSpace(raw.Payee), AnnualRateBps: raw.AnnualRateBps, Remark: remark}
		if l.Purpose == "CHANGE" {
			if !validID(l.BillID) {
				return result, domainError(ErrorValidation, "change bill requires billId", nil, nil)
			}
			if _, exists := seenBillIDs[l.BillID]; exists {
				return result, domainError(ErrorValidation, "duplicate billId", nil, nil)
			}
			seenBillIDs[l.BillID] = struct{}{}
			l.PositionType, l.Direction = "ASSET", "OUT"
			result.BillLines = append(result.BillLines, l)
			continue
		}
		validBillType := l.BillType == "BANK_ACCEPTANCE" || l.BillType == "COMMERCIAL_ACCEPTANCE" || l.BillType == "CHECK" || l.BillType == "OTHER"
		invalidLength := utf8.RuneCountInString(l.BillNo) > 200 || utf8.RuneCountInString(l.Drawer) > 200 || utf8.RuneCountInString(l.Acceptor) > 200 || utf8.RuneCountInString(l.Payee) > 200
		if l.Purpose != "PRIMARY" || l.PositionType != "ASSET" || l.Direction != "IN" || !validBillType || (l.Medium != "PAPER" && l.Medium != "ELECTRONIC") || !currencyPattern.MatchString(l.Currency) || l.Currency != result.Currency || l.BillNo == "" || l.Drawer == "" || l.Acceptor == "" || l.Payee == "" || invalidLength {
			return result, domainError(ErrorValidation, "invalid bill line", nil, nil)
		}
		var err error
		l.FaceAmount, err = moneyCents(raw.FaceAmount)
		if err != nil {
			return result, err
		}
		l.IssueDate, err = time.Parse(dateLayout, strings.TrimSpace(raw.IssueDate))
		if err != nil {
			return result, domainError(ErrorValidation, "invalid bill issueDate", nil, err)
		}
		l.MaturityDate, err = time.Parse(dateLayout, strings.TrimSpace(raw.MaturityDate))
		if err != nil || l.MaturityDate.Before(l.IssueDate) || l.MaturityDate.Before(result.BusinessDate) {
			return result, domainError(ErrorValidation, "invalid bill maturityDate", nil, err)
		}
		if l.AnnualRateBps < 0 || l.AnnualRateBps > 100000 {
			return result, domainError(ErrorValidation, "invalid annualRateBps", nil, nil)
		}
		l.InterestDays = int32(l.MaturityDate.Sub(l.IssueDate).Hours() / 24)
		l.InterestAmount, err = roundedBillAmount(l.FaceAmount, l.AnnualRateBps, l.InterestDays)
		if err != nil {
			return result, err
		}
		days := int32(l.MaturityDate.Sub(result.BusinessDate).Hours() / 24)
		l.CustomerCostAmount, err = roundedBillAmount(l.FaceAmount, result.InternalCostRateBps, days)
		if err != nil {
			return result, err
		}
		if l.BillID == "" {
			l.BillID = newID()
		}
		businessKey := strings.Join([]string{l.BillType, l.BillNo, l.Acceptor, strconv.FormatInt(l.FaceAmount, 10), l.MaturityDate.Format(dateLayout)}, "\x00")
		if _, exists := seenBusinessKeys[businessKey]; exists {
			return result, domainError(ErrorValidation, "duplicate bill", nil, nil)
		}
		seenBusinessKeys[businessKey] = struct{}{}
		if _, exists := seenBillIDs[l.BillID]; exists {
			return result, domainError(ErrorValidation, "duplicate billId", nil, nil)
		}
		seenBillIDs[l.BillID] = struct{}{}
		primary, err = checkedBillMoneyAdd(primary, l.FaceAmount)
		if err != nil {
			return result, err
		}
		result.BillLines = append(result.BillLines, l)
	}
	if len(input.BillCashLines) > 20 {
		return result, domainError(ErrorValidation, "billCashLines supports at most 20 items", nil, nil)
	}
	for _, raw := range input.BillCashLines {
		remark, remarkErr := lineRemark(raw.Remark)
		if remarkErr != nil {
			return result, remarkErr
		}
		if strings.TrimSpace(raw.BillLineID) != "" {
			return result, domainError(ErrorValidation, "billLineId is not supported in bill receipt cash lines", nil, nil)
		}
		if err := validateReference(&raw.FundAccount, "fundAccount", true); err != nil {
			return result, err
		}
		a, err := moneyCents(raw.Amount)
		if err != nil {
			return result, err
		}
		d := strings.ToUpper(strings.TrimSpace(raw.Direction))
		t := strings.ToUpper(strings.TrimSpace(raw.AmountType))
		if (d != "IN" && d != "OUT") || !map[string]bool{"PRINCIPAL": true, "INTEREST": true, "FEE": true, "MARGIN": true, "OTHER": true}[t] {
			return result, domainError(ErrorValidation, "invalid bill cash line", nil, nil)
		}
		result.BillCashLines = append(result.BillCashLines, fixedBillCashLine{BillLineID: strings.TrimSpace(raw.BillLineID), FundAccount: raw.FundAccount, Direction: d, AmountType: t, Amount: a, Remark: remark})
		if d == "IN" {
			cashIn, err = checkedBillMoneyAdd(cashIn, a)
		} else {
			cashOut, err = checkedBillMoneyAdd(cashOut, a)
		}
		if err != nil {
			return result, err
		}
	}
	net, err := checkedBillMoneyAdd(primary, cashIn)
	if err == nil {
		net, err = checkedBillMoneyAdd(net, -cashOut)
	}
	if err != nil {
		return result, err
	}
	if net <= 0 {
		return result, domainError(ErrorValidation, "customer net settlement must be positive", nil, nil)
	}
	result.TotalAmount = primary
	return result, nil
}

func validateBillPaymentDraft(input DraftInput, result validatedDraft) (validatedDraft, error) {
	if input.Supplier == nil {
		return result, domainError(ErrorValidation, "bill payment requires supplier", nil, nil)
	}
	if err := validateReference(input.Supplier, "supplier", true); err != nil {
		return result, err
	}
	if input.Customer != nil || input.Counterparty != nil || input.Employee != nil || input.Handler != nil ||
		input.FundAccount != nil || len(input.ProductLines) != 0 || len(input.ExpenseLines) != 0 ||
		len(input.BillCashLines) != 0 || input.InternalCostRateBps != 0 || input.MaturityType != "" ||
		input.InterestMode != "" || input.InterestParty != nil || input.WithRecourse {
		return result, domainError(ErrorValidation, "fields do not match bill payment", nil, nil)
	}
	if len(input.BillLines) < 1 || len(input.BillLines) > 20 {
		return result, domainError(ErrorValidation, "billLines must contain 1 to 20 items", nil, nil)
	}
	result.Supplier = input.Supplier
	result.CounterpartyType = "supplier"
	result.MaturityType = "NONE"
	result.InterestMode = "NONE"
	seen := make(map[string]struct{}, len(input.BillLines))
	for _, raw := range input.BillLines {
		remark, err := lineRemark(raw.Remark)
		if err != nil {
			return result, err
		}
		line := fixedBillLine{
			BillID:  strings.TrimSpace(raw.BillID),
			Purpose: strings.ToUpper(strings.TrimSpace(raw.Purpose)),
			Remark:  remark,
		}
		if line.Purpose != "PRIMARY" || !validID(line.BillID) {
			return result, domainError(ErrorValidation, "bill payment requires available billId", nil, nil)
		}
		if _, duplicate := seen[line.BillID]; duplicate {
			return result, domainError(ErrorValidation, "duplicate billId", nil, nil)
		}
		seen[line.BillID] = struct{}{}
		line.PositionType, line.Direction = "ASSET", "OUT"
		result.BillLines = append(result.BillLines, line)
	}
	return result, nil
}

func (s *Service) billPaymentTotal(ctx context.Context, q *dbsqlc.Queries, lines []fixedBillLine) (int64, error) {
	var total int64
	for _, line := range lines {
		bill, err := q.LockLedBill(ctx, line.BillID)
		if err != nil {
			return 0, domainError(ErrorConflict, "source bill is not available", nil, err)
		}
		balance, err := q.GetLedBillAvailableBalance(ctx, dbsqlc.GetLedBillAvailableBalanceParams{
			BillID: bill.ID, PositionType: "ASSET",
		})
		if err != nil || balance != 1 || bill.PositionType != "ASSET" {
			return 0, domainError(ErrorConflict, "source bill is not available", nil, err)
		}
		total, err = checkedBillMoneyAdd(total, bill.FaceAmountCents)
		if err != nil {
			return 0, err
		}
	}
	return total, nil
}

func checkedBillMoneyAdd(left, right int64) (int64, error) {
	if (right > 0 && left > math.MaxInt64-right) || (right < 0 && left < math.MinInt64-right) {
		return 0, domainError(ErrorValidation, "bill amount is out of range", nil, nil)
	}
	return left + right, nil
}
func roundedBillAmount(face int64, bps int32, days int32) (int64, error) {
	n := new(big.Int).Mul(big.NewInt(face), big.NewInt(int64(bps)))
	n.Mul(n, big.NewInt(int64(days)))
	n.Add(n, big.NewInt(1825000))
	n.Quo(n, big.NewInt(3650000))
	if !n.IsInt64() {
		return 0, domainError(ErrorValidation, "bill amount is out of range", nil, nil)
	}
	return n.Int64(), nil
}

func (s *Service) writeBillDetail(ctx context.Context, q *dbsqlc.Queries, entity, id string, d validatedDraft, r resolvedDraft, update bool) error {
	if update {
		if err := q.DeleteVouBillCashLines(ctx, id); err != nil {
			return err
		}
		if err := q.DeleteVouBillLines(ctx, id); err != nil {
			return err
		}
		if err := q.DeleteVouBillDetails(ctx, id); err != nil {
			return err
		}
	}
	party := r.Counterparty
	partyEntity := "customer"
	if entity == EntityBillPayment {
		party, partyEntity = r.Supplier, "supplier"
	}
	params := dbsqlc.InsertVouBillDetailParams{
		DocumentID: id, Entity: entity, CounterpartyEntity: stringPtr(partyEntity),
		CounterpartyObjectID: stringPtr(party.ObjectID), CounterpartyVersionID: stringPtr(party.VersionID),
		CounterpartyCode: stringPtr(party.Code), CounterpartyName: stringPtr(party.Data.Name),
		InternalCostRateBps: d.InternalCostRateBps, MaturityType: d.MaturityType, InterestMode: d.InterestMode,
		InterestPartyEntity: optionalBillPartyEntity(r.InterestParty), InterestPartyObjectID: optionalBillPartyID(r.InterestParty, 0),
		InterestPartyVersionID: optionalBillPartyID(r.InterestParty, 1), InterestPartyCode: optionalBillPartyCode(r.InterestParty),
		InterestPartyName: optionalBillPartyName(r.InterestParty), WithRecourse: d.WithRecourse,
	}
	if r.Handler != nil {
		params.HandlerObjectID, params.HandlerVersionID = stringPtr(r.Handler.ObjectID), stringPtr(r.Handler.VersionID)
		params.HandlerCode, params.HandlerName = stringPtr(r.Handler.Code), stringPtr(r.Handler.Data.Name)
	}
	return q.InsertVouBillDetail(ctx, params)
}
func (s *Service) replaceBillLines(ctx context.Context, q *dbsqlc.Queries, entity, id string, d validatedDraft, r resolvedDraft) error {
	if err := q.DeleteVouBillCashLines(ctx, id); err != nil {
		return err
	}
	if err := q.DeleteVouBillLines(ctx, id); err != nil {
		return err
	}
	resolvedLines := make([]fixedBillLine, 0, len(d.BillLines))
	var change int64
	for _, l := range d.BillLines {
		if l.Purpose == "CHANGE" || entity == EntityBillPayment {
			b, err := q.LockLedBill(ctx, l.BillID)
			if err != nil {
				return domainError(ErrorConflict, "source bill is not available", nil, err)
			}
			balance, balanceErr := q.GetLedBillAvailableBalance(ctx, dbsqlc.GetLedBillAvailableBalanceParams{BillID: b.ID, PositionType: l.PositionType})
			if balanceErr != nil || balance != 1 {
				return domainError(ErrorConflict, "source bill is not available", nil, balanceErr)
			}
			l.PositionType, l.BillType, l.BillNo, l.Medium, l.Currency = b.PositionType, b.BillType, b.BillNo, b.Medium, b.Currency
			l.FaceAmount, l.IssueDate, l.MaturityDate, l.Drawer, l.Acceptor, l.Payee = b.FaceAmountCents, b.IssueDate.Time, b.MaturityDate.Time, b.Drawer, b.Acceptor, b.Payee
			l.AnnualRateBps, l.InterestDays, l.InterestAmount, l.CustomerCostAmount = b.AnnualRateBps, b.InterestDays, b.InterestAmountCents, b.CustomerCostAmountCents
			change, err = checkedBillMoneyAdd(change, l.FaceAmount)
			if err != nil {
				return err
			}
		}
		resolvedLines = append(resolvedLines, l)
	}
	if entity == EntityBillPayment {
		if err := s.insertResolvedBillLines(ctx, q, id, resolvedLines, d.BillCashLines, r); err != nil {
			return err
		}
		total, err := q.SumVouBillLineFaceAmounts(ctx, id)
		if err != nil {
			return err
		}
		return q.UpdateVouBillDocumentTotal(ctx, dbsqlc.UpdateVouBillDocumentTotalParams{
			ID: id, Entity: entity, TotalAmountCents: total,
		})
	}
	net := d.TotalAmount
	var err error
	for _, cash := range d.BillCashLines {
		delta := cash.Amount
		if cash.Direction == "OUT" {
			delta = -delta
		}
		net, err = checkedBillMoneyAdd(net, delta)
		if err != nil {
			return err
		}
	}
	net, err = checkedBillMoneyAdd(net, -change)
	if err != nil {
		return err
	}
	if net <= 0 {
		return domainError(ErrorValidation, "customer net settlement must be positive", nil, nil)
	}
	return s.insertResolvedBillLines(ctx, q, id, resolvedLines, d.BillCashLines, r)
}

func (s *Service) insertResolvedBillLines(ctx context.Context, q *dbsqlc.Queries, id string, lines []fixedBillLine, cashLines []fixedBillCashLine, r resolvedDraft) error {
	for i, l := range lines {
		if err := q.InsertVouBillLine(ctx, dbsqlc.InsertVouBillLineParams{ID: newID(), DocumentID: id, LineNo: int32(i + 1), BillID: l.BillID, PositionType: l.PositionType, Direction: l.Direction, Purpose: l.Purpose, BillType: l.BillType, BillNo: l.BillNo, Medium: l.Medium, Currency: l.Currency, FaceAmountCents: l.FaceAmount, IssueDate: dateValue(l.IssueDate), MaturityDate: dateValue(l.MaturityDate), Drawer: l.Drawer, Acceptor: l.Acceptor, Payee: l.Payee, AnnualRateBps: l.AnnualRateBps, InterestDays: l.InterestDays, InterestAmountCents: l.InterestAmount, CustomerCostAmountCents: l.CustomerCostAmount, Remark: l.Remark}); err != nil {
			return err
		}
	}
	for i, l := range cashLines {
		f := r.BillFunds[i]
		if err := q.InsertVouBillCashLine(ctx, dbsqlc.InsertVouBillCashLineParams{ID: newID(), DocumentID: id, LineNo: int32(i + 1), BillLineID: nil, FundAccountObjectID: f.ObjectID, FundAccountVersionID: f.VersionID, FundAccountCode: f.Code, FundAccountName: f.Data.Name, Direction: l.Direction, AmountType: l.AmountType, AmountCents: l.Amount, Remark: l.Remark}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) loadBillData(ctx context.Context, q *dbsqlc.Queries, document dbsqlc.VouDocument, data DocumentDataView) (DocumentDataView, error) {
	d, err := q.GetVouBillDetail(ctx, document.ID)
	if err != nil {
		return data, err
	}
	party := optionalReference(d.CounterpartyObjectID, d.CounterpartyVersionID, deref(d.CounterpartyEntity), d.CounterpartyCode, d.CounterpartyName)
	if document.Entity == EntityBillPayment {
		data.Supplier = party
	} else {
		data.Counterparty = party
		data.Handler = optionalReference(d.HandlerObjectID, d.HandlerVersionID, "employee", d.HandlerCode, d.HandlerName)
	}
	data.InternalCostRateBps = d.InternalCostRateBps
	data.MaturityType = d.MaturityType
	data.InterestMode = d.InterestMode
	data.InterestParty = deref(d.InterestPartyName)
	data.WithRecourse = d.WithRecourse
	lines, err := q.ListVouBillLines(ctx, document.ID)
	if err != nil {
		return data, err
	}
	for _, l := range lines {
		data.BillLines = append(data.BillLines, BillLineView{LineID: l.ID, LineNo: l.LineNo, BillID: l.BillID, PositionType: l.PositionType, Direction: l.Direction, Purpose: l.Purpose, BillType: l.BillType, BillNo: l.BillNo, Medium: l.Medium, Currency: l.Currency, FaceAmount: formatMoney(l.FaceAmountCents), IssueDate: formatDate(l.IssueDate), MaturityDate: formatDate(l.MaturityDate), Drawer: l.Drawer, Acceptor: l.Acceptor, Payee: l.Payee, AnnualRateBps: l.AnnualRateBps, InterestDays: l.InterestDays, InterestAmount: formatMoney(l.InterestAmountCents), CustomerCostAmount: formatMoney(l.CustomerCostAmountCents), Remark: deref(l.Remark)})
	}
	cash, err := q.ListVouBillCashLines(ctx, document.ID)
	if err != nil {
		return data, err
	}
	for _, l := range cash {
		data.BillCashLines = append(data.BillCashLines, BillCashLineView{LineID: l.ID, LineNo: l.LineNo, BillLineID: deref(l.BillLineID), FundAccount: *reference(l.FundAccountObjectID, l.FundAccountVersionID, "fund-account", l.FundAccountCode, l.FundAccountName, "", deref(document.Currency), ""), Direction: l.Direction, AmountType: l.AmountType, Amount: formatMoney(l.AmountCents), Remark: deref(l.Remark)})
	}
	return data, nil
}

func optionalBillPartyEntity(ref *bobdomain.EffectiveReference) *string {
	if ref == nil {
		return nil
	}
	return stringPtr(ref.Entity)
}
func optionalBillPartyID(ref *bobdomain.EffectiveReference, field int) *string {
	if ref == nil {
		return nil
	}
	if field == 0 {
		return stringPtr(ref.ObjectID)
	}
	return stringPtr(ref.VersionID)
}
func optionalBillPartyCode(ref *bobdomain.EffectiveReference) *string {
	if ref == nil {
		return nil
	}
	return stringPtr(ref.Code)
}
func optionalBillPartyName(ref *bobdomain.EffectiveReference) *string {
	if ref == nil {
		return nil
	}
	return stringPtr(ref.Data.Name)
}
