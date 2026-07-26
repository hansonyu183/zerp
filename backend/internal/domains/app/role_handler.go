package app

import (
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/response"
)

func (h *Handler) queryRoles(c *gin.Context) {
	var input PageRequest
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.QueryRoles(c.Request.Context(), input)
	h.result(c, result, err)
}

func (h *Handler) getRole(c *gin.Context) {
	var input idInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.GetRole(c.Request.Context(), input.ID)
	h.result(c, result, err)
}

func (h *Handler) createRole(c *gin.Context) {
	var input CreateRoleInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.CreateRole(c.Request.Context(), input, actorID(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) saveRole(c *gin.Context) {
	var input SaveRoleInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.SaveRole(c.Request.Context(), input, actorID(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) setRoleStatus(status string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input revisionInput
		if !h.bind(c, &input) {
			return
		}
		result, err := h.service.SetRoleStatus(c.Request.Context(), input.ID, input.Revision, status, actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}
