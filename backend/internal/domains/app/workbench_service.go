package app

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

type workbenchPermissionScope struct {
	paths map[string]struct{}
}

func newWorkbenchPermissionScope(permissions []string) workbenchPermissionScope {
	paths := make(map[string]struct{}, len(permissions))
	for _, permission := range permissions {
		paths[permission] = struct{}{}
	}
	return workbenchPermissionScope{paths: paths}
}

func (scope workbenchPermissionScope) can(domain, entity, action string) bool {
	_, ok := scope.paths["/"+domain+"/"+entity+"/"+action]
	return ok
}

func (scope workbenchPermissionScope) entities(domain string) []string {
	set := map[string]struct{}{}
	for path := range scope.paths {
		parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
		if len(parts) == 3 && parts[0] == domain && validSegment(parts[1]) {
			set[parts[1]] = struct{}{}
		}
	}
	result := make([]string, 0, len(set))
	for entity := range set {
		result = append(result, entity)
	}
	sort.Strings(result)
	return result
}

func (scope workbenchPermissionScope) entitiesWith(domain string, matches func(string) bool) []string {
	entities := scope.entities(domain)
	result := make([]string, 0, len(entities))
	for _, entity := range entities {
		if scope.can(domain, entity, "query") && matches(entity) {
			result = append(result, entity)
		}
	}
	return result
}

func validateWorkbenchQuery(input WorkbenchQueryInput) (WorkbenchQueryInput, pageSpec, error) {
	input.Category = strings.ToUpper(strings.TrimSpace(input.Category))
	input.Keyword = strings.TrimSpace(input.Keyword)
	if input.Category != WorkbenchCategoryBob && input.Category != WorkbenchCategoryVou {
		return input, pageSpec{}, domainError(ErrorValidation, "invalid workbench category", nil)
	}
	if utf8.RuneCountInString(input.Keyword) > 128 {
		return input, pageSpec{}, domainError(ErrorValidation, "invalid workbench keyword", nil)
	}
	spec, err := validatePage(PageRequest{
		Page: input.Page, PageSize: input.PageSize,
	}, map[string]bool{"updatedAt": true}, "updatedAt", "desc")
	return input, spec, err
}

func (s *Service) QueryWorkbench(
	ctx context.Context,
	principal Principal,
	input WorkbenchQueryInput,
) (Page[WorkbenchItem], error) {
	input, spec, err := validateWorkbenchQuery(input)
	if err != nil {
		return Page[WorkbenchItem]{}, err
	}
	scope := newWorkbenchPermissionScope(principal.Permissions)
	if input.Category == WorkbenchCategoryBob {
		return s.queryWorkbenchBob(ctx, scope, input.Keyword, spec)
	}
	return s.queryWorkbenchVou(ctx, scope, input.Keyword, spec)
}

func (s *Service) queryWorkbenchBob(
	ctx context.Context,
	scope workbenchPermissionScope,
	keyword string,
	spec pageSpec,
) (Page[WorkbenchItem], error) {
	draftEntities := scope.entitiesWith("bob", func(entity string) bool {
		return scope.can("bob", entity, "submit")
	})
	pendingEntities := scope.entitiesWith("bob", func(entity string) bool {
		return scope.can("bob", entity, "approve") || scope.can("bob", entity, "reject")
	})
	params := dbsqlc.CountWorkbenchBobItemsParams{
		DraftEntities: draftEntities, PendingEntities: pendingEntities, Keyword: keyword,
	}
	total, err := s.queries.CountWorkbenchBobItems(ctx, params)
	if err != nil {
		return Page[WorkbenchItem]{}, s.internal("count workbench business objects", err)
	}
	rows, err := s.queries.ListWorkbenchBobItems(ctx, dbsqlc.ListWorkbenchBobItemsParams{
		DraftEntities: draftEntities, PendingEntities: pendingEntities, Keyword: keyword,
		PageSize: int32(spec.PageSize), PageOffset: spec.Offset,
	})
	if err != nil {
		return Page[WorkbenchItem]{}, s.internal("list workbench business objects", err)
	}
	items := make([]WorkbenchItem, 0, len(rows))
	for _, row := range rows {
		actions := make([]string, 0, 4)
		if scope.can("bob", row.Entity, "get") {
			actions = append(actions, "view")
			if row.Status == "DRAFT" && scope.can("bob", row.Entity, "save") {
				actions = append(actions, "edit")
			}
		}
		pendingStage := "APPROVE"
		if row.Status == "DRAFT" {
			pendingStage = "CHECK"
			if scope.can("bob", row.Entity, "submit") {
				actions = append(actions, "submit")
			}
		} else {
			if scope.can("bob", row.Entity, "approve") {
				actions = append(actions, "approve")
			}
			if scope.can("bob", row.Entity, "reject") {
				actions = append(actions, "reject")
			}
		}
		items = append(items, WorkbenchItem{
			Category: WorkbenchCategoryBob, Entity: row.Entity, Status: row.Status,
			PendingStage: pendingStage, AvailableActions: actions, UpdatedAt: row.ObjectUpdatedAt.Time,
			ObjectID: row.ObjectID, ObjectRevision: row.ObjectRevision, VersionID: row.VersionID,
			Revision: row.VersionRevision, Code: row.Code, Name: row.Name,
		})
	}
	return Page[WorkbenchItem]{Items: items, Total: total, Page: spec.Page, PageSize: spec.PageSize}, nil
}

func (s *Service) queryWorkbenchVou(
	ctx context.Context,
	scope workbenchPermissionScope,
	keyword string,
	spec pageSpec,
) (Page[WorkbenchItem], error) {
	draftEntities := scope.entitiesWith("vou", func(entity string) bool {
		return scope.can("vou", entity, "check")
	})
	checkedEntities := scope.entitiesWith("vou", func(entity string) bool {
		return scope.can("vou", entity, "approve")
	})
	approvedEntities := scope.entitiesWith("vou", func(entity string) bool {
		return scope.can("vou", entity, "finalize")
	})
	params := dbsqlc.CountWorkbenchVouItemsParams{
		DraftEntities: draftEntities, CheckedEntities: checkedEntities,
		ApprovedEntities: approvedEntities, Keyword: keyword,
	}
	total, err := s.queries.CountWorkbenchVouItems(ctx, params)
	if err != nil {
		return Page[WorkbenchItem]{}, s.internal("count workbench vouchers", err)
	}
	rows, err := s.queries.ListWorkbenchVouItems(ctx, dbsqlc.ListWorkbenchVouItemsParams{
		DraftEntities: draftEntities, CheckedEntities: checkedEntities,
		ApprovedEntities: approvedEntities, Keyword: keyword,
		PageSize: int32(spec.PageSize), PageOffset: spec.Offset,
	})
	if err != nil {
		return Page[WorkbenchItem]{}, s.internal("list workbench vouchers", err)
	}
	items := make([]WorkbenchItem, 0, len(rows))
	for _, row := range rows {
		actions := make([]string, 0, 3)
		if scope.can("vou", row.Entity, "get") {
			actions = append(actions, "view")
			if row.Status == "DRAFT" && scope.can("vou", row.Entity, "save") {
				actions = append(actions, "edit")
			}
		}
		pendingStage, action := "CHECK", "check"
		if row.Status == "CHECKED" {
			pendingStage, action = "APPROVE", "approve"
		} else if row.Status == "APPROVED" {
			pendingStage, action = "FINALIZE", "finalize"
		}
		if scope.can("vou", row.Entity, action) {
			actions = append(actions, action)
		}
		items = append(items, WorkbenchItem{
			Category: WorkbenchCategoryVou, Entity: row.Entity, Status: row.Status,
			PendingStage: pendingStage, AvailableActions: actions, UpdatedAt: row.UpdatedAt.Time,
			DocumentID: row.DocumentID, Revision: row.Revision, DocumentNo: row.DocumentNo,
			BusinessDate: row.BusinessDate, PartyName: row.PartyName,
			Currency: row.Currency, Amount: formatWorkbenchMoney(row.TotalAmountCents),
		})
	}
	return Page[WorkbenchItem]{Items: items, Total: total, Page: spec.Page, PageSize: spec.PageSize}, nil
}

func formatWorkbenchMoney(cents int64) string {
	sign := ""
	if cents < 0 {
		sign = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s%d.%02d", sign, cents/100, cents%100)
}
