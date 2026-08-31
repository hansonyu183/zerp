package app

import "github.com/gin-gonic/gin"

func (h *Handler) getBranding(c *gin.Context) {
	var input struct{}
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.GetBranding(c.Request.Context())
	h.result(c, result, err)
}
