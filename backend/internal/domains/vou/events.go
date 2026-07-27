package vou

import "strings"

const (
	documentFinalizedDirectTopicPrefix = "vou.document.finalized."
	documentUnfinalizedTopicPrefix     = "vou.document.unfinalized."
	documentFinalizedTopicPrefix       = "vou.document.finalized."
	documentReversedTopicPrefix        = "vou.document.reversed."
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

type DocumentFinalizedEvent struct {
	Entity     string
	DocumentID string
	DocumentNo string
	Revision   int64
	ActorID    string
	RequestID  string
}

func (event DocumentFinalizedEvent) Topic() string {
	return DocumentFinalizedTopic(event.Entity)
}

type DocumentUnfinalizedEvent struct {
	Entity     string
	DocumentID string
	DocumentNo string
	Revision   int64
	ActorID    string
	RequestID  string
	Reason     string
}

func (event DocumentUnfinalizedEvent) Topic() string {
	return DocumentUnfinalizedTopic(event.Entity)
}

func DocumentFinalizedTopic(entity string) string {
	return documentFinalizedDirectTopicPrefix + strings.TrimSpace(entity)
}

func DocumentUnfinalizedTopic(entity string) string {
	return documentUnfinalizedTopicPrefix + strings.TrimSpace(entity)
}
