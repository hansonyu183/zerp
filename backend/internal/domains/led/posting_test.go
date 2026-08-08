package led

import (
	"errors"
	"slices"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
)

func TestPostingVOUEntitiesReturnsIndependentPostingSet(t *testing.T) {
	t.Parallel()
	entities := PostingVOUEntities()
	for _, entity := range []string{voudomain.EntityEmployeeLoan, voudomain.EntityOtherIncome} {
		if !slices.Contains(entities, entity) {
			t.Fatalf("posting entities do not contain %q", entity)
		}
	}
	for _, entity := range []string{voudomain.EntitySaleOrder, voudomain.EntitySaleDelivery, voudomain.EntitySalePricing} {
		if slices.Contains(entities, entity) {
			t.Fatalf("posting entities contain non-ledger entity %q", entity)
		}
	}

	entities[0] = "mutated"
	if PostingVOUEntities()[0] == "mutated" {
		t.Fatal("posting entity list exposes mutable domain state")
	}
}

func TestRegisterSubscriptionsUsesPostingVOUEntities(t *testing.T) {
	t.Parallel()
	service := &Service{}
	if err := service.RegisterSubscriptions(nil); err == nil {
		t.Fatal("nil event bus was accepted")
	}
	bus := txevent.NewBus()
	if err := service.RegisterSubscriptions(bus); err != nil {
		t.Fatalf("register LED subscriptions: %v", err)
	}
	if err := service.RegisterSubscriptions(bus); !errors.Is(err, txevent.ErrDuplicateSubscriber) {
		t.Fatalf("duplicate registration error = %v", err)
	}
}
