package vou

import (
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

const (
	documentCreatedTopicPrefix = "vou.document.created."
	documentDeletedTopicPrefix = "vou.document.deleted."
	approvalTopicPrefix        = "vou.approval."
)

type DocumentCreatedEvent struct {
	Entity           string
	DocumentID       string
	DocumentNo       string
	Revision         int64
	ParentEntity     string
	ParentDocumentID string
	ActorID          string
	RequestID        string
}

func (event DocumentCreatedEvent) Topic() string {
	return DocumentCreatedTopic(event.Entity)
}

func DocumentCreatedTopic(entity string) string {
	return documentCreatedTopicPrefix + strings.TrimSpace(entity)
}

type DocumentDeletedEvent struct {
	Entity           string
	DocumentID       string
	DocumentNo       string
	ParentDocumentID string
	ActorID          string
	RequestID        string
	Reason           string
}

func (event DocumentDeletedEvent) Topic() string {
	return DocumentDeletedTopic(event.Entity)
}

func DocumentDeletedTopic(entity string) string {
	return documentDeletedTopicPrefix + strings.TrimSpace(entity)
}

func ApprovalTopic(entity string) approval.Topic[DocumentView] {
	return approval.MustTopic[DocumentView](approvalTopicPrefix + strings.TrimSpace(entity))
}
