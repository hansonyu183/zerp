package led

import (
	"context"
	"errors"
	"fmt"
	"time"

	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

func (s *Service) HandleIntermediaryStage(
	ctx context.Context, tx pgx.Tx, raw txevent.Event,
) error {
	event, ok := raw.(voudomain.IntermediaryStageEvent)
	if !ok {
		return fmt.Errorf("unexpected intermediary stage event %T", raw)
	}
	var status string
	var generationID *string
	var cutover *time.Time
	err := tx.QueryRow(ctx, `SELECT status,active_generation_id,cutover_date
		FROM led_control WHERE singleton FOR UPDATE`).Scan(&status, &generationID, &cutover)
	if err != nil {
		return err
	}
	if status != StatusActive || generationID == nil || cutover == nil {
		return txevent.Reject("ledger is not active", map[string]any{"status": status})
	}
	if event.Action == "CONFIRMED" {
		return eventFailure(s.postV2Stage(ctx, tx, *generationID, *cutover, event, true))
	}
	return eventFailure(s.reverseV2Stage(ctx, tx, *generationID, event))
}

func (s *Service) postV2Stage(
	ctx context.Context, tx pgx.Tx, generationID string, cutover time.Time,
	event voudomain.IntermediaryStageEvent, live bool,
) error {
	var effectiveDate time.Time
	switch event.Stage {
	case "RECEIPT":
		err := tx.QueryRow(ctx, `SELECT receipt_date FROM vou_intermediary_receipts
			WHERE child_id=$1`, event.ChildID).Scan(&effectiveDate)
		if err != nil {
			return err
		}
	case "SIGNOFF":
		err := tx.QueryRow(ctx, `SELECT signoff_date FROM vou_intermediary_signoffs
			WHERE child_id=$1`, event.ChildID).Scan(&effectiveDate)
		if err != nil {
			return err
		}
	default:
		return errors.New("unsupported intermediary V2 ledger stage")
	}
	if effectiveDate.Before(cutover) {
		if live {
			return domainError(ErrorConflict, "stage effect predates ledger cutover",
				map[string]any{"childNo": event.ChildNo}, nil)
		}
		return nil
	}
	occurredAt := time.Now().UTC()
	if event.Stage == "RECEIPT" {
		rows, err := tx.Query(ctx, `
			SELECT rl.id,rl.quantity_micros,pl.unit_price_cents,
			  p.supplier_object_id,p.supplier_version_id,p.supplier_code,p.supplier_name,
			  d.currency
			FROM vou_intermediary_receipt_lines rl
			JOIN vou_intermediary_procurement_lines pl ON pl.root_line_id=rl.root_line_id
			JOIN vou_intermediary_procurements p ON p.child_id=pl.child_id
			JOIN vou_documents d ON d.id=$2
			WHERE rl.child_id=$1 AND rl.quantity_micros>0`, event.ChildID, event.DocumentID)
		if err != nil {
			return err
		}
		type receiptPosting struct {
			lineID, objectID, versionID, code, name, currency string
			quantity                                          int64
			price                                             *int64
		}
		postings := make([]receiptPosting, 0)
		for rows.Next() {
			var posting receiptPosting
			if err = rows.Scan(&posting.lineID, &posting.quantity, &posting.price,
				&posting.objectID, &posting.versionID, &posting.code, &posting.name,
				&posting.currency); err != nil {
				rows.Close()
				return err
			}
			postings = append(postings, posting)
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, posting := range postings {
			if posting.price == nil {
				return domainError(ErrorConflict, "receipt is missing purchase price", nil, nil)
			}
			amount, amountErr := lineAmountCents(posting.quantity, *posting.price)
			if amountErr != nil {
				return amountErr
			}
			if _, err = tx.Exec(ctx, `
				INSERT INTO led_party_entries(
				  id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
				  source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
				  counterparty_entity,counterparty_object_id,counterparty_version_id,
				  counterparty_code,counterparty_name,currency,amount_delta_cents
				) VALUES($1,$2,'POSTING','intermediary-receipt',$3,$4,$5,$6,$7,$8,$9,$10,
				  'supplier',$11,$12,$13,$14,$15,$16)
				ON CONFLICT DO NOTHING`,
				newID(), generationID, event.ChildID, event.ChildNo, posting.lineID,
				event.ChildRevision, effectiveDate, occurredAt, event.ActorID, event.RequestID,
				posting.objectID, posting.versionID, posting.code, posting.name, posting.currency,
				-amount); err != nil {
				return err
			}
		}
		return nil
	}

	rows, err := tx.Query(ctx, `
		SELECT sl.id,sl.signed_qty_micros,l.sale_unit_price_cents,
		  r.customer_object_id,r.customer_version_id,r.customer_code,r.customer_name,d.currency
		FROM vou_intermediary_signoff_lines sl
		JOIN vou_intermediary_v2_lines l ON l.id=sl.root_line_id
		JOIN vou_intermediary_v2_details r ON r.document_id=l.document_id
		JOIN vou_documents d ON d.id=r.document_id
		WHERE sl.child_id=$1 AND sl.signed_qty_micros>0`, event.ChildID)
	if err != nil {
		return err
	}
	type signoffPosting struct {
		lineID, objectID, versionID, code, name, currency string
		quantity, price                                   int64
	}
	postings := make([]signoffPosting, 0)
	for rows.Next() {
		var posting signoffPosting
		if err = rows.Scan(&posting.lineID, &posting.quantity, &posting.price,
			&posting.objectID, &posting.versionID, &posting.code, &posting.name,
			&posting.currency); err != nil {
			rows.Close()
			return err
		}
		postings = append(postings, posting)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, posting := range postings {
		amount, amountErr := lineAmountCents(posting.quantity, posting.price)
		if amountErr != nil {
			return amountErr
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO led_party_entries(
			  id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
			  source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
			  counterparty_entity,counterparty_object_id,counterparty_version_id,
			  counterparty_code,counterparty_name,currency,amount_delta_cents
			) VALUES($1,$2,'POSTING','intermediary-signoff',$3,$4,$5,$6,$7,$8,$9,$10,
			  'customer',$11,$12,$13,$14,$15,$16)
			ON CONFLICT DO NOTHING`,
			newID(), generationID, event.ChildID, event.ChildNo, posting.lineID,
			event.ChildRevision, effectiveDate, occurredAt, event.ActorID, event.RequestID,
			posting.objectID, posting.versionID, posting.code, posting.name, posting.currency,
			amount); err != nil {
			return err
		}
	}
	var expectedSolvent, expectedResin, returnedSolvent, returnedResin int64
	var customerID, customerVersionID, customerCode, customerName string
	err = tx.QueryRow(ctx, `
		SELECT del.expected_solvent_containers,del.expected_resin_containers,
		  s.returned_solvent_containers,s.returned_resin_containers,
		  r.customer_object_id,r.customer_version_id,r.customer_code,r.customer_name
		FROM vou_intermediary_signoffs s
		JOIN vou_intermediary_deliveries del ON del.child_id=s.delivery_child_id
		JOIN vou_intermediary_children c ON c.id=s.child_id
		JOIN vou_intermediary_v2_details r ON r.document_id=c.document_id
		WHERE s.child_id=$1`, event.ChildID).Scan(&expectedSolvent, &expectedResin,
		&returnedSolvent, &returnedResin, &customerID, &customerVersionID, &customerCode, &customerName)
	if err != nil {
		return err
	}
	for _, container := range []struct {
		kind  string
		delta int64
	}{{"SOLVENT", expectedSolvent - returnedSolvent}, {"RESIN", expectedResin - returnedResin}} {
		if container.delta == 0 {
			continue
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO led_container_entries(
			  id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
			  source_revision,root_document_id,root_document_no,effective_date,occurred_at,
			  actor_id,request_id,customer_object_id,customer_version_id,customer_code,
			  customer_name,container_type,quantity_delta
			) VALUES($1,$2,'POSTING','intermediary-signoff',$3,$4,$5,$6,$7,$8,$9,$10,$11,
			  $12,$13,$14,$15,$16,$17) ON CONFLICT DO NOTHING`,
			newID(), generationID, event.ChildID, event.ChildNo, event.ChildRevision,
			event.DocumentID, event.DocumentNo, effectiveDate, occurredAt, event.ActorID,
			event.RequestID, customerID, customerVersionID, customerCode, customerName,
			container.kind, container.delta); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reverseV2Stage(
	ctx context.Context, tx pgx.Tx, generationID string, event voudomain.IntermediaryStageEvent,
) error {
	var maxRevision int64
	err := tx.QueryRow(ctx, `SELECT COALESCE(max(source_revision),0) FROM led_party_entries
		WHERE generation_id=$1 AND source_document_id=$2 AND entry_type='POSTING'`,
		generationID, event.ChildID).Scan(&maxRevision)
	if err != nil {
		return err
	}
	occurredAt := time.Now().UTC()
	if maxRevision != 0 {
		_, err = tx.Exec(ctx, `
		INSERT INTO led_party_entries(
		  id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
		  source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,reason,
		  counterparty_entity,counterparty_object_id,counterparty_version_id,counterparty_code,
		  counterparty_name,currency,amount_delta_cents
		)
		SELECT substring(md5(random()::text||e.id),1,26),e.generation_id,'REVERSAL',
		  e.source_entity,e.source_document_id,e.source_document_no,e.source_line_id,$3,
		  e.effective_date,$4,$5,$6,$7,e.counterparty_entity,e.counterparty_object_id,
		  e.counterparty_version_id,e.counterparty_code,e.counterparty_name,e.currency,
		  -e.amount_delta_cents
		FROM led_party_entries e WHERE e.generation_id=$1 AND e.source_document_id=$2
		  AND e.entry_type='POSTING' AND e.source_revision=$8
		ON CONFLICT DO NOTHING`, generationID, event.ChildID, event.ChildRevision, occurredAt,
			event.ActorID, event.RequestID, event.Reason, maxRevision)
		if err != nil {
			return err
		}
	}
	var containerMax int64
	if err = tx.QueryRow(ctx, `SELECT COALESCE(max(source_revision),0) FROM led_container_entries
		WHERE generation_id=$1 AND source_document_id=$2 AND entry_type='POSTING'`,
		generationID, event.ChildID).Scan(&containerMax); err != nil {
		return err
	}
	if containerMax != 0 {
		_, err = tx.Exec(ctx, `
			INSERT INTO led_container_entries(
			  id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
			  source_line_id,source_revision,root_document_id,root_document_no,effective_date,
			  occurred_at,actor_id,request_id,reason,customer_object_id,customer_version_id,
			  customer_code,customer_name,container_type,quantity_delta
			)
			SELECT substring(md5(random()::text||e.id),1,26),e.generation_id,'REVERSAL',
			  e.source_entity,e.source_document_id,e.source_document_no,e.source_line_id,$3,
			  e.root_document_id,e.root_document_no,e.effective_date,$4,$5,$6,$7,
			  e.customer_object_id,e.customer_version_id,e.customer_code,e.customer_name,
			  e.container_type,-e.quantity_delta
			FROM led_container_entries e WHERE e.generation_id=$1 AND e.source_document_id=$2
			  AND e.entry_type='POSTING' AND e.source_revision=$8
			ON CONFLICT DO NOTHING`, generationID, event.ChildID, event.ChildRevision, occurredAt,
			event.ActorID, event.RequestID, event.Reason, containerMax)
	}
	if maxRevision == 0 && containerMax == 0 {
		return txevent.Reject("stage predates the active ledger cutover", nil)
	}
	return err
}
