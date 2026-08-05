package app

import (
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

func (h *Handler) getMenu(c *gin.Context) {
	var input struct{}
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.GetMenu(c.Request.Context(), currentPrincipal(c))
	h.result(c, result, err)
}

func (h *Handler) saveBusinessMenu(c *gin.Context) {
	var input SaveBusinessMenuInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.SaveBusinessMenu(c.Request.Context(), input, currentPrincipal(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) activateMenu(c *gin.Context) {
	var input ActivateMenuInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.ActivateMenu(c.Request.Context(), input, currentPrincipal(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) resetBusinessMenu(c *gin.Context) {
	var input ResetBusinessMenuInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.ResetBusinessMenu(c.Request.Context(), input, currentPrincipal(c), response.RequestID(c))
	h.result(c, result, err)
}
