package productionseed

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/integrations/workflowactions"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	actorID      = systemidentity.UserID
	reviewerID   = "01J00000000000000000000001"
	businessDate = "2026-07-30"
	inputUnitID  = "01JAVX00000000000000000013"
)

type Result struct {
	Created int
	Resumed int
	Skipped int
}

type Seeder struct {
	pool     *pgxpool.Pool
	bob      *bobdomain.Service
	vouchers *voudomain.Service
}

type references struct {
	customer, supplier, employee, warehouse, raw, standard, custom voudomain.ReferenceInput
}

func productLine(product voudomain.ReferenceInput, quantity, price string) voudomain.ProductLineInput {
	return voudomain.ProductLineInput{
		Product:         voudomain.ProductReferenceInput{ObjectID: product.ObjectID},
		EnteredQuantity: quantity, EnteredUnit: voudomain.UnitReferenceInput{ObjectID: inputUnitID},
		BaseQuantity: quantity, UnitPrice: price,
	}
}

func formulaQuantity(quantity string) voudomain.QuantitySnapshotInput {
	return voudomain.QuantitySnapshotInput{
		EnteredQuantity: quantity,
		EnteredUnit:     voudomain.UnitReferenceInput{ObjectID: inputUnitID},
		BaseQuantity:    quantity,
	}
}

func productionLine(
	source string, product *voudomain.ReferenceInput, quantity, loss string,
	material voudomain.ReferenceInput, actual string,
) voudomain.ProductionOutputInput {
	result := voudomain.ProductionOutputInput{
		SourceOrderLineID: source, EnteredQuantity: quantity,
		EnteredUnit:  voudomain.UnitReferenceInput{ObjectID: inputUnitID},
		BaseQuantity: quantity, LossRate: loss,
		Materials: []voudomain.ProductionMaterialInput{{
			FormulaLineNo: 1, ActualMaterial: voudomain.ProductReferenceInput{ObjectID: material.ObjectID},
			ActualEnteredQuantity: actual, ActualEnteredUnit: voudomain.UnitReferenceInput{ObjectID: inputUnitID},
			ActualBaseQuantity: actual,
		}},
	}
	if product != nil {
		ref := voudomain.ProductReferenceInput{ObjectID: product.ObjectID}
		result.Product = &ref
	}
	return result
}

func New(
	pool *pgxpool.Pool,
	attachmentRoot string,
	logger *slog.Logger,
) (*Seeder, error) {
	if pool == nil {
		return nil, errors.New("production demo seed pool is required")
	}
	events := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	auxiliaryResolver := auxiliaryrefs.New(auxiliary)
	bobService := bobdomain.NewService(pool, auxiliaryResolver)
	vouchers, err := voudomain.NewService(
		pool,
		bobService,
		auxiliaryResolver,
		events,
		voudomain.AttachmentOptions{Root: attachmentRoot},
		logger,
		voudomain.WithApprovalAuthorizer(authorization.Func(nil)),
	)
	if err != nil {
		return nil, fmt.Errorf("create VOU service: %w", err)
	}
	if _, err = wfldomain.NewService(pool, events, workflowactions.New(vouchers), logger); err != nil {
		return nil, fmt.Errorf("create WFL service: %w", err)
	}
	return &Seeder{pool: pool, bob: bobService, vouchers: vouchers}, nil
}

func (s *Seeder) Seed(ctx context.Context) (Result, error) {
	refs, err := s.references(ctx)
	if err != nil {
		return Result{}, err
	}
	var result Result
	steps := []func(context.Context, references) (seedOutcome, error){
		s.seedPurchaseStock,
		s.seedSaleOrder,
		s.seedCompletedSelfProduction,
		s.seedDraftOrderProduction,
		s.seedDraftSelfProduction,
	}
	for _, step := range steps {
		outcome, stepErr := step(ctx, refs)
		if stepErr != nil {
			return result, stepErr
		}
		switch outcome {
		case outcomeCreated:
			result.Created++
		case outcomeResumed:
			result.Resumed++
		case outcomeSkipped:
			result.Skipped++
		}
	}
	return result, nil
}

func (s *Seeder) references(ctx context.Context) (references, error) {
	resolve := func(entity, code string) (voudomain.ReferenceInput, error) {
		var objectID string
		err := s.pool.QueryRow(ctx, `
			SELECT subject_id
			FROM approval_events
			WHERE domain='dcl' AND entity=$1 AND request_id=$2 AND action='CREATED'
			ORDER BY created_at,id
			LIMIT 1
		`, entity, "seed-bob-"+code+"-create").Scan(&objectID)
		if err != nil {
			return voudomain.ReferenceInput{}, fmt.Errorf("find BOB demo object %s: %w", code, err)
		}
		if entity == bobdomain.EntityCustomerAccount {
			view, currentErr := s.bob.CustomerAccountCurrentGet(ctx, objectID)
			if currentErr != nil {
				return voudomain.ReferenceInput{}, fmt.Errorf("get BOB demo object %s: %w", code, currentErr)
			}
			return voudomain.ReferenceInput{ObjectID: view.ObjectID, ApprovalEntryID: view.SourceApprovalEntryID}, nil
		}
		view, err := s.bob.Get(ctx, entity, bobdomain.GetInput{ObjectID: objectID})
		if err != nil {
			return voudomain.ReferenceInput{}, fmt.Errorf("get BOB demo object %s: %w", code, err)
		}
		if view.SourceApprovalEntryID == "" {
			return voudomain.ReferenceInput{}, fmt.Errorf("BOB demo object %s has no approved version", code)
		}
		return voudomain.ReferenceInput{
			ObjectID:        view.ObjectID,
			ApprovalEntryID: view.SourceApprovalEntryID,
		}, nil
	}
	var refs references
	values := []struct {
		target *voudomain.ReferenceInput
		entity string
		code   string
	}{
		{&refs.customer, bobdomain.EntityCustomerAccount, "DEMO-CUST-001"},
		{&refs.supplier, bobdomain.EntitySupplier, "DEMO-SUP-003"},
		{&refs.employee, bobdomain.EntityEmployee, "DEMO-EMP-001"},
		{&refs.warehouse, bobdomain.EntityWarehouse, "DEMO-WH-001"},
		{&refs.raw, bobdomain.EntityProduct, "DEMO-PROD-001"},
		{&refs.standard, bobdomain.EntityProduct, "DEMO-FG-001"},
		{&refs.custom, bobdomain.EntityProduct, "DEMO-FG-002"},
	}
	for _, value := range values {
		ref, err := resolve(value.entity, value.code)
		if err != nil {
			return references{}, err
		}
		*value.target = ref
	}
	return refs, nil
}

type seedOutcome int

const (
	outcomeCreated seedOutcome = iota + 1
	outcomeResumed
	outcomeSkipped
)

func (s *Seeder) seedPurchaseStock(ctx context.Context, refs references) (seedOutcome, error) {
	order, orderOutcome, err := s.ensureDocument(
		ctx,
		voudomain.EntityPurchaseOrder,
		"purchase-order",
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntityPurchaseOrder, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: businessDate,
				Currency:     "CNY",
				Remark:       "生产测试数据：原料备货",
				Supplier:     &refs.supplier,
				Purchaser:    &refs.employee,
				Warehouse:    &refs.warehouse,
				ProductLines: []voudomain.ProductLineInput{productLine(refs.raw, "500", "10.00")},
			}}, mustApprovalActor(requestID("purchase-order-create")))
		},
		voudomain.StatusApproved,
	)
	if err != nil {
		return 0, fmt.Errorf("seed production purchase order: %w", err)
	}
	orderView, err := s.vouchers.Get(
		ctx,
		voudomain.EntityPurchaseOrder,
		voudomain.GetInput{DocumentID: order.DocumentID},
	)
	if err != nil {
		return 0, fmt.Errorf("get production purchase order: %w", err)
	}
	if len(orderView.Data.ProductLines) != 1 {
		return 0, errors.New("production purchase order must contain one line")
	}
	_, inboundOutcome, err := s.ensureDocument(
		ctx,
		voudomain.EntityPurchaseInbound,
		"purchase-inbound",
		func() (voudomain.MutationResult, error) {
			return s.vouchers.CreatePurchaseInbound(ctx, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate:     businessDate,
				SourceDocumentID: order.DocumentID,
				Remark:           "生产测试数据：原料入库",
				Warehouse:        &refs.warehouse,
				SourceLines: []voudomain.SourceQuantityLineInput{{
					SourceLineID: orderView.Data.ProductLines[0].LineID,
					BaseQuantity: "500",
				}},
			}}, mustApprovalActor(requestID("purchase-inbound-create")))
		},
		voudomain.StatusApproved,
	)
	if err != nil {
		return 0, fmt.Errorf("seed production purchase inbound: %w", err)
	}
	return combineOutcomes(orderOutcome, inboundOutcome), nil
}

func (s *Seeder) seedSaleOrder(ctx context.Context, refs references) (seedOutcome, error) {
	_, outcome, err := s.ensureDocument(
		ctx,
		voudomain.EntitySaleOrder,
		"sale-order",
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySaleOrder, voudomain.CreateInput{Data: voudomain.DraftInput{
				BusinessDate: businessDate,
				Currency:     "CNY",
				Remark:       "生产配货固定测试订单",
				Customer:     &refs.customer,
				Salesperson:  &refs.employee,
				Warehouse:    &refs.warehouse,
				ProductLines: []voudomain.ProductLineInput{
					func() voudomain.ProductLineInput {
						line := productLine(refs.standard, "100", "80.00")
						line.Formula = fixedFormula(refs.raw, "2")
						return line
					}(),
					func() voudomain.ProductLineInput {
						line := productLine(refs.custom, "60", "120.00")
						line.Formula = &voudomain.FormulaInput{
							Output: formulaQuantity("1"), SourceType: "MANUAL",
							Components: []voudomain.FormulaComponentInput{{
								Material: voudomain.ProductReferenceInput{ObjectID: refs.raw.ObjectID},
								Quantity: formulaQuantity("3"),
							}},
						}
						return line
					}(),
				},
			}}, mustApprovalActor(requestID("sale-order-create")))
		},
		voudomain.StatusApproved,
	)
	if err != nil {
		return 0, fmt.Errorf("seed production sale order: %w", err)
	}
	return outcome, nil
}

func (s *Seeder) seedCompletedSelfProduction(
	ctx context.Context,
	refs references,
) (seedOutcome, error) {
	_, outcome, err := s.ensureDocument(
		ctx,
		voudomain.EntitySelfProduction,
		"self-production-approved",
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySelfProduction, voudomain.CreateInput{
				Data: productionDraft(
					refs,
					"生产自制品固定测试：已批准，材料领料与成品入库已记账",
					"10",
					"5",
					"21",
				),
			}, mustApprovalActor(requestID("self-production-approved-create")))
		},
		voudomain.StatusApproved,
	)
	if err != nil {
		return 0, fmt.Errorf("seed approved self production: %w", err)
	}
	return outcome, nil
}

func (s *Seeder) seedDraftOrderProduction(
	ctx context.Context,
	refs references,
) (seedOutcome, error) {
	orderID, err := s.findDocumentID(ctx, requestID("sale-order-create"))
	if err != nil {
		return 0, fmt.Errorf("find production source sale order: %w", err)
	}
	order, err := s.vouchers.Get(
		ctx,
		voudomain.EntitySaleOrder,
		voudomain.GetInput{DocumentID: orderID},
	)
	if err != nil {
		return 0, err
	}
	if len(order.Data.ProductLines) != 2 {
		return 0, errors.New("production source sale order must contain two lines")
	}
	_, outcome, err := s.ensureDocument(
		ctx,
		voudomain.EntityOrderProduction,
		"order-production-draft",
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntityOrderProduction, voudomain.CreateInput{
				ParentEntity: voudomain.EntitySaleOrder, ParentDocumentID: order.DocumentID,
				Data: voudomain.DraftInput{
					BusinessDate:      businessDate,
					Remark:            "生产配货固定测试：含标准品和客户定制品",
					MaterialWarehouse: &refs.warehouse,
					FinishedWarehouse: &refs.warehouse,
					ProductionLines: []voudomain.ProductionOutputInput{
						productionLine(order.Data.ProductLines[0].LineID, nil, "30", "2", refs.raw, "61.2"),
						productionLine(order.Data.ProductLines[1].LineID, nil, "20", "5", refs.raw, "63"),
					},
				},
			}, mustApprovalActor(requestID("order-production-draft-create")))
		},
		voudomain.StatusDraft,
	)
	if err != nil {
		return 0, fmt.Errorf("seed draft order production: %w", err)
	}
	return outcome, nil
}

func (s *Seeder) seedDraftSelfProduction(
	ctx context.Context,
	refs references,
) (seedOutcome, error) {
	_, outcome, err := s.ensureDocument(
		ctx,
		voudomain.EntitySelfProduction,
		"self-production-draft",
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntitySelfProduction, voudomain.CreateInput{
				Data: productionDraft(
					refs,
					"生产自制品固定测试：草稿，可直接修改损耗率后流转",
					"25",
					"3",
					"51.5",
				),
			}, mustApprovalActor(requestID("self-production-draft-create")))
		},
		voudomain.StatusDraft,
	)
	if err != nil {
		return 0, fmt.Errorf("seed draft self production: %w", err)
	}
	return outcome, nil
}

func productionDraft(
	refs references,
	remark, outputQuantity, lossRate, actualQuantity string,
) voudomain.DraftInput {
	return voudomain.DraftInput{
		BusinessDate:      businessDate,
		Remark:            remark,
		MaterialWarehouse: &refs.warehouse,
		FinishedWarehouse: &refs.warehouse,
		ProductionLines: []voudomain.ProductionOutputInput{
			productionLine("", &refs.standard, outputQuantity, lossRate, refs.raw, actualQuantity),
		},
	}
}

func fixedFormula(raw voudomain.ReferenceInput, materialQuantity string) *voudomain.FormulaInput {
	return &voudomain.FormulaInput{
		Output: formulaQuantity("1"), SourceType: "PRODUCT_FIXED",
		Components: []voudomain.FormulaComponentInput{{
			Material: voudomain.ProductReferenceInput{ObjectID: raw.ObjectID},
			Quantity: formulaQuantity(materialQuantity),
		}},
	}
}

func (s *Seeder) ensureDocument(
	ctx context.Context,
	entity, key string,
	create func() (voudomain.MutationResult, error),
	targetStatus string,
) (voudomain.MutationResult, seedOutcome, error) {
	documentID, err := s.findDocumentID(ctx, requestID(key+"-create"))
	outcome := outcomeResumed
	var current voudomain.MutationResult
	if errors.Is(err, pgx.ErrNoRows) {
		current, err = create()
		if err != nil {
			return current, 0, err
		}
		outcome = outcomeCreated
	} else if err == nil {
		view, getErr := s.vouchers.Get(ctx, entity, voudomain.GetInput{DocumentID: documentID})
		if getErr != nil {
			return current, 0, getErr
		}
		current = voudomain.MutationResult{
			DocumentID: view.DocumentID,
			DocumentNo: view.DocumentNo,
			Approval:   view.Approval,
		}
		if string(current.Approval.Status) == targetStatus {
			return current, outcomeSkipped, nil
		}
		currentRank, currentKnown := productionStatusRank(string(current.Approval.Status))
		targetRank, targetKnown := productionStatusRank(targetStatus)
		if !currentKnown {
			return current, 0, fmt.Errorf(
				"cannot evaluate %s seed status %s",
				entity,
				string(current.Approval.Status),
			)
		}
		if !targetKnown {
			return current, 0, fmt.Errorf("unsupported seed target status %s", targetStatus)
		}
		if currentRank > targetRank {
			return current, outcomeSkipped, nil
		}
	} else {
		return current, 0, err
	}
	current, err = s.advanceDocument(ctx, entity, key, current, targetStatus)
	return current, outcome, err
}

func (s *Seeder) advanceDocument(
	ctx context.Context,
	entity, key string,
	current voudomain.MutationResult,
	targetStatus string,
) (voudomain.MutationResult, error) {
	targetRank, ok := productionStatusRank(targetStatus)
	if !ok {
		return current, fmt.Errorf("unsupported seed target status %s", targetStatus)
	}
	currentRank, ok := productionStatusRank(string(current.Approval.Status))
	if !ok {
		return current, fmt.Errorf("cannot advance %s from status %s", entity, string(current.Approval.Status))
	}
	for currentRank < targetRank {
		var err error
		switch string(current.Approval.Status) {
		case voudomain.StatusDraft:
			current, err = s.vouchers.Submit(ctx, entity, voudomain.DocumentRevisionInput{
				DocumentID: current.DocumentID, Revision: current.Approval.Revision,
			}, mustApprovalActor(requestID(key+"-submit")))
		case voudomain.StatusPending:
			current, err = s.vouchers.Approve(ctx, entity, voudomain.DocumentRevisionInput{
				DocumentID: current.DocumentID, Revision: current.Approval.Revision,
			}, mustApprovalActor(requestID(key+"-approve")))
		default:
			return current, fmt.Errorf("cannot advance %s from status %s", entity, string(current.Approval.Status))
		}
		if err != nil {
			return current, err
		}
		currentRank, ok = productionStatusRank(string(current.Approval.Status))
		if !ok {
			return current, fmt.Errorf("cannot advance %s from status %s", entity, string(current.Approval.Status))
		}
	}
	if currentRank != targetRank {
		return current, fmt.Errorf("%s reached unexpected status %s", entity, string(current.Approval.Status))
	}
	return current, nil
}

func productionStatusRank(status string) (int, bool) {
	switch status {
	case voudomain.StatusDraft:
		return 0, true
	case voudomain.StatusPending:
		return 1, true
	case voudomain.StatusApproved:
		return 2, true
	default:
		return 0, false
	}
}

func (s *Seeder) findDocumentID(ctx context.Context, request string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		SELECT entry.subject_id
		FROM approval_events event
		JOIN approval_entries entry ON entry.id=event.entry_id
		WHERE event.request_id=$1 AND event.action='CREATED' AND entry.domain='vou'
		ORDER BY event.created_at,event.id
		LIMIT 1
	`, request).Scan(&id)
	return id, err
}

func requestID(value string) string {
	return "seed-production-demo-" + value
}

func mustApprovalActor(request string) approval.Actor {
	id := actorID
	if strings.HasSuffix(request, "-approve") || strings.HasSuffix(request, "-reject") {
		id = reviewerID
	}
	actor, err := approval.UserActor(authorization.Principal{ActorID: id}, request)
	if err != nil {
		panic(err)
	}
	return actor
}

func combineOutcomes(values ...seedOutcome) seedOutcome {
	result := outcomeSkipped
	for _, value := range values {
		if value == outcomeCreated {
			return outcomeCreated
		}
		if value == outcomeResumed {
			result = outcomeResumed
		}
	}
	return result
}
