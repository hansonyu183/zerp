package dcl

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

// subjectIdentity is the immutable DCL-owned identity of a versioned
// declaration. Approval owns version and revision; the subject owns neither.
type subjectIdentity struct {
	ObjectID string
	Code     string
}

func reserveSubject(ctx context.Context, tx pgx.Tx, entity, prefix, actorID string) (subjectIdentity, error) {
	q := dbsqlc.New(tx)
	number, err := q.NextDCLSubjectCode(ctx, entity)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return subjectIdentity{}, newError(
				ErrorConflict,
				"dcl_subject_code_capacity_exhausted",
				"DCL subject code capacity exhausted",
				nil,
				err,
			)
		}
		return subjectIdentity{}, err
	}
	identity := subjectIdentity{ObjectID: ulid.Make().String(), Code: fmt.Sprintf("%s-%04d", prefix, number)}
	if err = q.InsertDCLSubject(ctx, dbsqlc.InsertDCLSubjectParams{
		ID: identity.ObjectID, Entity: entity, Code: &identity.Code, ActorID: actorID,
	}); err != nil {
		return subjectIdentity{}, err
	}
	return identity, nil
}

func lockSubject(ctx context.Context, tx pgx.Tx, entity, objectID string) (subjectIdentity, error) {
	row, err := dbsqlc.New(tx).LockDCLSubject(ctx, dbsqlc.LockDCLSubjectParams{ID: objectID, Entity: entity})
	if err != nil {
		return subjectIdentity{}, err
	}
	if row.Code == nil {
		return subjectIdentity{}, fmt.Errorf("DCL subject %s/%s has no business code", entity, objectID)
	}
	return subjectIdentity{ObjectID: row.ID, Code: *row.Code}, nil
}
