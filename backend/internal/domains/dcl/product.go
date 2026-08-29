package dcl

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type productRules interface {
	ResolveProductDeclaration(context.Context, pgx.Tx, bobdomain.DetailView, bool, bool) (bobdomain.DetailView, error)
	ResolveProductDraftDeclaration(context.Context, pgx.Tx, bobdomain.DetailView, bobdomain.DetailView) (bobdomain.DetailView, error)
	EnsureProductDeclarationReferencesCurrent(context.Context, pgx.Tx, bobdomain.DetailView) error
	EnsureProductUnapproveAllowed(context.Context, pgx.Tx, string) error
}

type ProductService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       productRules
	coordinator *approval.Coordinator[dclapproval.ProductPayload]
}

func NewProductService(pool *pgxpool.Pool, rules productRules, authorizer approval.Authorizer, bus *txevent.Bus) *ProductService {
	if pool == nil || rules == nil || authorizer == nil || bus == nil {
		panic("dcl: persistence, business rules, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityProduct, authorizer, bus, dclapproval.ProductTopic)
	if err != nil {
		panic(err)
	}
	return &ProductService{pool: pool, queries: dbsqlc.New(pool), rules: rules, coordinator: c}
}

func productDeclarationData(data ProductInput) bobdomain.DetailView {
	unitConversions := make([]bobdomain.ProductUnitConversion, 0, len(data.UnitConversions))
	for _, conversion := range data.UnitConversions {
		unitConversions = append(unitConversions, bobdomain.ProductUnitConversion{
			Unit:   bobdomain.MeasurementUnitSnapshot{ObjectID: conversion.Unit.ObjectID},
			Factor: conversion.Factor,
		})
	}
	var formula *bobdomain.ProductFormula
	if data.Formula != nil {
		components := make([]bobdomain.ProductFormulaComponent, 0, len(data.Formula.Components))
		for _, component := range data.Formula.Components {
			components = append(components, bobdomain.ProductFormulaComponent{
				Material: bobdomain.FormulaMaterialReference{ObjectID: component.Material.ObjectID, ApprovalEntryID: component.Material.ApprovalEntryID},
				Quantity: bobdomain.QuantitySnapshot{
					EnteredQuantity: component.Quantity.EnteredQuantity,
					EnteredUnit:     bobdomain.MeasurementUnitSnapshot{ObjectID: component.Quantity.EnteredUnit.ObjectID},
					BaseQuantity:    component.Quantity.BaseQuantity,
				},
				ResolutionStatus: component.ResolutionStatus, RequiresConfirmation: component.RequiresConfirmation,
			})
		}
		formula = &bobdomain.ProductFormula{
			Output: bobdomain.QuantitySnapshot{
				EnteredQuantity: data.Formula.Output.EnteredQuantity,
				EnteredUnit:     bobdomain.MeasurementUnitSnapshot{ObjectID: data.Formula.Output.EnteredUnit.ObjectID},
				BaseQuantity:    data.Formula.Output.BaseQuantity,
			},
			Components: components,
		}
	}
	return bobdomain.DetailView{
		Name: data.Name, CategoryID: data.CategoryID, Specification: data.Specification, Model: data.Model,
		Barcode: data.Barcode, Remark: data.Remark, ProductTypeID: data.ProductTypeID,
		DefaultInputUnitID: data.DefaultInputUnitID, PricingUnitID: data.PricingUnitID,
		UnitConversions: unitConversions, Returnable: data.Returnable,
		DefaultPackagingSpec: data.DefaultPackagingSpec, Formula: formula,
	}
}

// ProductInputFromData strips resolved read snapshots back to the DCL-owned
// mutable fields used when an internal caller edits an existing declaration.
func ProductInputFromData(data ProductData) ProductInput {
	unitConversions := make([]ProductUnitConversionInput, 0, len(data.UnitConversions))
	for _, conversion := range data.UnitConversions {
		unitConversions = append(unitConversions, ProductUnitConversionInput{
			Unit:   MeasurementUnitReferenceInput{ObjectID: conversion.Unit.ObjectID},
			Factor: conversion.Factor,
		})
	}
	var formula *ProductFormulaInput
	if data.Formula != nil {
		components := make([]ProductFormulaComponentInput, 0, len(data.Formula.Components))
		for _, component := range data.Formula.Components {
			components = append(components, ProductFormulaComponentInput{
				Material: ProductFormulaMaterialInput{
					ObjectID:        component.Material.ObjectID,
					ApprovalEntryID: component.Material.ApprovalEntryID,
				},
				Quantity: ProductQuantityInput{
					EnteredQuantity: component.Quantity.EnteredQuantity,
					EnteredUnit:     MeasurementUnitReferenceInput{ObjectID: component.Quantity.EnteredUnit.ObjectID},
					BaseQuantity:    component.Quantity.BaseQuantity,
				},
				ResolutionStatus:     component.ResolutionStatus,
				RequiresConfirmation: component.RequiresConfirmation,
			})
		}
		formula = &ProductFormulaInput{
			Output: ProductQuantityInput{
				EnteredQuantity: data.Formula.Output.EnteredQuantity,
				EnteredUnit:     MeasurementUnitReferenceInput{ObjectID: data.Formula.Output.EnteredUnit.ObjectID},
				BaseQuantity:    data.Formula.Output.BaseQuantity,
			},
			Components: components,
		}
	}
	return ProductInput{
		Name: data.Name, CategoryID: data.CategoryID,
		Specification: data.Specification, Model: data.Model, Barcode: data.Barcode, Remark: data.Remark,
		ProductTypeID: data.ProductTypeID, DefaultInputUnitID: data.DefaultInputUnitID,
		PricingUnitID: data.PricingUnitID, UnitConversions: unitConversions,
		Returnable: data.Returnable, DefaultPackagingSpec: data.DefaultPackagingSpec, Formula: formula,
	}
}
func productDCLData(data bobdomain.DetailView) ProductData {
	return ProductData{
		Name: data.Name, CategoryID: data.CategoryID,
		CategoryCode: data.CategoryCode, CategoryName: data.CategoryName,
		Specification: data.Specification, Model: data.Model, Barcode: data.Barcode, Remark: data.Remark,
		ProductTypeID:   data.ProductTypeID,
		ProductTypeCode: data.ProductTypeCode, ProductTypeName: data.ProductTypeName, BehaviorProfile: data.BehaviorProfile,
		DefaultInputUnitID: data.DefaultInputUnitID,
		PricingUnitID:      data.PricingUnitID,
		UnitConversions:    data.UnitConversions, Returnable: data.Returnable,
		DefaultPackagingSpec: data.DefaultPackagingSpec, Formula: data.Formula,
	}
}
func productPayload(i subjectIdentity, enabled bool, data ProductData) dclapproval.ProductPayload {
	return dclapproval.ProductPayload{SubjectID: i.ObjectID, Code: i.Code, Enabled: enabled, Name: data.Name}
}
func productMutation(i subjectIdentity, enabled bool, e approval.Entry) ProductMutation {
	return ProductMutation{ObjectID: i.ObjectID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(e)}
}
func productInput(i ProductReviewInput) ProductVersionInput {
	return ProductVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}
}
func productVersionData(r bobdomain.DetailView) ProductData { return productDCLData(r) }

// carryProductFormulaCandidateSources compares the complete replacement input
// with the approved base before resolving stable material IDs. Unchanged lines
// retain their exact source entry; added/replaced lines require confirmation.
func carryProductFormulaCandidateSources(next *bobdomain.DetailView, previous bobdomain.DetailView) {
	if next.Formula == nil {
		return
	}
	byMaterial := map[string]bobdomain.ProductFormulaComponent{}
	if previous.Formula != nil {
		for _, component := range previous.Formula.Components {
			byMaterial[component.Material.ObjectID] = component
		}
	}
	for index := range next.Formula.Components {
		component := &next.Formula.Components[index]
		old, exists := byMaterial[component.Material.ObjectID]
		if !exists {
			component.RequiresConfirmation = true
			continue
		}
		component.Material.ApprovalEntryID = old.Material.ApprovalEntryID
	}
}

func (s *ProductService) Create(ctx context.Context, input ProductCreateInput, actor approval.Actor) (ProductMutation, error) {
	data, err := bobdomain.ValidateProductData(productDeclarationData(input.Data))
	if err != nil || !validActor(actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid product declaration create request", nil, nil)
		}
		return ProductMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id, err := reserveSubject(ctx, tx, EntityProduct, "PRD", actor.ID())
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	data, err = s.rules.ResolveProductDeclaration(ctx, tx, data, false, false)
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	e, err := s.coordinator.CreateFirstVersion(ctx, tx, id.ObjectID, actor, productPayload(id, true, productDCLData(data)))
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	if err = insertProductVersion(ctx, q, e.ID, true, data); err != nil {
		return ProductMutation{}, translateError(err)
	}
	if err = refreshProductBarcodeClaims(ctx, q, id.ObjectID); err != nil {
		return ProductMutation{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ProductMutation{}, translateError(err)
	}
	return productMutation(id, true, e), nil
}

func (s *ProductService) Save(ctx context.Context, input ProductSaveInput, actor approval.Actor) (ProductView, error) {
	data, err := bobdomain.ValidateProductData(productDeclarationData(input.Data))
	if err != nil || !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid product declaration save request", nil, nil)
		}
		return ProductView{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProductView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return ProductView{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityProduct})
	if err != nil || stored.SubjectID != input.ObjectID || stored.Revision != input.ApprovalRevision {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
		}
		return ProductView{}, translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityProduct, input.ObjectID)
	if err != nil {
		return ProductView{}, translateError(err)
	}
	var e approval.Entry
	var draftPrevious *bobdomain.DetailView
	if stored.Status == string(approval.StatusApproved) {
		e, err = s.coordinator.CreateNextVersion(ctx, tx, input.ObjectID, actor, productPayload(id, input.Enabled, productDCLData(data)))
		if err == nil {
			err = copyProductSnapshot(ctx, q, e.ID, stored.ID)
		}
		if err == nil {
			previous, loadErr := bobdomain.LoadDCLProductSnapshot(ctx, q, stored.ID)
			if loadErr != nil {
				err = loadErr
			} else {
				carryProductFormulaCandidateSources(&data, previous)
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
		previous, loadErr := bobdomain.LoadDCLProductSnapshot(ctx, q, stored.ID)
		if loadErr != nil {
			err = loadErr
		} else {
			draftPrevious = &previous
		}
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return ProductView{}, translateError(err)
	}
	if draftPrevious != nil {
		data, err = s.rules.ResolveProductDraftDeclaration(ctx, tx, data, *draftPrevious)
	} else {
		data, err = s.rules.ResolveProductDeclaration(ctx, tx, data, false, false)
	}
	if err != nil {
		return ProductView{}, translateError(err)
	}
	n, err := deleteProductSnapshot(ctx, q, e.ID)
	if err == nil && n == 1 {
		err = insertProductVersion(ctx, q, e.ID, input.Enabled, data)
	}
	if err != nil || n != 1 {
		if err == nil {
			err = errors.New("product declaration snapshot is missing")
		}
		return ProductView{}, translateError(err)
	}
	e, err = s.coordinator.SaveDraft(ctx, tx, e.ID, e.Revision, actor, productPayload(id, input.Enabled, productDCLData(data)))
	if err != nil {
		return ProductView{}, translateError(err)
	}
	if err = refreshProductBarcodeClaims(ctx, q, input.ObjectID); err != nil {
		return ProductView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ProductView{}, translateError(err)
	}
	return ProductView{
		ObjectID:  id.ObjectID,
		Entity:    EntityProduct,
		Code:      id.Code,
		Enabled:   input.Enabled,
		Approval:  approval.VersionMetaFromEntry(e),
		Data:      productVersionData(data),
		UpdatedAt: e.UpdatedAt,
	}, nil
}

func (s *ProductService) Submit(ctx context.Context, i ProductVersionInput, a approval.Actor) (ProductMutation, error) {
	return s.transition(ctx, i, "", approval.ActionSubmitted, a)
}
func (s *ProductService) Unsubmit(ctx context.Context, i ProductReviewInput, a approval.Actor) (ProductMutation, error) {
	return s.transition(ctx, productInput(i), "", approval.ActionUnsubmitted, a)
}
func (s *ProductService) Reject(ctx context.Context, i ProductReviewInput, a approval.Actor) (ProductMutation, error) {
	return s.transition(ctx, productInput(i), strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}
func (s *ProductService) Approve(ctx context.Context, i ProductVersionInput, a approval.Actor) (ProductMutation, error) {
	return s.transition(ctx, i, "", approval.ActionApproved, a)
}
func (s *ProductService) Unapprove(ctx context.Context, i ProductReviewInput, a approval.Actor) (ProductMutation, error) {
	return s.transition(ctx, productInput(i), strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}

func (s *ProductService) transition(ctx context.Context, input ProductVersionInput, reason string, action approval.Action, actor approval.Actor) (ProductMutation, error) {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return ProductMutation{}, newError(ErrorValidation, "validation_failed", "invalid product declaration lifecycle request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	p, err := s.coordinator.Prepare(ctx, tx, action, input.ApprovalEntryID, input.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != input.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "approval entry does not belong to product", nil, nil)
		}
		return ProductMutation{}, translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityProduct, input.ObjectID)
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := bobdomain.LoadDCLProductSnapshot(ctx, q, input.ApprovalEntryID)
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	data, err := bobdomain.ValidateProductData(stored)
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		data, err = s.rules.ResolveProductDeclaration(ctx, tx, data, true, false)
		if err != nil {
			return ProductMutation{}, translateError(err)
		}
		if err = s.rules.EnsureProductDeclarationReferencesCurrent(ctx, tx, data); err != nil {
			return ProductMutation{}, newError(ErrorConflict, "product_reference_drift", "product declaration references changed", nil, err)
		}
		if err = bobdomain.ValidateProductComplete(data); err != nil {
			return ProductMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureProductUnapproveAllowed(ctx, tx, input.ApprovalEntryID); err != nil {
			return ProductMutation{}, translateError(err)
		}
	}
	e, err := s.coordinator.Commit(ctx, tx, p, productPayload(id, stored.Enabled, productDCLData(data)))
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	if err = refreshProductBarcodeClaims(ctx, q, input.ObjectID); err != nil {
		return ProductMutation{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ProductMutation{}, translateError(err)
	}
	return productMutation(id, stored.Enabled, e), nil
}

func (s *ProductService) Delete(ctx context.Context, input ProductDeleteInput, actor approval.Actor) error {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid product declaration delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityProduct, input.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityProduct})
	if err != nil || e.SubjectID != input.ObjectID {
		return translateError(newError(ErrorValidation, "validation_failed", "declaration not found", nil, err))
	}
	stored, err := bobdomain.LoadDCLProductSnapshot(ctx, q, e.ID)
	if err != nil {
		return translateError(err)
	}
	if n, er := deleteProductSnapshot(ctx, q, e.ID); er != nil || n != 1 {
		if er == nil {
			er = errors.New("product declaration snapshot changed")
		}
		return translateError(er)
	}
	if err = refreshProductBarcodeClaims(ctx, q, input.ObjectID); err != nil {
		return err
	}
	d := productVersionData(stored)
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, e.ID, input.ApprovalRevision, actor, productPayload(id, stored.Enabled, d)); err != nil {
		return translateError(err)
	}
	_, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityProduct, SubjectID: input.ObjectID})
	if errors.Is(latestErr, pgx.ErrNoRows) {
		if n, er := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: input.ObjectID, Entity: EntityProduct}); er != nil || n != 1 {
			if er == nil {
				er = errors.New("DCL subject changed")
			}
			return translateError(er)
		}
	} else if latestErr != nil {
		return translateError(latestErr)
	}
	return translateError(tx.Commit(ctx))
}

func insertProductVersion(ctx context.Context, q *dbsqlc.Queries, id string, enabled bool, d bobdomain.DetailView) error {
	d.Enabled = enabled
	return storeProductSnapshot(ctx, q, id, d)
}

func refreshProductBarcodeClaims(ctx context.Context, q *dbsqlc.Queries, objectID string) error {
	if err := q.LockDCLProductBarcodeClaims(ctx); err != nil {
		return translateError(err)
	}
	if _, err := q.FindDCLProductBarcodeConflict(ctx, objectID); err == nil {
		return newError(ErrorConflict, "product_barcode_conflict", "product barcode is already occupied", map[string]string{"field": "barcode"}, nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return translateError(err)
	}
	if err := q.DeleteDCLProductBarcodeClaims(ctx, objectID); err != nil {
		return translateError(err)
	}
	return translateError(q.RebuildDCLProductBarcodeClaims(ctx, objectID))
}
