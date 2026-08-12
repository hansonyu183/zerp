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
	"github.com/oklog/ulid/v2"
)

func (s *Service) applyGlobalRegisters(ctx context.Context, tx pgx.Tx, event voudomain.DocumentApprovedEvent, books []dbsqlc.ListAccountingPostingBooksRow) error {
	var inserted bool
	err := tx.QueryRow(ctx, `INSERT INTO acc_register_events (source_entity, source_document_id, source_revision)
		VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING true`, event.Entity, event.DocumentID, event.Revision).Scan(&inserted)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return databaseError("register global accounting event", err)
	}
	switch event.Entity {
	case voudomain.EntityAssetAcquisition:
		return registerAssetAcquisition(ctx, tx, event, books)
	case voudomain.EntityAssetSale, voudomain.EntityAssetLiquidation:
		return registerAssetDisposal(ctx, tx, event)
	case voudomain.EntityBillReceipt, voudomain.EntityBillIssue:
		return registerBillChanges(ctx, tx, event, books)
	case voudomain.EntityBillPayment, voudomain.EntityBillDiscount, voudomain.EntityBillMaturity:
		return registerBillChanges(ctx, tx, event, books)
	case voudomain.EntitySaleSignoff:
		return registerContainerChange(ctx, tx, event)
	default:
		return nil
	}
}

func registerAssetAcquisition(ctx context.Context, tx pgx.Tx, event voudomain.DocumentApprovedEvent, books []dbsqlc.ListAccountingPostingBooksRow) error {
	date, _ := time.Parse("2006-01-02", event.Snapshot.Data.BusinessDate)
	for _, line := range event.Snapshot.Data.AssetAcquisitionLines {
		original, err := fixeddecimal.ParsePositive(line.OriginalValue, 2, false)
		if err != nil {
			return domainError(ErrorValidation, "invalid asset register value", err)
		}
		residual, err := fixeddecimal.ParsePositive(line.ResidualRate, 4, true)
		if err != nil || residual > 10000 {
			return domainError(ErrorValidation, "invalid asset register residual rate", err)
		}
		assetID := line.LineID
		if _, err = tx.Exec(ctx, `INSERT INTO acc_assets (
			id, asset_no, source_document_id, source_line_id, name, category_id, department_id,
			useful_life_months, residual_rate_bps, acquired_on, state
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE')`, assetID, "AST-"+assetID, event.DocumentID,
			line.LineID, line.AssetName, line.Category.ObjectID, line.Department.ObjectID,
			line.UsefulLifeMonths, residual, date); err != nil {
			return databaseError("create global asset", err)
		}
		for _, book := range books {
			configuration, configErr := loadAssetAccountingConfiguration(ctx, tx, book.ID)
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
			assetDimensions, err := renderAssetDimensions(configuration.AssetDimensions, fields)
			if err != nil || assetDimensions[DimensionAsset] != assetID {
				return domainError(ErrorValidation, "asset subject dimensions must identify the acquired asset", err)
			}
			accumulatedDimensions, err := renderAssetDimensions(configuration.AccumulatedDepreciationDimensions, fields)
			if err != nil || accumulatedDimensions[DimensionAsset] != assetID {
				return domainError(ErrorValidation, "accumulated depreciation dimensions must identify the acquired asset", err)
			}
			expenseDimensions, err := renderAssetDimensions(configuration.DepreciationExpenseDimensions, fields)
			if err != nil {
				return err
			}
			assetJSON, _ := json.Marshal(assetDimensions)
			accumulatedJSON, _ := json.Marshal(accumulatedDimensions)
			expenseJSON, _ := json.Marshal(expenseDimensions)
			if _, err = tx.Exec(ctx, `INSERT INTO acc_asset_book_values (
				book_id,asset_id,currency,original_minor,asset_subject_id,asset_dimensions,
				accumulated_subject_id,accumulated_dimensions,expense_subject_id,expense_dimensions
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, book.ID, assetID, event.Snapshot.Data.Currency, original,
				configuration.AssetSubjectID, assetJSON, configuration.AccumulatedDepreciationSubjectID,
				accumulatedJSON, configuration.DepreciationExpenseSubjectID, expenseJSON); err != nil {
				return databaseError("create asset book value", err)
			}
		}
	}
	return nil
}

func loadAssetAccountingConfiguration(ctx context.Context, tx pgx.Tx, bookID string) (AssetAccountingConfiguration, error) {
	var definitionJSON []byte
	if err := tx.QueryRow(ctx, `SELECT definition FROM acc_mapping_versions
		WHERE book_id=$1 AND vou_entity='asset-acquisition' AND state='APPROVED'`, bookID).Scan(&definitionJSON); err != nil {
		return AssetAccountingConfiguration{}, databaseError("get asset accounting mapping", err)
	}
	var definition MappingDefinition
	if err := json.Unmarshal(definitionJSON, &definition); err != nil || definition.AssetConfiguration == nil {
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

func registerAssetDisposal(ctx context.Context, tx pgx.Tx, event voudomain.DocumentApprovedEvent) error {
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
		result, err := tx.Exec(ctx, `UPDATE acc_assets SET state=$1,disposed_by_document_id=$2,disposed_on=$3 WHERE id=$4 AND state='ACTIVE'`, state, event.DocumentID, event.Snapshot.Data.BusinessDate, assetID)
		if err != nil {
			return databaseError("dispose global asset", err)
		}
		if result.RowsAffected() != 1 {
			return domainError(ErrorConflict, "asset is not available", nil)
		}
	}
	return nil
}

func registerBillChanges(ctx context.Context, tx pgx.Tx, event voudomain.DocumentApprovedEvent, books []dbsqlc.ListAccountingPostingBooksRow) error {
	for _, line := range event.Snapshot.Data.BillLines {
		if line.Direction == "IN" {
			amount, err := fixeddecimal.ParsePositive(line.FaceAmount, 2, false)
			if err != nil {
				return domainError(ErrorValidation, "invalid bill register value", err)
			}
			issueDate, _ := time.Parse("2006-01-02", line.IssueDate)
			maturityDate, _ := time.Parse("2006-01-02", line.MaturityDate)
			if _, err = tx.Exec(ctx, `INSERT INTO acc_bills (id,bill_no,bill_type,position_type,currency,face_amount_minor,issue_date,maturity_date,state,source_document_id)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'AVAILABLE',$9)`, line.BillID, line.BillNo, line.BillType, line.PositionType,
				line.Currency, amount, issueDate, maturityDate, event.DocumentID); err != nil {
				return databaseError("create global bill", err)
			}
			for _, book := range books {
				if _, err = tx.Exec(ctx, `INSERT INTO acc_bill_book_values (book_id,bill_id,value_minor) VALUES ($1,$2,$3)`, book.ID, line.BillID, amount); err != nil {
					return databaseError("create bill book value", err)
				}
			}
			continue
		}
		result, err := tx.Exec(ctx, `UPDATE acc_bills SET state='SETTLED',settled_by_document_id=$1 WHERE id=$2 AND state='AVAILABLE'`, event.DocumentID, line.BillID)
		if err != nil {
			return databaseError("settle global bill", err)
		}
		if result.RowsAffected() != 1 {
			return domainError(ErrorConflict, "source bill is not available", nil)
		}
	}
	return nil
}

func registerContainerChange(ctx context.Context, tx pgx.Tx, event voudomain.DocumentApprovedEvent) error {
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
		if _, err := tx.Exec(ctx, `INSERT INTO acc_container_entries (id,customer_id,container_type,quantity_delta,source_document_id,source_revision)
			VALUES ($1,$2,$3,$4,$5,$6)`, ulid.Make().String(), event.Snapshot.Data.Customer.ObjectID, containerType, delta, event.DocumentID, event.Revision); err != nil {
			return databaseError("create container entry", err)
		}
	}
	return nil
}

func (s *Service) reverseGlobalRegisters(ctx context.Context, tx pgx.Tx, event voudomain.DocumentUnapprovedEvent) error {
	result, err := tx.Exec(ctx, `DELETE FROM acc_register_events WHERE source_entity=$1 AND source_document_id=$2 AND source_revision=$3`, event.Entity, event.DocumentID, event.Snapshot.Revision)
	if err != nil {
		return databaseError("delete global accounting event", err)
	}
	if result.RowsAffected() == 0 {
		return nil
	}
	switch event.Entity {
	case voudomain.EntityAssetAcquisition:
		_, err = tx.Exec(ctx, `DELETE FROM acc_assets WHERE source_document_id=$1 AND state='ACTIVE'`, event.DocumentID)
	case voudomain.EntityAssetSale, voudomain.EntityAssetLiquidation:
		_, err = tx.Exec(ctx, `UPDATE acc_assets SET state='ACTIVE',disposed_by_document_id=NULL,disposed_on=NULL WHERE disposed_by_document_id=$1`, event.DocumentID)
	case voudomain.EntityBillReceipt, voudomain.EntityBillIssue:
		_, err = tx.Exec(ctx, `DELETE FROM acc_bills WHERE source_document_id=$1 AND state='AVAILABLE'`, event.DocumentID)
	case voudomain.EntityBillPayment, voudomain.EntityBillDiscount, voudomain.EntityBillMaturity:
		_, err = tx.Exec(ctx, `UPDATE acc_bills SET state='AVAILABLE',settled_by_document_id=NULL WHERE settled_by_document_id=$1`, event.DocumentID)
	case voudomain.EntitySaleSignoff:
		_, err = tx.Exec(ctx, `DELETE FROM acc_container_entries WHERE source_document_id=$1 AND source_revision=$2`, event.DocumentID, event.Snapshot.Revision)
	}
	if err != nil {
		return databaseError("reverse global accounting register", err)
	}
	return nil
}
