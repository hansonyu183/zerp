package acc

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"
)

func (s *Service) applyGlobalRegisters(ctx context.Context, q *dbsqlc.Queries, event voudomain.DocumentApprovedEvent, books []dbsqlc.ListAccountingPostingBooksRow, snapshot postingSnapshot) error {
	_, err := q.RegisterAccountingGlobalEvent(ctx, dbsqlc.RegisterAccountingGlobalEventParams{SourceEntity: event.Entity, SourceDocumentID: event.DocumentID, SourceRevision: event.Revision})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return databaseError("register global accounting event", err)
	}
	switch event.Entity {
	case voudomain.EntityAssetAcquisition:
		return registerAssetAcquisition(ctx, q, event, books, snapshot)
	case voudomain.EntityAssetSale, voudomain.EntityAssetLiquidation:
		return registerAssetDisposal(ctx, q, event)
	case voudomain.EntityBillReceipt, voudomain.EntityBillIssue:
		return registerBillChanges(ctx, q, event, books)
	case voudomain.EntityBillPayment, voudomain.EntityBillDiscount, voudomain.EntityBillMaturity:
		return registerBillChanges(ctx, q, event, books)
	case voudomain.EntitySaleSignoff:
		return registerContainerChange(ctx, q, event)
	default:
		return nil
	}
}

func registerAssetAcquisition(ctx context.Context, q *dbsqlc.Queries, event voudomain.DocumentApprovedEvent, books []dbsqlc.ListAccountingPostingBooksRow, snapshot postingSnapshot) error {
	date, _ := time.Parse("2006-01-02", event.Snapshot.Data.BusinessDate)
	for _, line := range event.Snapshot.Data.AssetAcquisitionLines {
		original, err := fixeddecimal.ParsePositive(line.OriginalValue, 2, false)
		if err != nil {
			return domainError(ErrorValidation, "invalid asset register value", err)
		}
		// VOU exposes residual rate as a percentage with two decimal places
		// (for example, "5.00" means 5%, stored as 500 basis points).
		residual, err := fixeddecimal.ParsePositive(line.ResidualRate, 2, true)
		if err != nil || residual > 10000 {
			return domainError(ErrorValidation, "invalid asset register residual rate", err)
		}
		assetID := line.LineID
		if err = q.CreateAccountingAsset(ctx, dbsqlc.CreateAccountingAssetParams{
			ID: assetID, AssetNo: "AST-" + assetID, SourceDocumentID: event.DocumentID,
			SourceLineID: line.LineID, Name: line.AssetName, CategoryID: line.Category.ObjectID,
			DepartmentID: line.Department.ObjectID, UsefulLifeMonths: line.UsefulLifeMonths,
			ResidualRateBps: int32(residual), AcquiredOn: pgtype.Date{Time: date, Valid: true},
		}); err != nil {
			return databaseError("create global asset", err)
		}
		for _, book := range books {
			configuration, configErr := loadAssetAccountingConfiguration(ctx, q, book.ID, snapshot.header)
			if configErr != nil {
				return configErr
			}
			encoded, _ := json.Marshal(line)
			var raw any
			if err = json.Unmarshal(encoded, &raw); err != nil {
				return domainError(ErrorInternal, "encode asset accounting snapshot", err)
			}
			fields := map[string]string{}
			flattenSnapshotValue(fields, "", raw)
			assetJSON, accumulatedJSON, expenseJSON := []byte(`{}`), []byte(`{}`), []byte(`{}`)
			var assetSubjectID, accumulatedSubjectID, expenseSubjectID *string
			if configuration != nil {
				assetDimensions, renderErr := renderAssetDimensions(configuration.AssetDimensions, fields)
				if renderErr != nil || assetDimensions[DimensionAsset] != assetID {
					return domainError(ErrorValidation, "asset subject dimensions must identify the acquired asset", renderErr)
				}
				accumulatedDimensions, renderErr := renderAssetDimensions(configuration.AccumulatedDepreciationDimensions, fields)
				if renderErr != nil || accumulatedDimensions[DimensionAsset] != assetID {
					return domainError(ErrorValidation, "accumulated depreciation dimensions must identify the acquired asset", renderErr)
				}
				expenseDimensions, renderErr := renderAssetDimensions(configuration.DepreciationExpenseDimensions, fields)
				if renderErr != nil {
					return renderErr
				}
				assetJSON, _ = json.Marshal(assetDimensions)
				accumulatedJSON, _ = json.Marshal(accumulatedDimensions)
				expenseJSON, _ = json.Marshal(expenseDimensions)
				assetSubjectID = &configuration.AssetSubjectID
				accumulatedSubjectID = &configuration.AccumulatedDepreciationSubjectID
				expenseSubjectID = &configuration.DepreciationExpenseSubjectID
			}
			if err = q.CreateAccountingAssetBookValue(ctx, dbsqlc.CreateAccountingAssetBookValueParams{
				BookID: book.ID, AssetID: assetID, Currency: event.Snapshot.Data.Currency, OriginalMinor: original,
				AssetSubjectID: assetSubjectID, AssetDimensions: assetJSON,
				AccumulatedSubjectID: accumulatedSubjectID, AccumulatedDimensions: accumulatedJSON,
				ExpenseSubjectID: expenseSubjectID, ExpenseDimensions: expenseJSON,
			}); err != nil {
				return databaseError("create asset book value", err)
			}
		}
	}
	return nil
}

func loadAssetAccountingConfiguration(ctx context.Context, q *dbsqlc.Queries, bookID string, header map[string]string) (*AssetAccountingConfiguration, error) {
	mapping, err := q.GetCurrentApprovedAccountingMapping(ctx, dbsqlc.GetCurrentApprovedAccountingMappingParams{BookID: bookID, VouEntity: voudomain.EntityAssetAcquisition})
	if err != nil {
		return nil, databaseError("get asset accounting mapping", err)
	}
	var definition MappingDefinition
	if err = json.Unmarshal(mapping.Definition, &definition); err != nil {
		return nil, domainError(ErrorInternal, "invalid stored asset accounting mapping", err)
	}
	result, _, err := selectMappingResult(mapping.DefaultResult, definition, header)
	if err != nil {
		return nil, err
	}
	if result == MappingResultUnpost {
		return definition.AssetConfiguration, nil
	}
	if definition.AssetConfiguration == nil {
		return nil, domainError(ErrorConflict, "asset accounting configuration is missing", nil)
	}
	return definition.AssetConfiguration, nil
}

func requireAssetAccountingConfiguration(ctx context.Context, q *dbsqlc.Queries, bookID string) (AssetAccountingConfiguration, error) {
	mapping, err := q.GetCurrentApprovedAccountingMapping(ctx, dbsqlc.GetCurrentApprovedAccountingMappingParams{BookID: bookID, VouEntity: voudomain.EntityAssetAcquisition})
	if err != nil {
		return AssetAccountingConfiguration{}, databaseError("get asset accounting mapping", err)
	}
	var definition MappingDefinition
	if err = json.Unmarshal(mapping.Definition, &definition); err != nil || definition.AssetConfiguration == nil {
		return AssetAccountingConfiguration{}, domainError(ErrorConflict, "asset accounting configuration is missing", err)
	}
	return *definition.AssetConfiguration, nil
}

func renderAssetDimensions(configuration map[string]string, fields map[string]string) (map[string]string, error) {
	result := make(map[string]string, len(configuration))
	for dimension, field := range configuration {
		value := fields[field]
		if _, err := ulid.ParseStrict(value); err != nil {
			return nil, domainError(ErrorValidation, "invalid asset accounting dimension", err)
		}
		result[dimension] = value
	}
	return result, nil
}

func registerAssetDisposal(ctx context.Context, q *dbsqlc.Queries, event voudomain.DocumentApprovedEvent) error {
	state := "SOLD"
	assetIDs := make([]string, 0)
	for _, line := range event.Snapshot.Data.AssetSaleLines {
		assetIDs = append(assetIDs, line.AssetID)
	}
	if event.Entity == voudomain.EntityAssetLiquidation {
		state = "RETIRED"
		for _, line := range event.Snapshot.Data.AssetLiquidationLines {
			assetIDs = append(assetIDs, line.AssetID)
		}
	}
	for _, assetID := range assetIDs {
		documentID := event.DocumentID
		disposedOn, _ := time.Parse("2006-01-02", event.Snapshot.Data.BusinessDate)
		rows, err := q.DisposeAccountingAsset(ctx, dbsqlc.DisposeAccountingAssetParams{State: state, DocumentID: &documentID, DisposedOn: pgtype.Date{Time: disposedOn, Valid: true}, AssetID: assetID})
		if err != nil {
			return databaseError("dispose global asset", err)
		}
		if rows != 1 {
			return domainError(ErrorConflict, "asset is not available", nil)
		}
	}
	return nil
}

func registerBillChanges(ctx context.Context, q *dbsqlc.Queries, event voudomain.DocumentApprovedEvent, books []dbsqlc.ListAccountingPostingBooksRow) error {
	origin := event.Snapshot.Data.Customer
	if origin == nil {
		origin = event.Snapshot.Data.Supplier
	}
	if origin == nil {
		origin = event.Snapshot.Data.Counterparty
	}
	for _, line := range event.Snapshot.Data.BillLines {
		if line.Direction == "IN" {
			amount, err := fixeddecimal.ParsePositive(line.FaceAmount, 2, false)
			if err != nil {
				return domainError(ErrorValidation, "invalid bill register value", err)
			}
			issueDate, _ := time.Parse("2006-01-02", line.IssueDate)
			maturityDate, _ := time.Parse("2006-01-02", line.MaturityDate)
			interest, _ := fixeddecimal.ParsePositive(line.InterestAmount, 2, true)
			customerCost, _ := fixeddecimal.ParsePositive(line.CustomerCostAmount, 2, true)
			var originEntity, originID, originVersion, originCode, originName *string
			if origin != nil {
				originEntity, originID, originVersion = &origin.Entity, &origin.ObjectID, &origin.ApprovalEntryID
				originCode, originName = &origin.Code, &origin.Name
			}
			if err = q.CreateAccountingBill(ctx, dbsqlc.CreateAccountingBillParams{
				ID: line.BillID, BillNo: line.BillNo, BillType: line.BillType, PositionType: line.PositionType,
				Currency: line.Currency, Medium: line.Medium, FaceAmountMinor: amount,
				IssueDate: pgtype.Date{Time: issueDate, Valid: true}, MaturityDate: pgtype.Date{Time: maturityDate, Valid: true},
				Drawer: line.Drawer, Acceptor: line.Acceptor, Payee: line.Payee,
				AnnualRateBps: line.AnnualRateBps, InterestDays: line.InterestDays,
				InterestAmountMinor: interest, CustomerCostAmountMinor: customerCost,
				OriginPartyEntity: originEntity, OriginPartyObjectID: originID, OriginPartyApprovalEntryID: originVersion,
				OriginPartyCode: originCode, OriginPartyName: originName,
				SourceDocumentID: event.DocumentID, SourceLineID: line.LineID,
			}); err != nil {
				return databaseError("create global bill", err)
			}
			for _, book := range books {
				if err = q.CreateAccountingBillBookValue(ctx, dbsqlc.CreateAccountingBillBookValueParams{BookID: book.ID, BillID: line.BillID, ValueMinor: amount}); err != nil {
					return databaseError("create bill book value", err)
				}
			}
			continue
		}
		documentID := event.DocumentID
		rows, err := q.SettleAccountingBill(ctx, dbsqlc.SettleAccountingBillParams{DocumentID: &documentID, BillID: line.BillID})
		if err != nil {
			return databaseError("settle global bill", err)
		}
		if rows != 1 {
			return domainError(ErrorConflict, "source bill is not available", nil)
		}
	}
	return nil
}

func registerContainerChange(ctx context.Context, q *dbsqlc.Queries, event voudomain.DocumentApprovedEvent) error {
	if event.Snapshot.Data.Customer == nil {
		return nil
	}
	changes := map[string]int64{
		"SOLVENT": event.Snapshot.Data.ExpectedSolventContainers - event.Snapshot.Data.ReturnedSolventContainers,
		"RESIN":   event.Snapshot.Data.ExpectedResinContainers - event.Snapshot.Data.ReturnedResinContainers,
	}
	for containerType, delta := range changes {
		if delta == 0 {
			continue
		}
		if err := q.CreateAccountingContainerEntry(ctx, dbsqlc.CreateAccountingContainerEntryParams{
			ID: ulid.Make().String(), CustomerID: event.Snapshot.Data.Customer.ObjectID,
			ContainerType: containerType, QuantityDelta: delta,
			SourceDocumentID: event.DocumentID, SourceRevision: event.Revision,
		}); err != nil {
			return databaseError("create container entry", err)
		}
	}
	return nil
}

func (s *Service) reverseGlobalRegisters(ctx context.Context, tx pgx.Tx, event voudomain.DocumentUnapprovedEvent) error {
	q := s.queries.WithTx(tx)
	rows, err := q.DeleteAccountingGlobalEvent(ctx, dbsqlc.DeleteAccountingGlobalEventParams{SourceEntity: event.Entity, SourceDocumentID: event.DocumentID, SourceRevision: event.Snapshot.Revision})
	if err != nil {
		return databaseError("delete global accounting event", err)
	}
	if rows == 0 {
		return nil
	}
	switch event.Entity {
	case voudomain.EntityAssetAcquisition:
		err = q.DeleteActiveAccountingAssetsBySource(ctx, event.DocumentID)
	case voudomain.EntityAssetSale, voudomain.EntityAssetLiquidation:
		err = q.RestoreAccountingAssetsByDisposal(ctx, &event.DocumentID)
	case voudomain.EntityBillReceipt, voudomain.EntityBillIssue:
		err = q.DeleteAvailableAccountingBillsBySource(ctx, event.DocumentID)
	case voudomain.EntityBillPayment, voudomain.EntityBillDiscount, voudomain.EntityBillMaturity:
		err = q.RestoreAccountingBillsBySettlement(ctx, &event.DocumentID)
	case voudomain.EntitySaleSignoff:
		err = q.DeleteAccountingContainerEntriesBySource(ctx, dbsqlc.DeleteAccountingContainerEntriesBySourceParams{DocumentID: event.DocumentID, SourceRevision: event.Snapshot.Revision})
	}
	if err != nil {
		return databaseError("reverse global accounting register", err)
	}
	return nil
}
