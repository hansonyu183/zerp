package app

import (
	"github.com/gin-gonic/gin"
)

func (h *Handler) createFeedback(c *gin.Context) {
	var input CreateFeedbackInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.CreateFeedback(c.Request.Context(), input, actorID(c))
	h.result(c, result, err)
}

func (h *Handler) getFeedback(c *gin.Context) {
	var input GetFeedbackInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.GetFeedback(c.Request.Context(), input.FeedbackID, actorID(c))
	h.result(c, result, err)
}
