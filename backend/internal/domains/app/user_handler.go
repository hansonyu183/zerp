package app

import (
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

func (h *Handler) queryUsers(c *gin.Context) {
	var input PageRequest
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.QueryUsers(c.Request.Context(), input)
	if err != nil {
		h.result(c, nil, err)
		return
	}
	items := make([]UserListItem, 0, len(result.Items))
	for _, user := range result.Items {
		items = append(items, userListItem(user))
	}
	h.result(c, Page[UserListItem]{Items: items, Total: result.Total, Page: result.Page, PageSize: result.PageSize}, nil)
}

func (h *Handler) getUser(c *gin.Context) {
	var input idInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.GetUser(c.Request.Context(), input.ID)
	if err != nil {
		h.result(c, nil, err)
		return
	}
	h.result(c, userDetail(result), nil)
}

func (h *Handler) createUser(c *gin.Context) {
	var input CreateUserInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.CreateUser(c.Request.Context(), input, actorID(c), response.RequestID(c))
	if err != nil {
		h.result(c, nil, err)
		return
	}
	h.result(c, userDetail(result), nil)
}

func (h *Handler) saveUser(c *gin.Context) {
	var input SaveUserInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.SaveUser(c.Request.Context(), input, actorID(c), response.RequestID(c))
	if err != nil {
		h.result(c, nil, err)
		return
	}
	h.result(c, userDetail(result), nil)
}

func (h *Handler) setUserStatus(status string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input revisionInput
		if !h.bind(c, &input) {
			return
		}
		result, err := h.service.SetUserStatus(c.Request.Context(), input.ID, input.Revision, status, actorID(c), response.RequestID(c))
		if err != nil {
			h.result(c, nil, err)
			return
		}
		h.result(c, userDetail(result), nil)
	}
}

func (h *Handler) resetUserPassword(c *gin.Context) {
	var input ResetPasswordInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.ResetUserPassword(c.Request.Context(), input, actorID(c), response.RequestID(c))
	h.result(c, result, err)
}
