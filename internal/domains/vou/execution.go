package vou

import (
	"context"
	"encoding/json"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

func (s *Service) Execute(
	ctx context.Context, entity string, input ExecuteInput, actorID, requestID string,
) (MutationResult, error) {
	if !validEntity(entity) {
		return MutationResult{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin execute", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusApproved); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateStoredAttributes(ctx, q, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	var summary map[string]any
	switch entity {
	case EntitySaleOrder, EntityIntermediarySaleOrder:
		execution, validationErr := validateSaleExecution(input)
		if validationErr != nil {
			return MutationResult{}, validationErr
		}
		if execution.OutboundDate.Before(document.BusinessDate.Time) {
			return MutationResult{}, domainError(ErrorValidation, "outboundDate precedes businessDate", nil, nil)
		}
		summary, err = s.applySaleExecution(ctx, tx, q, entity, document, execution)
	case EntityPurchaseOrder:
		execution, validationErr := validatePurchaseExecution(input)
		if validationErr != nil {
			return MutationResult{}, validationErr
		}
		if execution.InboundDate.Before(document.BusinessDate.Time) {
			return MutationResult{}, domainError(ErrorValidation, "inboundDate precedes businessDate", nil, nil)
		}
		summary, err = s.applyPurchaseExecution(ctx, q, document, execution)
	default:
		if err = validateFinancialExecution(input); err == nil {
			summary = map[string]any{"confirmed": true}
		}
	}
	if err != nil {
		return MutationResult{}, err
	}
	revision, err := q.ExecuteVouDocument(ctx, dbsqlc.ExecuteVouDocumentParams{
		ActorID: stringPtr(actorID), ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("execute document", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "EXECUTED",
		From: stringPtr(StatusApproved), To: StatusExecuted, ActorID: actorID,
		RequestID: requestID, Summary: summary,
	}); err != nil {
		return MutationResult{}, s.writeError("audit execute", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentExecutedEvent{
		Entity: entity, DocumentID: input.DocumentID, DocumentNo: document.DocumentNo,
		Revision: revision, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.eventError("publish document executed", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit execute", err)
	}
	return mutation(document, StatusExecuted, revision), nil
}

func (s *Service) Unexecute(
	ctx context.Context, entity string, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin unexecute", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusExecuted); err != nil {
		return MutationResult{}, err
	}
	summary, err := s.executionSummary(ctx, q, entity, input.DocumentID)
	if err != nil {
		return MutationResult{}, s.internal("read execution for reversal", err)
	}
	switch entity {
	case EntitySaleOrder:
		if _, err = q.ClearVouSaleOrderExecution(ctx, input.DocumentID); err == nil {
			err = q.ClearVouProductLineExecution(ctx, input.DocumentID)
		}
	case EntityIntermediarySaleOrder:
		if _, err = q.ClearVouIntermediarySaleOrderExecution(ctx, input.DocumentID); err == nil {
			err = q.ClearVouProductLineExecution(ctx, input.DocumentID)
		}
	case EntityPurchaseOrder:
		if _, err = q.ClearVouPurchaseOrderExecution(ctx, input.DocumentID); err == nil {
			err = q.ClearVouProductLineExecution(ctx, input.DocumentID)
		}
	}
	if err != nil {
		return MutationResult{}, s.writeError("clear execution", err)
	}
	revision, err := q.UnexecuteVouDocument(ctx, dbsqlc.UnexecuteVouDocumentParams{
		ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("unexecute document", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "UNEXECUTED",
		From: stringPtr(StatusExecuted), To: StatusApproved, ActorID: actorID,
		Reason: reason, RequestID: requestID, Summary: summary,
	}); err != nil {
		return MutationResult{}, s.writeError("audit unexecute", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentUnexecutedEvent{
		Entity: entity, DocumentID: input.DocumentID, DocumentNo: document.DocumentNo,
		Revision: revision, ActorID: actorID, RequestID: requestID, Reason: *reason,
	}); err != nil {
		return MutationResult{}, s.eventError("publish document unexecuted", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit unexecute", err)
	}
	return mutation(document, StatusApproved, revision), nil
}

func (s *Service) applySaleExecution(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	entity string,
	document dbsqlc.VouDocument,
	execution validatedSaleExecution,
) (map[string]any, error) {
	platform, err := s.resolver.ResolveEffectiveReference(
		ctx, tx, bobdomain.EntitySupplier, execution.Platform.ObjectID, execution.Platform.VersionID,
	)
	if err != nil || platform.Data.SupplierType != bobdomain.SupplierTypeLogisticsPlatform {
		return nil, domainError(ErrorConflict, "platform is not an effective logistics platform", nil, err)
	}
	vehicle, err := s.resolver.ResolveEffectiveReference(
		ctx, tx, bobdomain.EntityVehicle, execution.Vehicle.ObjectID, execution.Vehicle.VersionID,
	)
	if err != nil {
		return nil, domainError(ErrorConflict, "vehicle is not effective", nil, err)
	}
	if vehicle.Data.PlatformObjectID != platform.ObjectID {
		return nil, domainError(ErrorConflict, "vehicle does not belong to platform", nil, nil)
	}
	lines, err := q.ListVouProductLines(ctx, document.ID)
	if err != nil {
		return nil, s.internal("list sale lines", err)
	}
	if len(lines) != len(execution.Lines) {
		return nil, domainError(ErrorValidation, "execution lines do not match document", nil, nil)
	}
	byID := make(map[string]fixedSaleExecutionLine, len(execution.Lines))
	for _, line := range execution.Lines {
		byID[line.LineID] = line
	}
	hasDifference := false
	for _, line := range lines {
		actual, ok := byID[line.ID]
		if !ok || actual.Outbound > line.OrderedQtyMicros {
			return nil, domainError(ErrorValidation, "execution lines do not match ordered quantities", nil, nil)
		}
		if actual.Outbound < line.OrderedQtyMicros {
			hasDifference = true
		}
		rows, updateErr := q.SetVouSaleLineExecution(ctx, dbsqlc.SetVouSaleLineExecutionParams{
			OutboundQtyMicros: int64Ptr(actual.Outbound), SignedQtyMicros: int64Ptr(actual.Signed),
			RejectedQtyMicros: int64Ptr(actual.Rejected), LossQtyMicros: int64Ptr(actual.Loss),
			ID: line.ID, DocumentID: document.ID,
		})
		if updateErr != nil || rows != 1 {
			return nil, s.writeError("set sale line execution", updateErr)
		}
	}
	if hasDifference && execution.DifferenceReason == nil {
		return nil, domainError(ErrorValidation, "differenceReason is required", nil, nil)
	}
	if !hasDifference {
		execution.DifferenceReason = nil
	}
	switch entity {
	case EntitySaleOrder:
		rows, updateErr := q.SetVouSaleOrderExecution(ctx, dbsqlc.SetVouSaleOrderExecutionParams{
			OutboundDate: dateValue(execution.OutboundDate), SignoffDate: dateValue(execution.SignoffDate),
			PlatformObjectID: stringPtr(platform.ObjectID), PlatformVersionID: stringPtr(platform.VersionID),
			PlatformCode: stringPtr(platform.Code), PlatformName: stringPtr(platform.Data.Name),
			VehicleObjectID: stringPtr(vehicle.ObjectID), VehicleVersionID: stringPtr(vehicle.VersionID),
			VehicleCode: stringPtr(vehicle.Code), VehicleName: stringPtr(vehicle.Data.Name), VehiclePlateNumber: stringPtr(vehicle.Data.PlateNumber),
			DifferenceReason: execution.DifferenceReason, DocumentID: document.ID,
		})
		if updateErr != nil || rows != 1 {
			return nil, s.writeError("set sale execution", updateErr)
		}
	case EntityIntermediarySaleOrder:
		rows, updateErr := q.SetVouIntermediarySaleOrderExecution(ctx, dbsqlc.SetVouIntermediarySaleOrderExecutionParams{
			OutboundDate: dateValue(execution.OutboundDate), SignoffDate: dateValue(execution.SignoffDate),
			PlatformObjectID: stringPtr(platform.ObjectID), PlatformVersionID: stringPtr(platform.VersionID),
			PlatformCode: stringPtr(platform.Code), PlatformName: stringPtr(platform.Data.Name),
			VehicleObjectID: stringPtr(vehicle.ObjectID), VehicleVersionID: stringPtr(vehicle.VersionID),
			VehicleCode: stringPtr(vehicle.Code), VehicleName: stringPtr(vehicle.Data.Name), VehiclePlateNumber: stringPtr(vehicle.Data.PlateNumber),
			DifferenceReason: execution.DifferenceReason, DocumentID: document.ID,
		})
		if updateErr != nil || rows != 1 {
			return nil, s.writeError("set intermediary execution", updateErr)
		}
	}
	return map[string]any{
		"outboundDate": execution.OutboundDate.Format(dateLayout),
		"signoffDate":  execution.SignoffDate.Format(dateLayout), "lineCount": len(lines),
	}, nil
}

func (s *Service) applyPurchaseExecution(
	ctx context.Context,
	q *dbsqlc.Queries,
	document dbsqlc.VouDocument,
	execution validatedPurchaseExecution,
) (map[string]any, error) {
	lines, err := q.ListVouProductLines(ctx, document.ID)
	if err != nil {
		return nil, s.internal("list purchase lines", err)
	}
	if len(lines) != len(execution.Lines) {
		return nil, domainError(ErrorValidation, "execution lines do not match document", nil, nil)
	}
	byID := make(map[string]fixedPurchaseExecutionLine, len(execution.Lines))
	for _, line := range execution.Lines {
		byID[line.LineID] = line
	}
	hasDifference := false
	for _, line := range lines {
		actual, ok := byID[line.ID]
		if !ok || actual.Inbound > line.OrderedQtyMicros {
			return nil, domainError(ErrorValidation, "execution lines do not match ordered quantities", nil, nil)
		}
		if actual.Inbound < line.OrderedQtyMicros {
			hasDifference = true
		}
		rows, updateErr := q.SetVouPurchaseLineExecution(ctx, dbsqlc.SetVouPurchaseLineExecutionParams{
			InboundQtyMicros: int64Ptr(actual.Inbound), ID: line.ID, DocumentID: document.ID,
		})
		if updateErr != nil || rows != 1 {
			return nil, s.writeError("set purchase line execution", updateErr)
		}
	}
	if hasDifference && execution.DifferenceReason == nil {
		return nil, domainError(ErrorValidation, "differenceReason is required", nil, nil)
	}
	if !hasDifference {
		execution.DifferenceReason = nil
	}
	rows, err := q.SetVouPurchaseOrderExecution(ctx, dbsqlc.SetVouPurchaseOrderExecutionParams{
		InboundDate: dateValue(execution.InboundDate), DifferenceReason: execution.DifferenceReason,
		DocumentID: document.ID,
	})
	if err != nil || rows != 1 {
		return nil, s.writeError("set purchase execution", err)
	}
	return map[string]any{"inboundDate": execution.InboundDate.Format(dateLayout), "lineCount": len(lines)}, nil
}

func (s *Service) executionSummary(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string,
) (map[string]any, error) {
	data, err := s.loadData(ctx, q, dbsqlc.VouDocument{ID: documentID, Entity: entity})
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	var summary map[string]any
	if err = json.Unmarshal(encoded, &summary); err != nil {
		return nil, err
	}
	return summary, nil
}

type auditInput struct {
	DocumentID, Entity, Event, To, ActorID, RequestID string
	From, Reason                                      *string
	Summary                                           map[string]any
}
