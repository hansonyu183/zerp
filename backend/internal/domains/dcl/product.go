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

type productCurrentWriter interface {
	ReserveProductIdentity(context.Context, pgx.Tx, string) (bobdomain.ProductIdentity, error)
	GetProductIdentity(context.Context, pgx.Tx, string) (bobdomain.ProductIdentity, error)
	ResolveProductDeclaration(context.Context, pgx.Tx, bobdomain.DetailView, bool, bool) (bobdomain.DetailView, error)
	EnsureProductDeclarationReferencesCurrent(context.Context, pgx.Tx, bobdomain.DetailView) error
	ApplyProductCurrent(context.Context, pgx.Tx, string, string, bool, bobdomain.DetailView, string) (bobdomain.ProductCurrent, error)
	RemoveProductCurrent(context.Context, pgx.Tx, string, string) (bobdomain.ProductIdentity, error)
	DeleteProductIdentity(context.Context, pgx.Tx, string, int64) error
	EnsureProductUnapproveAllowed(context.Context, pgx.Tx, string) error
}

type ProductService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	current     productCurrentWriter
	coordinator *approval.Coordinator[dclapproval.ProductPayload]
}

func NewProductService(pool *pgxpool.Pool, current productCurrentWriter, authorizer approval.Authorizer, bus *txevent.Bus) *ProductService {
	if pool == nil || current == nil || authorizer == nil || bus == nil {
		panic("dcl: persistence, BOB current writer, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityProduct, authorizer, bus, dclapproval.ProductTopic)
	if err != nil {
		panic(err)
	}
	return &ProductService{pool: pool, queries: dbsqlc.New(pool), current: current, coordinator: c}
}

func productDeclarationData(data ProductInput) bobdomain.DetailView {
	return bobdomain.DetailView{
		Name: data.Name, CategoryID: data.CategoryID, Specification: data.Specification, Model: data.Model,
		Barcode: data.Barcode, Remark: data.Remark, ProductTypeID: data.ProductTypeID,
		DefaultInputUnitID: data.DefaultInputUnitID, PricingUnitID: data.PricingUnitID,
		UnitConversions: data.UnitConversions, Returnable: data.Returnable,
		DefaultPackagingSpec: data.DefaultPackagingSpec, Formula: data.Formula,
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
func productPayload(i bobdomain.ProductIdentity, enabled bool, data ProductData) dclapproval.ProductPayload {
	return dclapproval.ProductPayload{SubjectID: i.ObjectID, Code: i.Code, Enabled: enabled, Name: data.Name}
}
func productMutation(i bobdomain.ProductIdentity, enabled bool, e approval.Entry) ProductMutation {
	return ProductMutation{ObjectID: i.ObjectID, ObjectRevision: i.ObjectRevision, Enabled: enabled, Approval: approval.VersionMetaFromEntry(e)}
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

// carryProductDraftSources preserves immutable source evidence when a user
// saves unrelated fields on an existing draft. A changed stable ID has no
// carried entry and is resolved to the current approved source by BOB.
func carryProductDraftSources(next *bobdomain.DetailView, previous bobdomain.DetailView) {
	if next.CategoryID == previous.CategoryID {
		next.CategoryCode, next.CategoryName = previous.CategoryCode, previous.CategoryName
	}
	if next.ProductTypeID == previous.ProductTypeID {
		next.ProductTypeCode, next.ProductTypeName = previous.ProductTypeCode, previous.ProductTypeName
		next.BehaviorProfile = previous.BehaviorProfile
	}
	if next.DefaultInputUnitID == previous.DefaultInputUnitID {
	}
	if next.PricingUnitID == previous.PricingUnitID {
	}
	units := make(map[string]bobdomain.MeasurementUnitSnapshot, len(previous.UnitConversions))
	for _, conversion := range previous.UnitConversions {
		units[conversion.Unit.ObjectID] = conversion.Unit
	}
	for index := range next.UnitConversions {
		if unit, ok := units[next.UnitConversions[index].Unit.ObjectID]; ok {
			next.UnitConversions[index].Unit = unit
		}
	}
	if next.Formula == nil || previous.Formula == nil {
		return
	}
	if next.Formula.Output.EnteredUnit.ObjectID == previous.Formula.Output.EnteredUnit.ObjectID {
		next.Formula.Output.EnteredUnit = previous.Formula.Output.EnteredUnit
	}
	components := make(map[string]bobdomain.ProductFormulaComponent, len(previous.Formula.Components))
	for _, component := range previous.Formula.Components {
		components[component.Material.ObjectID] = component
	}
	for index := range next.Formula.Components {
		component := &next.Formula.Components[index]
		old, ok := components[component.Material.ObjectID]
		if !ok {
			continue
		}
		component.Material = old.Material
		component.ResolutionStatus = old.ResolutionStatus
		if component.Quantity.EnteredUnit.ObjectID == old.Quantity.EnteredUnit.ObjectID {
			component.Quantity.EnteredUnit = old.Quantity.EnteredUnit
		}
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
	id, err := s.current.ReserveProductIdentity(ctx, tx, actor.ID())
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	data, err = s.current.ResolveProductDeclaration(ctx, tx, data, false, false)
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	if err = q.InsertDCLSubject(ctx, dbsqlc.InsertDCLSubjectParams{ID: id.ObjectID, Entity: EntityProduct, ActorID: actor.ID()}); err != nil {
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
	id, err := s.current.GetProductIdentity(ctx, tx, input.ObjectID)
	if err != nil {
		return ProductView{}, translateError(err)
	}
	var e approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		e, err = s.coordinator.CreateNextVersion(ctx, tx, input.ObjectID, actor, productPayload(id, input.Enabled, productDCLData(data)))
		if err == nil {
			err = bobdomain.CopyProductSnapshot(ctx, q, e.ID, stored.ID)
		}
		if err == nil {
			previous, loadErr := bobdomain.LoadProductSnapshot(ctx, q, stored.ID)
			if loadErr != nil {
				err = loadErr
			} else {
				carryProductFormulaCandidateSources(&data, previous)
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
		previous, loadErr := bobdomain.LoadProductSnapshot(ctx, q, stored.ID)
		if loadErr != nil {
			err = loadErr
		} else {
			carryProductDraftSources(&data, previous)
		}
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return ProductView{}, translateError(err)
	}
	data, err = s.current.ResolveProductDeclaration(ctx, tx, data, false, stored.Status == string(approval.StatusDraft))
	if err != nil {
		return ProductView{}, translateError(err)
	}
	n, err := bobdomain.DeleteProductSnapshot(ctx, q, e.ID)
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
		ObjectID:       id.ObjectID,
		Entity:         EntityProduct,
		Code:           id.Code,
		ObjectRevision: id.ObjectRevision,
		Enabled:        input.Enabled,
		Approval:       approval.VersionMetaFromEntry(e),
		Data:           productVersionData(data),
		UpdatedAt:      e.UpdatedAt,
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
	id, err := s.current.GetProductIdentity(ctx, tx, input.ObjectID)
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := bobdomain.LoadProductSnapshot(ctx, q, input.ApprovalEntryID)
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	data, err := bobdomain.ValidateProductData(stored)
	if err != nil {
		return ProductMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		data, err = s.current.ResolveProductDeclaration(ctx, tx, data, true, false)
		if err != nil {
			return ProductMutation{}, translateError(err)
		}
		if err = s.current.EnsureProductDeclarationReferencesCurrent(ctx, tx, data); err != nil {
			return ProductMutation{}, newError(ErrorConflict, "product_reference_drift", "product declaration references changed", nil, err)
		}
		if err = bobdomain.ValidateProductComplete(data); err != nil {
			return ProductMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.current.EnsureProductUnapproveAllowed(ctx, tx, input.ApprovalEntryID); err != nil {
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
	resultID, resultEnabled := id, stored.Enabled
	if action == approval.ActionApproved {
		c, applyErr := s.current.ApplyProductCurrent(ctx, tx, input.ObjectID, e.ID, stored.Enabled, data, actor.ID())
		if applyErr != nil {
			return ProductMutation{}, translateError(applyErr)
		}
		resultID, resultEnabled = c.ProductIdentity, c.Enabled
	}
	if action == approval.ActionUnapproved {
		resultID, resultEnabled, err = s.restoreLatestApproved(ctx, tx, id, actor.ID())
		if err != nil {
			return ProductMutation{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return ProductMutation{}, translateError(err)
	}
	return productMutation(resultID, resultEnabled, e), nil
}

func (s *ProductService) restoreLatestApproved(ctx context.Context, tx pgx.Tx, id bobdomain.ProductIdentity, actorID string) (bobdomain.ProductIdentity, bool, error) {
	latest, err := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityProduct, SubjectID: id.ObjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		r, e := s.current.RemoveProductCurrent(ctx, tx, id.ObjectID, actorID)
		return r, false, translateError(e)
	}
	if err != nil {
		return bobdomain.ProductIdentity{}, false, translateError(err)
	}
	stored, err := bobdomain.LoadProductSnapshot(ctx, s.queries.WithTx(tx), latest.ID)
	if err != nil {
		return bobdomain.ProductIdentity{}, false, translateError(err)
	}
	d, err := bobdomain.ValidateProductData(stored)
	if err != nil {
		return bobdomain.ProductIdentity{}, false, translateError(err)
	}
	c, err := s.current.ApplyProductCurrent(ctx, tx, id.ObjectID, latest.ID, stored.Enabled, d, actorID)
	return c.ProductIdentity, c.Enabled, translateError(err)
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
	id, err := s.current.GetProductIdentity(ctx, tx, input.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityProduct})
	if err != nil || e.SubjectID != input.ObjectID {
		return translateError(newError(ErrorValidation, "validation_failed", "declaration not found", nil, err))
	}
	stored, err := bobdomain.LoadProductSnapshot(ctx, q, e.ID)
	if err != nil {
		return translateError(err)
	}
	if n, er := bobdomain.DeleteProductSnapshot(ctx, q, e.ID); er != nil || n != 1 {
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
		if err = s.current.DeleteProductIdentity(ctx, tx, input.ObjectID, id.ObjectRevision); err != nil {
			return translateError(err)
		}
	} else if latestErr != nil {
		return translateError(latestErr)
	}
	return translateError(tx.Commit(ctx))
}

func insertProductVersion(ctx context.Context, q *dbsqlc.Queries, id string, enabled bool, d bobdomain.DetailView) error {
	d.Enabled = enabled
	return bobdomain.StoreProductSnapshot(ctx, q, id, d)
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
