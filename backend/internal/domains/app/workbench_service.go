package app

import (
	"context"
	"fmt"
	"slices"
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
	if input.PageSize != 20 {
		return input, pageSpec{}, domainError(ErrorValidation, "invalid workbench page size", nil)
	}
	if len(input.Entities) > 100 || len(input.PendingStages) > 3 {
		return input, pageSpec{}, domainError(ErrorValidation, "invalid workbench filters", nil)
	}
	entitySet := make(map[string]struct{}, len(input.Entities))
	for index, entity := range input.Entities {
		entity = strings.ToLower(strings.TrimSpace(entity))
		if !validSegment(entity) {
			return input, pageSpec{}, domainError(ErrorValidation, "invalid workbench entity filter", nil)
		}
		if _, duplicate := entitySet[entity]; duplicate {
			return input, pageSpec{}, domainError(ErrorValidation, "duplicate workbench entity filter", nil)
		}
		entitySet[entity] = struct{}{}
		input.Entities[index] = entity
	}
	stageSet := make(map[string]struct{}, len(input.PendingStages))
	for index, stage := range input.PendingStages {
		stage = strings.ToUpper(strings.TrimSpace(stage))
		valid := stage == "SUBMIT" || stage == "APPROVE"
		if !valid {
			return input, pageSpec{}, domainError(ErrorValidation, "invalid workbench pending stage filter", nil)
		}
		if _, duplicate := stageSet[stage]; duplicate {
			return input, pageSpec{}, domainError(ErrorValidation, "duplicate workbench pending stage filter", nil)
		}
		stageSet[stage] = struct{}{}
		input.PendingStages[index] = stage
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
		return s.queryWorkbenchBob(ctx, principal.User.ID, scope, input, spec)
	}
	return s.queryWorkbenchVou(ctx, scope, input, spec)
}

func filterWorkbenchEntities(available, selected []string) []string {
	if len(selected) == 0 {
		return available
	}
	selectedSet := make(map[string]struct{}, len(selected))
	for _, entity := range selected {
		selectedSet[entity] = struct{}{}
	}
	result := make([]string, 0, len(available))
	for _, entity := range available {
		if _, ok := selectedSet[entity]; ok {
			result = append(result, entity)
		}
	}
	return result
}

func includesWorkbenchStage(selected []string, stage string) bool {
	return len(selected) == 0 || slices.Contains(selected, stage)
}

func appendDCLWorkbenchEntities(scope workbenchPermissionScope, entities []string, matches func(string, string) bool) []string {
	for _, entity := range []string{"operating-entity", "warehouse", "vehicle", "fund-account", "product", "party"} {
		if scope.can("dcl", entity, "query") && matches("dcl", entity) {
			entities = append(entities, entity)
		}
	}
	return entities
}

func workbenchApprovalDomain(entity string) string {
	if entity == "operating-entity" || entity == "warehouse" || entity == "vehicle" || entity == "fund-account" || entity == "product" || entity == "party" {
		return "dcl"
	}
	return "bob"
}

func (s *Service) queryWorkbenchBob(
	ctx context.Context,
	actorID string,
	scope workbenchPermissionScope,
	input WorkbenchQueryInput,
	spec pageSpec,
) (Page[WorkbenchItem], error) {
	draftEntities := scope.entitiesWith("bob", func(entity string) bool {
		return scope.can("bob", entity, "submit")
	})
	draftEntities = appendDCLWorkbenchEntities(scope, draftEntities, func(domain, entity string) bool {
		return scope.can(domain, entity, "submit")
	})
	pendingEntities := scope.entitiesWith("bob", func(entity string) bool {
		return scope.can("bob", entity, "approve") ||
			scope.can("bob", entity, "reject")
	})
	pendingEntities = appendDCLWorkbenchEntities(scope, pendingEntities, func(domain, entity string) bool {
		return scope.can(domain, entity, "approve") || scope.can(domain, entity, "reject")
	})
	unsubmitEntities := scope.entitiesWith("bob", func(entity string) bool {
		return scope.can("bob", entity, "unsubmit")
	})
	unsubmitEntities = appendDCLWorkbenchEntities(scope, unsubmitEntities, func(domain, entity string) bool {
		return scope.can(domain, entity, "unsubmit")
	})
	draftEntities = filterWorkbenchEntities(draftEntities, input.Entities)
	pendingEntities = filterWorkbenchEntities(pendingEntities, input.Entities)
	unsubmitEntities = filterWorkbenchEntities(unsubmitEntities, input.Entities)
	if !includesWorkbenchStage(input.PendingStages, "SUBMIT") {
		draftEntities = nil
	}
	if !includesWorkbenchStage(input.PendingStages, "APPROVE") {
		pendingEntities = nil
		unsubmitEntities = nil
	}
	params := dbsqlc.CountWorkbenchBobItemsParams{
		DraftEntities:    draftEntities,
		PendingEntities:  pendingEntities,
		ActorID:          actorID,
		UnsubmitEntities: unsubmitEntities,
		Keyword:          input.Keyword,
	}
	total, err := s.queries.CountWorkbenchBobItems(ctx, params)
	if err != nil {
		return Page[WorkbenchItem]{}, s.internal("count workbench business objects", err)
	}
	rows, err := s.queries.ListWorkbenchBobItems(ctx, dbsqlc.ListWorkbenchBobItemsParams{
		DraftEntities:    draftEntities,
		PendingEntities:  pendingEntities,
		UnsubmitEntities: unsubmitEntities,
		ActorID:          actorID,
		Keyword:          input.Keyword,
		PageSize:         int32(spec.PageSize),
		PageOffset:       spec.Offset,
	})
	if err != nil {
		return Page[WorkbenchItem]{}, s.internal("list workbench business objects", err)
	}
	items := make([]WorkbenchItem, 0, len(rows))
	for _, row := range rows {
		domain := workbenchApprovalDomain(row.Entity)
		actions := make([]string, 0, 4)
		if scope.can(domain, row.Entity, "get") {
			actions = append(actions, "view")
			if row.Status == "DRAFT" && scope.can(domain, row.Entity, "save") {
				actions = append(actions, "edit")
			}
		}
		pendingStage := "APPROVE"
		if row.Status == "DRAFT" {
			pendingStage = "SUBMIT"
			if scope.can(domain, row.Entity, "submit") {
				actions = append(actions, "submit")
			}
		} else {
			if !row.IsSubmittedByActor && scope.can(domain, row.Entity, "approve") {
				actions = append(actions, "approve")
			}
			if !row.IsSubmittedByActor && scope.can(domain, row.Entity, "reject") {
				actions = append(actions, "reject")
			}
			if scope.can(domain, row.Entity, "unsubmit") {
				actions = append(actions, "unsubmit")
			}
		}
		items = append(items, WorkbenchItem{
			Category: WorkbenchCategoryBob, Entity: row.Entity, Status: row.Status,
			PendingStage: pendingStage, AvailableActions: actions, UpdatedAt: row.ObjectUpdatedAt.Time,
			ObjectID: row.ObjectID, ObjectRevision: row.ObjectRevision, ApprovalEntryID: row.ApprovalEntryID,
			Revision: row.ApprovalRevision, Code: row.Code, Name: row.Name,
		})
	}
	return Page[WorkbenchItem]{Items: items, Total: total, Page: spec.Page, PageSize: spec.PageSize}, nil
}

func (s *Service) queryWorkbenchVou(
	ctx context.Context,
	scope workbenchPermissionScope,
	input WorkbenchQueryInput,
	spec pageSpec,
) (Page[WorkbenchItem], error) {
	draftEntities := scope.entitiesWith("vou", func(entity string) bool {
		return scope.can("vou", entity, "submit")
	})
	pendingEntities := scope.entitiesWith("vou", func(entity string) bool {
		return scope.can("vou", entity, "approve") || scope.can("vou", entity, "unsubmit")
	})
	draftEntities = filterWorkbenchEntities(draftEntities, input.Entities)
	pendingEntities = filterWorkbenchEntities(pendingEntities, input.Entities)
	if !includesWorkbenchStage(input.PendingStages, "SUBMIT") {
		draftEntities = nil
	}
	if !includesWorkbenchStage(input.PendingStages, "APPROVE") {
		pendingEntities = nil
	}
	params := dbsqlc.CountWorkbenchVouItemsParams{
		DraftEntities: draftEntities, PendingEntities: pendingEntities,
		Keyword: input.Keyword,
	}
	total, err := s.queries.CountWorkbenchVouItems(ctx, params)
	if err != nil {
		return Page[WorkbenchItem]{}, s.internal("count workbench vouchers", err)
	}
	rows, err := s.queries.ListWorkbenchVouItems(ctx, dbsqlc.ListWorkbenchVouItemsParams{
		DraftEntities: draftEntities, PendingEntities: pendingEntities,
		Keyword:  input.Keyword,
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
		pendingStage := "SUBMIT"
		if row.Status == "PENDING" {
			pendingStage = "APPROVE"
			if scope.can("vou", row.Entity, "approve") {
				actions = append(actions, "approve")
			}
			if scope.can("vou", row.Entity, "unsubmit") {
				actions = append(actions, "unsubmit")
			}
		} else if scope.can("vou", row.Entity, "submit") {
			actions = append(actions, "submit")
		}
		items = append(items, WorkbenchItem{
			Category: WorkbenchCategoryVou, Entity: row.Entity, Status: row.Status,
			PendingStage: pendingStage, AvailableActions: actions, UpdatedAt: row.UpdatedAt.Time,
			DocumentID: row.DocumentID, Revision: row.Revision, DocumentNo: row.DocumentNo,
			BusinessDate: row.BusinessDate, PartyName: requiredWorkbenchString(row.PartyName),
			Currency: requiredWorkbenchString(row.Currency), Amount: formatWorkbenchMoney(row.TotalAmountCents),
		})
	}
	return Page[WorkbenchItem]{Items: items, Total: total, Page: spec.Page, PageSize: spec.PageSize}, nil
}

func requiredWorkbenchString(value string) *string {
	return &value
}

func formatWorkbenchMoney(cents int64) string {
	sign := ""
	if cents < 0 {
		sign = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s%d.%02d", sign, cents/100, cents%100)
}
