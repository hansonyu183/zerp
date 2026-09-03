package vou

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

const productionPercentScale int64 = 100_000_000

type fixedProductionMaterial struct {
	FormulaLineNo         int32
	FormulaMaterial       ReferenceView
	FormulaQuantity       int64
	SuggestedQuantity     int64
	ActualMaterial        bobdomain.EffectiveReference
	ActualEnteredQuantity int64
	ActualEnteredUnit     bobdomain.MeasurementUnitSnapshot
	ActualQuantity        int64
	AdjustmentReason      *string
}

type fixedProductionOutput struct {
	SourceOrderLineID         *string
	Product                   bobdomain.EffectiveReference
	EnteredQuantity           int64
	EnteredUnit               bobdomain.MeasurementUnitSnapshot
	OutputQuantity            int64
	LossRate                  int64
	FormulaBaseOutputQuantity int64
	Remark                    *string
	Materials                 []fixedProductionMaterial
}

type fixedProductionDraft struct {
	BusinessDate      time.Time
	Remark            *string
	MaterialWarehouse bobdomain.EffectiveReference
	FinishedWarehouse bobdomain.EffectiveReference
	Outputs           []fixedProductionOutput
}

type productionFormulaComponent struct {
	Material ReferenceView
	Quantity int64
}

type productionFormula struct {
	BaseOutputQuantity int64
	Components         []productionFormulaComponent
}

func isProductionEntity(entity string) bool {
	return entity == EntityOrderProduction || entity == EntitySelfProduction
}

func (s *Service) CreateProduction(
	ctx context.Context,
	entity string,
	input CreateInput,
	actor approval.Actor,
) (MutationResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
	if !isProductionEntity(entity) || !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid production create request", nil, nil)
	}
	parentEntity, parentID, err := validateParentInput(input.ParentEntity, input.ParentDocumentID)
	if err != nil {
		return MutationResult{}, err
	}
	if entity == EntityOrderProduction {
		if parentEntity != EntitySaleOrder || parentID == "" {
			return MutationResult{}, domainError(
				ErrorValidation, "order production parent must be a sale order", nil, nil,
			)
		}
	} else if parentEntity != "" || parentID != "" {
		return MutationResult{}, domainError(
			ErrorValidation, "self production cannot have a source document", nil, nil,
		)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin production create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	draft, err := s.prepareProductionDraft(ctx, tx, entity, parentID, "", input.Data, nil)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.guardVOUWrite(ctx, tx, draft.BusinessDate); err != nil {
		return MutationResult{}, err
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: entity, BusinessDate: dateValue(draft.BusinessDate),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "document number exhausted", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("allocate production number", err)
	}
	documentID := newID()
	documentNo := fmt.Sprintf(
		"%s-%s-%04d", entityPrefix(entity), draft.BusinessDate.Format("20060102"), counter,
	)
	entry, err := s.createDocumentApproval(ctx, tx, entity, documentID, actor)
	if err != nil {
		return MutationResult{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO vou_documents(
		id,entity,document_no,approval_entry_id,business_date,currency,total_amount_cents,remark,
		parent_entity,parent_document_id
	) VALUES($1,$2,$3,$4,$5,NULL,0,$6,$7,$8)`,
		documentID, entity, documentNo, entry.ID, draft.BusinessDate, draft.Remark,
		nullableString(parentEntity), nullableString(parentID))
	if err != nil {
		return MutationResult{}, s.writeError("insert production document", err)
	}
	if err = s.insertProductionDraft(ctx, tx, entity, documentID, draft); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{
		Entity: entity, DocumentID: documentID, DocumentNo: documentNo, Revision: 1,
		ParentEntity: parentEntity, ParentDocumentID: parentID,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.eventError("publish production created", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit production create", err)
	}
	return MutationResult{
		DocumentID: documentID, DocumentNo: documentNo, Approval: approval.MetaFromEntry(entry),
	}, nil
}

func (s *Service) SaveProduction(
	ctx context.Context,
	entity string,
	input SaveInput,
	actor approval.Actor,
) (MutationResult, error) {
	if !isProductionEntity(entity) {
		return MutationResult{}, domainError(ErrorValidation, "invalid production entity", nil, nil)
	}
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	businessDate, err := parseBusinessDate(input.Data.BusinessDate)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin production save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := s.lockDocumentForWriteDates(ctx, tx, input.DocumentID, entity, businessDate)
	if err = documentWriteConflict(
		err, document.Revision, input.Revision, document.Status, StatusDraft,
	); err != nil {
		return MutationResult{}, err
	}
	coordinator, prepared, err := s.prepareDraftSave(ctx, tx, document, input.Revision, actor)
	if err != nil {
		return MutationResult{}, err
	}
	parentID := deref(document.ParentDocumentID)
	saved, err := s.loadData(ctx, q, document)
	if err != nil {
		return MutationResult{}, err
	}
	draft, err := s.prepareProductionDraft(
		ctx, tx, entity, parentID, input.DocumentID, input.Data, &saved,
	)
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_production_material_lines
		WHERE output_line_id IN (
			SELECT id FROM vou_production_output_lines WHERE document_id=$1
		)`,
		input.DocumentID); err != nil {
		return MutationResult{}, s.writeError("replace production lines", err)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_production_output_lines WHERE document_id=$1`,
		input.DocumentID); err != nil {
		return MutationResult{}, s.writeError("replace production lines", err)
	}
	if _, err = tx.Exec(ctx, `UPDATE vou_production_details SET
		material_warehouse_object_id=$2,material_warehouse_approval_entry_id=$3,
		material_warehouse_code=$4,material_warehouse_name=$5,
		finished_warehouse_object_id=$6,finished_warehouse_approval_entry_id=$7,
		finished_warehouse_code=$8,finished_warehouse_name=$9
		WHERE document_id=$1`,
		input.DocumentID,
		draft.MaterialWarehouse.ObjectID, draft.MaterialWarehouse.ApprovalEntryID,
		draft.MaterialWarehouse.Code, draft.MaterialWarehouse.Data.Name,
		draft.FinishedWarehouse.ObjectID, draft.FinishedWarehouse.ApprovalEntryID,
		draft.FinishedWarehouse.Code, draft.FinishedWarehouse.Data.Name,
	); err != nil {
		return MutationResult{}, s.writeError("update production warehouses", err)
	}
	if err = s.insertProductionLines(ctx, tx, input.DocumentID, draft.Outputs); err != nil {
		return MutationResult{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE vou_documents SET
		business_date=$1,currency=NULL,total_amount_cents=0,remark=$2
		WHERE id=$3 AND entity=$4`,
		draft.BusinessDate, draft.Remark, input.DocumentID, entity)
	if err != nil {
		return MutationResult{}, s.writeError("update production draft", err)
	}
	entry, err := s.commitDraftSave(ctx, tx, q, document, coordinator, prepared)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit production save", err)
	}
	return MutationResult{
		DocumentID: input.DocumentID, DocumentNo: document.DocumentNo,
		Approval: approval.MetaFromEntry(entry),
	}, nil
}

func (s *Service) prepareProductionDraft(
	ctx context.Context,
	tx pgx.Tx,
	entity, parentID, excludedDocumentID string,
	input DraftInput,
	saved *DocumentDataView,
) (fixedProductionDraft, error) {
	if strings.TrimSpace(input.Currency) != "" || input.Customer != nil || input.Supplier != nil ||
		input.Counterparty != nil || input.Employee != nil || input.Salesperson != nil ||
		input.Purchaser != nil || input.Handler != nil || input.Warehouse != nil ||
		input.Carrier != nil || input.Vehicle != nil || input.FundAccount != nil ||
		strings.TrimSpace(input.SourceName) != "" || strings.TrimSpace(input.Amount) != "" ||
		len(input.ProductLines) != 0 || len(input.ExpenseLines) != 0 ||
		len(input.SourceLines) != 0 || len(input.SignoffLines) != 0 || len(input.ReturnLines) != 0 {
		return fixedProductionDraft{}, domainError(
			ErrorValidation, "fields do not match production entity", nil, nil,
		)
	}
	businessDate, err := time.Parse(dateLayout, strings.TrimSpace(input.BusinessDate))
	if err != nil {
		return fixedProductionDraft{}, domainError(ErrorValidation, "invalid businessDate", nil, nil)
	}
	remark := optionalText(input.Remark)
	if remark != nil && utf8.RuneCountInString(*remark) > 1000 {
		return fixedProductionDraft{}, domainError(ErrorValidation, "remark is too long", nil, nil)
	}
	if err = validateReference(input.MaterialWarehouse, "materialWarehouse", true); err != nil {
		return fixedProductionDraft{}, err
	}
	if err = validateReference(input.FinishedWarehouse, "finishedWarehouse", true); err != nil {
		return fixedProductionDraft{}, err
	}
	if len(input.ProductionLines) == 0 || len(input.ProductionLines) > 200 {
		return fixedProductionDraft{}, domainError(
			ErrorValidation, "productionLines must contain 1 to 200 items", nil, nil,
		)
	}
	var savedMaterialWarehouse, savedFinishedWarehouse *bobdomain.EffectiveReference
	if saved != nil && saved.MaterialWarehouse != nil {
		savedMaterialWarehouse = &bobdomain.EffectiveReference{ObjectID: saved.MaterialWarehouse.ObjectID, ApprovalEntryID: saved.MaterialWarehouse.ApprovalEntryID}
	}
	if saved != nil && saved.FinishedWarehouse != nil {
		savedFinishedWarehouse = &bobdomain.EffectiveReference{ObjectID: saved.FinishedWarehouse.ObjectID, ApprovalEntryID: saved.FinishedWarehouse.ApprovalEntryID}
	}
	materialWarehouse, err := s.resolveSelectedReference(ctx, tx, bobdomain.EntityWarehouse,
		input.MaterialWarehouse, savedMaterialWarehouse, saved == nil)
	if err != nil {
		return fixedProductionDraft{}, err
	}
	finishedWarehouse, err := s.resolveSelectedReference(ctx, tx, bobdomain.EntityWarehouse,
		input.FinishedWarehouse, savedFinishedWarehouse, saved == nil)
	if err != nil {
		return fixedProductionDraft{}, err
	}
	result := fixedProductionDraft{
		BusinessDate: businessDate, Remark: remark,
		MaterialWarehouse: *materialWarehouse, FinishedWarehouse: *finishedWarehouse,
		Outputs: make([]fixedProductionOutput, 0, len(input.ProductionLines)),
	}
	if entity == EntityOrderProduction {
		if !validID(parentID) {
			return fixedProductionDraft{}, domainError(
				ErrorValidation, "invalid production source order", nil, nil,
			)
		}
		var status string
		if err = tx.QueryRow(ctx, `SELECT a.status FROM vou_documents d
			JOIN approval_entries a ON a.id=d.approval_entry_id AND a.domain='vou'
				AND a.entity=d.entity AND a.subject_id=d.id
			WHERE d.id=$1 AND d.entity='sale-order' FOR UPDATE OF d,a`, parentID).Scan(&status); err != nil {
			return fixedProductionDraft{}, domainError(
				ErrorConflict, "production source order is unavailable", nil, err,
			)
		}
		if status != StatusApproved {
			return fixedProductionDraft{}, domainError(
				ErrorConflict, "production source order is not approved", nil, nil,
			)
		}
	}
	seenProducts := make(map[string]bool, len(input.ProductionLines))
	seenSources := make(map[string]bool, len(input.ProductionLines))
	for _, outputInput := range input.ProductionLines {
		output, outputErr := s.prepareProductionOutput(
			ctx, tx, entity, parentID, outputInput,
		)
		if outputErr != nil {
			return fixedProductionDraft{}, outputErr
		}
		if seenProducts[output.Product.ObjectID] {
			return fixedProductionDraft{}, domainError(
				ErrorValidation, "duplicate production product", nil, nil,
			)
		}
		seenProducts[output.Product.ObjectID] = true
		if output.SourceOrderLineID != nil {
			if seenSources[*output.SourceOrderLineID] {
				return fixedProductionDraft{}, domainError(
					ErrorValidation, "duplicate production source line", nil, nil,
				)
			}
			seenSources[*output.SourceOrderLineID] = true
		}
		result.Outputs = append(result.Outputs, output)
	}
	if entity == EntityOrderProduction {
		for _, output := range result.Outputs {
			var reserved int64
			err = tx.QueryRow(ctx, `SELECT COALESCE(sum(line.base_quantity_micros),0)::bigint
				FROM vou_production_output_lines line
				JOIN vou_documents document ON document.id=line.document_id
				WHERE line.source_order_line_id=$1
				  AND ($2='' OR line.document_id<>$2)`,
				*output.SourceOrderLineID, excludedDocumentID).Scan(&reserved)
			if err != nil {
				return fixedProductionDraft{}, s.internal("read reserved production quantity", err)
			}
			var ordered int64
			if err = tx.QueryRow(ctx, `SELECT base_quantity_micros FROM vou_product_lines
				WHERE id=$1 AND document_id=$2`, *output.SourceOrderLineID, parentID).
				Scan(&ordered); err != nil {
				return fixedProductionDraft{}, s.internal("read production source quantity", err)
			}
			if reserved > ordered-output.OutputQuantity {
				return fixedProductionDraft{}, domainError(
					ErrorConflict, "production quantity exceeds sale order line",
					map[string]any{"sourceOrderLineId": *output.SourceOrderLineID}, nil,
				)
			}
		}
	}
	return result, nil
}

func (s *Service) prepareProductionOutput(
	ctx context.Context,
	tx pgx.Tx,
	entity, parentID string,
	input ProductionOutputInput,
) (fixedProductionOutput, error) {
	enteredQuantity, err := quantityMicros(input.EnteredQuantity, false)
	if err != nil {
		return fixedProductionOutput{}, domainError(
			ErrorValidation, "invalid production entered quantity", nil, err,
		)
	}
	outputQuantity, err := quantityMicros(input.BaseQuantity, false)
	if err != nil {
		return fixedProductionOutput{}, domainError(
			ErrorValidation, "invalid production output quantity", nil, err,
		)
	}
	lossRate, err := parseFixed(input.LossRate, 6, true)
	if err != nil || lossRate < 0 || lossRate > productionPercentScale {
		return fixedProductionOutput{}, domainError(
			ErrorValidation, "lossRate must be between 0 and 100", nil, err,
		)
	}
	remark, err := lineRemark(input.Remark)
	if err != nil {
		return fixedProductionOutput{}, err
	}
	var product bobdomain.EffectiveReference
	var formula productionFormula
	var sourceLineID *string
	if entity == EntityOrderProduction {
		source := strings.TrimSpace(input.SourceOrderLineID)
		if !validID(source) || input.Product != nil {
			return fixedProductionOutput{}, domainError(
				ErrorValidation, "order production requires sourceOrderLineId only", nil, nil,
			)
		}
		sourceLineID = &source
		product, formula, err = s.loadOrderProductionFormula(ctx, tx, parentID, source)
	} else {
		if strings.TrimSpace(input.SourceOrderLineID) != "" || input.Product == nil ||
			validateProductReference(*input.Product) != nil {
			return fixedProductionOutput{}, domainError(
				ErrorValidation, "self production requires product only", nil, nil,
			)
		}
		productRef, resolveErr := s.resolver.ResolveCurrentReference(
			ctx, tx, bobdomain.EntityProduct, input.Product.ObjectID,
		)
		if resolveErr != nil {
			return fixedProductionOutput{}, domainError(ErrorConflict, "product reference is not effective", nil, resolveErr)
		}
		product = productRef
		if product.Data.BehaviorProfile != bobdomain.ProductBehaviorStandardFinished ||
			product.Data.Formula == nil {
			return fixedProductionOutput{}, domainError(
				ErrorConflict, "self production product must have a fixed formula", nil, nil,
			)
		}
		formula, err = productProductionFormula(product.Data.Formula)
		if err == nil {
			err = s.refreshProductionFormulaMaterials(ctx, tx, &formula)
		}
	}
	if err != nil {
		return fixedProductionOutput{}, err
	}
	enteredUnit, err := productUnitSnapshot(product.Data, input.EnteredUnit.ObjectID)
	if err != nil {
		return fixedProductionOutput{}, err
	}
	if len(input.Materials) != len(formula.Components) {
		return fixedProductionOutput{}, domainError(
			ErrorValidation, "production materials must match formula lines", nil, nil,
		)
	}
	materialInputs := make(map[int32]ProductionMaterialInput, len(input.Materials))
	for _, material := range input.Materials {
		if material.FormulaLineNo < 1 || int(material.FormulaLineNo) > len(formula.Components) ||
			materialInputs[material.FormulaLineNo].FormulaLineNo != 0 {
			return fixedProductionOutput{}, domainError(
				ErrorValidation, "invalid production formula line", nil, nil,
			)
		}
		materialInputs[material.FormulaLineNo] = material
	}
	output := fixedProductionOutput{
		SourceOrderLineID: sourceLineID, Product: product,
		EnteredQuantity: enteredQuantity, EnteredUnit: enteredUnit,
		OutputQuantity: outputQuantity, LossRate: lossRate,
		FormulaBaseOutputQuantity: formula.BaseOutputQuantity, Remark: remark,
		Materials: make([]fixedProductionMaterial, 0, len(formula.Components)),
	}
	for index, component := range formula.Components {
		materialInput := materialInputs[int32(index+1)]
		if err = validateProductReference(materialInput.ActualMaterial); err != nil {
			return fixedProductionOutput{}, err
		}
		actualRef, resolveErr := s.resolver.ResolveCurrentReference(
			ctx, tx, bobdomain.EntityProduct, materialInput.ActualMaterial.ObjectID,
		)
		if resolveErr != nil {
			return fixedProductionOutput{}, domainError(ErrorConflict, "actual material is not effective", nil, resolveErr)
		}
		actual := &actualRef
		if actual.Data.BehaviorProfile != bobdomain.ProductBehaviorRawMaterial {
			return fixedProductionOutput{}, domainError(
				ErrorConflict, "actual production material must be raw material", nil, nil,
			)
		}
		actualEnteredQuantity, quantityErr := quantityMicros(materialInput.ActualEnteredQuantity, false)
		if quantityErr != nil {
			return fixedProductionOutput{}, domainError(
				ErrorValidation, "invalid actual material entered quantity", nil, quantityErr,
			)
		}
		actualQuantity, quantityErr := quantityMicros(materialInput.ActualBaseQuantity, false)
		if quantityErr != nil {
			return fixedProductionOutput{}, domainError(
				ErrorValidation, "invalid actual material quantity", nil, quantityErr,
			)
		}
		actualEnteredUnit, quantityErr := productUnitSnapshot(actual.Data, materialInput.ActualEnteredUnit.ObjectID)
		if quantityErr != nil {
			return fixedProductionOutput{}, quantityErr
		}
		suggested, calculationErr := productionSuggestedQuantity(
			component.Quantity, formula.BaseOutputQuantity, outputQuantity, lossRate,
		)
		if calculationErr != nil {
			return fixedProductionOutput{}, calculationErr
		}
		reason := optionalText(materialInput.AdjustmentReason)
		adjusted := actual.ObjectID != component.Material.ObjectID ||
			actual.ApprovalEntryID != component.Material.ApprovalEntryID || actualQuantity != suggested
		if adjusted && reason == nil {
			return fixedProductionOutput{}, domainError(
				ErrorValidation, "adjustmentReason is required for changed material usage", nil, nil,
			)
		}
		if reason != nil && utf8.RuneCountInString(*reason) > 1000 {
			return fixedProductionOutput{}, domainError(
				ErrorValidation, "adjustmentReason is too long", nil, nil,
			)
		}
		output.Materials = append(output.Materials, fixedProductionMaterial{
			FormulaLineNo: int32(index + 1), FormulaMaterial: component.Material,
			FormulaQuantity: component.Quantity, SuggestedQuantity: suggested,
			ActualMaterial: *actual, ActualEnteredQuantity: actualEnteredQuantity,
			ActualEnteredUnit: actualEnteredUnit, ActualQuantity: actualQuantity, AdjustmentReason: reason,
		})
	}
	return output, nil
}

func (s *Service) loadOrderProductionFormula(
	ctx context.Context,
	tx pgx.Tx,
	orderID, sourceLineID string,
) (bobdomain.EffectiveReference, productionFormula, error) {
	var product bobdomain.EffectiveReference
	var behaviorProfile string
	var base int64
	var sourceUnit bobdomain.MeasurementUnitSnapshot
	err := tx.QueryRow(ctx, `SELECT line.product_object_id,line.product_approval_entry_id,
		line.product_code,line.product_name,line.entered_unit_symbol,line.behavior_profile,
		line.entered_unit_object_id,line.entered_unit_code,line.entered_unit_name,
		formula.output_base_quantity_micros
		FROM vou_product_lines line
		JOIN vou_sale_order_formulas formula ON formula.product_line_id=line.id
		WHERE line.id=$1 AND line.document_id=$2`,
		sourceLineID, orderID).Scan(
		&product.ObjectID, &product.ApprovalEntryID, &product.Code,
		&product.Data.Name, &sourceUnit.Symbol, &behaviorProfile,
		&sourceUnit.ObjectID, &sourceUnit.Code, &sourceUnit.Name, &base,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return product, productionFormula{}, domainError(
			ErrorConflict, "sale order line has no production formula", nil, nil,
		)
	}
	if err != nil {
		return product, productionFormula{}, s.internal("read sale order production formula", err)
	}
	if behaviorProfile != bobdomain.ProductBehaviorStandardFinished &&
		behaviorProfile != bobdomain.ProductBehaviorCustomFinished {
		return product, productionFormula{}, domainError(
			ErrorConflict, "sale order line is not a producible finished product", nil, nil,
		)
	}
	product.Entity = bobdomain.EntityProduct
	product.Data.Unit = sourceUnit.Symbol
	product.Data.BehaviorProfile = behaviorProfile
	product.Data.UnitConversions = []bobdomain.ProductUnitConversion{{Unit: sourceUnit, Factor: "1"}}
	rows, err := tx.Query(ctx, `SELECT material_object_id,material_approval_entry_id,
		material_code,material_name,entered_unit_symbol,base_quantity_micros
		FROM vou_sale_order_formula_lines
		WHERE product_line_id=$1 ORDER BY line_no`, sourceLineID)
	if err != nil {
		return product, productionFormula{}, s.internal("read sale order formula materials", err)
	}
	defer rows.Close()
	formula := productionFormula{BaseOutputQuantity: base}
	for rows.Next() {
		var component productionFormulaComponent
		if err = rows.Scan(
			&component.Material.ObjectID, &component.Material.ApprovalEntryID,
			&component.Material.Code, &component.Material.Name,
			&component.Material.Unit, &component.Quantity,
		); err != nil {
			return product, productionFormula{}, err
		}
		component.Material.Entity = bobdomain.EntityProduct
		component.Material.BehaviorProfile = bobdomain.ProductBehaviorRawMaterial
		formula.Components = append(formula.Components, component)
	}
	if err = rows.Err(); err != nil {
		return product, productionFormula{}, err
	}
	if len(formula.Components) == 0 {
		return product, productionFormula{}, domainError(
			ErrorConflict, "sale order production formula is empty", nil, nil,
		)
	}
	return product, formula, nil
}

func productProductionFormula(input *bobdomain.ProductFormula) (productionFormula, error) {
	base, err := quantityMicros(input.Output.BaseQuantity, false)
	if err != nil {
		return productionFormula{}, domainError(
			ErrorConflict, "product formula base quantity is invalid", nil, err,
		)
	}
	result := productionFormula{
		BaseOutputQuantity: base,
		Components:         make([]productionFormulaComponent, 0, len(input.Components)),
	}
	for _, item := range input.Components {
		quantity, quantityErr := quantityMicros(item.Quantity.BaseQuantity, false)
		if quantityErr != nil {
			return productionFormula{}, domainError(
				ErrorConflict, "product formula material quantity is invalid", nil, quantityErr,
			)
		}
		result.Components = append(result.Components, productionFormulaComponent{
			Material: ReferenceView{
				ObjectID: item.Material.ObjectID, ApprovalEntryID: item.Material.ApprovalEntryID,
				Entity: bobdomain.EntityProduct, Code: item.Material.Code,
				Name: item.Material.Name, Unit: item.Quantity.EnteredUnit.Symbol,
				BehaviorProfile: bobdomain.ProductBehaviorRawMaterial,
			},
			Quantity: quantity,
		})
	}
	if len(result.Components) == 0 {
		return productionFormula{}, domainError(
			ErrorConflict, "product formula is empty", nil, nil,
		)
	}
	return result, nil
}

func (s *Service) refreshProductionFormulaMaterials(
	ctx context.Context, tx pgx.Tx, formula *productionFormula,
) error {
	for index := range formula.Components {
		material, err := s.resolver.ResolveCurrentReference(
			ctx,
			tx,
			bobdomain.EntityProduct,
			formula.Components[index].Material.ObjectID,
		)
		if err != nil {
			return domainError(
				ErrorConflict,
				"formula material is not currently effective",
				nil,
				err,
			)
		}
		if material.Data.BehaviorProfile != bobdomain.ProductBehaviorRawMaterial {
			return domainError(
				ErrorConflict,
				"formula component must reference a raw material",
				nil,
				nil,
			)
		}
		formula.Components[index].Material = referenceView(material)
	}
	return nil
}

func productionSuggestedQuantity(
	formulaQuantity, formulaOutputBaseQuantity, outputQuantity, lossRate int64,
) (int64, error) {
	numerator := new(big.Int).Mul(big.NewInt(formulaQuantity), big.NewInt(outputQuantity))
	numerator.Mul(numerator, big.NewInt(productionPercentScale+lossRate))
	denominator := new(big.Int).Mul(
		big.NewInt(formulaOutputBaseQuantity), big.NewInt(productionPercentScale),
	)
	numerator.Add(numerator, new(big.Int).Quo(denominator, big.NewInt(2)))
	numerator.Quo(numerator, denominator)
	if !numerator.IsInt64() || numerator.Sign() <= 0 {
		return 0, domainError(
			ErrorValidation, "suggested material quantity is out of range", nil, nil,
		)
	}
	return numerator.Int64(), nil
}

func (s *Service) insertProductionDraft(
	ctx context.Context,
	tx pgx.Tx,
	entity, documentID string,
	draft fixedProductionDraft,
) error {
	_, err := tx.Exec(ctx, `INSERT INTO vou_production_details(
		document_id,entity,
		material_warehouse_object_id,material_warehouse_approval_entry_id,
		material_warehouse_code,material_warehouse_name,
		finished_warehouse_object_id,finished_warehouse_approval_entry_id,
		finished_warehouse_code,finished_warehouse_name
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		documentID, entity,
		draft.MaterialWarehouse.ObjectID, draft.MaterialWarehouse.ApprovalEntryID,
		draft.MaterialWarehouse.Code, draft.MaterialWarehouse.Data.Name,
		draft.FinishedWarehouse.ObjectID, draft.FinishedWarehouse.ApprovalEntryID,
		draft.FinishedWarehouse.Code, draft.FinishedWarehouse.Data.Name,
	)
	if err != nil {
		return s.writeError("insert production detail", err)
	}
	return s.insertProductionLines(ctx, tx, documentID, draft.Outputs)
}

func (s *Service) insertProductionLines(
	ctx context.Context,
	tx pgx.Tx,
	documentID string,
	outputs []fixedProductionOutput,
) error {
	for outputIndex, output := range outputs {
		outputID := newID()
		_, err := tx.Exec(ctx, `INSERT INTO vou_production_output_lines(
			id,document_id,line_no,source_order_line_id,
			product_object_id,product_approval_entry_id,product_code,product_name,
			entered_unit_symbol,behavior_profile,entered_quantity_micros,
			entered_unit_object_id,entered_unit_code,entered_unit_name,
			base_quantity_micros,loss_rate_micros,formula_base_quantity_micros,remark
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
			outputID, documentID, outputIndex+1, output.SourceOrderLineID,
			output.Product.ObjectID, output.Product.ApprovalEntryID, output.Product.Code,
			output.Product.Data.Name, output.EnteredUnit.Symbol, output.Product.Data.BehaviorProfile,
			output.EnteredQuantity, output.EnteredUnit.ObjectID, output.EnteredUnit.Code,
			output.EnteredUnit.Name, output.OutputQuantity,
			output.LossRate, output.FormulaBaseOutputQuantity, output.Remark,
		)
		if err != nil {
			return s.writeError("insert production output", err)
		}
		for materialIndex, material := range output.Materials {
			_, err = tx.Exec(ctx, `INSERT INTO vou_production_material_lines(
				id,output_line_id,line_no,
				formula_material_object_id,formula_material_approval_entry_id,
				formula_material_code,formula_material_name,formula_entered_unit_symbol,
				formula_base_quantity_micros,suggested_base_quantity_micros,
				actual_material_object_id,actual_material_approval_entry_id,
				actual_material_code,actual_material_name,actual_entered_unit_symbol,
			actual_entered_quantity_micros,actual_entered_unit_object_id,
			actual_entered_unit_code,actual_entered_unit_name,
			actual_base_quantity_micros,adjustment_reason
			) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
				newID(), outputID, materialIndex+1,
				material.FormulaMaterial.ObjectID, material.FormulaMaterial.ApprovalEntryID,
				material.FormulaMaterial.Code, material.FormulaMaterial.Name,
				material.FormulaMaterial.Unit, material.FormulaQuantity, material.SuggestedQuantity,
				material.ActualMaterial.ObjectID, material.ActualMaterial.ApprovalEntryID,
				material.ActualMaterial.Code, material.ActualMaterial.Data.Name,
				material.ActualEnteredUnit.Symbol, material.ActualEnteredQuantity,
				material.ActualEnteredUnit.ObjectID, material.ActualEnteredUnit.Code,
				material.ActualEnteredUnit.Name,
				material.ActualQuantity, material.AdjustmentReason,
			)
			if err != nil {
				return s.writeError("insert production material", err)
			}
		}
	}
	return nil
}

func (s *Service) loadProductionData(
	ctx context.Context,
	document documentRecord,
	data DocumentDataView,
) (DocumentDataView, error) {
	var material, finished ReferenceView
	err := s.pool.QueryRow(ctx, `SELECT
		material_warehouse_object_id,material_warehouse_approval_entry_id,
		material_warehouse_code,material_warehouse_name,
		finished_warehouse_object_id,finished_warehouse_approval_entry_id,
		finished_warehouse_code,finished_warehouse_name
		FROM vou_production_details WHERE document_id=$1`, document.ID).Scan(
		&material.ObjectID, &material.ApprovalEntryID, &material.Code, &material.Name,
		&finished.ObjectID, &finished.ApprovalEntryID, &finished.Code, &finished.Name,
	)
	if err != nil {
		return data, err
	}
	material.Entity = bobdomain.EntityWarehouse
	finished.Entity = bobdomain.EntityWarehouse
	data.MaterialWarehouse = &material
	data.FinishedWarehouse = &finished
	rows, err := s.pool.Query(ctx, `SELECT id,line_no,source_order_line_id,
		product_object_id,product_approval_entry_id,product_code,product_name,entered_unit_symbol,
		behavior_profile,entered_quantity_micros,entered_unit_object_id,entered_unit_code,
		entered_unit_name,base_quantity_micros,loss_rate_micros,
		formula_base_quantity_micros,remark
		FROM vou_production_output_lines WHERE document_id=$1 ORDER BY line_no`, document.ID)
	if err != nil {
		return data, err
	}
	defer rows.Close()
	for rows.Next() {
		var item ProductionOutputLineView
		var sourceID *string
		var enteredQuantity, quantity, lossRate, base int64
		var behaviorProfile string
		var remark *string
		if err = rows.Scan(
			&item.LineID, &item.LineNo, &sourceID,
			&item.Product.ObjectID, &item.Product.ApprovalEntryID,
			&item.Product.Code, &item.Product.Name, &item.Product.Unit,
			&behaviorProfile, &enteredQuantity, &item.EnteredUnit.ObjectID,
			&item.EnteredUnit.Code, &item.EnteredUnit.Name,
			&quantity, &lossRate, &base, &remark,
		); err != nil {
			return data, err
		}
		item.SourceOrderLineID = deref(sourceID)
		item.Product.Entity = bobdomain.EntityProduct
		item.Product.BehaviorProfile = behaviorProfile
		item.EnteredUnit.Symbol = item.Product.Unit
		item.EnteredQuantity = formatQuantity(enteredQuantity)
		item.BaseQuantity = formatQuantity(quantity)
		item.LossRate = formatQuantity(lossRate)
		item.FormulaBaseQuantity = formatQuantity(base)
		item.Remark = deref(remark)
		materialRows, materialErr := s.pool.Query(ctx, `SELECT id,line_no,
			formula_material_object_id,formula_material_approval_entry_id,
			formula_material_code,formula_material_name,formula_entered_unit_symbol,
			formula_base_quantity_micros,suggested_base_quantity_micros,
			actual_material_object_id,actual_material_approval_entry_id,
			actual_material_code,actual_material_name,actual_entered_unit_symbol,
			actual_entered_quantity_micros,actual_entered_unit_object_id,
			actual_entered_unit_code,actual_entered_unit_name,
			actual_base_quantity_micros,adjustment_reason
			FROM vou_production_material_lines
			WHERE output_line_id=$1 ORDER BY line_no`, item.LineID)
		if materialErr != nil {
			return data, materialErr
		}
		for materialRows.Next() {
			var line ProductionMaterialLineView
			var formulaQuantity, suggested, actualEnteredQuantity, actualQuantity int64
			var adjustment *string
			if materialErr = materialRows.Scan(
				&line.LineID, &line.LineNo,
				&line.FormulaMaterial.ObjectID, &line.FormulaMaterial.ApprovalEntryID,
				&line.FormulaMaterial.Code, &line.FormulaMaterial.Name,
				&line.FormulaMaterial.Unit, &formulaQuantity, &suggested,
				&line.ActualMaterial.ObjectID, &line.ActualMaterial.ApprovalEntryID,
				&line.ActualMaterial.Code, &line.ActualMaterial.Name,
				&line.ActualMaterial.Unit, &actualEnteredQuantity,
				&line.ActualEnteredUnit.ObjectID, &line.ActualEnteredUnit.Code,
				&line.ActualEnteredUnit.Name,
				&actualQuantity, &adjustment,
			); materialErr != nil {
				materialRows.Close()
				return data, materialErr
			}
			line.FormulaMaterial.Entity = bobdomain.EntityProduct
			line.FormulaMaterial.BehaviorProfile = bobdomain.ProductBehaviorRawMaterial
			line.ActualMaterial.Entity = bobdomain.EntityProduct
			line.ActualMaterial.BehaviorProfile = bobdomain.ProductBehaviorRawMaterial
			line.ActualEnteredUnit.Symbol = line.ActualMaterial.Unit
			line.FormulaBaseQuantity = formatQuantity(formulaQuantity)
			line.SuggestedBaseQuantity = formatQuantity(suggested)
			line.ActualEnteredQuantity = formatQuantity(actualEnteredQuantity)
			line.ActualBaseQuantity = formatQuantity(actualQuantity)
			line.AdjustmentReason = deref(adjustment)
			item.Materials = append(item.Materials, line)
		}
		if materialErr = materialRows.Err(); materialErr != nil {
			materialRows.Close()
			return data, materialErr
		}
		materialRows.Close()
		data.ProductionLines = append(data.ProductionLines, item)
	}
	return data, rows.Err()
}
