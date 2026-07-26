package wfl

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

func checkDocument(ctx context.Context, tx pgx.Tx, document *documentRow, actorID string) error {
	if document.status != "DRAFT" {
		return conflict("only draft document can be checked", nil)
	}
	if err := countPendingAttachments(ctx, tx, document.id); err != nil {
		return err
	}
	err := tx.QueryRow(ctx, `UPDATE vou_documents SET status='REVIEWED',reviewed_at=now(),reviewed_by=$1,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, document.id, document.revision).Scan(&document.revision)
	if err == nil {
		document.status = "REVIEWED"
		document.reviewedBy = &actorID
	}
	return err
}

func uncheckDocument(ctx context.Context, tx pgx.Tx, document *documentRow, reasonValue, actorID string) error {
	if document.status != "REVIEWED" {
		return conflict("only checked document can be unchecked", nil)
	}
	if _, err := requiredReason(reasonValue); err != nil {
		return err
	}
	err := tx.QueryRow(ctx, `UPDATE vou_documents SET status='DRAFT',reviewed_at=NULL,reviewed_by=NULL,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, document.id, document.revision).Scan(&document.revision)
	if err == nil {
		document.status = "DRAFT"
		document.reviewedBy = nil
	}
	return err
}

func (s *Service) finalizeDocument(ctx context.Context, tx pgx.Tx, process processRow, stage string, document *documentRow, action, actorID, requestID string) error {
	expected := map[string]string{StageProcurement: "place", StageReceipt: "confirm", StageDelivery: "execute", StageSignoff: "confirm"}[stage]
	if action != expected || document.status != "REVIEWED" || document.reviewedBy == nil {
		return conflict("document must be checked first", nil)
	}
	if *document.reviewedBy == actorID {
		return conflict("final actor must differ from checker", nil)
	}
	if err := s.validateFinal(ctx, tx, process, stage, *document); err != nil {
		return err
	}
	err := tx.QueryRow(ctx, `UPDATE vou_documents SET status='APPROVED',approved_at=now(),approved_by=$1,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, document.id, document.revision).Scan(&document.revision)
	if err != nil {
		return err
	}
	document.status = "APPROVED"
	if stage == StageReceipt || stage == StageSignoff {
		err = s.events.Publish(ctx, tx, voudomain.ManagedDocumentEvent{Action: "FINALIZED", Entity: document.entity,
			DocumentID: document.id, DocumentNo: document.number, Revision: document.revision, ActorID: actorID, RequestID: requestID})
	}
	return err
}

func (s *Service) reverseDocument(ctx context.Context, tx pgx.Tx, process processRow, stage string, document *documentRow, action, reasonValue, actorID, requestID string) error {
	expected := map[string]string{StageProcurement: "unplace", StageReceipt: "unconfirm", StageDelivery: "unexecute", StageSignoff: "unconfirm"}[stage]
	if action != expected || document.status != "APPROVED" {
		return conflict("document is not in final state", nil)
	}
	reason, err := requiredReason(reasonValue)
	if err != nil {
		return err
	}
	if process.status == StatusShortRequested || process.status == StatusShortClosed {
		return conflict("short close must be cancelled first", nil)
	}
	if err = s.validateReverse(ctx, tx, process, stage, *document); err != nil {
		return err
	}
	err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='REVIEWED',approved_at=NULL,approved_by=NULL,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, document.id, document.revision).Scan(&document.revision)
	if err != nil {
		return err
	}
	document.status = "REVIEWED"
	if stage == StageReceipt || stage == StageSignoff {
		err = s.events.Publish(ctx, tx, voudomain.ManagedDocumentEvent{Action: "REVERSED", Entity: document.entity,
			DocumentID: document.id, DocumentNo: document.number, Revision: document.revision, ActorID: actorID,
			RequestID: requestID, Reason: *reason})
	}
	return err
}

func (s *Service) deleteStage(ctx context.Context, tx pgx.Tx, process processRow, stage string, document documentRow, reasonValue, actorID, requestID string) error {
	if document.status != "DRAFT" {
		return conflict("only draft document can be deleted", nil)
	}
	if _, err := requiredReason(reasonValue); err != nil {
		return err
	}
	var attachments, children int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_document_attachments WHERE document_id=$1`, document.id).Scan(&attachments); err != nil {
		return err
	}
	if attachments != 0 {
		return conflict("attachments must be removed first", nil)
	}
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents WHERE parent_document_id=$1`, document.id).Scan(&children); err != nil {
		return err
	}
	if children != 0 {
		return conflict("downstream documents block deletion", nil)
	}
	if err := insertWFLAudit(ctx, tx, process.id, stage+"_DELETED", nil, process.status, stage, document.id,
		document.number, "DRAFT", actorID, requestID, optional(reasonValue), map[string]any{"physicalDelete": true}); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM vou_audit_events WHERE document_id=$1`, document.id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM vou_documents WHERE id=$1 AND status='DRAFT'`, document.id)
	return err
}

func (s *Service) validateFinal(ctx context.Context, tx pgx.Tx, process processRow, stage string, document documentRow) error {
	switch stage {
	case StageReceipt:
		var invalid int64
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_goods_receipt_lines r JOIN vou_procurement_order_lines p
			ON p.id=r.source_procurement_line_id WHERE r.document_id=$1 AND
			r.quantity_micros + COALESCE((SELECT sum(r2.quantity_micros) FROM vou_goods_receipt_lines r2
			JOIN vou_documents d2 ON d2.id=r2.document_id WHERE r2.source_procurement_line_id=p.id
			AND d2.status='APPROVED'),0) > p.quantity_micros`, document.id).Scan(&invalid)
		if err != nil {
			return err
		}
		if invalid != 0 {
			return conflict("confirmed receipts exceed procurement", nil)
		}
	case StageDelivery:
		var invalid int64
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_delivery_note_lines dl JOIN vou_documents d ON d.id=dl.document_id
			WHERE dl.document_id=$1 AND dl.quantity_micros >
			COALESCE((SELECT sum(r.quantity_micros) FROM vou_goods_receipt_lines r JOIN vou_documents rd ON rd.id=r.document_id
				WHERE r.source_customer_line_id=dl.source_customer_line_id AND rd.status='APPROVED' AND rd.business_date<=d.business_date),0)
			- COALESCE((SELECT sum(x.quantity_micros) FROM vou_delivery_note_lines x JOIN vou_documents xd ON xd.id=x.document_id
				WHERE x.source_customer_line_id=dl.source_customer_line_id AND xd.status='APPROVED' AND xd.business_date<=d.business_date),0)
			+ COALESCE((SELECT sum(s.rejected_qty_micros) FROM vou_signoff_note_lines s JOIN vou_documents sd ON sd.id=s.document_id
				WHERE s.source_customer_line_id=dl.source_customer_line_id AND sd.status='APPROVED' AND sd.business_date<=d.business_date),0)`,
			document.id).Scan(&invalid)
		if err != nil {
			return err
		}
		if invalid != 0 {
			return conflict("delivery exceeds date-aware available quantity", nil)
		}
	case StageSignoff:
		var invalid int64
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_signoff_note_lines s JOIN vou_customer_order_lines c
			ON c.id=s.source_customer_line_id WHERE s.document_id=$1 AND s.signed_qty_micros+
			COALESCE((SELECT sum(s2.signed_qty_micros) FROM vou_signoff_note_lines s2 JOIN vou_documents d2 ON d2.id=s2.document_id
				WHERE s2.source_customer_line_id=c.id AND d2.status='APPROVED'),0)>c.ordered_qty_micros`, document.id).Scan(&invalid)
		if err != nil {
			return err
		}
		if invalid != 0 {
			return conflict("signed quantity exceeds customer order", nil)
		}
	}
	return nil
}

func (s *Service) validateReverse(ctx context.Context, tx pgx.Tx, process processRow, stage string, document documentRow) error {
	var count int64
	switch stage {
	case StageProcurement:
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents WHERE parent_document_id=$1`, document.id).Scan(&count)
		if err != nil {
			return err
		}
		if count != 0 {
			return conflict("receipt documents block procurement reversal", nil)
		}
	case StageDelivery:
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents WHERE parent_document_id=$1`, document.id).Scan(&count)
		if err != nil {
			return err
		}
		if count != 0 {
			return conflict("signoff documents block delivery reversal", nil)
		}
	case StageReceipt:
		var invalid int64
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_customer_order_lines c WHERE c.document_id=$1 AND
			COALESCE((SELECT sum(r.quantity_micros) FROM vou_goods_receipt_lines r JOIN vou_documents rd ON rd.id=r.document_id
				JOIN wfl_process_documents rl ON rl.document_id=rd.id WHERE rl.process_id=$2 AND r.source_customer_line_id=c.id
				AND rd.status='APPROVED' AND rd.id<>$3),0)
			- COALESCE((SELECT sum(d.quantity_micros) FROM vou_delivery_note_lines d JOIN vou_documents dd ON dd.id=d.document_id
				JOIN wfl_process_documents dl ON dl.document_id=dd.id WHERE dl.process_id=$2 AND d.source_customer_line_id=c.id
				AND dd.status='APPROVED'),0)
			+ COALESCE((SELECT sum(s.rejected_qty_micros) FROM vou_signoff_note_lines s JOIN vou_documents sd ON sd.id=s.document_id
				JOIN wfl_process_documents sl ON sl.document_id=sd.id WHERE sl.process_id=$2 AND s.source_customer_line_id=c.id
				AND sd.status='APPROVED'),0)<0`, process.rootID, process.id, document.id).Scan(&invalid)
		if err != nil {
			return err
		}
		if invalid != 0 {
			return conflict("receipt reversal would make delivery pool negative", nil)
		}
	}
	return nil
}

func countPendingAttachments(ctx context.Context, tx pgx.Tx, documentID string) error {
	var count int64
	err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_document_attachments a JOIN vou_files f ON f.id=a.file_id
		WHERE a.document_id=$1 AND f.status='PENDING'`, documentID).Scan(&count)
	if err != nil {
		return err
	}
	if count != 0 {
		return conflict("attachments are still uploading", nil)
	}
	return nil
}

func updateDocumentStatus(ctx context.Context, tx pgx.Tx, document documentRow, status, actorID string) (int64, error) {
	var revision int64
	var err error
	switch {
	case document.status == "DRAFT" && status == "REVIEWED":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='REVIEWED',reviewed_at=now(),reviewed_by=$1,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`, actorID, document.id, document.revision).Scan(&revision)
	case document.status == "REVIEWED" && status == "DRAFT":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='DRAFT',reviewed_at=NULL,reviewed_by=NULL,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`, actorID, document.id, document.revision).Scan(&revision)
	case document.status == "REVIEWED" && status == "APPROVED":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='APPROVED',approved_at=now(),approved_by=$1,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`, actorID, document.id, document.revision).Scan(&revision)
	case document.status == "APPROVED" && status == "REVIEWED":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='REVIEWED',approved_at=NULL,approved_by=NULL,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`, actorID, document.id, document.revision).Scan(&revision)
	}
	return revision, err
}

func updateProcessStatus(ctx context.Context, tx pgx.Tx, process processRow, status, actorID string) (int64, error) {
	var revision int64
	err := tx.QueryRow(ctx, `UPDATE wfl_process_instances SET status=$1::varchar,revision=revision+1,
		completed_at=CASE WHEN $1::varchar IN ('COMPLETED','SHORT_CLOSED') THEN now() ELSE NULL END,
		updated_at=now(),updated_by=$2 WHERE id=$3 AND revision=$4 RETURNING revision`,
		status, actorID, process.id, process.revision).Scan(&revision)
	return revision, err
}

func validateShortClose(ctx context.Context, tx pgx.Tx, processID string) error {
	var unfinished int64
	err := tx.QueryRow(ctx, `SELECT count(*) FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		WHERE l.process_id=$1 AND l.stage<>'CUSTOMER_ORDER' AND d.status IN ('DRAFT','REVIEWED')`, processID).Scan(&unfinished)
	if err != nil {
		return err
	}
	if unfinished != 0 {
		return conflict("unfinished documents block short close", nil)
	}
	var unsignedDelivery int64
	err = tx.QueryRow(ctx, `SELECT count(*) FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		WHERE l.process_id=$1 AND l.stage='DELIVERY' AND d.status='APPROVED'
		AND NOT EXISTS(SELECT 1 FROM vou_documents s WHERE s.parent_document_id=d.id AND s.entity='signoff-note' AND s.status='APPROVED')`, processID).Scan(&unsignedDelivery)
	if err != nil {
		return err
	}
	if unsignedDelivery != 0 {
		return conflict("unsigned deliveries block short close", nil)
	}
	return nil
}

func maybeComplete(ctx context.Context, tx pgx.Tx, process processRow, actorID string) (string, bool, error) {
	if process.status == StatusShortRequested || process.status == StatusShortClosed {
		return process.status, false, nil
	}
	var incomplete, unfinished, unsigned int64
	err := tx.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM vou_customer_order_lines c WHERE c.document_id=$1 AND
		 COALESCE((SELECT sum(s.signed_qty_micros) FROM vou_signoff_note_lines s JOIN vou_documents d ON d.id=s.document_id
		 WHERE s.source_customer_line_id=c.id AND d.status='APPROVED'),0)<>c.ordered_qty_micros),
		(SELECT count(*) FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		 WHERE l.process_id=$2 AND l.stage<>'CUSTOMER_ORDER' AND d.status IN ('DRAFT','REVIEWED')),
		(SELECT count(*) FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		 WHERE l.process_id=$2 AND l.stage='DELIVERY' AND d.status='APPROVED'
		 AND NOT EXISTS(SELECT 1 FROM vou_documents s WHERE s.parent_document_id=d.id
		 AND s.entity='signoff-note' AND s.status='APPROVED'))`,
		process.rootID, process.id).Scan(&incomplete, &unfinished, &unsigned)
	if err != nil {
		return process.status, false, err
	}
	target := StatusApproved
	if incomplete == 0 && unfinished == 0 && unsigned == 0 {
		target = StatusCompleted
	}
	if target == process.status {
		return target, false, nil
	}
	_, err = tx.Exec(ctx, `UPDATE wfl_process_instances SET status=$1::varchar,revision=revision+1,
		completed_at=CASE WHEN $1::varchar='COMPLETED' THEN now() ELSE NULL END,updated_at=now(),updated_by=$2 WHERE id=$3`,
		target, actorID, process.id)
	return target, true, err
}

func requiredReason(value string) (*string, error) {
	value = strings.TrimSpace(value)
	if len([]rune(value)) < 1 || len([]rune(value)) > 1000 {
		return nil, validation("reason must contain 1 to 1000 characters", nil)
	}
	return &value, nil
}
func decode(raw json.RawMessage, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return validation("invalid stage data", map[string]any{"cause": err.Error()})
	}
	return nil
}
func semanticStatus(stage, status string) string {
	if status == "DRAFT" {
		return "DRAFT"
	}
	if status == "REVIEWED" {
		return "CHECKED"
	}
	if status == "APPROVED" {
		return map[string]string{StageCustomer: "APPROVED", StageProcurement: "ORDERED", StageReceipt: "CONFIRMED", StageDelivery: "EXECUTED", StageSignoff: "CONFIRMED"}[stage]
	}
	return status
}
func stageSequence(ctx context.Context, tx pgx.Tx, processID, stage string) int {
	var next int
	_ = tx.QueryRow(ctx, `SELECT COALESCE(max(sequence_no),0)+1 FROM wfl_process_documents WHERE process_id=$1 AND stage=$2`, processID, stage).Scan(&next)
	return next
}
func linkStage(ctx context.Context, tx pgx.Tx, processID, documentID string, sequence int, stage string) error {
	_, err := tx.Exec(ctx, `INSERT INTO wfl_process_documents(process_id,document_id,stage,sequence_no) VALUES($1,$2,$3,$4)`, processID, documentID, stage, sequence)
	return err
}

var _ = errors.Is
var _ = time.Time{}
