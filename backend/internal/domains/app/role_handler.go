package app

import (
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

func (h *Handler) queryRoles(c *gin.Context) {
	var input PageRequest
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.QueryRoleDirectory(c.Request.Context(), input, currentPrincipal(c))
	h.result(c, result, err)
}

func (h *Handler) getRole(c *gin.Context) {
	var input idInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.GetRoleDetail(c.Request.Context(), input.ID, currentPrincipal(c))
	h.result(c, result, err)
}

func (h *Handler) createRole(c *gin.Context) {
	var input CreateRoleInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.CreateRoleAs(c.Request.Context(), input, currentPrincipal(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) saveRole(c *gin.Context) {
	var input SaveRoleInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.SaveRoleAs(c.Request.Context(), input, currentPrincipal(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) setRoleStatus(status string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input revisionInput
		if !h.bind(c, &input) {
			return
		}
		result, err := h.service.SetRoleStatusAs(c.Request.Context(), input.ID, input.Revision, status, currentPrincipal(c), response.RequestID(c))
		h.result(c, result, err)
	}
}
