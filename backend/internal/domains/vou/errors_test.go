package vou

import (
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
)

func TestMapApprovalErrorPreservesTransactionalConsumerRejection(t *testing.T) {
	rejection := txevent.Reject("approved accounting mapping is missing", map[string]any{"bookId": "book-1"})
	err := &approval.Error{
		Kind: approval.ErrorInternal, ErrorKey: "approval_event_delivery_failed",
		Message: "approval event delivery failed", Cause: rejection,
	}

	mapped := mapApprovalError(err)
	var domainErr *DomainError
	if !errors.As(mapped, &domainErr) || domainErr.Kind != ErrorConflict ||
		domainErr.Message != "approved accounting mapping is missing" {
		t.Fatalf("mapped rejection = %#v", mapped)
	}
	data, ok := domainErr.Data.(map[string]any)
	if !ok || data["bookId"] != "book-1" {
		t.Fatalf("mapped rejection data = %#v", domainErr.Data)
	}
}
