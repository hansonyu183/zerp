package vou

import "strings"

const (
	documentCreatedTopicPrefix    = "vou.document.created."
	documentDeletedTopicPrefix    = "vou.document.deleted."
	documentChangedTopicPrefix    = "vou.document.changed."
	documentApprovedTopicPrefix   = "vou.document.approved."
	documentUnapprovedTopicPrefix = "vou.document.unapproved."
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

type DocumentApprovedEvent struct {
	Entity     string
	DocumentID string
	DocumentNo string
	Revision   int64
	ActorID    string
	RequestID  string
	Snapshot   DocumentView
}

func (event DocumentApprovedEvent) Topic() string {
	return DocumentApprovedTopic(event.Entity)
}

func DocumentApprovedTopic(entity string) string {
	return documentApprovedTopicPrefix + strings.TrimSpace(entity)
}

type DocumentUnapprovedEvent struct {
	Entity     string
	DocumentID string
	DocumentNo string
	Revision   int64
	ActorID    string
	RequestID  string
	Reason     string
	Snapshot   DocumentView
}

func (event DocumentUnapprovedEvent) Topic() string {
	return DocumentUnapprovedTopic(event.Entity)
}

func DocumentUnapprovedTopic(entity string) string {
	return documentUnapprovedTopicPrefix + strings.TrimSpace(entity)
}
