package txevent

import (
	"context"
	"errors"
	"fmt"
	"runtime/debug"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
)

var (
	ErrInvalidSubscription = errors.New("invalid transactional event subscription")
	ErrDuplicateSubscriber = errors.New("duplicate transactional event subscriber")
	ErrInvalidPublication  = errors.New("invalid transactional event publication")
)

// Event is delivered synchronously to every subscriber registered for its topic.
type Event interface {
	Topic() string
}

// Handler must use tx for every database operation that needs to be atomic with
// the publisher. It must not start asynchronous work or perform external side
// effects that cannot be rolled back with tx.
type Handler func(context.Context, pgx.Tx, Event) error

type subscription struct {
	name    string
	handler Handler
}

// Bus is an in-process synchronous transactional event bus.
type Bus struct {
	mu            sync.RWMutex
	subscriptions map[string][]subscription
}

func NewBus() *Bus {
	return &Bus{subscriptions: make(map[string][]subscription)}
}

// Subscribe registers a named handler for a topic. Handlers are invoked in
// registration order. Subscriber names must be unique within a topic.
func (b *Bus) Subscribe(topic, subscriberName string, handler Handler) error {
	if b == nil {
		return fmt.Errorf("%w: nil bus", ErrInvalidSubscription)
	}
	topic = strings.TrimSpace(topic)
	subscriberName = strings.TrimSpace(subscriberName)
	if topic == "" || subscriberName == "" || handler == nil {
		return ErrInvalidSubscription
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	if b.subscriptions == nil {
		b.subscriptions = make(map[string][]subscription)
	}
	for _, existing := range b.subscriptions[topic] {
		if existing.name == subscriberName {
			return fmt.Errorf("%w: topic %q subscriber %q", ErrDuplicateSubscriber, topic, subscriberName)
		}
	}
	b.subscriptions[topic] = append(b.subscriptions[topic], subscription{
		name: subscriberName, handler: handler,
	})
	return nil
}

// Publish invokes a snapshot of the topic's subscribers synchronously and stops
// at the first failure. Publish never commits or rolls back tx.
func (b *Bus) Publish(ctx context.Context, tx pgx.Tx, event Event) error {
	if b == nil || ctx == nil || tx == nil || event == nil {
		return ErrInvalidPublication
	}
	topic := strings.TrimSpace(event.Topic())
	if topic == "" {
		return fmt.Errorf("%w: empty topic", ErrInvalidPublication)
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	b.mu.RLock()
	subscribers := append([]subscription(nil), b.subscriptions[topic]...)
	b.mu.RUnlock()

	for _, subscriber := range subscribers {
		if err := invoke(ctx, tx, event, subscriber.handler); err != nil {
			return &DeliveryError{Topic: topic, Subscriber: subscriber.name, Cause: err}
		}
	}
	return nil
}

func invoke(ctx context.Context, tx pgx.Tx, event Event, handler Handler) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = &panicError{Value: recovered, Stack: debug.Stack()}
		}
	}()
	return handler(ctx, tx, event)
}

// RejectionError represents a safe business rejection from a subscriber.
type RejectionError struct {
	Message string
	Data    any
}

func (e *RejectionError) Error() string {
	if e == nil || strings.TrimSpace(e.Message) == "" {
		return "transactional event rejected"
	}
	return e.Message
}

func Reject(message string, data any) error {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "transactional event rejected"
	}
	return &RejectionError{Message: message, Data: data}
}

// DeliveryError identifies the subscriber that prevented event delivery.
type DeliveryError struct {
	Topic      string
	Subscriber string
	Cause      error
}

func (e *DeliveryError) Error() string {
	if e == nil {
		return "transactional event delivery failed"
	}
	return fmt.Sprintf("deliver transactional event %q to %q: %v", e.Topic, e.Subscriber, e.Cause)
}

func (e *DeliveryError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

type panicError struct {
	Value any
	Stack []byte
}

func (e *panicError) Error() string {
	return fmt.Sprintf("subscriber panic: %v\n%s", e.Value, e.Stack)
}
