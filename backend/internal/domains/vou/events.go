package vou

import "strings"

const (
	documentCreatedTopicPrefix         = "vou.document.created."
	documentDeletedTopicPrefix         = "vou.document.deleted."
	documentChangedTopicPrefix         = "vou.document.changed."
	documentFinalizedDirectTopicPrefix = "vou.document.finalized."
	documentUnfinalizedTopicPrefix     = "vou.document.unfinalized."
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

type DocumentChangedEvent struct {
	Action     string
	Entity     string
	DocumentID string
	DocumentNo string
	Status     string
	Revision   int64
	ActorID    string
	RequestID  string
	Reason     string
}

func (event DocumentChangedEvent) Topic() string {
	return DocumentChangedTopic(event.Entity)
}

func DocumentChangedTopic(entity string) string {
	return documentChangedTopicPrefix + strings.TrimSpace(entity)
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
