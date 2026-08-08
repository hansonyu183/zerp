package app

import (
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

func (h *Handler) querySystemParameters(c *gin.Context) {
	var input PageRequest
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.QuerySystemParameters(c.Request.Context(), input)
	h.result(c, result, err)
}

func (h *Handler) getSystemParameter(c *gin.Context) {
	var input struct {
		Key string `json:"key"`
	}
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.GetSystemParameter(c.Request.Context(), input.Key)
	h.result(c, result, err)
}

func (h *Handler) saveSystemParameter(c *gin.Context) {
	var input SaveSystemParameterInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.SaveSystemParameter(c.Request.Context(), input, actorID(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) resetSystemParameter(c *gin.Context) {
	var input ResetSystemParameterInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.ResetSystemParameter(c.Request.Context(), input, actorID(c), response.RequestID(c))
	h.result(c, result, err)
}
