package vou

import "strings"

const (
	documentExecutedTopicPrefix   = "vou.document.executed."
	documentUnexecutedTopicPrefix = "vou.document.unexecuted."
	documentFinalizedTopicPrefix  = "vou.document.finalized."
	documentReversedTopicPrefix   = "vou.document.reversed."
)

type ManagedDocumentEvent struct {
	Action, Entity, DocumentID, DocumentNo string
	Revision                               int64
	ActorID, RequestID, Reason             string
}

func (event ManagedDocumentEvent) Topic() string {
	if event.Action == "FINALIZED" {
		return documentFinalizedTopicPrefix + strings.TrimSpace(event.Entity)
	}
	return documentReversedTopicPrefix + strings.TrimSpace(event.Entity)
}

func ManagedDocumentFinalizedTopic(entity string) string {
	return documentFinalizedTopicPrefix + strings.TrimSpace(entity)
}

func ManagedDocumentReversedTopic(entity string) string {
	return documentReversedTopicPrefix + strings.TrimSpace(entity)
}

type DocumentExecutedEvent struct {
	Entity     string
	DocumentID string
	DocumentNo string
	Revision   int64
	ActorID    string
	RequestID  string
}

func (event DocumentExecutedEvent) Topic() string {
	return DocumentExecutedTopic(event.Entity)
}

type DocumentUnexecutedEvent struct {
	Entity     string
	DocumentID string
	DocumentNo string
	Revision   int64
	ActorID    string
	RequestID  string
	Reason     string
}

func (event DocumentUnexecutedEvent) Topic() string {
	return DocumentUnexecutedTopic(event.Entity)
}

func DocumentExecutedTopic(entity string) string {
	return documentExecutedTopicPrefix + strings.TrimSpace(entity)
}

func DocumentUnexecutedTopic(entity string) string {
	return documentUnexecutedTopicPrefix + strings.TrimSpace(entity)
}
