package app

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

func (h *Handler) initiateFeedbackAttachment(c *gin.Context) {
	var input FeedbackAttachmentInitiateInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.InitiateFeedbackAttachment(c.Request.Context(), input, actorID(c))
	h.result(c, result, err)
}

func (h *Handler) removeFeedbackAttachment(c *gin.Context) {
	var input FeedbackAttachmentRemoveInput
	if !h.bind(c, &input) {
		return
	}
	err := h.service.RemoveFeedbackAttachment(c.Request.Context(), input.FileID, actorID(c))
	h.result(c, struct{}{}, err)
}

func (h *Handler) uploadFeedbackAttachment(c *gin.Context) {
	err := h.service.UploadFeedbackAttachment(
		c.Request.Context(), c.Param("token"), actorID(c), c.Request.Body,
		c.Request.ContentLength, c.GetHeader("Content-Type"),
	)
	if err != nil {
		h.writeFeedbackFileError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) writeFeedbackFileError(c *gin.Context, err error) {
	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		domainErr = &DomainError{Kind: ErrorInternal, Message: "internal server error", Cause: err}
	}
	status := http.StatusInternalServerError
	switch domainErr.Kind {
	case ErrorValidation:
		status = http.StatusBadRequest
	case ErrorConflict:
		status = http.StatusConflict
	}
	if status == http.StatusInternalServerError {
		h.logger.Error(
			"feedback file endpoint failure",
			"requestId", response.RequestID(c),
			"path", c.FullPath(),
			"error", domainErr.Cause,
		)
	}
	c.JSON(status, gin.H{"error": domainErr.Message, "requestId": response.RequestID(c)})
}

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
