package app

import (
	"github.com/gin-gonic/gin"
)

func (h *Handler) queryWorkbench(c *gin.Context) {
	var input WorkbenchQueryInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.QueryWorkbench(c.Request.Context(), currentPrincipal(c), input)
	h.result(c, result, err)
}
