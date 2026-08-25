package testseed

import (
	"context"
	"errors"
	"fmt"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	"github.com/jackc/pgx/v5"
)

type auxSample struct {
	key, entity string
	data        func(map[string]auxdomain.ObjectView) map[string]any
	enabled     bool
}

func (s *Seeder) seedAuxiliary(ctx context.Context, counts *Counts) error {
	samples := []auxSample{
		{"payment-bank-transfer", auxdomain.EntityPaymentMethod, fixedAux(map[string]any{
			"name": "银行转账", "defaultSalesSurcharge": "0.00", "description": "测试收款方式",
		}), true},
		{"asset-category-test", auxdomain.EntityAssetCategory, fixedAux(map[string]any{
			"name": "通用固定资产", "defaultUsefulLifeMonths": 60,
			"defaultResidualRate": "5.00", "description": "测试资产类别",
		}), true},
		{"product-category-root", auxdomain.EntityProductCategory, fixedAux(map[string]any{
			"name": "工业产品", "description": "测试产品分类",
		}), true},
		{"product-type-raw", auxdomain.EntityProductType, fixedAux(map[string]any{"name": "测试原材料", "behaviorProfile": "RAW_MATERIAL"}), true},
		{"product-type-finished", auxdomain.EntityProductType, fixedAux(map[string]any{"name": "测试自制成品", "behaviorProfile": "STANDARD_FINISHED"}), true},
		{"product-type-custom", auxdomain.EntityProductType, fixedAux(map[string]any{"name": "测试定制成品", "behaviorProfile": "CUSTOM_FINISHED"}), true},
		{"product-type-packaging", auxdomain.EntityProductType, fixedAux(map[string]any{"name": "测试包装物", "behaviorProfile": "PACKAGING"}), true},
		{"product-category-parts", auxdomain.EntityProductCategory, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "零部件", "parentId": refs["product-category-root"].ObjectID,
				"description": "测试产品子分类",
			}
		}, true},
		{"department-root", auxdomain.EntityDepartment, fixedAux(map[string]any{
			"name": "运营中心", "description": "测试部门",
		}), true},
		{"department-sales", auxdomain.EntityDepartment, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "销售组", "parentId": refs["department-root"].ObjectID,
				"description": "测试子部门",
			}
		}, true},
		{"department-disabled", auxdomain.EntityDepartment, fixedAux(map[string]any{
			"name": "停用部门", "description": "用于验证停用筛选",
		}), false},
		{"position-operator", auxdomain.EntityPosition, fixedAux(map[string]any{
			"name": "业务专员", "description": "测试岗位",
		}), true},
		{"position-disabled", auxdomain.EntityPosition, fixedAux(map[string]any{
			"name": "停用岗位", "description": "用于验证停用筛选",
		}), false},
		{"dictionary-test", auxdomain.EntityDictionaryType, fixedAux(map[string]any{
			"name": "测试状态", "description": "测试自定义字典",
		}), true},
		{"dictionary-test-active", auxdomain.EntityDictionaryItem, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "正常", "dictionaryTypeCode": refs["dictionary-test"].Code, "sortOrder": 10,
			}
		}, true},
		{"dictionary-test-disabled", auxdomain.EntityDictionaryItem, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "停用选项", "dictionaryTypeCode": refs["dictionary-test"].Code, "sortOrder": 20,
			}
		}, false},
		{"unit-test-disabled", auxdomain.EntityMeasurementUnit, fixedAux(map[string]any{
			"name": "箱（停用）", "symbol": "箱", "quantityScale": 0,
		}), false},
		{"unit-test-pallet", auxdomain.EntityMeasurementUnit, fixedAux(map[string]any{
			"name": "托盘（测试）", "symbol": "托", "quantityScale": 0,
		}), true},
		{"income-root", auxdomain.EntityIncomeExpense, fixedAux(map[string]any{
			"name": "经营收入", "direction": "INCOME", "description": "测试收入分类",
		}), true},
		{"income-service", auxdomain.EntityIncomeExpense, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "服务收入", "direction": "INCOME",
				"parentId": refs["income-root"].ObjectID, "description": "测试可选收入叶子",
			}
		}, true},
		{"expense-root", auxdomain.EntityIncomeExpense, fixedAux(map[string]any{
			"name": "经营费用", "direction": "EXPENSE", "description": "测试费用分类",
		}), true},
		{"expense-travel", auxdomain.EntityIncomeExpense, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "差旅费", "direction": "EXPENSE",
				"parentId": refs["expense-root"].ObjectID, "description": "测试可选费用叶子",
			}
		}, true},
	}
	for _, sample := range samples {
		view, result, err := s.ensureAuxiliary(ctx, sample)
		if err != nil {
			return fmt.Errorf("%s: %w", sample.key, err)
		}
		s.auxRefs[sample.key] = view
		counts.add(result)
	}
	for _, code := range []string{"UNT-0001", "UNT-0002", "UNT-0003", "UNT-0004"} {
		actor, actorErr := seedActor(actorID, requestID(code, "query"))
		if actorErr != nil {
			return actorErr
		}
		view, err := s.auxiliary.Query(ctx, auxdomain.EntityMeasurementUnit, auxdomain.QueryInput{
			Page: 1, PageSize: 20, Filters: auxdomain.QueryFilters{Keyword: code},
		}, actor)
		if err != nil || len(view.Items) != 1 || view.Items[0].Code != code {
			return fmt.Errorf("required measurement unit %s is unavailable", code)
		}
		s.auxRefs[code] = view.Items[0]
	}
	return nil
}

func fixedAux(data map[string]any) func(map[string]auxdomain.ObjectView) map[string]any {
	return func(map[string]auxdomain.ObjectView) map[string]any { return data }
}

func (s *Seeder) ensureAuxiliary(
	ctx context.Context,
	sample auxSample,
) (auxdomain.ObjectView, outcome, error) {
	var objectID string
	err := s.pool.QueryRow(ctx, `
		SELECT subject_id
		FROM approval_events
		WHERE domain='aux' AND request_id=$1 AND action='CREATED'
		ORDER BY created_at,id
		LIMIT 1
	`, requestID(sample.key, "create")).Scan(&objectID)
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		createActor, actorErr := seedActor(actorID, requestID(sample.key, "create"))
		if actorErr != nil {
			return auxdomain.ObjectView{}, 0, actorErr
		}
		result, createErr := s.auxiliary.Create(
			ctx,
			sample.entity,
			auxdomain.CreateInput{Data: auxdomain.CreateData{Data: sample.data(s.auxRefs)}},
			createActor,
		)
		if createErr != nil {
			return auxdomain.ObjectView{}, 0, createErr
		}
		submitter, submitErr := seedActor(actorID, requestID(sample.key, "submit"))
		if submitErr != nil {
			return auxdomain.ObjectView{}, 0, submitErr
		}
		pending, submitErr := s.auxiliary.Submit(ctx, sample.entity, auxdomain.ApprovalRevisionInput{
			ObjectID: result.ObjectID, ApprovalEntryID: result.Approval.ApprovalEntryID,
			ApprovalRevision: result.Approval.Revision,
		}, submitter)
		if submitErr != nil {
			return auxdomain.ObjectView{}, 0, submitErr
		}
		reviewer, reviewErr := seedActor(reviewerID, requestID(sample.key, "approve"))
		if reviewErr != nil {
			return auxdomain.ObjectView{}, 0, reviewErr
		}
		approved, reviewErr := s.auxiliary.Approve(ctx, sample.entity, auxdomain.ApprovalRevisionInput{
			ObjectID: result.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID,
			ApprovalRevision: pending.Approval.Revision,
		}, reviewer)
		if reviewErr != nil {
			return auxdomain.ObjectView{}, 0, reviewErr
		}
		_ = approved
		objectID = result.ObjectID
		created = true
	} else if err != nil {
		return auxdomain.ObjectView{}, 0, err
	}
	getActor, actorErr := seedActor(actorID, requestID(sample.key, "get"))
	if actorErr != nil {
		return auxdomain.ObjectView{}, 0, actorErr
	}
	view, err := s.auxiliary.Get(
		ctx,
		sample.entity,
		auxdomain.GetInput{ObjectID: objectID},
		getActor,
	)
	if err != nil {
		return auxdomain.ObjectView{}, 0, err
	}
	if view.Enabled != sample.enabled {
		var external int
		if err = s.pool.QueryRow(ctx, `
			SELECT count(*)
			FROM approval_events
			WHERE domain='aux' AND subject_id=$1 AND request_id NOT LIKE $2
		`, objectID, seedPrefix+"%").Scan(&external); err != nil {
			return auxdomain.ObjectView{}, 0, err
		}
		if external == 0 {
			input := auxdomain.ObjectRevisionInput{ObjectID: objectID, ObjectRevision: view.ObjectRevision}
			stateActor, stateErr := seedActor(actorID, requestID(sample.key, "state"))
			if stateErr != nil {
				return auxdomain.ObjectView{}, 0, stateErr
			}
			if sample.enabled {
				_, err = s.auxiliary.Enable(ctx, sample.entity, input, stateActor)
			} else {
				_, err = s.auxiliary.Disable(ctx, sample.entity, input, stateActor)
			}
			if err != nil {
				return auxdomain.ObjectView{}, 0, err
			}
			view, err = s.auxiliary.Get(ctx, sample.entity, auxdomain.GetInput{ObjectID: objectID}, getActor)
			if err != nil {
				return auxdomain.ObjectView{}, 0, err
			}
			if !created {
				return view, outcomeResumed, nil
			}
		}
	}
	if created {
		return view, outcomeCreated, nil
	}
	return view, outcomeSkipped, nil
}
