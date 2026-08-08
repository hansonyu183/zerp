package previewseed

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
		{"asset-category-preview", auxdomain.EntityAssetCategory, fixedAux(map[string]any{
			"name": "通用固定资产", "defaultUsefulLifeMonths": 60,
			"defaultResidualRate": "5.00", "description": "预览测试资产类别",
		}), true},
		{"product-category-root", auxdomain.EntityProductCategory, fixedAux(map[string]any{
			"name": "工业产品", "description": "预览测试产品分类",
		}), true},
		{"product-category-parts", auxdomain.EntityProductCategory, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "零部件", "parentId": refs["product-category-root"].ObjectID,
				"description": "预览测试产品子分类",
			}
		}, true},
		{"department-root", auxdomain.EntityDepartment, fixedAux(map[string]any{
			"name": "运营中心", "description": "预览测试部门",
		}), true},
		{"department-sales", auxdomain.EntityDepartment, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "销售组", "parentId": refs["department-root"].ObjectID,
				"description": "预览测试子部门",
			}
		}, true},
		{"department-disabled", auxdomain.EntityDepartment, fixedAux(map[string]any{
			"name": "停用部门", "description": "用于验证停用筛选",
		}), false},
		{"position-operator", auxdomain.EntityPosition, fixedAux(map[string]any{
			"name": "业务专员", "description": "预览测试岗位",
		}), true},
		{"position-disabled", auxdomain.EntityPosition, fixedAux(map[string]any{
			"name": "停用岗位", "description": "用于验证停用筛选",
		}), false},
		{"dictionary-preview", auxdomain.EntityDictionaryType, fixedAux(map[string]any{
			"name": "预览状态", "description": "预览测试自定义字典",
		}), true},
		{"dictionary-preview-active", auxdomain.EntityDictionaryItem, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "正常", "dictionaryTypeCode": refs["dictionary-preview"].Code, "sortOrder": 10,
			}
		}, true},
		{"dictionary-preview-disabled", auxdomain.EntityDictionaryItem, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "停用选项", "dictionaryTypeCode": refs["dictionary-preview"].Code, "sortOrder": 20,
			}
		}, false},
		{"unit-preview-disabled", auxdomain.EntityMeasurementUnit, fixedAux(map[string]any{
			"name": "箱（停用）", "symbol": "箱", "quantityScale": 0,
		}), false},
		{"subject-revenue", auxdomain.EntityAccountSubject, fixedAux(map[string]any{
			"name": "营业收入", "direction": "REVENUE", "description": "预览测试收入科目",
		}), true},
		{"subject-service-revenue", auxdomain.EntityAccountSubject, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "服务收入", "direction": "REVENUE",
				"parentId": refs["subject-revenue"].ObjectID, "description": "预览测试收入子科目",
			}
		}, true},
		{"subject-expense", auxdomain.EntityAccountSubject, fixedAux(map[string]any{
			"name": "期间费用", "direction": "EXPENSE", "description": "预览测试费用科目",
		}), true},
		{"subject-travel-expense", auxdomain.EntityAccountSubject, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "差旅费", "direction": "EXPENSE",
				"parentId": refs["subject-expense"].ObjectID, "description": "预览测试费用子科目",
			}
		}, true},
		{"income-root", auxdomain.EntityIncomeExpense, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "经营收入", "direction": "INCOME",
				"accountSubjectId": refs["subject-revenue"].ObjectID, "description": "预览测试收入分类",
			}
		}, true},
		{"income-service", auxdomain.EntityIncomeExpense, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "服务收入", "direction": "INCOME",
				"parentId":         refs["income-root"].ObjectID,
				"accountSubjectId": refs["subject-service-revenue"].ObjectID,
				"description":      "预览测试可选收入叶子",
			}
		}, true},
		{"expense-root", auxdomain.EntityIncomeExpense, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "经营费用", "direction": "EXPENSE",
				"accountSubjectId": refs["subject-expense"].ObjectID, "description": "预览测试费用分类",
			}
		}, true},
		{"expense-travel", auxdomain.EntityIncomeExpense, func(refs map[string]auxdomain.ObjectView) map[string]any {
			return map[string]any{
				"name": "差旅费", "direction": "EXPENSE",
				"parentId":         refs["expense-root"].ObjectID,
				"accountSubjectId": refs["subject-travel-expense"].ObjectID,
				"description":      "预览测试可选费用叶子",
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
		view, err := s.auxiliary.Query(ctx, auxdomain.EntityMeasurementUnit, auxdomain.QueryInput{
			Page: 1, PageSize: 20, Filters: auxdomain.QueryFilters{Keyword: code},
		})
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
		SELECT object_id
		FROM aux_audit_events
		WHERE request_id=$1 AND event_type='CREATED'
		ORDER BY occurred_at,id
		LIMIT 1
	`, requestID(sample.key, "create")).Scan(&objectID)
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		result, createErr := s.auxiliary.Create(
			ctx,
			sample.entity,
			auxdomain.CreateInput{Data: auxdomain.CreateData{Data: sample.data(s.auxRefs)}},
			actorID,
			requestID(sample.key, "create"),
		)
		if createErr != nil {
			return auxdomain.ObjectView{}, 0, createErr
		}
		objectID = result.ObjectID
		created = true
	} else if err != nil {
		return auxdomain.ObjectView{}, 0, err
	}
	view, err := s.auxiliary.Get(
		ctx,
		sample.entity,
		auxdomain.GetInput{ObjectID: objectID},
	)
	if err != nil {
		return auxdomain.ObjectView{}, 0, err
	}
	if view.Enabled != sample.enabled {
		var external int
		if err = s.pool.QueryRow(ctx, `
			SELECT count(*)
			FROM aux_audit_events
			WHERE object_id=$1 AND request_id NOT LIKE $2
		`, objectID, seedPrefix+"%").Scan(&external); err != nil {
			return auxdomain.ObjectView{}, 0, err
		}
		if external == 0 {
			input := auxdomain.RevisionInput{ObjectID: objectID, Revision: view.ObjectRevision}
			if sample.enabled {
				_, err = s.auxiliary.Enable(ctx, sample.entity, input, actorID, requestID(sample.key, "enable"))
			} else {
				_, err = s.auxiliary.Disable(ctx, sample.entity, input, actorID, requestID(sample.key, "disable"))
			}
			if err != nil {
				return auxdomain.ObjectView{}, 0, err
			}
			view, err = s.auxiliary.Get(ctx, sample.entity, auxdomain.GetInput{ObjectID: objectID})
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
