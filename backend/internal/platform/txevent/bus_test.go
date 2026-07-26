package txevent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type testEvent string

func (e testEvent) Topic() string { return string(e) }

type stubTx struct{}

func (stubTx) Begin(context.Context) (pgx.Tx, error) { return nil, errors.New("unused") }
func (stubTx) Commit(context.Context) error          { return errors.New("unused") }
func (stubTx) Rollback(context.Context) error        { return errors.New("unused") }
func (stubTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	return 0, errors.New("unused")
}
func (stubTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults { return nil }
func (stubTx) LargeObjects() pgx.LargeObjects                         { return pgx.LargeObjects{} }
func (stubTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	return nil, errors.New("unused")
}
func (stubTx) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unused")
}
func (stubTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unused")
}
func (stubTx) QueryRow(context.Context, string, ...any) pgx.Row { return nil }
func (stubTx) Conn() *pgx.Conn                                  { return nil }

func TestBusRoutesInRegistrationOrderAndStopsOnFailure(t *testing.T) {
	bus := NewBus()
	var calls []string
	first := func(_ context.Context, gotTx pgx.Tx, event Event) error {
		if _, ok := gotTx.(stubTx); !ok || event.Topic() != "vou.sale-order.executed" {
			t.Fatalf("unexpected delivery tx=%T topic=%q", gotTx, event.Topic())
		}
		calls = append(calls, "first")
		return nil
	}
	failure := errors.New("failed")
	second := func(context.Context, pgx.Tx, Event) error {
		calls = append(calls, "second")
		return failure
	}
	third := func(context.Context, pgx.Tx, Event) error {
		calls = append(calls, "third")
		return nil
	}
	for name, handler := range map[string]Handler{
		"wrong-topic": third,
	} {
		if err := bus.Subscribe("vou.purchase-order.executed", name, handler); err != nil {
			t.Fatalf("subscribe wrong topic: %v", err)
		}
	}
	if err := bus.Subscribe("vou.sale-order.executed", "first", first); err != nil {
		t.Fatalf("subscribe first: %v", err)
	}
	if err := bus.Subscribe("vou.sale-order.executed", "second", second); err != nil {
		t.Fatalf("subscribe second: %v", err)
	}
	if err := bus.Subscribe("vou.sale-order.executed", "third", third); err != nil {
		t.Fatalf("subscribe third: %v", err)
	}

	err := bus.Publish(t.Context(), stubTx{}, testEvent("vou.sale-order.executed"))
	var delivery *DeliveryError
	if !errors.As(err, &delivery) || delivery.Subscriber != "second" || !errors.Is(err, failure) {
		t.Fatalf("publish error = %#v", err)
	}
	if got, want := fmt.Sprint(calls), "[first second]"; got != want {
		t.Fatalf("calls = %s, want %s", got, want)
	}
}

func TestBusAllowsNoSubscribers(t *testing.T) {
	if err := NewBus().Publish(t.Context(), stubTx{}, testEvent("unregistered")); err != nil {
		t.Fatalf("publish without subscribers: %v", err)
	}
}

func TestBusRejectsInvalidAndDuplicateSubscriptions(t *testing.T) {
	bus := &Bus{}
	handler := func(context.Context, pgx.Tx, Event) error { return nil }
	if err := bus.Subscribe("", "subscriber", handler); !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("empty topic error = %v", err)
	}
	if err := bus.Subscribe("topic", "", handler); !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("empty subscriber error = %v", err)
	}
	if err := bus.Subscribe("topic", "subscriber", nil); !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("nil handler error = %v", err)
	}
	if err := bus.Subscribe("topic", "subscriber", handler); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := bus.Subscribe("topic", "subscriber", handler); !errors.Is(err, ErrDuplicateSubscriber) {
		t.Fatalf("duplicate error = %v", err)
	}
}

func TestBusPreservesRejectionAndRecoversPanic(t *testing.T) {
	t.Run("rejection", func(t *testing.T) {
		bus := NewBus()
		if err := bus.Subscribe("topic", "rejector", func(context.Context, pgx.Tx, Event) error {
			return Reject("库存不足", map[string]any{"available": 0})
		}); err != nil {
			t.Fatalf("subscribe: %v", err)
		}
		err := bus.Publish(t.Context(), stubTx{}, testEvent("topic"))
		var rejection *RejectionError
		if !errors.As(err, &rejection) || rejection.Message != "库存不足" {
			t.Fatalf("rejection = %#v", err)
		}
	})

	t.Run("panic", func(t *testing.T) {
		bus := NewBus()
		if err := bus.Subscribe("topic", "panicker", func(context.Context, pgx.Tx, Event) error {
			panic("boom")
		}); err != nil {
			t.Fatalf("subscribe: %v", err)
		}
		err := bus.Publish(t.Context(), stubTx{}, testEvent("topic"))
		var delivery *DeliveryError
		if !errors.As(err, &delivery) || delivery.Subscriber != "panicker" ||
			err == nil || !strings.Contains(err.Error(), "subscriber panic: boom") {
			t.Fatalf("panic error = %#v", err)
		}
	})
}

func TestBusConcurrentSubscribeAndPublish(t *testing.T) {
	bus := NewBus()
	const count = 50
	var wg sync.WaitGroup
	for index := range count {
		wg.Add(1)
		go func() {
			defer wg.Done()
			name := fmt.Sprintf("subscriber-%d", index)
			if err := bus.Subscribe("topic", name, func(context.Context, pgx.Tx, Event) error {
				return nil
			}); err != nil {
				t.Errorf("subscribe %s: %v", name, err)
			}
			if err := bus.Publish(t.Context(), stubTx{}, testEvent("topic")); err != nil {
				t.Errorf("publish: %v", err)
			}
		}()
	}
	wg.Wait()
}
