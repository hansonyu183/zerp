package app

import (
	"github.com/gin-gonic/gin"
	apigen "github.com/hansonyu183/zerp/backend/internal/api/generated"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

func roleQueryRequest(input apigen.RoleQueryRequest) PageRequest {
	request := PageRequest{Page: input.Page, PageSize: int(input.PageSize), Filters: map[string]string{}}
	if input.Filters != nil {
		if input.Filters.Search != nil {
			request.Filters["search"] = *input.Filters.Search
		}
		if input.Filters.Status != nil {
			request.Filters["status"] = string(*input.Filters.Status)
		}
	}
	request.Sort = make([]SortItem, 0, len(input.Sort))
	for _, item := range input.Sort {
		request.Sort = append(request.Sort, SortItem{Field: string(item.Field), Order: string(item.Order)})
	}
	return request
}

func generatedRoleListItem(item RoleListItem) apigen.RoleListItem {
	actions := make([]apigen.RoleAction, 0, len(item.AvailableActions))
	for _, action := range item.AvailableActions {
		actions = append(actions, apigen.RoleAction(action))
	}
	return apigen.RoleListItem{
		Id: item.ID, Code: item.Code, Name: item.Name, Description: item.Description,
		Status: apigen.UserStatus(item.Status), Type: apigen.RoleType(item.Type),
		AvailableActions: actions, Assignable: item.Assignable, CreatedAt: item.CreatedAt,
		UpdatedAt: item.UpdatedAt, Revision: item.Revision,
	}
}

func generatedRoleDetail(detail RoleDetail) apigen.RoleDetail {
	item := generatedRoleListItem(detail.RoleListItem)
	permissions := make([]apigen.RolePermission, 0, len(detail.Permissions))
	for _, permission := range detail.Permissions {
		permissions = append(permissions, apigen.RolePermission{
			Id: permission.ID, Path: permission.Path, Description: permission.Description,
			Status: apigen.UserStatus(permission.Status), Domain: permission.Domain,
			Entity: permission.Entity, Action: permission.Action,
		})
	}
	return apigen.RoleDetail{
		Id: item.Id, Code: item.Code, Name: item.Name, Description: item.Description,
		Status: item.Status, Type: item.Type, AvailableActions: item.AvailableActions,
		Assignable: item.Assignable, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
		Revision: item.Revision, Permissions: permissions,
	}
}

func generatedRolePage(page Page[RoleListItem]) apigen.RolePage {
	items := make([]apigen.RoleListItem, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, generatedRoleListItem(item))
	}
	return apigen.RolePage{Items: items, Total: page.Total, Page: page.Page, PageSize: apigen.RolePagePageSize(page.PageSize)}
}

func (h *Handler) queryRoles(c *gin.Context) {
	var input apigen.RoleQueryRequest
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.QueryRoles(c.Request.Context(), roleQueryRequest(input), currentPrincipal(c))
	h.result(c, generatedRolePage(result), err)
}

func (h *Handler) getRole(c *gin.Context) {
	var input apigen.IdRequest
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.GetRole(c.Request.Context(), input.Id, currentPrincipal(c))
	h.result(c, generatedRoleDetail(result), err)
}

func (h *Handler) createRole(c *gin.Context) {
	var input apigen.CreateRoleRequest
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.CreateRole(c.Request.Context(), CreateRoleInput{
		Name: input.Name, Description: input.Description, PermissionIDs: input.PermissionIds,
	}, currentPrincipal(c), response.RequestID(c))
	h.result(c, generatedRoleDetail(result), err)
}

func (h *Handler) saveRole(c *gin.Context) {
	var input apigen.SaveRoleRequest
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.SaveRole(c.Request.Context(), SaveRoleInput{
		ID: input.Id, Name: input.Name, Description: input.Description,
		PermissionIDs: input.PermissionIds, Revision: input.Revision,
	}, currentPrincipal(c), response.RequestID(c))
	h.result(c, generatedRoleDetail(result), err)
}

func (h *Handler) setRoleStatus(status string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input apigen.RevisionRequest
		if !h.bind(c, &input) {
			return
		}
		result, err := h.service.SetRoleStatus(c.Request.Context(), input.Id, input.Revision, status, currentPrincipal(c), response.RequestID(c))
		h.result(c, generatedRoleDetail(result), err)
	}
}
