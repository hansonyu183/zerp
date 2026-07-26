package wfl

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

func (s *Service) createStage(ctx context.Context, tx pgx.Tx, process processRow, stage string, raw json.RawMessage, actorID, replacingDocumentID string) (documentRow, error) {
	var result documentRow
	if len(raw) == 0 {
		return result, validation("stage data is required", nil)
	}
	switch stage {
	case StageProcurement:
		var count int64
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM wfl_process_documents WHERE process_id=$1 AND stage='PROCUREMENT'`, process.id).Scan(&count); err != nil {
			return result, err
		}
		if count != 0 {
			return result, conflict("procurement already exists", nil)
		}
		var data ProcurementInput
		if err := decode(raw, &data); err != nil {
			return result, err
		}
		return s.insertProcurement(ctx, tx, process, data, actorID)
	case StageReceipt:
		var data ReceiptInput
		if err := decode(raw, &data); err != nil {
			return result, err
		}
		return s.insertReceipt(ctx, tx, process, data, actorID)
	case StageDelivery:
		var data DeliveryInput
		if err := decode(raw, &data); err != nil {
			return result, err
		}
		return s.insertDelivery(ctx, tx, process, data, actorID)
	case StageSignoff:
		var data SignoffInput
		if err := decode(raw, &data); err != nil {
			return result, err
		}
		return s.insertSignoff(ctx, tx, process, data, actorID, replacingDocumentID)
	default:
		return result, validation("invalid stage", nil)
	}
}
