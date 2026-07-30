package wfl

import (
	"context"
	"errors"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

func (s *Service) registerDocumentSubscriptions(bus *txevent.Bus) error {
	for _, entity := range []string{voudomain.EntitySaleOrder, voudomain.EntityPurchaseOrder} {
		if err := bus.Subscribe(
			voudomain.DocumentCreatedTopic(entity),
			"wfl-process-composition",
			s.handleRootDocumentCreated,
		); err != nil {
			return err
		}
	}
	if err := bus.Subscribe(
		voudomain.DocumentCreatedTopic(voudomain.EntityOrderProduction),
		"wfl-production-composition",
		s.handleOrderProductionCreated,
	); err != nil {
		return err
	}
	for _, entity := range []string{
		voudomain.EntitySaleOrder, voudomain.EntitySaleOutbound,
		voudomain.EntitySaleDelivery, voudomain.EntitySaleSignoff,
		voudomain.EntitySaleReturn,
		voudomain.EntityPurchaseOrder, voudomain.EntityPurchaseInbound,
		voudomain.EntityOrderProduction,
		voudomain.EntityReceipt, voudomain.EntityPayment,
		voudomain.EntityExpenseReimbursement, voudomain.EntityOtherIncome,
	} {
		if err := bus.Subscribe(
			voudomain.DocumentDeletedTopic(entity),
			"wfl-process-composition",
			s.handleDocumentDeleted,
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) handleOrderProductionCreated(
	ctx context.Context,
	tx pgx.Tx,
	raw txevent.Event,
) error {
	event, ok := raw.(voudomain.DocumentCreatedEvent)
	if !ok || event.Entity != voudomain.EntityOrderProduction ||
		event.ParentEntity != voudomain.EntitySaleOrder {
		return txevent.Reject("invalid order production created event", nil)
	}
	var processID string
	err := tx.QueryRow(ctx, `SELECT process_id FROM wfl_process_documents
		WHERE document_id=$1 AND stage=$2`,
		event.ParentDocumentID, StageSaleOrder).Scan(&processID)
	if errors.Is(err, pgx.ErrNoRows) {
		return txevent.Reject("production source has no sales workflow", nil)
	}
	if err != nil {
		return err
	}
	var sequence int32
	if err = tx.QueryRow(ctx, `SELECT COALESCE(max(sequence_no),0)+1
		FROM wfl_process_documents WHERE process_id=$1 AND stage=$2`,
		processID, StageProduction).Scan(&sequence); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO wfl_process_documents(
		process_id,document_id,stage,sequence_no
	) VALUES($1,$2,$3,$4)`,
		processID, event.DocumentID, StageProduction, sequence); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO wfl_audit_events(
		id,process_id,event_type,to_status,stage,document_id,document_no,
		document_status,actor_id,request_id,summary
	) SELECT $1::varchar,$2::varchar,'PRODUCTION_LINKED',status,$3::varchar,
	         $4::varchar,$5::varchar,'DRAFT',$6::varchar,$7::varchar,'{}'
	  FROM wfl_process_instances WHERE id=$2::varchar`,
		newID(), processID, StageProduction, event.DocumentID, event.DocumentNo,
		event.ActorID, event.RequestID)
	return err
}

func (s *Service) handleRootDocumentCreated(
	ctx context.Context,
	tx pgx.Tx,
	raw txevent.Event,
) error {
	event, ok := raw.(voudomain.DocumentCreatedEvent)
	if !ok {
		return txevent.Reject("invalid document created event", nil)
	}
	processType, stage := ProcessTypeSales, StageSaleOrder
	if event.Entity == voudomain.EntityPurchaseOrder {
		processType, stage = ProcessTypePurchase, StagePurchaseOrder
	}
	var existing string
	err := tx.QueryRow(ctx, `SELECT id FROM wfl_process_instances
		WHERE root_document_id=$1`, event.DocumentID).Scan(&existing)
	if err == nil {
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO wfl_process_instances(
		id,process_type,definition_version,root_document_id,status,revision,
		created_by,updated_by
	) VALUES($1,$2,1,$1,'DRAFT',1,$3,$3)`,
		event.DocumentID, processType, event.ActorID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO wfl_process_documents(
		process_id,document_id,stage,sequence_no
	) VALUES($1,$1,$2,1)`, event.DocumentID, stage); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO wfl_audit_events(
		id,process_id,event_type,to_status,stage,document_id,document_no,
		document_status,actor_id,request_id,summary
	) VALUES($1,$2,'CREATED','DRAFT',$3,$2,$4,'DRAFT',$5,$6,'{}')`,
		newID(), event.DocumentID, stage, event.DocumentNo, event.ActorID, event.RequestID)
	return err
}

func (s *Service) handleDocumentDeleted(
	ctx context.Context,
	tx pgx.Tx,
	raw txevent.Event,
) error {
	event, ok := raw.(voudomain.DocumentDeletedEvent)
	if !ok {
		return txevent.Reject("invalid document deleted event", nil)
	}
	var processID string
	err := tx.QueryRow(ctx, `SELECT process_id FROM wfl_process_documents
		WHERE document_id=$1`, event.DocumentID).Scan(&processID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if processID == event.DocumentID {
		if _, err = tx.Exec(ctx, `DELETE FROM wfl_audit_events WHERE process_id=$1`, processID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM wfl_process_documents WHERE process_id=$1`, processID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM wfl_process_instances WHERE id=$1`, processID)
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM wfl_process_documents WHERE document_id=$1`, event.DocumentID)
	return err
}
