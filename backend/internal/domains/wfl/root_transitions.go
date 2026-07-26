package wfl

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type rootTransition struct {
	processStatus  string
	documentStatus string
	event          string
	reason         *string
}

func (s *Service) prepareRootTransition(
	ctx context.Context,
	tx pgx.Tx,
	action string,
	reasonValue string,
	actorID string,
	process processRow,
	document documentRow,
) (rootTransition, error) {
	switch action {
	case "check":
		return s.prepareRootCheck(ctx, tx, process, document)
	case "uncheck":
		return prepareRootUncheck(reasonValue, process, document)
	case "approve":
		return prepareRootApprove(actorID, process, document)
	case "unapprove":
		return s.prepareRootUnapprove(ctx, tx, reasonValue, process, document)
	case "short-close-request":
		return s.prepareShortCloseRequest(ctx, tx, reasonValue, process, document)
	case "short-close-cancel":
		return prepareShortCloseCancel(reasonValue, process, document)
	case "short-close-confirm":
		return s.prepareShortCloseConfirm(ctx, tx, actorID, process, document)
	case "short-close-unconfirm":
		return prepareShortCloseUnconfirm(reasonValue, process, document)
	default:
		return rootTransition{}, validation("invalid workflow action", nil)
	}
}

func (s *Service) prepareRootCheck(
	ctx context.Context,
	tx pgx.Tx,
	process processRow,
	document documentRow,
) (rootTransition, error) {
	if process.status != StatusDraft || document.status != "DRAFT" {
		return rootTransition{}, conflict("customer order is not draft", nil)
	}
	if err := countPendingAttachments(ctx, tx, document.id); err != nil {
		return rootTransition{}, err
	}
	return rootTransition{
		processStatus: StatusChecked, documentStatus: "REVIEWED", event: "CHECKED",
	}, nil
}

func prepareRootUncheck(
	reasonValue string,
	process processRow,
	document documentRow,
) (rootTransition, error) {
	if process.status != StatusChecked || document.status != "REVIEWED" {
		return rootTransition{}, conflict("customer order is not checked", nil)
	}
	reason, err := requiredReason(reasonValue)
	return rootTransition{
		processStatus: StatusDraft, documentStatus: "DRAFT", event: "UNCHECKED", reason: reason,
	}, err
}

func prepareRootApprove(
	actorID string,
	process processRow,
	document documentRow,
) (rootTransition, error) {
	if process.status != StatusChecked || document.status != "REVIEWED" {
		return rootTransition{}, conflict("customer order is not checked", nil)
	}
	if document.reviewedBy != nil && *document.reviewedBy == actorID {
		return rootTransition{}, conflict("approver must differ from checker", nil)
	}
	return rootTransition{
		processStatus: StatusApproved, documentStatus: "APPROVED", event: "APPROVED",
	}, nil
}

func (s *Service) prepareRootUnapprove(
	ctx context.Context,
	tx pgx.Tx,
	reasonValue string,
	process processRow,
	document documentRow,
) (rootTransition, error) {
	if process.status != StatusApproved || document.status != "APPROVED" {
		return rootTransition{}, conflict("customer order is not approved", nil)
	}
	var children int64
	if err := tx.QueryRow(
		ctx,
		`SELECT count(*) FROM wfl_process_documents WHERE process_id=$1 AND stage<>'CUSTOMER_ORDER'`,
		process.id,
	).Scan(&children); err != nil {
		return rootTransition{}, err
	}
	if children != 0 {
		return rootTransition{}, conflict("downstream documents block unapprove", nil)
	}
	reason, err := requiredReason(reasonValue)
	return rootTransition{
		processStatus: StatusChecked, documentStatus: "REVIEWED", event: "UNAPPROVED", reason: reason,
	}, err
}

func (s *Service) prepareShortCloseRequest(
	ctx context.Context,
	tx pgx.Tx,
	reasonValue string,
	process processRow,
	document documentRow,
) (rootTransition, error) {
	if process.status != StatusApproved {
		return rootTransition{}, conflict("process is not approved", nil)
	}
	reason, err := requiredReason(reasonValue)
	if err == nil {
		err = validateShortClose(ctx, tx, process.id)
	}
	return rootTransition{
		processStatus:  StatusShortRequested,
		documentStatus: document.status,
		event:          "SHORT_CLOSE_REQUESTED",
		reason:         reason,
	}, err
}

func prepareShortCloseCancel(
	reasonValue string,
	process processRow,
	document documentRow,
) (rootTransition, error) {
	if process.status != StatusShortRequested {
		return rootTransition{}, conflict("short close is not requested", nil)
	}
	reason, err := requiredReason(reasonValue)
	return rootTransition{
		processStatus:  StatusApproved,
		documentStatus: document.status,
		event:          "SHORT_CLOSE_CANCELLED",
		reason:         reason,
	}, err
}

func (s *Service) prepareShortCloseConfirm(
	ctx context.Context,
	tx pgx.Tx,
	actorID string,
	process processRow,
	document documentRow,
) (rootTransition, error) {
	if process.status != StatusShortRequested {
		return rootTransition{}, conflict("short close is not requested", nil)
	}
	var requester string
	if err := tx.QueryRow(ctx, `SELECT actor_id FROM wfl_audit_events WHERE process_id=$1
		AND event_type='SHORT_CLOSE_REQUESTED' ORDER BY occurred_at DESC,id DESC LIMIT 1`, process.id).Scan(&requester); err != nil {
		return rootTransition{}, err
	}
	if requester == actorID {
		return rootTransition{}, conflict("short close confirmer must differ from requester", nil)
	}
	return rootTransition{
		processStatus:  StatusShortClosed,
		documentStatus: document.status,
		event:          "SHORT_CLOSE_CONFIRMED",
	}, nil
}

func prepareShortCloseUnconfirm(
	reasonValue string,
	process processRow,
	document documentRow,
) (rootTransition, error) {
	if process.status != StatusShortClosed {
		return rootTransition{}, conflict("process is not short closed", nil)
	}
	reason, err := requiredReason(reasonValue)
	return rootTransition{
		processStatus:  StatusShortRequested,
		documentStatus: document.status,
		event:          "SHORT_CLOSE_UNCONFIRMED",
		reason:         reason,
	}, err
}
