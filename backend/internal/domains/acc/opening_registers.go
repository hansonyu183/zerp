package acc

import (
	"context"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"
)

func saveOpeningRegisters(ctx context.Context, q *dbsqlc.Queries, input SaveOpeningInput) error {
	for _, remove := range []func(context.Context, string) error{q.DeleteAccountingOpeningAssets, q.DeleteAccountingOpeningBills, q.DeleteAccountingOpeningContainers} {
		if err := remove(ctx, input.BookID); err != nil {
			return databaseError("replace accounting opening registers", err)
		}
	}
	for index, asset := range input.Assets {
		asset.AssetID = strings.TrimSpace(asset.AssetID)
		createObject := asset.AssetID == ""
		if createObject {
			asset.AssetID = ulid.Make().String()
		} else if _, err := ulid.ParseStrict(asset.AssetID); err != nil {
			return domainError(ErrorValidation, "invalid opening asset id", err)
		} else {
			exists, existsErr := q.AccountingAssetExists(ctx, asset.AssetID)
			if existsErr != nil {
				return databaseError("check opening asset", existsErr)
			}
			createObject = !exists
		}
		original, err := fixeddecimal.ParsePositive(asset.OriginalValue, 2, false)
		if err != nil {
			return domainError(ErrorValidation, "invalid opening asset value", err)
		}
		accumulated, err := fixeddecimal.ParsePositive(asset.AccumulatedDepreciation, 2, true)
		if err != nil || accumulated > original {
			return domainError(ErrorValidation, "invalid opening accumulated depreciation", err)
		}
		currency := strings.ToUpper(strings.TrimSpace(asset.Currency))
		var acquired pgtype.Date
		var residual int64
		if createObject {
			acquiredDate, dateErr := time.Parse("2006-01-02", asset.AcquiredOn)
			residual, err = fixeddecimal.ParsePositive(asset.ResidualRate, 4, true)
			if dateErr != nil || err != nil || residual > 10000 || asset.UsefulLifeMonths < 1 ||
				strings.TrimSpace(asset.AssetNo) == "" || strings.TrimSpace(asset.Name) == "" ||
				!validID(asset.CategoryID) || !validID(asset.DepartmentID) {
				return domainError(ErrorValidation, "invalid opening asset facts", firstError(dateErr, err))
			}
			acquired = pgtype.Date{Time: acquiredDate, Valid: true}
		}
		if !currencyPattern.MatchString(currency) {
			return domainError(ErrorValidation, "invalid opening asset currency", nil)
		}
		if err = q.InsertAccountingOpeningAsset(ctx, dbsqlc.InsertAccountingOpeningAssetParams{
			BookID: input.BookID, LineOrder: int32(index), AssetID: asset.AssetID, CreateObject: createObject,
			AssetNo: optionalRegisterText(asset.AssetNo), Name: optionalRegisterText(asset.Name),
			CategoryID: optionalRegisterText(asset.CategoryID), DepartmentID: optionalRegisterText(asset.DepartmentID),
			UsefulLifeMonths: optionalPositiveInt(asset.UsefulLifeMonths), ResidualRateBps: optionalResidualInt32(createObject, residual),
			AcquiredOn: acquired, Currency: currency, OriginalMinor: original, AccumulatedMinor: accumulated,
		}); err != nil {
			return databaseError("save accounting opening asset", err)
		}
	}
	for index, bill := range input.Bills {
		if err := saveOpeningBill(ctx, q, input.BookID, index, bill); err != nil {
			return err
		}
	}
	for index, container := range input.Containers {
		if !validID(container.CustomerID) || (container.ContainerType != "SOLVENT" && container.ContainerType != "RESIN") || container.Quantity == 0 {
			return domainError(ErrorValidation, "invalid opening container balance", nil)
		}
		if err := q.InsertAccountingOpeningContainer(ctx, dbsqlc.InsertAccountingOpeningContainerParams{
			BookID: input.BookID, LineOrder: int32(index), CustomerID: container.CustomerID,
			ContainerType: container.ContainerType, Quantity: container.Quantity,
		}); err != nil {
			return databaseError("save accounting opening container", err)
		}
	}
	return nil
}

func saveOpeningBill(ctx context.Context, q *dbsqlc.Queries, bookID string, index int, bill OpeningBillInput) error {
	bill.BillID = strings.TrimSpace(bill.BillID)
	createObject := bill.BillID == ""
	if createObject {
		bill.BillID = ulid.Make().String()
	} else if _, err := ulid.ParseStrict(bill.BillID); err != nil {
		return domainError(ErrorValidation, "invalid opening bill id", err)
	} else {
		exists, existsErr := q.AccountingBillExists(ctx, bill.BillID)
		if existsErr != nil {
			return databaseError("check opening bill", existsErr)
		}
		createObject = !exists
	}
	value, err := fixeddecimal.ParsePositive(bill.ValueAmount, 2, false)
	if err != nil || !currencyPattern.MatchString(strings.ToUpper(strings.TrimSpace(bill.Currency))) {
		return domainError(ErrorValidation, "invalid opening bill value", err)
	}
	var face, interest, cost int64
	var issue, maturity pgtype.Date
	if createObject {
		face, err = fixeddecimal.ParsePositive(bill.FaceAmount, 2, false)
		var interestErr, costErr error
		interest, interestErr = fixeddecimal.ParsePositive(bill.InterestAmount, 2, true)
		cost, costErr = fixeddecimal.ParsePositive(bill.CustomerCostAmount, 2, true)
		issueDate, issueErr := time.Parse("2006-01-02", bill.IssueDate)
		maturityDate, maturityErr := time.Parse("2006-01-02", bill.MaturityDate)
		if err != nil || interestErr != nil || costErr != nil || issueErr != nil || maturityErr != nil || maturityDate.Before(issueDate) ||
			strings.TrimSpace(bill.BillNo) == "" || strings.TrimSpace(bill.Drawer) == "" || strings.TrimSpace(bill.Acceptor) == "" || strings.TrimSpace(bill.Payee) == "" ||
			(bill.PositionType != "ASSET" && bill.PositionType != "LIABILITY") || (bill.Medium != "PAPER" && bill.Medium != "ELECTRONIC") ||
			bill.AnnualRateBps < 0 || bill.InterestDays < 0 || !validID(bill.OriginatingParty.ObjectID) || !validID(bill.OriginatingParty.ApprovalEntryID) {
			return domainError(ErrorValidation, "invalid opening bill facts", firstError(err, interestErr, costErr, issueErr, maturityErr))
		}
		issue = pgtype.Date{Time: issueDate, Valid: true}
		maturity = pgtype.Date{Time: maturityDate, Valid: true}
	}
	err = q.InsertAccountingOpeningBill(ctx, dbsqlc.InsertAccountingOpeningBillParams{
		BookID: bookID, LineOrder: int32(index), BillID: bill.BillID, CreateObject: createObject,
		BillNo: optionalRegisterText(bill.BillNo), BillType: optionalRegisterText(bill.BillType),
		PositionType: optionalRegisterText(bill.PositionType), Medium: optionalRegisterText(bill.Medium),
		Currency: strings.ToUpper(strings.TrimSpace(bill.Currency)), FaceAmountMinor: optionalRegisterMoney(createObject, face),
		IssueDate: issue, MaturityDate: maturity, Drawer: optionalRegisterText(bill.Drawer), Acceptor: optionalRegisterText(bill.Acceptor), Payee: optionalRegisterText(bill.Payee),
		AnnualRateBps: optionalRegisterInt(createObject, bill.AnnualRateBps), InterestDays: optionalRegisterInt(createObject, bill.InterestDays),
		InterestAmountMinor: optionalRegisterMoney(createObject, interest), CustomerCostAmountMinor: optionalRegisterMoney(createObject, cost),
		OriginPartyEntity: optionalRegisterText(bill.OriginatingParty.Entity), OriginPartyObjectID: optionalRegisterText(bill.OriginatingParty.ObjectID),
		OriginPartyApprovalEntryID: optionalRegisterText(bill.OriginatingParty.ApprovalEntryID), OriginPartyCode: optionalRegisterText(bill.OriginatingParty.Code),
		OriginPartyName: optionalRegisterText(bill.OriginatingParty.Name), ValueMinor: value,
	})
	if err != nil {
		return databaseError("save accounting opening bill", err)
	}
	return nil
}

func loadOpeningRegisters(ctx context.Context, q *dbsqlc.Queries, view *OpeningView) error {
	view.Assets, view.Bills, view.Containers = []OpeningAssetView{}, []OpeningBillView{}, []OpeningContainerView{}
	assets, err := q.ListAccountingOpeningAssets(ctx, view.BookID)
	if err != nil {
		return databaseError("load accounting opening assets", err)
	}
	for _, row := range assets {
		item := OpeningAssetView{
			OpeningAssetInput: OpeningAssetInput{
				AssetID: row.AssetID, AssetNo: row.AssetNo, Name: row.Name,
				CategoryID: row.CategoryID, DepartmentID: row.DepartmentID,
				UsefulLifeMonths: row.UsefulLifeMonths, Currency: row.Currency,
				ResidualRate:            fixeddecimal.Format(int64(row.ResidualRateBps), 4, true),
				OriginalValue:           fixeddecimal.Format(row.OriginalMinor, 2, false),
				AccumulatedDepreciation: fixeddecimal.Format(row.AccumulatedMinor, 2, false),
			},
			CreateObject: row.CreateObject,
		}
		if row.AcquiredOn.Valid {
			item.AcquiredOn = row.AcquiredOn.Time.Format("2006-01-02")
		}
		view.Assets = append(view.Assets, item)
	}
	bills, err := q.ListAccountingOpeningBills(ctx, view.BookID)
	if err != nil {
		return databaseError("load accounting opening bills", err)
	}
	for _, row := range bills {
		item := OpeningBillView{
			OpeningBillInput: OpeningBillInput{
				BillID: row.BillID, BillNo: row.BillNo, BillType: row.BillType,
				PositionType: row.PositionType, Medium: row.Medium, Currency: row.Currency,
				Drawer: row.Drawer, Acceptor: row.Acceptor, Payee: row.Payee,
				AnnualRateBps: row.AnnualRateBps, InterestDays: row.InterestDays,
				FaceAmount:         fixeddecimal.Format(row.FaceAmountMinor, 2, false),
				InterestAmount:     fixeddecimal.Format(row.InterestAmountMinor, 2, false),
				CustomerCostAmount: fixeddecimal.Format(row.CustomerCostAmountMinor, 2, false),
				ValueAmount:        fixeddecimal.Format(row.ValueMinor, 2, false),
				OriginatingParty:   OpeningPartyInput{Entity: row.OriginPartyEntity, ObjectID: row.OriginPartyObjectID, ApprovalEntryID: row.OriginPartyApprovalEntryID, Code: row.OriginPartyCode, Name: row.OriginPartyName},
			},
			CreateObject: row.CreateObject,
		}
		if row.IssueDate.Valid {
			item.IssueDate = row.IssueDate.Time.Format("2006-01-02")
		}
		if row.MaturityDate.Valid {
			item.MaturityDate = row.MaturityDate.Time.Format("2006-01-02")
		}
		view.Bills = append(view.Bills, item)
	}
	containers, err := q.ListAccountingOpeningContainers(ctx, view.BookID)
	if err != nil {
		return databaseError("load accounting opening containers", err)
	}
	for _, row := range containers {
		view.Containers = append(view.Containers, OpeningContainerView{CustomerID: row.CustomerID, ContainerType: row.ContainerType, Quantity: row.Quantity})
	}
	return nil
}

func approveOpeningRegisters(ctx context.Context, q *dbsqlc.Queries, bookID string, lines []normalizedOpeningLine) error {
	assets, err := q.ListAccountingOpeningAssetsForApproval(ctx, bookID)
	if err != nil {
		return err
	}
	var config AssetAccountingConfiguration
	if len(assets) > 0 {
		config, err = requireAssetAccountingConfiguration(ctx, q, bookID)
		if err != nil {
			return err
		}
	}
	for _, asset := range assets {
		if !openingLineMatches(lines, config.AssetSubjectID, DimensionAsset, asset.AssetID, asset.Currency, asset.OriginalMinor, 0) || (asset.AccumulatedMinor > 0 && !openingLineMatches(lines, config.AccumulatedDepreciationSubjectID, DimensionAsset, asset.AssetID, asset.Currency, 0, asset.AccumulatedMinor)) {
			return domainError(ErrorConflict, "opening asset values do not reconcile", nil)
		}
		if asset.CreateObject {
			if err = q.CreateAccountingAsset(ctx, dbsqlc.CreateAccountingAssetParams{
				ID: asset.AssetID, AssetNo: *asset.AssetNo, SourceDocumentID: bookID, SourceLineID: asset.AssetID,
				Name: *asset.Name, CategoryID: *asset.CategoryID, DepartmentID: *asset.DepartmentID,
				UsefulLifeMonths: *asset.UsefulLifeMonths, ResidualRateBps: *asset.ResidualRateBps, AcquiredOn: asset.AcquiredOn,
			}); err != nil {
				return databaseError("create opening asset", err)
			}
		} else {
			active, activeErr := q.AccountingAssetIsActive(ctx, asset.AssetID)
			if activeErr != nil || !active {
				return domainError(ErrorConflict, "opening asset is not available", activeErr)
			}
		}
		assetDimensions := []byte(`{"ASSET":"` + asset.AssetID + `"}`)
		assetSubjectID, accumulatedSubjectID, expenseSubjectID := config.AssetSubjectID, config.AccumulatedDepreciationSubjectID, config.DepreciationExpenseSubjectID
		if err = q.CreateAccountingAssetBookValue(ctx, dbsqlc.CreateAccountingAssetBookValueParams{
			BookID: bookID, AssetID: asset.AssetID, Currency: asset.Currency,
			OriginalMinor: asset.OriginalMinor, AccumulatedMinor: asset.AccumulatedMinor,
			AssetSubjectID: &assetSubjectID, AssetDimensions: assetDimensions,
			AccumulatedSubjectID: &accumulatedSubjectID, AccumulatedDimensions: assetDimensions,
			ExpenseSubjectID: &expenseSubjectID, ExpenseDimensions: []byte(`{}`),
		}); err != nil {
			return databaseError("create opening asset book value", err)
		}
	}
	bills, err := q.ListAccountingOpeningBillsForApproval(ctx, bookID)
	if err != nil {
		return err
	}
	for _, bill := range bills {
		debit, credit := bill.ValueMinor, int64(0)
		if bill.PositionType != nil && *bill.PositionType == "LIABILITY" {
			debit, credit = 0, bill.ValueMinor
		}
		if !openingAnyBillLineMatches(lines, bill.BillID, bill.Currency, debit, credit) {
			return domainError(ErrorConflict, "opening bill value does not reconcile", nil)
		}
		if bill.CreateObject {
			if err = q.CreateAccountingBill(ctx, dbsqlc.CreateAccountingBillParams{
				ID: bill.BillID, BillNo: *bill.BillNo, BillType: *bill.BillType, PositionType: *bill.PositionType,
				Currency: bill.Currency, Medium: *bill.Medium, FaceAmountMinor: *bill.FaceAmountMinor,
				IssueDate: bill.IssueDate, MaturityDate: bill.MaturityDate, Drawer: *bill.Drawer, Acceptor: *bill.Acceptor, Payee: *bill.Payee,
				AnnualRateBps: *bill.AnnualRateBps, InterestDays: *bill.InterestDays,
				InterestAmountMinor: *bill.InterestAmountMinor, CustomerCostAmountMinor: *bill.CustomerCostAmountMinor,
				OriginPartyEntity: bill.OriginPartyEntity, OriginPartyObjectID: bill.OriginPartyObjectID,
				OriginPartyApprovalEntryID: bill.OriginPartyApprovalEntryID, OriginPartyCode: bill.OriginPartyCode, OriginPartyName: bill.OriginPartyName,
				SourceDocumentID: bookID, SourceLineID: bill.BillID,
			}); err != nil {
				return databaseError("create opening bill", err)
			}
		} else {
			available, availableErr := q.AccountingBillIsAvailable(ctx, bill.BillID)
			if availableErr != nil || !available {
				return domainError(ErrorConflict, "opening bill is not available", availableErr)
			}
		}
		if err = q.CreateAccountingBillBookValue(ctx, dbsqlc.CreateAccountingBillBookValueParams{BookID: bookID, BillID: bill.BillID, ValueMinor: bill.ValueMinor}); err != nil {
			return databaseError("create opening bill book value", err)
		}
	}
	err = q.CreateAccountingOpeningContainerBalances(ctx, bookID)
	if err != nil {
		return databaseError("create opening container balances", err)
	}
	return nil
}

func unapproveOpeningRegisters(ctx context.Context, q *dbsqlc.Queries, bookID string) error {
	referenced, err := q.AccountingOpeningObjectsReferencedByOtherBooks(ctx, bookID)
	if err != nil {
		return err
	}
	if referenced {
		return domainError(ErrorConflict, "opening global object is used by another book", nil)
	}
	operations := []func(context.Context, string) error{
		q.DeleteAccountingOpeningContainerBalances,
		q.DeleteAccountingAssetBookValues,
		q.DeleteAccountingBillBookValues,
		q.DeleteAccountingOpeningCreatedAssets,
		q.DeleteAccountingOpeningCreatedBills,
	}
	for _, operation := range operations {
		if err := operation(ctx, bookID); err != nil {
			return databaseError("reverse opening registers", err)
		}
	}
	return nil
}

func openingLineMatches(lines []normalizedOpeningLine, subject, dimension, object, currency string, debit, credit int64) bool {
	for _, line := range lines {
		if line.subjectID == subject && line.currency == currency && line.dimensions[dimension] == object && line.debitMinor == debit && line.creditMinor == credit {
			return true
		}
	}
	return false
}
func openingAnyBillLineMatches(lines []normalizedOpeningLine, id, currency string, debit, credit int64) bool {
	for _, line := range lines {
		if line.currency == currency && line.dimensions[DimensionBill] == id && line.debitMinor == debit && line.creditMinor == credit {
			return true
		}
	}
	return false
}
func optionalRegisterText(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
func optionalPositiveInt(value int32) *int32 {
	if value <= 0 {
		return nil
	}
	return &value
}
func optionalResidualInt32(enabled bool, value int64) *int32 {
	if !enabled {
		return nil
	}
	result := int32(value)
	return &result
}
func optionalRegisterMoney(enabled bool, value int64) *int64 {
	if !enabled {
		return nil
	}
	return &value
}
func optionalRegisterInt(enabled bool, value int32) *int32 {
	if !enabled {
		return nil
	}
	return &value
}
func firstError(errors ...error) error {
	for _, err := range errors {
		if err != nil {
			return err
		}
	}
	return nil
}

func validID(value string) bool {
	_, err := ulid.ParseStrict(strings.TrimSpace(value))
	return err == nil
}
