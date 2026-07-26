package app

import (
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/response"
)

func (h *Handler) queryUsers(c *gin.Context) {
	var input PageRequest
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.QueryUsers(c.Request.Context(), input)
	h.result(c, result, err)
}

func (h *Handler) getUser(c *gin.Context) {
	var input idInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.GetUser(c.Request.Context(), input.ID)
	h.result(c, result, err)
}

func (h *Handler) createUser(c *gin.Context) {
	var input CreateUserInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.CreateUser(c.Request.Context(), input, actorID(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) saveUser(c *gin.Context) {
	var input SaveUserInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.SaveUser(c.Request.Context(), input, actorID(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) setUserStatus(status string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input revisionInput
		if !h.bind(c, &input) {
			return
		}
		result, err := h.service.SetUserStatus(c.Request.Context(), input.ID, input.Revision, status, actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}
