package approval

import (
	"context"
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type topicStubTx struct{}

func (topicStubTx) Begin(context.Context) (pgx.Tx, error) { return nil, errors.New("unused") }
func (topicStubTx) Commit(context.Context) error          { return errors.New("unused") }
func (topicStubTx) Rollback(context.Context) error        { return errors.New("unused") }
func (topicStubTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	return 0, errors.New("unused")
}
func (topicStubTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults { return nil }
func (topicStubTx) LargeObjects() pgx.LargeObjects                         { return pgx.LargeObjects{} }
func (topicStubTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	return nil, errors.New("unused")
}
func (topicStubTx) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unused")
}
func (topicStubTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unused")
}
func (topicStubTx) QueryRow(context.Context, string, ...any) pgx.Row { return nil }
func (topicStubTx) Conn() *pgx.Conn                                  { return nil }

type typedPayload struct {
	SubjectID string
}

func TestTypedTopicDeliversWithoutConsumerCasts(t *testing.T) {
	bus := txevent.NewBus()
	topic := MustTopic[typedPayload]("approval.test-subject.lifecycle")
	var received Event[typedPayload]
	if err := topic.Subscribe(bus, "test-subscriber", func(_ context.Context, tx pgx.Tx, event Event[typedPayload]) error {
		if _, ok := tx.(topicStubTx); !ok {
			t.Fatalf("transaction type = %T", tx)
		}
		received = event
		return nil
	}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	event := Event[typedPayload]{Action: ActionApproved, Payload: typedPayload{SubjectID: "subject-1"}}
	if err := topic.Publish(t.Context(), bus, topicStubTx{}, event); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if received.Action != ActionApproved || received.Payload.SubjectID != "subject-1" {
		t.Fatalf("received event = %+v", received)
	}
}

func TestTypedTopicPreservesSubscriberFailureAndPanic(t *testing.T) {
	for _, test := range []struct {
		name      string
		handler   Handler[string]
		wantCause error
	}{
		{name: "error", wantCause: errors.New("reject"), handler: nil},
		{name: "panic", handler: func(context.Context, pgx.Tx, Event[string]) error { panic("boom") }},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := txevent.NewBus()
			topic := MustTopic[string]("approval.failure.lifecycle")
			handler := test.handler
			if test.wantCause != nil {
				handler = func(context.Context, pgx.Tx, Event[string]) error { return test.wantCause }
			}
			if err := topic.Subscribe(bus, "subscriber", handler); err != nil {
				t.Fatalf("subscribe: %v", err)
			}
			err := topic.Publish(t.Context(), bus, topicStubTx{}, Event[string]{Payload: "payload"})
			var delivery *txevent.DeliveryError
			if !errors.As(err, &delivery) {
				t.Fatalf("delivery error = %v", err)
			}
			if test.wantCause != nil && !errors.Is(err, test.wantCause) {
				t.Fatalf("delivery cause = %v", err)
			}
		})
	}
}
