package vou

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

type workflowDefaults struct {
	FundAccountObjectID string `json:"fundAccountObjectId"`
	HandlerObjectID     string `json:"handlerObjectId"`
}

func (s *Service) CreateWorkflowChild(
	ctx context.Context,
	tx pgx.Tx,
	converterKey, sourceDocumentID string,
	defaultsJSON json.RawMessage,
	requestID string,
) (MutationResult, error) {
	var defaults workflowDefaults
	if len(defaultsJSON) != 0 {
		if err := json.Unmarshal(defaultsJSON, &defaults); err != nil {
			return MutationResult{}, domainError(ErrorValidation, "invalid workflow node defaults", nil, err)
		}
	}
	actorID := systemidentity.UserID
	var targetEntity string
	switch converterKey {
	case "sale-order-to-outbound":
		targetEntity = EntitySaleOutbound
	case "sale-outbound-to-delivery":
		targetEntity = EntitySaleDelivery
	case "sale-delivery-to-signoff":
		targetEntity = EntitySaleSignoff
	case "purchase-order-to-inbound":
		targetEntity = EntityPurchaseInbound
	case "sale-signoff-to-receipt":
		targetEntity = EntityReceipt
	case "purchase-inbound-to-payment":
		targetEntity = EntityPayment
	case "expense-reimbursement-to-payment":
		targetEntity = EntityExpensePayment
	default:
		return MutationResult{}, domainError(ErrorValidation, "unsupported workflow converter", map[string]any{"converterKey": converterKey}, nil)
	}
	if existing, ok, err := s.findWorkflowChild(ctx, tx, sourceDocumentID, targetEntity); err != nil {
		return MutationResult{}, err
	} else if ok {
		return existing, nil
	}
	switch converterKey {
	case "sale-order-to-outbound":
		result, err := s.ensureAutoOutboundDraft(ctx, tx, sourceDocumentID, actorID, requestID)
		if err != nil {
			return result, err
		}
		if result.DocumentID == "" {
			result, _, err = s.findWorkflowChild(ctx, tx, sourceDocumentID, targetEntity)
		}
		return result, err
	case "sale-outbound-to-delivery":
		result, err := s.ensureAutoDeliveryDraft(ctx, tx, sourceDocumentID, actorID, requestID)
		if err != nil {
			return result, err
		}
		if result.DocumentID == "" {
			result, _, err = s.findWorkflowChild(ctx, tx, sourceDocumentID, targetEntity)
		}
		return result, err
	case "sale-delivery-to-signoff":
		result, err := s.ensureAutoSignoffDraft(ctx, tx, sourceDocumentID, actorID, requestID)
		if err != nil {
			return result, err
		}
		if result.DocumentID == "" {
			result, _, err = s.findWorkflowChild(ctx, tx, sourceDocumentID, targetEntity)
		}
		return result, err
	case "purchase-order-to-inbound":
		return s.createWorkflowPurchaseInbound(ctx, tx, sourceDocumentID, requestID)
	case "sale-signoff-to-receipt", "purchase-inbound-to-payment":
		return s.createWorkflowCashDocument(ctx, tx, converterKey, sourceDocumentID, defaults, requestID)
	case "expense-reimbursement-to-payment":
		return s.createWorkflowExpensePayment(ctx, tx, sourceDocumentID, defaults, requestID)
	}
	return MutationResult{}, nil
}

func (s *Service) findWorkflowChild(ctx context.Context, tx pgx.Tx, sourceID, entity string) (MutationResult, bool, error) {
	var result MutationResult
	err := tx.QueryRow(ctx, `SELECT id,document_no,status,revision FROM vou_documents
		WHERE parent_document_id=$1 AND entity=$2 AND status<>'DELETED' ORDER BY created_at,id LIMIT 1 FOR UPDATE`, sourceID, entity).
		Scan(&result.DocumentID, &result.DocumentNo, &result.Status, &result.Revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, false, nil
	}
	return result, err == nil, err
}

func (s *Service) createWorkflowPurchaseInbound(ctx context.Context, tx pgx.Tx, orderID, requestID string) (MutationResult, error) {
	order, detail, err := s.lockPurchaseOrderForInbound(ctx, tx, orderID)
	if err != nil {
		return MutationResult{}, err
	}
	warehouse, err := s.resolveInboundWarehouse(ctx, tx, nil, detail)
	if err != nil {
		return MutationResult{}, err
	}
	orderLines, err := s.queries.WithTx(tx).ListVouProductLines(ctx, orderID)
	if err != nil {
		return MutationResult{}, err
	}
	inputs := make([]SourceQuantityLineInput, 0, len(orderLines))
	for _, line := range orderLines {
		var reserved int64
		if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(l.quantity_micros),0) FROM vou_purchase_inbound_lines l
			JOIN vou_purchase_inbound_details d ON d.document_id=l.document_id
			WHERE d.source_order_id=$1 AND l.source_order_line_id=$2`, orderID, line.ID).Scan(&reserved); err != nil {
			return MutationResult{}, err
		}
		remaining := line.OrderedQtyMicros - reserved
		if remaining > 0 {
			inputs = append(inputs, SourceQuantityLineInput{SourceLineID: line.ID, Quantity: formatQuantity(remaining)})
		}
	}
	if len(inputs) == 0 {
		return MutationResult{}, domainError(ErrorConflict, "purchase order has no remaining inbound quantity", nil, nil)
	}
	lines, total, err := s.validateAndReserveInboundLines(ctx, tx, orderID, "", inputs)
	if err != nil {
		return MutationResult{}, err
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{Entity: EntityPurchaseInbound, BusinessDate: order.BusinessDate})
	if err != nil {
		return MutationResult{}, err
	}
	id := newID()
	date := order.BusinessDate.Time
	number := fmt.Sprintf("%s-%s-%04d", entityPrefix(EntityPurchaseInbound), date.Format("20060102"), counter)
	_, err = tx.Exec(ctx, `INSERT INTO vou_documents(id,entity,document_no,business_date,currency,total_amount_cents,parent_entity,parent_document_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, id, EntityPurchaseInbound, number, date, order.Currency, total, EntityPurchaseOrder, orderID, systemidentity.UserID)
	if err != nil {
		return MutationResult{}, err
	}
	if err = q.InsertVouPurchaseInboundDetail(ctx, dbsqlc.InsertVouPurchaseInboundDetailParams{DocumentID: id, SourceOrderID: orderID, SupplierObjectID: detail.SupplierObjectID, SupplierVersionID: detail.SupplierVersionID, SupplierCode: detail.SupplierCode, SupplierName: detail.SupplierName, WarehouseObjectID: warehouse.ObjectID, WarehouseVersionID: warehouse.VersionID, WarehouseCode: warehouse.Code, WarehouseName: warehouse.Data.Name}); err != nil {
		return MutationResult{}, err
	}
	if err = s.insertPurchaseInboundLines(ctx, q, id, lines); err != nil {
		return MutationResult{}, err
	}
	var legacyProcess bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM wfl_process_instances WHERE id=$1 AND process_type=$2)`,
		orderID, purchaseWorkflowType).Scan(&legacyProcess); err != nil {
		return MutationResult{}, err
	}
	if legacyProcess {
		var sequence int32
		if err = tx.QueryRow(ctx, `SELECT COALESCE(max(sequence_no),0)+1 FROM wfl_process_documents
			WHERE process_id=$1 AND stage=$2`, orderID, purchaseStageInbound).Scan(&sequence); err != nil {
			return MutationResult{}, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO wfl_process_documents(process_id,document_id,stage,sequence_no)
			VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, orderID, id, purchaseStageInbound, sequence); err != nil {
			return MutationResult{}, err
		}
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: id, Entity: EntityPurchaseInbound, Event: "CREATED", To: StatusDraft, ActorID: systemidentity.UserID, RequestID: requestID, Summary: map[string]any{"sourceOrderId": orderID}}); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntityPurchaseInbound, DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: EntityPurchaseOrder, ParentDocumentID: orderID, ActorID: systemidentity.UserID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) resolveWorkflowDefault(ctx context.Context, tx pgx.Tx, entity, objectID, field string) (bobdomain.EffectiveReference, error) {
	if objectID == "" {
		return bobdomain.EffectiveReference{}, domainError(ErrorConflict, field+" is required by workflow", nil, nil)
	}
	ref, err := s.resolver.ResolveCurrentEffectiveReference(ctx, tx, entity, objectID)
	if err != nil {
		return ref, domainError(ErrorConflict, field+" is not effective", nil, err)
	}
	return ref, nil
}

func (s *Service) createWorkflowExpensePayment(ctx context.Context, tx pgx.Tx, reimbursementID string, defaults workflowDefaults, requestID string) (MutationResult, error) {
	var source dbsqlc.VouDocument
	var employeeObjectID, employeeVersionID, employeeCode, employeeName string
	err := tx.QueryRow(ctx, `SELECT d.id,d.entity,d.document_no,d.status,d.revision,d.business_date,d.currency,d.total_amount_cents,d.remark,d.created_at,d.created_by,d.updated_at,d.updated_by,
		x.employee_object_id,x.employee_version_id,x.employee_code,x.employee_name
		FROM vou_documents d JOIN vou_expense_reimbursement_details x ON x.document_id=d.id WHERE d.id=$1 FOR UPDATE OF d`, reimbursementID).Scan(&source.ID, &source.Entity, &source.DocumentNo, &source.Status, &source.Revision, &source.BusinessDate, &source.Currency, &source.TotalAmountCents, &source.Remark, &source.CreatedAt, &source.CreatedBy, &source.UpdatedAt, &source.UpdatedBy, &employeeObjectID, &employeeVersionID, &employeeCode, &employeeName)
	if err != nil {
		return MutationResult{}, err
	}
	if source.Status != StatusApproved && source.Status != StatusFinalized {
		return MutationResult{}, domainError(ErrorConflict, "expense reimbursement is not approved", nil, nil)
	}
	fund, err := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityFundAccount, defaults.FundAccountObjectID, "fundAccount")
	if err != nil {
		return MutationResult{}, err
	}
	if fund.Data.Currency != deref(source.Currency) {
		return MutationResult{}, domainError(ErrorConflict, "fund account currency does not match reimbursement", nil, nil)
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{Entity: EntityExpensePayment, BusinessDate: source.BusinessDate})
	if err != nil {
		return MutationResult{}, err
	}
	id := newID()
	date := source.BusinessDate.Time
	number := fmt.Sprintf("%s-%s-%04d", entityPrefix(EntityExpensePayment), date.Format("20060102"), counter)
	_, err = tx.Exec(ctx, `INSERT INTO vou_documents(id,entity,document_no,business_date,currency,total_amount_cents,remark,parent_entity,parent_document_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`, id, EntityExpensePayment, number, date, source.Currency, source.TotalAmountCents, source.Remark, EntityExpenseReimbursement, reimbursementID, systemidentity.UserID)
	if err != nil {
		return MutationResult{}, err
	}
	err = q.InsertVouExpensePaymentDetail(ctx, dbsqlc.InsertVouExpensePaymentDetailParams{DocumentID: id, SourceReimbursementID: reimbursementID, EmployeeObjectID: employeeObjectID, EmployeeVersionID: employeeVersionID, EmployeeCode: employeeCode, EmployeeName: employeeName, FundAccountObjectID: fund.ObjectID, FundAccountVersionID: fund.VersionID, FundAccountCode: fund.Code, FundAccountName: fund.Data.Name})
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: id, Entity: EntityExpensePayment, Event: "CREATED", To: StatusDraft, ActorID: systemidentity.UserID, RequestID: requestID, Summary: map[string]any{"sourceReimbursementId": reimbursementID}}); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntityExpensePayment, DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: EntityExpenseReimbursement, ParentDocumentID: reimbursementID, ActorID: systemidentity.UserID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) createWorkflowCashDocument(ctx context.Context, tx pgx.Tx, converterKey, sourceID string, defaults workflowDefaults, requestID string) (MutationResult, error) {
	entity := EntityReceipt
	partyEntity := "customer"
	var partyObjectID, partyVersionID, partyCode, partyName string
	var source dbsqlc.VouDocument
	if converterKey == "purchase-inbound-to-payment" {
		entity = EntityPayment
		partyEntity = "supplier"
		err := tx.QueryRow(ctx, `SELECT d.id,d.entity,d.document_no,d.status,d.revision,d.business_date,d.currency,d.total_amount_cents,d.remark,d.created_at,d.created_by,d.updated_at,d.updated_by,x.supplier_object_id,x.supplier_version_id,x.supplier_code,x.supplier_name FROM vou_documents d JOIN vou_purchase_inbound_details x ON x.document_id=d.id WHERE d.id=$1 FOR UPDATE OF d`, sourceID).Scan(&source.ID, &source.Entity, &source.DocumentNo, &source.Status, &source.Revision, &source.BusinessDate, &source.Currency, &source.TotalAmountCents, &source.Remark, &source.CreatedAt, &source.CreatedBy, &source.UpdatedAt, &source.UpdatedBy, &partyObjectID, &partyVersionID, &partyCode, &partyName)
		if err != nil {
			return MutationResult{}, err
		}
	} else {
		err := tx.QueryRow(ctx, `SELECT d.id,d.entity,d.document_no,d.status,d.revision,d.business_date,d.currency,d.total_amount_cents,d.remark,d.created_at,d.created_by,d.updated_at,d.updated_by,x.customer_object_id,x.customer_version_id,x.customer_code,x.customer_name FROM vou_documents d JOIN vou_sale_signoff_details x ON x.document_id=d.id WHERE d.id=$1 FOR UPDATE OF d`, sourceID).Scan(&source.ID, &source.Entity, &source.DocumentNo, &source.Status, &source.Revision, &source.BusinessDate, &source.Currency, &source.TotalAmountCents, &source.Remark, &source.CreatedAt, &source.CreatedBy, &source.UpdatedAt, &source.UpdatedBy, &partyObjectID, &partyVersionID, &partyCode, &partyName)
		if err != nil {
			return MutationResult{}, err
		}
	}
	fund, err := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityFundAccount, defaults.FundAccountObjectID, "fundAccount")
	if err != nil {
		return MutationResult{}, err
	}
	handler, err := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityEmployee, defaults.HandlerObjectID, "handler")
	if err != nil {
		return MutationResult{}, err
	}
	if fund.Data.Currency != deref(source.Currency) {
		return MutationResult{}, domainError(ErrorConflict, "fund account currency does not match source document", nil, nil)
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{Entity: entity, BusinessDate: source.BusinessDate})
	if err != nil {
		return MutationResult{}, err
	}
	id := newID()
	date := source.BusinessDate.Time
	number := fmt.Sprintf("%s-%s-%04d", entityPrefix(entity), date.Format("20060102"), counter)
	_, err = tx.Exec(ctx, `INSERT INTO vou_documents(id,entity,document_no,business_date,currency,total_amount_cents,remark,parent_entity,parent_document_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`, id, entity, number, date, source.Currency, source.TotalAmountCents, source.Remark, source.Entity, sourceID, systemidentity.UserID)
	if err != nil {
		return MutationResult{}, err
	}
	if entity == EntityReceipt {
		err = q.InsertVouReceiptDetail(ctx, dbsqlc.InsertVouReceiptDetailParams{DocumentID: id, CounterpartyEntity: partyEntity, CounterpartyObjectID: partyObjectID, CounterpartyVersionID: partyVersionID, CounterpartyCode: partyCode, CounterpartyName: partyName, FundAccountObjectID: fund.ObjectID, FundAccountVersionID: fund.VersionID, FundAccountCode: fund.Code, FundAccountName: fund.Data.Name, HandlerObjectID: stringPtr(handler.ObjectID), HandlerVersionID: stringPtr(handler.VersionID), HandlerCode: stringPtr(handler.Code), HandlerName: stringPtr(handler.Data.Name)})
	} else {
		err = q.InsertVouPaymentDetail(ctx, dbsqlc.InsertVouPaymentDetailParams{DocumentID: id, CounterpartyEntity: partyEntity, CounterpartyObjectID: partyObjectID, CounterpartyVersionID: partyVersionID, CounterpartyCode: partyCode, CounterpartyName: partyName, FundAccountObjectID: fund.ObjectID, FundAccountVersionID: fund.VersionID, FundAccountCode: fund.Code, FundAccountName: fund.Data.Name, HandlerObjectID: stringPtr(handler.ObjectID), HandlerVersionID: stringPtr(handler.VersionID), HandlerCode: stringPtr(handler.Code), HandlerName: stringPtr(handler.Data.Name)})
	}
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: id, Entity: entity, Event: "CREATED", To: StatusDraft, ActorID: systemidentity.UserID, RequestID: requestID, Summary: map[string]any{"sourceDocumentId": sourceID}}); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: entity, DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: source.Entity, ParentDocumentID: sourceID, ActorID: systemidentity.UserID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) SaveExpensePayment(ctx context.Context, input SaveInput, actorID, requestID string) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	date, err := parseBusinessDate(input.Data.BusinessDate)
	if err != nil {
		return MutationResult{}, err
	}
	if err = validateReference(input.Data.FundAccount, "fundAccount", true); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: EntityExpensePayment})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	fund, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityFundAccount, input.Data.FundAccount.ObjectID, input.Data.FundAccount.VersionID)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "fund account is not effective", nil, err)
	}
	if fund.Data.Currency != deref(document.Currency) {
		return MutationResult{}, domainError(ErrorConflict, "fund account currency does not match document currency", nil, nil)
	}
	revision, err := q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{BusinessDate: dateValue(date), Currency: document.Currency, DueDate: document.DueDate, TotalAmountCents: document.TotalAmountCents, Remark: optionalText(input.Data.Remark), ActorID: actorID, ID: input.DocumentID, Entity: EntityExpensePayment, Revision: input.Revision})
	if err != nil {
		return MutationResult{}, err
	}
	rows, err := q.UpdateVouExpensePaymentFundAccount(ctx, dbsqlc.UpdateVouExpensePaymentFundAccountParams{FundAccountObjectID: fund.ObjectID, FundAccountVersionID: fund.VersionID, FundAccountCode: fund.Code, FundAccountName: fund.Data.Name, DocumentID: input.DocumentID})
	if err != nil || rows != 1 {
		return MutationResult{}, s.writeError("update expense payment", err)
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: input.DocumentID, Entity: EntityExpensePayment, Event: "SAVED", From: stringPtr(StatusDraft), To: StatusDraft, ActorID: actorID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return mutation(document, StatusDraft, revision), nil
}
