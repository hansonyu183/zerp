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

func (s *Service) AvailableBills(ctx context.Context, input AvailableBillQueryInput) (Page[AvailableBillItem], error) {
	input.BillNo = strings.TrimSpace(input.BillNo)
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 ||
		(input.PositionType != "ASSET" && input.PositionType != "LIABILITY") {
		return Page[AvailableBillItem]{}, domainError(ErrorValidation, "invalid available bill query", nil, nil)
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*)
		FROM acc_bills bill
		WHERE bill.state='AVAILABLE' AND bill.position_type=$1
		  AND ($2='' OR bill.bill_no ILIKE '%'||$2||'%')`, input.PositionType, input.BillNo).Scan(&total); err != nil {
		return Page[AvailableBillItem]{}, s.internal("count available accounting bills", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT bill.id,bill.position_type,bill.bill_type,bill.bill_no,bill.medium,bill.currency,
		bill.face_amount_minor,bill.issue_date,bill.maturity_date,bill.drawer,bill.acceptor,bill.payee,
		bill.annual_rate_bps,bill.interest_days,bill.interest_amount_minor,bill.customer_cost_amount_minor,
		bill.origin_party_object_id,bill.origin_party_version_id,bill.origin_party_entity,
		bill.origin_party_code,bill.origin_party_name,
		COALESCE(document.entity,'acc-opening'),COALESCE(document.document_no,'期初')
		FROM acc_bills bill
		LEFT JOIN vou_documents document ON document.id=bill.source_document_id
		WHERE bill.state='AVAILABLE' AND bill.position_type=$1
		  AND ($2='' OR bill.bill_no ILIKE '%'||$2||'%')
		ORDER BY bill.maturity_date,bill.bill_no,bill.id
		LIMIT $3 OFFSET $4`, input.PositionType, input.BillNo, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return Page[AvailableBillItem]{}, s.internal("list available accounting bills", err)
	}
	defer rows.Close()
	items := make([]AvailableBillItem, 0)
	for rows.Next() {
		var item AvailableBillItem
		var face, interest, customerCost int64
		var issue, maturity time.Time
		var partyObjectID, partyVersionID, partyEntity, partyCode, partyName *string
		if err = rows.Scan(&item.BillID, &item.PositionType, &item.BillType, &item.BillNo, &item.Medium,
			&item.Currency, &face, &issue, &maturity, &item.Drawer, &item.Acceptor, &item.Payee,
			&item.AnnualRateBps, &item.InterestDays, &interest, &customerCost, &partyObjectID,
			&partyVersionID, &partyEntity, &partyCode, &partyName, &item.SourceEntity, &item.SourceDocumentNo); err != nil {
			return Page[AvailableBillItem]{}, s.internal("scan available accounting bill", err)
		}
		if partyObjectID == nil || partyVersionID == nil || partyEntity == nil || partyCode == nil || partyName == nil {
			return Page[AvailableBillItem]{}, domainError(ErrorConflict, "source bill has no originating party", map[string]any{"billId": item.BillID}, nil)
		}
		item.FaceAmount, item.InterestAmount, item.CustomerCostAmount = formatMoney(face), formatMoney(interest), formatMoney(customerCost)
		item.IssueDate, item.MaturityDate = issue.Format(dateLayout), maturity.Format(dateLayout)
		item.OriginatingParty = *reference(*partyObjectID, *partyVersionID, *partyEntity, *partyCode, *partyName, "", "", "")
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page[AvailableBillItem]{}, s.internal("iterate available accounting bills", err)
	}
	return Page[AvailableBillItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
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

func validateBillIssueDraft(input DraftInput, result validatedDraft) (validatedDraft, error) {
	if input.Supplier == nil {
		return result, domainError(ErrorValidation, "bill issue requires supplier", nil, nil)
	}
	if err := validateReference(input.Supplier, "supplier", true); err != nil {
		return result, err
	}
	if input.Customer != nil || input.Counterparty != nil || input.Employee != nil || input.Handler != nil ||
		input.FundAccount != nil || len(input.ProductLines) != 0 || len(input.ExpenseLines) != 0 ||
		input.InternalCostRateBps != 0 || input.MaturityType != "" || input.WithRecourse {
		return result, domainError(ErrorValidation, "fields do not match bill issue", nil, nil)
	}
	mode := strings.ToUpper(strings.TrimSpace(input.InterestMode))
	if mode != "BANK_DEDUCTED" && mode != "THIRD_PARTY_PAYABLE" {
		return result, domainError(ErrorValidation, "invalid bill issue interestMode", nil, nil)
	}
	if mode == "THIRD_PARTY_PAYABLE" {
		if err := validateReference(input.InterestParty, "interestParty", true); err != nil {
			return result, err
		}
	} else if input.InterestParty != nil {
		return result, domainError(ErrorValidation, "interestParty does not match interestMode", nil, nil)
	}
	if len(input.BillLines) < 1 || len(input.BillLines) > 20 || len(input.BillCashLines) > 20 {
		return result, domainError(ErrorValidation, "bill issue lines must contain 1 to 20 items", nil, nil)
	}
	result.Supplier, result.CounterpartyType = input.Supplier, "supplier"
	result.MaturityType, result.InterestMode = "NONE", mode
	if mode == "THIRD_PARTY_PAYABLE" {
		result.InterestParty = input.InterestParty
	}
	seenKeys := make(map[string]struct{}, len(input.BillLines))
	seenIDs := make(map[string]struct{}, len(input.BillLines))
	for _, raw := range input.BillLines {
		remark, err := lineRemark(raw.Remark)
		if err != nil {
			return result, err
		}
		line := fixedBillLine{
			BillID: strings.TrimSpace(raw.BillID), PositionType: strings.ToUpper(strings.TrimSpace(raw.PositionType)),
			Direction: strings.ToUpper(strings.TrimSpace(raw.Direction)), Purpose: strings.ToUpper(strings.TrimSpace(raw.Purpose)),
			BillType: strings.ToUpper(strings.TrimSpace(raw.BillType)), BillNo: strings.TrimSpace(raw.BillNo),
			Medium: strings.ToUpper(strings.TrimSpace(raw.Medium)), Currency: strings.ToUpper(strings.TrimSpace(raw.Currency)),
			Drawer: strings.TrimSpace(raw.Drawer), Acceptor: strings.TrimSpace(raw.Acceptor), Payee: strings.TrimSpace(raw.Payee),
			AnnualRateBps: raw.AnnualRateBps, Remark: remark,
		}
		validType := line.BillType == "BANK_ACCEPTANCE" || line.BillType == "COMMERCIAL_ACCEPTANCE" || line.BillType == "CHECK" || line.BillType == "OTHER"
		tooLong := utf8.RuneCountInString(line.BillNo) > 200 || utf8.RuneCountInString(line.Drawer) > 200 || utf8.RuneCountInString(line.Acceptor) > 200 || utf8.RuneCountInString(line.Payee) > 200
		if line.Purpose != "PRIMARY" || line.PositionType != "LIABILITY" || line.Direction != "IN" || !validType ||
			(line.Medium != "PAPER" && line.Medium != "ELECTRONIC") || !currencyPattern.MatchString(line.Currency) ||
			line.Currency != result.Currency || line.BillNo == "" || line.Drawer == "" || line.Acceptor == "" || line.Payee == "" || tooLong {
			return result, domainError(ErrorValidation, "invalid bill issue line", nil, nil)
		}
		line.FaceAmount, err = moneyCents(raw.FaceAmount)
		if err != nil {
			return result, err
		}
		line.IssueDate, err = time.Parse(dateLayout, strings.TrimSpace(raw.IssueDate))
		if err != nil {
			return result, domainError(ErrorValidation, "invalid bill issue issueDate", nil, err)
		}
		line.MaturityDate, err = time.Parse(dateLayout, strings.TrimSpace(raw.MaturityDate))
		if err != nil || line.MaturityDate.Before(line.IssueDate) || line.MaturityDate.Before(result.BusinessDate) {
			return result, domainError(ErrorValidation, "invalid bill issue maturityDate", nil, err)
		}
		if line.AnnualRateBps < 0 || line.AnnualRateBps > 100000 {
			return result, domainError(ErrorValidation, "invalid annualRateBps", nil, nil)
		}
		line.InterestDays = int32(line.MaturityDate.Sub(line.IssueDate).Hours() / 24)
		line.InterestAmount, err = roundedBillAmount(line.FaceAmount, line.AnnualRateBps, line.InterestDays)
		if err != nil {
			return result, err
		}
		if line.BillID == "" {
			line.BillID = newID()
		}
		key := strings.Join([]string{line.BillType, line.BillNo, line.Acceptor, strconv.FormatInt(line.FaceAmount, 10), line.MaturityDate.Format(dateLayout)}, "\x00")
		if _, duplicate := seenKeys[key]; duplicate {
			return result, domainError(ErrorValidation, "duplicate bill", nil, nil)
		}
		if _, duplicate := seenIDs[line.BillID]; duplicate {
			return result, domainError(ErrorValidation, "duplicate billId", nil, nil)
		}
		seenKeys[key], seenIDs[line.BillID] = struct{}{}, struct{}{}
		result.TotalAmount, err = checkedBillMoneyAdd(result.TotalAmount, line.FaceAmount)
		if err != nil {
			return result, err
		}
		result.BillLines = append(result.BillLines, line)
	}
	for _, raw := range input.BillCashLines {
		remark, err := lineRemark(raw.Remark)
		if err != nil {
			return result, err
		}
		if strings.TrimSpace(raw.BillLineID) != "" {
			return result, domainError(ErrorValidation, "billLineId is not supported in bill issue cash lines", nil, nil)
		}
		if err = validateReference(&raw.FundAccount, "fundAccount", true); err != nil {
			return result, err
		}
		amount, err := moneyCents(raw.Amount)
		if err != nil {
			return result, err
		}
		direction, amountType := strings.ToUpper(strings.TrimSpace(raw.Direction)), strings.ToUpper(strings.TrimSpace(raw.AmountType))
		if (direction != "IN" && direction != "OUT") || !map[string]bool{"PRINCIPAL": true, "INTEREST": true, "FEE": true, "MARGIN": true, "OTHER": true}[amountType] {
			return result, domainError(ErrorValidation, "invalid bill issue cash line", nil, nil)
		}
		result.BillCashLines = append(result.BillCashLines, fixedBillCashLine{FundAccount: raw.FundAccount, Direction: direction, AmountType: amountType, Amount: amount, Remark: remark})
	}
	return result, nil
}

func validateBillDiscountDraft(input DraftInput, result validatedDraft) (validatedDraft, error) {
	if input.Counterparty == nil || strings.ToLower(strings.TrimSpace(input.CounterpartyType)) != "other-party" {
		return result, domainError(ErrorValidation, "bill discount requires other-party counterparty", nil, nil)
	}
	if err := validateReference(input.Counterparty, "counterparty", true); err != nil {
		return result, err
	}
	if input.Customer != nil || input.Supplier != nil || input.Employee != nil || input.Handler != nil || input.FundAccount != nil ||
		len(input.ProductLines) != 0 || len(input.ExpenseLines) != 0 || input.InternalCostRateBps != 0 || input.MaturityType != "" {
		return result, domainError(ErrorValidation, "fields do not match bill discount", nil, nil)
	}
	mode := strings.ToUpper(strings.TrimSpace(input.InterestMode))
	if mode != "BANK_DEDUCTED" && mode != "THIRD_PARTY_PAYABLE" {
		return result, domainError(ErrorValidation, "invalid bill discount interestMode", nil, nil)
	}
	if mode == "THIRD_PARTY_PAYABLE" {
		if err := validateReference(input.InterestParty, "interestParty", true); err != nil {
			return result, err
		}
	} else if input.InterestParty != nil {
		return result, domainError(ErrorValidation, "interestParty does not match interestMode", nil, nil)
	}
	if len(input.BillLines) < 1 || len(input.BillLines) > 20 || len(input.BillCashLines) > 20 {
		return result, domainError(ErrorValidation, "bill discount lines must contain 1 to 20 items", nil, nil)
	}
	result.Counterparty, result.CounterpartyType = input.Counterparty, "other-party"
	result.MaturityType, result.InterestMode, result.WithRecourse = "NONE", mode, input.WithRecourse
	if mode == "THIRD_PARTY_PAYABLE" {
		result.InterestParty = input.InterestParty
	}
	seen := make(map[string]struct{}, len(input.BillLines))
	for _, raw := range input.BillLines {
		remark, err := lineRemark(raw.Remark)
		if err != nil {
			return result, err
		}
		line := fixedBillLine{BillID: strings.TrimSpace(raw.BillID), Purpose: strings.ToUpper(strings.TrimSpace(raw.Purpose)), AnnualRateBps: raw.AnnualRateBps, Remark: remark}
		if line.Purpose != "PRIMARY" || !validID(line.BillID) || line.AnnualRateBps < 0 || line.AnnualRateBps > 100000 {
			return result, domainError(ErrorValidation, "bill discount requires available billId and rate", nil, nil)
		}
		if _, duplicate := seen[line.BillID]; duplicate {
			return result, domainError(ErrorValidation, "duplicate billId", nil, nil)
		}
		seen[line.BillID] = struct{}{}
		line.PositionType, line.Direction = "ASSET", "OUT"
		result.BillLines = append(result.BillLines, line)
	}
	for _, raw := range input.BillCashLines {
		remark, err := lineRemark(raw.Remark)
		if err != nil {
			return result, err
		}
		if strings.TrimSpace(raw.BillLineID) != "" {
			return result, domainError(ErrorValidation, "billLineId is not supported in bill discount cash lines", nil, nil)
		}
		if err = validateReference(&raw.FundAccount, "fundAccount", true); err != nil {
			return result, err
		}
		amount, err := moneyCents(raw.Amount)
		if err != nil {
			return result, err
		}
		direction, amountType := strings.ToUpper(strings.TrimSpace(raw.Direction)), strings.ToUpper(strings.TrimSpace(raw.AmountType))
		if (direction != "IN" && direction != "OUT") || !map[string]bool{"PRINCIPAL": true, "INTEREST": true, "FEE": true, "MARGIN": true, "OTHER": true}[amountType] {
			return result, domainError(ErrorValidation, "invalid bill discount cash line", nil, nil)
		}
		result.BillCashLines = append(result.BillCashLines, fixedBillCashLine{FundAccount: raw.FundAccount, Direction: direction, AmountType: amountType, Amount: amount, Remark: remark})
	}
	return result, nil
}

func validateBillMaturityDraft(input DraftInput, result validatedDraft) (validatedDraft, error) {
	if input.Customer != nil || input.Supplier != nil || input.Counterparty != nil || strings.TrimSpace(input.CounterpartyType) != "" || input.Employee != nil || input.Handler != nil || input.FundAccount != nil || len(input.ProductLines) != 0 || len(input.ExpenseLines) != 0 || input.InternalCostRateBps != 0 || input.InterestMode != "" || input.InterestParty != nil || input.WithRecourse {
		return result, domainError(ErrorValidation, "fields do not match bill maturity", nil, nil)
	}
	maturityType := strings.ToUpper(strings.TrimSpace(input.MaturityType))
	if maturityType != "RECEIPT" && maturityType != "PAYMENT" {
		return result, domainError(ErrorValidation, "bill maturity requires receipt or payment", nil, nil)
	}
	if len(input.BillLines) < 1 || len(input.BillLines) > 20 || len(input.BillCashLines) < 1 || len(input.BillCashLines) > 20 {
		return result, domainError(ErrorValidation, "bill maturity lines must contain 1 to 20 items", nil, nil)
	}
	result.MaturityType, result.InterestMode = maturityType, "NONE"
	position, cashDirection := "ASSET", "IN"
	if maturityType == "PAYMENT" {
		position, cashDirection = "LIABILITY", "OUT"
	}
	seen := make(map[string]struct{}, len(input.BillLines))
	for _, raw := range input.BillLines {
		remark, err := lineRemark(raw.Remark)
		if err != nil {
			return result, err
		}
		line := fixedBillLine{BillID: strings.TrimSpace(raw.BillID), Purpose: strings.ToUpper(strings.TrimSpace(raw.Purpose)), Remark: remark}
		if line.Purpose != "PRIMARY" || !validID(line.BillID) {
			return result, domainError(ErrorValidation, "bill maturity requires available billId", nil, nil)
		}
		if _, duplicate := seen[line.BillID]; duplicate {
			return result, domainError(ErrorValidation, "duplicate billId", nil, nil)
		}
		seen[line.BillID] = struct{}{}
		line.PositionType, line.Direction = position, "OUT"
		result.BillLines = append(result.BillLines, line)
	}
	for _, raw := range input.BillCashLines {
		remark, err := lineRemark(raw.Remark)
		if err != nil {
			return result, err
		}
		if strings.TrimSpace(raw.BillLineID) != "" {
			return result, domainError(ErrorValidation, "billLineId is not supported in bill maturity cash lines", nil, nil)
		}
		if err = validateReference(&raw.FundAccount, "fundAccount", true); err != nil {
			return result, err
		}
		amount, err := moneyCents(raw.Amount)
		if err != nil {
			return result, err
		}
		direction, amountType := strings.ToUpper(strings.TrimSpace(raw.Direction)), strings.ToUpper(strings.TrimSpace(raw.AmountType))
		if direction != cashDirection || !map[string]bool{"PRINCIPAL": true, "INTEREST": true, "FEE": true, "MARGIN": true, "OTHER": true}[amountType] {
			return result, domainError(ErrorValidation, "invalid bill maturity cash line", nil, nil)
		}
		result.BillCashLines = append(result.BillCashLines, fixedBillCashLine{FundAccount: raw.FundAccount, Direction: direction, AmountType: amountType, Amount: amount, Remark: remark})
	}
	return result, nil
}

func (s *Service) billPaymentTotal(ctx context.Context, q *dbsqlc.Queries, lines []fixedBillLine, businessDate time.Time) (int64, error) {
	var total int64
	for _, line := range lines {
		bill, err := q.LockAccountingBillForVou(ctx, line.BillID)
		if err != nil {
			return 0, domainError(ErrorConflict, "source bill is not available", nil, err)
		}
		balance, err := billAvailableBalance(ctx, q, bill.ID, "ASSET", businessDate)
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
	if entity == EntityBillPayment || entity == EntityBillIssue {
		party, partyEntity = r.Supplier, "supplier"
	} else if entity == EntityBillDiscount {
		partyEntity = "other-party"
	} else if entity == EntityBillMaturity {
		party = nil
	}
	params := dbsqlc.InsertVouBillDetailParams{
		DocumentID: id, Entity: entity,
		InternalCostRateBps: d.InternalCostRateBps, MaturityType: d.MaturityType, InterestMode: d.InterestMode,
		InterestPartyEntity: optionalBillPartyEntity(r.InterestParty), InterestPartyObjectID: optionalBillPartyID(r.InterestParty, 0),
		InterestPartyVersionID: optionalBillPartyID(r.InterestParty, 1), InterestPartyCode: optionalBillPartyCode(r.InterestParty),
		InterestPartyName: optionalBillPartyName(r.InterestParty), WithRecourse: d.WithRecourse,
	}
	if party != nil {
		params.CounterpartyEntity = stringPtr(partyEntity)
		params.CounterpartyObjectID, params.CounterpartyVersionID = stringPtr(party.ObjectID), stringPtr(party.VersionID)
		params.CounterpartyCode, params.CounterpartyName = stringPtr(party.Code), stringPtr(party.Data.Name)
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
		if l.Purpose == "CHANGE" || entity == EntityBillPayment || entity == EntityBillDiscount || entity == EntityBillMaturity {
			discountRate := l.AnnualRateBps
			b, err := q.LockAccountingBillForVou(ctx, l.BillID)
			if err != nil {
				return domainError(ErrorConflict, "source bill is not available", nil, err)
			}
			if b.Currency != d.Currency {
				return domainError(ErrorValidation, "source bill currency must match document currency", nil, nil)
			}
			balance, balanceErr := billAvailableBalance(ctx, q, b.ID, l.PositionType, d.BusinessDate)
			if balanceErr != nil || balance != 1 {
				return domainError(ErrorConflict, "source bill is not available", nil, balanceErr)
			}
			if entity == EntityBillDiscount && !b.MaturityDate.Time.After(d.BusinessDate) {
				return domainError(ErrorConflict, "source bill is matured", nil, nil)
			}
			if entity == EntityBillMaturity && b.MaturityDate.Time.After(d.BusinessDate) {
				return domainError(ErrorConflict, "source bill is not matured", nil, nil)
			}
			l.PositionType, l.BillType, l.BillNo, l.Medium, l.Currency = b.PositionType, b.BillType, b.BillNo, b.Medium, b.Currency
			l.FaceAmount, l.IssueDate, l.MaturityDate, l.Drawer, l.Acceptor, l.Payee = b.FaceAmountCents, b.IssueDate.Time, b.MaturityDate.Time, b.Drawer, b.Acceptor, b.Payee
			l.AnnualRateBps, l.InterestDays, l.InterestAmount, l.CustomerCostAmount = b.AnnualRateBps, b.InterestDays, b.InterestAmountCents, b.CustomerCostAmountCents
			if entity == EntityBillDiscount {
				l.AnnualRateBps = discountRate
				l.InterestDays = int32(l.MaturityDate.Sub(d.BusinessDate).Hours() / 24)
				l.InterestAmount, err = roundedBillAmount(l.FaceAmount, l.AnnualRateBps, l.InterestDays)
				if err != nil {
					return err
				}
			}
			change, err = checkedBillMoneyAdd(change, l.FaceAmount)
			if err != nil {
				return err
			}
		}
		resolvedLines = append(resolvedLines, l)
	}
	if entity == EntityBillPayment || entity == EntityBillDiscount || entity == EntityBillMaturity {
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
	if document.Entity == EntityBillPayment || document.Entity == EntityBillIssue {
		data.Supplier = party
	} else if document.Entity != EntityBillMaturity {
		data.Counterparty = party
		data.Handler = optionalReference(d.HandlerObjectID, d.HandlerVersionID, "employee", d.HandlerCode, d.HandlerName)
	}
	data.InternalCostRateBps = d.InternalCostRateBps
	data.MaturityType = d.MaturityType
	data.InterestMode = d.InterestMode
	data.InterestParty = optionalReference(
		d.InterestPartyObjectID,
		d.InterestPartyVersionID,
		deref(d.InterestPartyEntity),
		d.InterestPartyCode,
		d.InterestPartyName,
	)
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

func (s *Service) billMaturityTotal(ctx context.Context, q *dbsqlc.Queries, lines []fixedBillLine, businessDate time.Time) (int64, error) {
	var total int64
	for _, line := range lines {
		bill, err := q.LockAccountingBillForVou(ctx, line.BillID)
		if err != nil {
			return 0, domainError(ErrorConflict, "source bill is not available", nil, err)
		}
		balance, err := billAvailableBalance(ctx, q, bill.ID, line.PositionType, businessDate)
		if err != nil || balance != 1 || bill.PositionType != line.PositionType {
			return 0, domainError(ErrorConflict, "source bill is not available", nil, err)
		}
		if bill.MaturityDate.Time.After(businessDate) {
			return 0, domainError(ErrorConflict, "source bill is not matured", nil, nil)
		}
		total, err = checkedBillMoneyAdd(total, bill.FaceAmountCents)
		if err != nil {
			return 0, err
		}
	}
	return total, nil
}

func billAvailableBalance(ctx context.Context, q *dbsqlc.Queries, billID, positionType string, asOfDate time.Time) (int64, error) {
	return q.GetAccountingBillAvailableBalance(ctx, dbsqlc.GetAccountingBillAvailableBalanceParams{
		BillID: billID, PositionType: positionType,
		AsOfDate: dateValue(asOfDate),
	})
}
