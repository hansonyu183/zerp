package approval

import (
	"context"
	"errors"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

var ErrTypedEventMismatch = errors.New("typed approval event mismatch")

type Topic[T any] struct {
	name string
}

func NewTopic[T any](name string) (Topic[T], error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Topic[T]{}, txevent.ErrInvalidSubscription
	}
	return Topic[T]{name: name}, nil
}

func MustTopic[T any](name string) Topic[T] {
	topic, err := NewTopic[T](name)
	if err != nil {
		panic(err)
	}
	return topic
}

func (t Topic[T]) Name() string { return t.name }

type publishedEvent[T any] struct {
	topic string
	event Event[T]
}

func (e publishedEvent[T]) Topic() string { return e.topic }

type Handler[T any] func(context.Context, pgx.Tx, Event[T]) error

func Subscribe[T any](bus *txevent.Bus, topic Topic[T], subscriberName string, handler Handler[T]) error {
	if bus == nil || strings.TrimSpace(topic.name) == "" || handler == nil {
		return txevent.ErrInvalidSubscription
	}
	return bus.Subscribe(topic.name, subscriberName, func(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
		typed, ok := raw.(publishedEvent[T])
		if !ok || typed.topic != topic.name {
			return ErrTypedEventMismatch
		}
		return handler(ctx, tx, typed.event)
	})
}

func Publish[T any](ctx context.Context, bus *txevent.Bus, tx pgx.Tx, topic Topic[T], event Event[T]) error {
	if bus == nil || strings.TrimSpace(topic.name) == "" {
		return txevent.ErrInvalidPublication
	}
	return bus.Publish(ctx, tx, publishedEvent[T]{topic: topic.name, event: event})
}

func (t Topic[T]) Subscribe(bus *txevent.Bus, subscriberName string, handler Handler[T]) error {
	return Subscribe(bus, t, subscriberName, handler)
}

func (t Topic[T]) Publish(ctx context.Context, bus *txevent.Bus, tx pgx.Tx, event Event[T]) error {
	return Publish(ctx, bus, tx, t, event)
}
