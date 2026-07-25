package vou

import "strings"

const (
	documentExecutedTopicPrefix   = "vou.document.executed."
	documentUnexecutedTopicPrefix = "vou.document.unexecuted."
)

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

type IntermediaryStageEvent struct {
	Action        string
	Stage         string
	DocumentID    string
	DocumentNo    string
	RootRevision  int64
	ChildID       string
	ChildNo       string
	ChildRevision int64
	ActorID       string
	RequestID     string
	Reason        string
}

func (event IntermediaryStageEvent) Topic() string {
	return "vou.intermediary-v2." + strings.ToLower(event.Stage) + "." + strings.ToLower(event.Action)
}

func IntermediaryStageTopic(stage, action string) string {
	return "vou.intermediary-v2." + strings.ToLower(stage) + "." + strings.ToLower(action)
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
