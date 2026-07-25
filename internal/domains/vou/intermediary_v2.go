package vou

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	stageProcurement = "PROCUREMENT"
	stageReceipt     = "RECEIPT"
	stageDelivery    = "DELIVERY"
	stageSignoff     = "SIGNOFF"
)

type v2Root struct {
	ID, DocumentNo, Status, Currency, Remark string
	Revision, TotalAmount                    int64
	BusinessDate                             time.Time
	CheckedBy, ApprovedBy                    *string
}

type v2Line struct {
	ID, ProductObjectID, ProductVersionID, ProductCode, ProductName, ProductUnit string
	ContainerType, Remark                                                        string
	LineNo                                                                       int32
	Ordered, SalePrice, LineAmount                                               int64
	QuantityPerContainer                                                         *int64
}

type v2Child struct {
	ID, DocumentID, Stage, ChildNo, Status, CreatedBy, UpdatedBy string
	Revision                                                     int64
	CheckedBy, FinalBy                                           *string
}

type v2FixedLine struct {
	Product                bobdomain.EffectiveReference
	Ordered, Price, Amount int64
	ContainerType          string
	QuantityPerContainer   *int64
	Remark                 *string
}

type v2ResolvedRoot struct {
	BusinessDate                      time.Time
	Currency                          string
	Remark                            *string
	Customer, Salesperson, Settlement bobdomain.EffectiveReference
	Lines                             []v2FixedLine
	Total                             int64
}

func (s *Service) CreateIntermediaryV2(
	ctx context.Context, input CreateInput, actorID, requestID string,
) (MutationResult, error) {
	resolved, err := s.resolveV2Root(ctx, nil, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	if !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid actor", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin V2 create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	resolved, err = s.resolveV2Root(ctx, tx, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: EntityIntermediarySaleOrder, BusinessDate: dateValue(resolved.BusinessDate),
	})
	if err != nil {
		return MutationResult{}, s.writeError("allocate V2 number", err)
	}
	id := newID()
	number := fmt.Sprintf("ISO-%s-%06d", resolved.BusinessDate.Format("20060102"), counter)
	_, err = tx.Exec(ctx, `
		INSERT INTO vou_documents(
			id, entity, document_no, status, revision, business_date, currency,
			total_amount_cents, remark, created_by, updated_by, workflow_version
		) VALUES ($1,'intermediary-sale-order',$2,'DRAFT',1,$3,$4,$5,$6,$7,$7,2)`,
		id, number, resolved.BusinessDate, resolved.Currency, resolved.Total, resolved.Remark, actorID)
	if err != nil {
		return MutationResult{}, s.writeError("insert V2 document", err)
	}
	if err = insertV2Root(ctx, tx, id, resolved); err != nil {
		return MutationResult{}, s.writeError("insert V2 detail", err)
	}
	if err = insertV2Audit(ctx, tx, id, "CREATED", nil, StatusDraft, actorID, requestID,
		"", "", "", StatusDraft, nil, map[string]any{"documentNo": number}); err != nil {
		return MutationResult{}, s.writeError("audit V2 create", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit V2 create", err)
	}
	return MutationResult{
		DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1,
		RootRevision: 1, WorkflowStatus: StatusDraft,
	}, nil
}

func (s *Service) SaveIntermediaryV2(
	ctx context.Context, input SaveInput, actorID, requestID string,
) (MutationResult, error) {
	revision := input.RootRevision
	if revision == 0 {
		revision = input.Revision
	}
	if !validID(input.DocumentID) || revision < 1 {
		return MutationResult{}, domainError(ErrorValidation, "invalid document revision", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin V2 save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	root, err := lockV2Root(ctx, tx, input.DocumentID)
	if err = v2RootConflict(err, root, revision, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	resolved, err := s.resolveV2Root(ctx, tx, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	var childCount int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_intermediary_children WHERE document_id=$1`,
		root.ID).Scan(&childCount); err != nil {
		return MutationResult{}, s.internal("count V2 children", err)
	}
	if childCount != 0 {
		return MutationResult{}, domainError(ErrorConflict, "root draft has child documents", nil, nil)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_intermediary_v2_lines WHERE document_id=$1`, root.ID); err != nil {
		return MutationResult{}, s.writeError("replace V2 lines", err)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_intermediary_v2_details WHERE document_id=$1`, root.ID); err != nil {
		return MutationResult{}, s.writeError("replace V2 detail", err)
	}
	if err = insertV2Root(ctx, tx, root.ID, resolved); err != nil {
		return MutationResult{}, s.writeError("insert saved V2 detail", err)
	}
	var next int64
	err = tx.QueryRow(ctx, `
		UPDATE vou_documents SET business_date=$1,currency=$2,total_amount_cents=$3,remark=$4,
			revision=revision+1,updated_at=now(),updated_by=$5
		WHERE id=$6 AND workflow_version=2 AND status='DRAFT' AND revision=$7
		RETURNING revision`, resolved.BusinessDate, resolved.Currency, resolved.Total, resolved.Remark,
		actorID, root.ID, revision).Scan(&next)
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "document changed", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("save V2 root", err)
	}
	if err = insertV2Audit(ctx, tx, root.ID, "SAVED", stringPtr(StatusDraft), StatusDraft,
		actorID, requestID, "", "", "", StatusDraft, nil, map[string]any{"revision": next}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit V2 save", err)
	}
	return v2Mutation(root, next, StatusDraft, nil, nil), nil
}

func (s *Service) IntermediaryV2Action(
	ctx context.Context, action string, input IntermediaryActionInput,
	actorID, requestID string,
) (any, error) {
	if strings.HasSuffix(action, "-get") {
		return s.getV2Child(ctx, action, input)
	}
	if !validID(input.DocumentID) || input.RootRevision < 1 || !validID(actorID) {
		return nil, domainError(ErrorValidation, "invalid V2 action request", nil, nil)
	}
	switch action {
	case "check", "uncheck", "short-close-request", "short-close-cancel",
		"short-close-confirm", "short-close-unconfirm":
		return s.v2RootAction(ctx, action, input, actorID, requestID)
	}
	parts := strings.SplitN(action, "-", 2)
	if len(parts) != 2 || !slices.Contains([]string{"procurement", "receipt", "delivery", "signoff"}, parts[0]) {
		return nil, domainError(ErrorValidation, "invalid intermediary action", nil, nil)
	}
	return s.v2ChildAction(ctx, strings.ToUpper(parts[0]), parts[1], input, actorID, requestID)
}

func (s *Service) v2RootAction(
	ctx context.Context, action string, input IntermediaryActionInput, actorID, requestID string,
) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin V2 root action", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	root, err := lockV2Root(ctx, tx, input.DocumentID)
	if err = v2RootConflict(err, root, input.RootRevision, ""); err != nil {
		return MutationResult{}, err
	}
	from, to, event := root.Status, "", ""
	var reason *string
	switch action {
	case "check":
		if root.Status != StatusDraft {
			return MutationResult{}, v2StatusError(root, StatusDraft)
		}
		var pending int64
		if err = tx.QueryRow(ctx, `
			SELECT count(*) FROM vou_document_attachments a JOIN vou_files f ON f.id=a.file_id
			WHERE a.document_id=$1 AND f.status='PENDING'`, root.ID).Scan(&pending); err != nil {
			return MutationResult{}, s.internal("count V2 pending attachments", err)
		}
		if pending != 0 {
			return MutationResult{}, domainError(ErrorConflict, "attachments are still uploading", nil, nil)
		}
		to, event = StatusChecked, "CHECKED"
	case "uncheck":
		if root.Status != StatusChecked {
			return MutationResult{}, v2StatusError(root, StatusChecked)
		}
		reason, err = v2Reason(input.Reason)
		to, event = StatusDraft, "UNCHECKED"
	case "short-close-request":
		if root.Status != StatusApproved {
			return MutationResult{}, v2StatusError(root, StatusApproved)
		}
		reason, err = v2Reason(input.Reason)
		if err == nil {
			err = validateShortClose(ctx, tx, root.ID)
		}
		to, event = StatusShortCloseRequested, "SHORT_CLOSE_REQUESTED"
	case "short-close-cancel":
		if root.Status != StatusShortCloseRequested {
			return MutationResult{}, v2StatusError(root, StatusShortCloseRequested)
		}
		reason, err = v2Reason(input.Reason)
		to, event = StatusApproved, "SHORT_CLOSE_CANCELLED"
	case "short-close-confirm":
		if root.Status != StatusShortCloseRequested {
			return MutationResult{}, v2StatusError(root, StatusShortCloseRequested)
		}
		var requester string
		err = tx.QueryRow(ctx, `
			SELECT actor_id FROM vou_audit_events
			WHERE document_id=$1 AND event_type='SHORT_CLOSE_REQUESTED'
			ORDER BY occurred_at DESC,id DESC LIMIT 1`, root.ID).Scan(&requester)
		if err == nil && requester == actorID {
			err = domainError(ErrorConflict, "short close confirmer must differ from requester", nil, nil)
		}
		to, event = StatusShortClosed, "SHORT_CLOSE_CONFIRMED"
	case "short-close-unconfirm":
		if root.Status != StatusShortClosed {
			return MutationResult{}, v2StatusError(root, StatusShortClosed)
		}
		reason, err = v2Reason(input.Reason)
		to, event = StatusShortCloseRequested, "SHORT_CLOSE_UNCONFIRMED"
	}
	if err != nil {
		return MutationResult{}, err
	}
	var next int64
	switch action {
	case "check":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status=$1,checked_at=now(),checked_by=$2,
			revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=$3 AND revision=$4 RETURNING revision`,
			to, actorID, root.ID, root.Revision).Scan(&next)
	case "uncheck":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status=$1,checked_at=NULL,checked_by=NULL,
			revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=$3 AND revision=$4 RETURNING revision`,
			to, actorID, root.ID, root.Revision).Scan(&next)
	case "short-close-confirm":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status=$1,completed_at=now(),
			revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=$3 AND revision=$4 RETURNING revision`,
			to, actorID, root.ID, root.Revision).Scan(&next)
	case "short-close-unconfirm":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status=$1,completed_at=NULL,
			revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=$3 AND revision=$4 RETURNING revision`,
			to, actorID, root.ID, root.Revision).Scan(&next)
	default:
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status=$1,
			revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=$3 AND revision=$4 RETURNING revision`,
			to, actorID, root.ID, root.Revision).Scan(&next)
	}
	if err != nil {
		return MutationResult{}, s.writeError("update V2 root status", err)
	}
	if err = insertV2Audit(ctx, tx, root.ID, event, &from, to, actorID, requestID,
		"", "", "", to, reason, map[string]any{"revision": next}); err != nil {
		return MutationResult{}, err
	}
	balances, err := loadV2Balances(ctx, tx, root.ID, true)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit V2 root action", err)
	}
	result := v2Mutation(root, next, to, nil, &balances)
	return result, nil
}

func (s *Service) ApproveIntermediaryV2(
	ctx context.Context, documentID string, revision int64, actorID, requestID string,
) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin V2 approve", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	root, err := lockV2Root(ctx, tx, documentID)
	if err = v2RootConflict(err, root, revision, StatusChecked); err != nil {
		return MutationResult{}, err
	}
	if root.CheckedBy == nil || *root.CheckedBy == actorID {
		return MutationResult{}, domainError(ErrorConflict, "approver must differ from checker", nil, nil)
	}
	var next int64
	err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='APPROVED',approved_at=now(),approved_by=$1,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, root.ID, root.Revision).Scan(&next)
	if err != nil {
		return MutationResult{}, s.writeError("approve V2 root", err)
	}
	if err = insertV2Audit(ctx, tx, root.ID, "APPROVED", stringPtr(StatusChecked), StatusApproved,
		actorID, requestID, "", "", "", StatusApproved, nil, map[string]any{"revision": next}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return v2Mutation(root, next, StatusApproved, nil, nil), nil
}

func (s *Service) UnapproveIntermediaryV2(
	ctx context.Context, documentID string, revision int64, reasonValue, actorID, requestID string,
) (MutationResult, error) {
	reason, err := v2Reason(reasonValue)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin V2 unapprove", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	root, err := lockV2Root(ctx, tx, documentID)
	if err = v2RootConflict(err, root, revision, StatusApproved); err != nil {
		return MutationResult{}, err
	}
	var children int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_intermediary_children WHERE document_id=$1`,
		root.ID).Scan(&children); err != nil {
		return MutationResult{}, err
	}
	if children != 0 {
		return MutationResult{}, domainError(ErrorConflict, "child documents must be reversed and deleted first", nil, nil)
	}
	var next int64
	err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='CHECKED',approved_at=NULL,approved_by=NULL,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, root.ID, root.Revision).Scan(&next)
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertV2Audit(ctx, tx, root.ID, "UNAPPROVED", stringPtr(StatusApproved), StatusChecked,
		actorID, requestID, "", "", "", StatusChecked, reason, map[string]any{"revision": next}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return v2Mutation(root, next, StatusChecked, nil, nil), nil
}

func (s *Service) resolveV2Root(ctx context.Context, tx pgx.Tx, data DraftInput) (v2ResolvedRoot, error) {
	var result v2ResolvedRoot
	date, err := time.Parse(dateLayout, strings.TrimSpace(data.BusinessDate))
	if err != nil || !currencyPattern.MatchString(strings.ToUpper(strings.TrimSpace(data.Currency))) {
		return result, domainError(ErrorValidation, "invalid V2 business date or currency", nil, nil)
	}
	if err = validateReference(data.Customer, "customer", true); err != nil {
		return result, err
	}
	if len(data.ProductLines) == 0 || len(data.ProductLines) > 100 {
		return result, domainError(ErrorValidation, "product lines are required", nil, nil)
	}
	if utf8.RuneCountInString(strings.TrimSpace(data.Remark)) > 1000 {
		return result, domainError(ErrorValidation, "remark is too long", nil, nil)
	}
	if tx == nil {
		return v2ResolvedRoot{BusinessDate: date}, nil
	}
	customer, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityCustomer,
		data.Customer.ObjectID, data.Customer.VersionID)
	if err != nil {
		return result, v2ReferenceError("customer", err)
	}
	var salesperson bobdomain.EffectiveReference
	if data.Salesperson != nil {
		if err = validateReference(data.Salesperson, "salesperson", true); err != nil {
			return result, err
		}
		salesperson, err = s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityEmployee,
			data.Salesperson.ObjectID, data.Salesperson.VersionID)
	} else if customer.Data.SalespersonEmployeeID != "" {
		salesperson, err = s.resolver.ResolveCurrentEffectiveReference(ctx, tx, bobdomain.EntityEmployee,
			customer.Data.SalespersonEmployeeID)
	} else {
		err = domainError(ErrorConflict, "customer salesperson is not configured", nil, nil)
	}
	if err != nil {
		return result, v2ReferenceError("salesperson", err)
	}
	if customer.Data.SettlementMethodID == "" || customer.Data.SettlementMethodVersionID == "" {
		return result, domainError(ErrorConflict, "customer settlement method is not configured", nil, nil)
	}
	settlement, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntitySettlementMethod,
		customer.Data.SettlementMethodID, customer.Data.SettlementMethodVersionID)
	if err != nil {
		return result, v2ReferenceError("customer settlement method", err)
	}
	lines := make([]v2FixedLine, 0, len(data.ProductLines))
	var total int64
	for _, line := range data.ProductLines {
		if err = validateReference(&line.Product, "product", true); err != nil {
			return result, err
		}
		quantity, quantityErr := quantityMicros(line.OrderedQuantity, false)
		price, priceErr := moneyCents(line.UnitPrice)
		if quantityErr != nil || priceErr != nil {
			return result, domainError(ErrorValidation, "invalid V2 line quantity or price", nil, nil)
		}
		amount, amountErr := lineAmountCents(quantity, price)
		if amountErr != nil {
			return result, domainError(ErrorValidation, "invalid V2 line amount", nil, amountErr)
		}
		product, referenceErr := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityProduct,
			line.Product.ObjectID, line.Product.VersionID)
		if referenceErr != nil {
			return result, v2ReferenceError("product", referenceErr)
		}
		containerType := product.Data.ContainerType
		quantityPerContainer := int64PtrOrNil(product.Data.QuantityPerContainer)
		if line.ContainerType != nil {
			containerType = strings.ToUpper(strings.TrimSpace(*line.ContainerType))
		}
		if line.QuantityPerContainer != nil {
			parsed, parseErr := quantityMicros(*line.QuantityPerContainer, false)
			if parseErr != nil {
				return result, domainError(ErrorValidation, "invalid quantity per container", nil, parseErr)
			}
			quantityPerContainer = &parsed
		}
		if containerType == bobdomain.ContainerTypeNone {
			quantityPerContainer = nil
		} else if !slices.Contains([]string{bobdomain.ContainerTypeSolvent, bobdomain.ContainerTypeResin}, containerType) ||
			quantityPerContainer == nil || *quantityPerContainer <= 0 {
			return result, domainError(ErrorValidation, "invalid product container snapshot", nil, nil)
		}
		remark := optionalText(line.Remark)
		if remark != nil && utf8.RuneCountInString(*remark) > 1000 {
			return result, domainError(ErrorValidation, "line remark is too long", nil, nil)
		}
		if total > int64(^uint64(0)>>1)-amount {
			return result, domainError(ErrorValidation, "document amount out of range", nil, nil)
		}
		total += amount
		lines = append(lines, v2FixedLine{Product: product, Ordered: quantity, Price: price,
			Amount: amount, ContainerType: containerType, QuantityPerContainer: quantityPerContainer,
			Remark: remark})
	}
	return v2ResolvedRoot{
		BusinessDate: date, Currency: strings.ToUpper(strings.TrimSpace(data.Currency)),
		Remark: optionalText(data.Remark), Customer: customer, Salesperson: salesperson,
		Settlement: settlement, Lines: lines, Total: total,
	}, nil
}

func insertV2Root(ctx context.Context, tx pgx.Tx, documentID string, data v2ResolvedRoot) error {
	day := data.Settlement.Data.DayOfMonth
	_, err := tx.Exec(ctx, `
		INSERT INTO vou_intermediary_v2_details(
			document_id,customer_object_id,customer_version_id,customer_code,customer_name,
			salesperson_object_id,salesperson_version_id,salesperson_code,salesperson_name,
			contact_name,contact_phone,delivery_address,
			settlement_object_id,settlement_version_id,settlement_code,settlement_name,
			settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),NULLIF($11,''),NULLIF($12,''),
			$13,$14,$15,$16,$17,$18,$19,$20)`,
		documentID, data.Customer.ObjectID, data.Customer.VersionID, data.Customer.Code, data.Customer.Data.Name,
		data.Salesperson.ObjectID, data.Salesperson.VersionID, data.Salesperson.Code, data.Salesperson.Data.Name,
		data.Customer.Data.ContactName, data.Customer.Data.ContactPhone, data.Customer.Data.Address,
		data.Settlement.ObjectID, data.Settlement.VersionID, data.Settlement.Code, data.Settlement.Data.Name,
		data.Settlement.Data.RuleType, data.Settlement.Data.MonthOffset, day, data.Settlement.Data.DayOffset)
	if err != nil {
		return err
	}
	for index, line := range data.Lines {
		_, err = tx.Exec(ctx, `
			INSERT INTO vou_intermediary_v2_lines(
				id,document_id,line_no,product_object_id,product_version_id,product_code,product_name,
				product_unit,ordered_qty_micros,sale_unit_price_cents,line_amount_cents,
				container_type,quantity_per_container_micros,remark
			) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			newID(), documentID, index+1, line.Product.ObjectID, line.Product.VersionID,
			line.Product.Code, line.Product.Data.Name, line.Product.Data.Unit, line.Ordered,
			line.Price, line.Amount, line.ContainerType, line.QuantityPerContainer, line.Remark)
		if err != nil {
			return err
		}
	}
	return nil
}

func lockV2Root(ctx context.Context, tx pgx.Tx, id string) (v2Root, error) {
	var root v2Root
	var date pgtype.Date
	var remark *string
	err := tx.QueryRow(ctx, `
		SELECT id,document_no,status,revision,business_date,currency,total_amount_cents,
		       COALESCE(remark,''),checked_by,approved_by
		FROM vou_documents WHERE id=$1 AND entity='intermediary-sale-order'
		  AND workflow_version=2 FOR UPDATE`, id).Scan(
		&root.ID, &root.DocumentNo, &root.Status, &root.Revision, &date, &root.Currency,
		&root.TotalAmount, &root.Remark, &root.CheckedBy, &root.ApprovedBy)
	if date.Valid {
		root.BusinessDate = date.Time
	}
	_ = remark
	return root, err
}

func v2RootConflict(err error, root v2Root, revision int64, status string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "V2 intermediary document not found", nil, nil)
	}
	if err != nil {
		return err
	}
	if root.Revision != revision || status != "" && root.Status != status {
		return domainError(ErrorConflict, "document changed", map[string]any{
			"rootRevision": root.Revision, "workflowStatus": root.Status,
		}, nil)
	}
	return nil
}

func v2StatusError(root v2Root, expected string) error {
	return domainError(ErrorConflict, "invalid workflow status", map[string]any{
		"rootRevision": root.Revision, "workflowStatus": root.Status, "expected": expected,
	}, nil)
}

func v2Reason(value string) (*string, error) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) < 1 || utf8.RuneCountInString(value) > 1000 {
		return nil, domainError(ErrorValidation, "reason must contain 1 to 1000 characters", nil, nil)
	}
	return &value, nil
}

func insertV2Audit(
	ctx context.Context, tx pgx.Tx, documentID, event string, from *string, to, actorID, requestID,
	stage, childID, childNo, childStatus string, reason *string, summary map[string]any,
) error {
	encoded, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO vou_audit_events(
			id,document_id,entity,event_type,from_status,to_status,actor_id,reason,request_id,summary,
			workflow_version,stage,child_id,child_no,child_status
		) VALUES($1,$2,'intermediary-sale-order',$3,$4,$5,$6,$7,$8,$9,2,
		         NULLIF($10,''),NULLIF($11,''),NULLIF($12,''),NULLIF($13,''))`,
		newID(), documentID, event, from, to, actorID, reason, requestID, encoded,
		stage, childID, childNo, childStatus)
	return err
}

func v2Mutation(root v2Root, revision int64, status string, child *v2Child, balances *IntermediaryBalances) MutationResult {
	result := MutationResult{
		DocumentID: root.ID, DocumentNo: root.DocumentNo, Status: status, Revision: revision,
		RootRevision: revision, WorkflowStatus: status, Balances: balances,
	}
	if child != nil {
		result.ChildID, result.ChildNo = child.ID, child.ChildNo
		result.ChildRevision, result.ChildStatus = child.Revision, child.Status
	}
	return result
}

func int64PtrOrNil(value string) *int64 {
	if value == "" {
		return nil
	}
	parsed, err := quantityMicros(value, false)
	if err != nil {
		return nil
	}
	return &parsed
}

func v2ReferenceError(field string, err error) error {
	return domainError(ErrorConflict, field+" is not currently effective", nil, err)
}

func validateShortClose(ctx context.Context, tx pgx.Tx, documentID string) error {
	var unfinished, remaining int64
	err := tx.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FROM vou_intermediary_children c
		   WHERE c.document_id=$1 AND (
		     c.status IN ('DRAFT','CHECKED')
		     OR (c.stage='DELIVERY' AND c.status='EXECUTED' AND NOT EXISTS(
		       SELECT 1 FROM vou_intermediary_signoffs s JOIN vou_intermediary_children sc ON sc.id=s.child_id
		       WHERE s.delivery_child_id=c.id AND sc.status='CONFIRMED')))),
		  (SELECT count(*) FROM vou_intermediary_v2_lines l
		   WHERE l.document_id=$1 AND COALESCE((
		     SELECT sum(sl.signed_qty_micros) FROM vou_intermediary_signoff_lines sl
		     JOIN vou_intermediary_children sc ON sc.id=sl.child_id
		     WHERE sl.root_line_id=l.id AND sc.status='CONFIRMED'),0) < l.ordered_qty_micros)`,
		documentID).Scan(&unfinished, &remaining)
	if err != nil {
		return err
	}
	if unfinished != 0 {
		return domainError(ErrorConflict, "unfinished child documents block short close", nil, nil)
	}
	if remaining == 0 {
		return domainError(ErrorConflict, "fully signed order cannot be short closed", nil, nil)
	}
	return nil
}
