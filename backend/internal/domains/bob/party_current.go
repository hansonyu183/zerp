package bob

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PartyCurrentReader exposes the small, current-only Party read surface that
// other domains need. It deliberately does not depend on Service, so wiring
// DCL's declaration service cannot create a BOB/DCL constructor cycle.
type PartyCurrentReader struct {
	pool    *pgxpool.Pool
	queries *dbsqlc.Queries
}

func NewPartyCurrentReader(pool *pgxpool.Pool) *PartyCurrentReader {
	if pool == nil {
		panic("bob: Party current reader requires persistence")
	}
	return &PartyCurrentReader{pool: pool, queries: dbsqlc.New(pool)}
}

// RelationshipCards returns only current BOB relationship cards permitted by
// visibility. Callers therefore cannot infer the existence or count of a
// hidden relationship type.
func (r *PartyCurrentReader) RelationshipCards(ctx context.Context, partyID string, visibility PartyRelationshipVisibility) ([]PartyRelationshipCard, error) {
	if !validID(partyID) {
		return nil, domainError(ErrorValidation, "invalid Party", nil, nil)
	}
	return visiblePartyRelationshipCards(ctx, r.queries, partyID, visibility)
}

// ResolveForRelationship returns the highest approved Party snapshot inside
// the caller's transaction. A merged DCL Party root is unavailable.
func (r *PartyCurrentReader) ResolveForRelationship(ctx context.Context, tx pgx.Tx, partyID string) (PartyRelationshipResolved, error) {
	if tx == nil || !validID(partyID) {
		return PartyRelationshipResolved{}, domainError(ErrorValidation, "invalid Party", nil, nil)
	}
	party, err := r.queries.WithTx(tx).GetDCLApprovedPartyForBOB(ctx, partyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return PartyRelationshipResolved{}, domainError(ErrorConflict, "主体不可用", nil, nil)
	}
	return PartyRelationshipResolved{ID: party.ID, Kind: party.Kind, DisplayName: party.DisplayName}, err
}
