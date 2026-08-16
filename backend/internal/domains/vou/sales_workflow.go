package vou

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func salesParentEntity(entity string) string {
	switch entity {
	case EntitySaleOutbound:
		return EntitySaleOrder
	case EntitySaleDelivery:
		return EntitySaleOutbound
	default:
		return EntitySaleDelivery
	}
}

func managedSalesDocument(document dbsqlc.VouDocument) bool {
	return document.Entity == EntitySaleOrder || isSalesChainEntity(document.Entity) || document.Entity == EntitySaleReturn
}

func (s *Service) validateManagedSalesParentStatus(ctx context.Context, tx pgx.Tx, document dbsqlc.VouDocument, targetStatus string) error {
	if managedPurchaseDocument(document) {
		return s.validateManagedPurchaseParentStatus(ctx, tx, document, targetStatus)
	}
	if !managedSalesDocument(document) || document.ParentDocumentID == nil {
		return nil
	}
	parentStatus, err := s.queries.WithTx(tx).LockVouDocumentStatusForShare(ctx, *document.ParentDocumentID)
	if err != nil {
		return s.internal("read sales workflow parent status", err)
	}
	rank := map[string]int{StatusDraft: 0, StatusChecked: 1, StatusApproved: 2}
	required, ok := rank[targetStatus]
	if !ok || rank[parentStatus] < required {
		return domainError(ErrorConflict, "parent sales document has not reached the required status", map[string]any{
			"parentDocumentId": *document.ParentDocumentID, "parentStatus": parentStatus, "requiredStatus": targetStatus,
		}, nil)
	}
	return nil
}

func (s *Service) validateManagedSalesReady(ctx context.Context, tx pgx.Tx, document dbsqlc.VouDocument) error {
	if managedPurchaseDocument(document) {
		if document.Entity == EntityPurchaseOrder {
			return nil
		}
		message := "purchase inbound has no lines"
		if document.Entity == EntityPurchaseReturn {
			message = "purchase return has no lines"
		}
		q := s.queries.WithTx(tx)
		var ready bool
		var err error
		if document.Entity == EntityPurchaseReturn {
			ready, err = q.HasVouPurchaseReturnLines(ctx, document.ID)
		} else {
			ready, err = q.HasVouPurchaseInboundLines(ctx, document.ID)
		}
		if err != nil {
			return s.internal("validate purchase inbound readiness", err)
		}
		if !ready {
			return domainError(ErrorConflict, message, nil, nil)
		}
		return nil
	}
	if !managedSalesDocument(document) || document.Entity == EntitySaleOrder {
		return nil
	}
	var ready bool
	var err error
	q := s.queries.WithTx(tx)
	switch document.Entity {
	case EntitySaleOutbound:
		var value *bool
		value, err = q.IsVouSaleOutboundReady(ctx, document.ID)
		ready = value != nil && *value
	case EntitySaleDelivery:
		var value *bool
		value, err = q.IsVouSaleDeliveryReady(ctx, document.ID)
		ready = value != nil && *value
	case EntitySaleSignoff:
		ready, err = q.IsVouSaleSignoffReady(ctx, document.ID)
	default:
		return nil
	}
	if err != nil {
		return s.internal("validate generated sales draft", err)
	}
	if !ready {
		return domainError(ErrorValidation, "generated sales draft is missing required business data", map[string]any{
			"documentId": document.ID, "entity": document.Entity,
		}, nil)
	}
	return nil
}

func (s *Service) validateManagedSalesChildrenAtMost(ctx context.Context, tx pgx.Tx, document dbsqlc.VouDocument, targetStatus string) error {
	if !managedSalesDocument(document) {
		return nil
	}
	targetRank := map[string]int{StatusDraft: 0, StatusChecked: 1, StatusApproved: 2}[targetStatus]
	rows, err := s.queries.WithTx(tx).ListVouWorkflowChildrenForShare(ctx, &document.ID)
	if err != nil {
		return s.internal("read sales workflow children", err)
	}
	for _, row := range rows {
		childID, childEntity, status := row.ID, row.Entity, row.Status
		if childEntity == EntityOrderProduction {
			return domainError(ErrorConflict, "production document blocks the reverse transition", map[string]any{"documentId": childID, "status": status}, nil)
		}
		childRank, ok := map[string]int{StatusDraft: 0, StatusChecked: 1, StatusApproved: 2}[status]
		if !ok || childRank > targetRank {
			return domainError(ErrorConflict, "downstream sales document blocks the reverse transition", map[string]any{
				"documentId": childID, "status": status, "parentTargetStatus": targetStatus,
			}, nil)
		}
	}
	return nil
}
