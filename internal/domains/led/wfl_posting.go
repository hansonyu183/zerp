package led

import (
	"context"
	"fmt"
	"time"

	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

func (s *Service) HandleManagedDocument(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(voudomain.ManagedDocumentEvent)
	if !ok {
		return fmt.Errorf("unexpected WFL document event %T", raw)
	}
	var status string
	var generationID *string
	var cutover *time.Time
	if err := tx.QueryRow(ctx, `SELECT status,active_generation_id,cutover_date
		FROM led_control WHERE singleton FOR UPDATE`).Scan(&status, &generationID, &cutover); err != nil {
		return err
	}
	if status != StatusActive || generationID == nil || cutover == nil {
		return txevent.Reject("ledger is not active", map[string]any{"status": status})
	}
	if event.Action == "FINALIZED" {
		return eventFailure(s.postManagedDocument(ctx, tx, *generationID, *cutover, event, true))
	}
	return eventFailure(s.reverseManagedDocument(ctx, tx, *generationID, event))
}

func (s *Service) postManagedDocument(ctx context.Context, tx pgx.Tx, generationID string,
	cutover time.Time, event voudomain.ManagedDocumentEvent, live bool) error {
	var date time.Time
	var currency string
	if err := tx.QueryRow(ctx, `SELECT business_date,currency FROM vou_documents WHERE id=$1`,
		event.DocumentID).Scan(&date, &currency); err != nil {
		return err
	}
	if date.Before(cutover) {
		if live {
			return domainError(ErrorConflict, "document effect predates ledger cutover",
				map[string]any{"documentNo": event.DocumentNo}, nil)
		}
		return nil
	}
	occurredAt := time.Now().UTC()
	if event.Entity == voudomain.EntityGoodsReceipt {
		rows, err := tx.Query(ctx, `SELECT l.id,l.line_amount_cents,d.supplier_object_id,
			d.supplier_version_id,d.supplier_code,d.supplier_name
			FROM vou_goods_receipt_lines l JOIN vou_goods_receipt_details d ON d.document_id=l.document_id
			WHERE l.document_id=$1 AND l.quantity_micros>0`, event.DocumentID)
		if err != nil {
			return err
		}
		type posting struct {
			lineID, objectID, versionID, code, name string
			amount                                  int64
		}
		postings := []posting{}
		for rows.Next() {
			var item posting
			if err = rows.Scan(&item.lineID, &item.amount, &item.objectID, &item.versionID,
				&item.code, &item.name); err != nil {
				rows.Close()
				return err
			}
			postings = append(postings, item)
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, item := range postings {
			if _, err = tx.Exec(ctx, `INSERT INTO led_party_entries(
				id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
				source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
				counterparty_entity,counterparty_object_id,counterparty_version_id,counterparty_code,
				counterparty_name,currency,amount_delta_cents)
				VALUES($1,$2,'POSTING',$3,$4,$5,$6,$7,$8,$9,$10,$11,'supplier',$12,$13,$14,$15,$16,$17)
				ON CONFLICT DO NOTHING`, newID(), generationID, event.Entity, event.DocumentID,
				event.DocumentNo, item.lineID, event.Revision, date, occurredAt, event.ActorID, event.RequestID,
				item.objectID, item.versionID, item.code, item.name, currency, -item.amount); err != nil {
				return err
			}
		}
		return nil
	}
	if event.Entity != voudomain.EntitySignoffNote {
		return fmt.Errorf("unsupported WFL ledger entity %s", event.Entity)
	}
	rows, err := tx.Query(ctx, `SELECT l.id,l.line_amount_cents,d.customer_object_id,
		d.customer_version_id,d.customer_code,d.customer_name
		FROM vou_signoff_note_lines l JOIN vou_signoff_note_details d ON d.document_id=l.document_id
		WHERE l.document_id=$1 AND l.signed_qty_micros>0`, event.DocumentID)
	if err != nil {
		return err
	}
	type posting struct {
		lineID, objectID, versionID, code, name string
		amount                                  int64
	}
	postings := []posting{}
	for rows.Next() {
		var item posting
		if err = rows.Scan(&item.lineID, &item.amount, &item.objectID, &item.versionID,
			&item.code, &item.name); err != nil {
			rows.Close()
			return err
		}
		postings = append(postings, item)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, item := range postings {
		if _, err = tx.Exec(ctx, `INSERT INTO led_party_entries(
			id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
			source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
			counterparty_entity,counterparty_object_id,counterparty_version_id,counterparty_code,
			counterparty_name,currency,amount_delta_cents)
			VALUES($1,$2,'POSTING',$3,$4,$5,$6,$7,$8,$9,$10,$11,'customer',$12,$13,$14,$15,$16,$17)
			ON CONFLICT DO NOTHING`, newID(), generationID, event.Entity, event.DocumentID,
			event.DocumentNo, item.lineID, event.Revision, date, occurredAt, event.ActorID, event.RequestID,
			item.objectID, item.versionID, item.code, item.name, currency, item.amount); err != nil {
			return err
		}
	}
	var expectedSolvent, expectedResin, returnedSolvent, returnedResin int64
	var customerID, customerVersion, customerCode, customerName, rootID, rootNo string
	err = tx.QueryRow(ctx, `SELECT x.expected_solvent_containers,x.expected_resin_containers,
		s.returned_solvent_containers,s.returned_resin_containers,s.customer_object_id,
		s.customer_version_id,s.customer_code,s.customer_name,p.root_document_id,r.document_no
		FROM vou_signoff_note_details s JOIN vou_documents d ON d.id=s.document_id
		JOIN vou_delivery_note_details x ON x.document_id=d.parent_document_id
		JOIN wfl_process_documents l ON l.document_id=d.id
		JOIN wfl_process_instances p ON p.id=l.process_id
		JOIN vou_documents r ON r.id=p.root_document_id WHERE s.document_id=$1`, event.DocumentID).
		Scan(&expectedSolvent, &expectedResin, &returnedSolvent, &returnedResin, &customerID,
			&customerVersion, &customerCode, &customerName, &rootID, &rootNo)
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
		if _, err = tx.Exec(ctx, `INSERT INTO led_container_entries(
			id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
			source_revision,root_document_id,root_document_no,effective_date,occurred_at,actor_id,
			request_id,customer_object_id,customer_version_id,customer_code,customer_name,
			container_type,quantity_delta)
			VALUES($1,$2,'POSTING',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
			ON CONFLICT DO NOTHING`, newID(), generationID, event.Entity, event.DocumentID,
			event.DocumentNo, event.Revision, rootID, rootNo, date, occurredAt, event.ActorID,
			event.RequestID, customerID, customerVersion, customerCode, customerName,
			container.kind, container.delta); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reverseManagedDocument(ctx context.Context, tx pgx.Tx, generationID string,
	event voudomain.ManagedDocumentEvent) error {
	var partyRevision, containerRevision int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(max(source_revision),0) FROM led_party_entries
		WHERE generation_id=$1 AND source_document_id=$2 AND entry_type='POSTING'`,
		generationID, event.DocumentID).Scan(&partyRevision); err != nil {
		return err
	}
	if err := tx.QueryRow(ctx, `SELECT COALESCE(max(source_revision),0) FROM led_container_entries
		WHERE generation_id=$1 AND source_document_id=$2 AND entry_type='POSTING'`,
		generationID, event.DocumentID).Scan(&containerRevision); err != nil {
		return err
	}
	if partyRevision == 0 && containerRevision == 0 {
		return txevent.Reject("document predates the active ledger cutover", nil)
	}
	occurredAt := time.Now().UTC()
	if partyRevision != 0 {
		if _, err := tx.Exec(ctx, `INSERT INTO led_party_entries(
			id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
			source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,reason,
			counterparty_entity,counterparty_object_id,counterparty_version_id,counterparty_code,
			counterparty_name,currency,amount_delta_cents)
			SELECT substring(md5(random()::text||e.id),1,26),e.generation_id,'REVERSAL',
			e.source_entity,e.source_document_id,e.source_document_no,e.source_line_id,$3,e.effective_date,
			$4,$5,$6,$7,e.counterparty_entity,e.counterparty_object_id,e.counterparty_version_id,
			e.counterparty_code,e.counterparty_name,e.currency,-e.amount_delta_cents
			FROM led_party_entries e WHERE e.generation_id=$1 AND e.source_document_id=$2
			AND e.entry_type='POSTING' AND e.source_revision=$8 ON CONFLICT DO NOTHING`,
			generationID, event.DocumentID, event.Revision, occurredAt, event.ActorID,
			event.RequestID, event.Reason, partyRevision); err != nil {
			return err
		}
	}
	if containerRevision != 0 {
		_, err := tx.Exec(ctx, `INSERT INTO led_container_entries(
			id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
			source_line_id,source_revision,root_document_id,root_document_no,effective_date,
			occurred_at,actor_id,request_id,reason,customer_object_id,customer_version_id,
			customer_code,customer_name,container_type,quantity_delta)
			SELECT substring(md5(random()::text||e.id),1,26),e.generation_id,'REVERSAL',
			e.source_entity,e.source_document_id,e.source_document_no,e.source_line_id,$3,
			e.root_document_id,e.root_document_no,e.effective_date,$4,$5,$6,$7,e.customer_object_id,
			e.customer_version_id,e.customer_code,e.customer_name,e.container_type,-e.quantity_delta
			FROM led_container_entries e WHERE e.generation_id=$1 AND e.source_document_id=$2
			AND e.entry_type='POSTING' AND e.source_revision=$8 ON CONFLICT DO NOTHING`,
			generationID, event.DocumentID, event.Revision, occurredAt, event.ActorID,
			event.RequestID, event.Reason, containerRevision)
		return err
	}
	return nil
}
