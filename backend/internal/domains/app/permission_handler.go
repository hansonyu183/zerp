package app

import "github.com/gin-gonic/gin"

func (h *Handler) queryPermissions(c *gin.Context) {
	var input PageRequest
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.QueryPermissions(c.Request.Context(), input)
	h.result(c, result, err)
}

func (h *Handler) getPermission(c *gin.Context) {
	var input idInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.GetPermission(c.Request.Context(), input.ID)
	h.result(c, result, err)
}
