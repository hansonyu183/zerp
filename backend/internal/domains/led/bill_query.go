package led

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

type validatedBillQuery struct {
	Page, PageSize                                                                   int
	PositionType, Availability, BillType, BillNo                                     string
	MaturityDateFrom, MaturityDateTo, OriginatingPartyType, OriginatingPartyObjectID string
	SourceEntity, SortField, SortOrder                                               string
}

func (s *Service) QueryBills(ctx context.Context, input BillQueryInput) (Page[BillView], error) {
	query, err := validateBillQuery(input)
	if err != nil {
		return Page[BillView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[BillView]{}, err
	}
	rows, err := s.queries.ListLedBills(ctx, dbsqlc.ListLedBillsParams{
		GenerationID: generationID, PositionType: query.PositionType,
		Availability: query.Availability, BillType: query.BillType, BillNo: query.BillNo,
		MaturityDateFrom: query.MaturityDateFrom, MaturityDateTo: query.MaturityDateTo,
		OriginatingPartyEntity:   query.OriginatingPartyType,
		OriginatingPartyObjectID: query.OriginatingPartyObjectID, SourceEntity: query.SourceEntity,
		SortField: query.SortField, SortOrder: query.SortOrder,
		PageOffset: int32((query.Page - 1) * query.PageSize), PageSize: int32(query.PageSize),
	})
	if err != nil {
		return Page[BillView]{}, s.internal("list bills", err)
	}
	items := make([]BillView, 0, len(rows))
	var total int64
	for _, row := range rows {
		total = row.TotalCount
		items = append(items, BillView{
			BillID: row.ID, PositionType: row.PositionType, Availability: row.Availability,
			BillType: row.BillType, BillNo: row.BillNo, Medium: row.Medium,
			Currency: row.Currency, FaceAmount: formatMoney(row.FaceAmountCents),
			IssueDate: formatDate(row.IssueDate), MaturityDate: formatDate(row.MaturityDate),
			Drawer: row.Drawer, Acceptor: row.Acceptor, Payee: row.Payee,
			AnnualRateBps: row.AnnualRateBps, InterestDays: row.InterestDays,
			InterestAmount: formatMoney(row.InterestAmountCents),
			OriginatingParty: ReferenceView{
				ObjectID: deref(row.OriginPartyObjectID), VersionID: deref(row.OriginPartyVersionID),
				Entity: deref(row.OriginPartyEntity), Code: deref(row.OriginPartyCode), Name: deref(row.OriginPartyName),
			},
			CustomerCostAmount: formatMoney(row.CustomerCostAmountCents),
			SourceEntity:       row.SourceEntity, SourceDocumentNo: row.SourceDocumentNo,
		})
	}
	return Page[BillView]{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, nil
}

func validateBillQuery(input BillQueryInput) (validatedBillQuery, error) {
	result := validatedBillQuery{
		Page: input.Page, PageSize: input.PageSize, SortField: "maturityDate", SortOrder: "asc",
		PositionType:             strings.ToUpper(strings.TrimSpace(input.Filters.PositionType)),
		Availability:             strings.ToUpper(strings.TrimSpace(input.Filters.Availability)),
		BillType:                 strings.ToUpper(strings.TrimSpace(input.Filters.BillType)),
		BillNo:                   strings.TrimSpace(input.Filters.BillNo),
		MaturityDateFrom:         strings.TrimSpace(input.Filters.MaturityDateFrom),
		MaturityDateTo:           strings.TrimSpace(input.Filters.MaturityDateTo),
		OriginatingPartyType:     strings.TrimSpace(input.Filters.OriginatingPartyType),
		OriginatingPartyObjectID: strings.TrimSpace(input.Filters.OriginatingPartyObjectID),
		SourceEntity:             strings.TrimSpace(input.Filters.SourceEntity),
	}
	if result.Page < 1 || result.PageSize < 1 || result.PageSize > 100 || len(input.Sort) > 1 || utf8.RuneCountInString(result.BillNo) > 200 {
		return validatedBillQuery{}, domainError(ErrorValidation, "invalid bill query", nil, nil)
	}
	if result.PositionType != "" && result.PositionType != "ASSET" && result.PositionType != "LIABILITY" {
		return validatedBillQuery{}, domainError(ErrorValidation, "invalid bill positionType", nil, nil)
	}
	if result.Availability != "" && result.Availability != "AVAILABLE" && result.Availability != "USED" && result.Availability != "MATURED" && result.Availability != "HELD" {
		return validatedBillQuery{}, domainError(ErrorValidation, "invalid bill availability", nil, nil)
	}
	if result.BillType != "" && result.BillType != "BANK_ACCEPTANCE" && result.BillType != "COMMERCIAL_ACCEPTANCE" && result.BillType != "CHECK" && result.BillType != "OTHER" {
		return validatedBillQuery{}, domainError(ErrorValidation, "invalid billType", nil, nil)
	}
	if result.OriginatingPartyType != "" && result.OriginatingPartyType != "customer" &&
		result.OriginatingPartyType != "supplier" && result.OriginatingPartyType != "other-party" {
		return validatedBillQuery{}, domainError(ErrorValidation, "invalid originatingPartyType", nil, nil)
	}
	if result.OriginatingPartyObjectID != "" && !validID(result.OriginatingPartyObjectID) {
		return validatedBillQuery{}, domainError(ErrorValidation, "invalid originatingPartyObjectId", nil, nil)
	}
	if (result.OriginatingPartyType == "") != (result.OriginatingPartyObjectID == "") {
		return validatedBillQuery{}, domainError(ErrorValidation, "incomplete originating party filter", nil, nil)
	}
	if result.SourceEntity != "" && result.SourceEntity != "bill-receipt" &&
		result.SourceEntity != "bill-payment" && result.SourceEntity != "bill-issue" &&
		result.SourceEntity != "bill-discount" && result.SourceEntity != "bill-maturity" {
		return validatedBillQuery{}, domainError(ErrorValidation, "invalid sourceEntity", nil, nil)
	}
	var from, to time.Time
	var err error
	if result.MaturityDateFrom != "" {
		from, err = time.Parse(dateLayout, result.MaturityDateFrom)
		if err != nil {
			return validatedBillQuery{}, domainError(ErrorValidation, "invalid maturityDateFrom", nil, err)
		}
	}
	if result.MaturityDateTo != "" {
		to, err = time.Parse(dateLayout, result.MaturityDateTo)
		if err != nil || (!from.IsZero() && to.Before(from)) {
			return validatedBillQuery{}, domainError(ErrorValidation, "invalid maturityDateTo", nil, err)
		}
	}
	if len(input.Sort) == 1 {
		field, order := input.Sort[0].Field, input.Sort[0].Order
		if field != "maturityDate" && field != "billNo" && field != "faceAmount" && field != "sourceDocumentNo" {
			return validatedBillQuery{}, domainError(ErrorValidation, "invalid bill sort field", nil, nil)
		}
		if order != "asc" && order != "desc" {
			return validatedBillQuery{}, domainError(ErrorValidation, "invalid bill sort order", nil, nil)
		}
		result.SortField, result.SortOrder = field, order
	}
	return result, nil
}
