package auxiliaryrefs

import (
	"context"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

type Resolver struct {
	service *auxdomain.Service
}

func New(service *auxdomain.Service) Resolver {
	return Resolver{service: service}
}

func (resolver Resolver) ResolveCurrentAuxiliaryReference(
	ctx context.Context,
	tx pgx.Tx,
	entity, objectID string,
) (bobdomain.AuxiliaryReference, error) {
	reference, err := resolver.service.ResolveCurrentReference(ctx, tx, entity, objectID)
	if err != nil {
		return bobdomain.AuxiliaryReference{}, err
	}
	return mapReference(reference), nil
}

func (resolver Resolver) ResolveAuxiliaryCode(
	ctx context.Context,
	tx pgx.Tx,
	entity, code string,
) (bobdomain.AuxiliaryReference, error) {
	reference, err := resolver.service.ResolveCode(ctx, tx, entity, code)
	if err != nil {
		return bobdomain.AuxiliaryReference{}, err
	}
	return mapReference(reference), nil
}

func mapReference(reference auxdomain.Reference) bobdomain.AuxiliaryReference {
	return bobdomain.AuxiliaryReference{
		ObjectID: reference.ObjectID, Entity: reference.Entity, Code: reference.Code, Data: reference.Data,
	}
}
