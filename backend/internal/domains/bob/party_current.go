package bob

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PartyCurrentWriter owns the BOB current projection only.  DCL owns every
// identity snapshot and lifecycle transition.
type PartyCurrentWriter struct{ pool *pgxpool.Pool }

// PartyCurrentReader exposes the small, current-only Party read surface that
// other domains need. It deliberately does not depend on Service, so wiring
// DCL's declaration service cannot create a BOB/DCL constructor cycle.
type PartyCurrentReader struct{ pool *pgxpool.Pool }

type PartyIdentity struct {
	PartyID string
}

func NewPartyCurrentWriter(pool *pgxpool.Pool) *PartyCurrentWriter {
	if pool == nil {
		panic("bob: Party current writer requires persistence")
	}
	return &PartyCurrentWriter{pool: pool}
}

func NewPartyCurrentReader(pool *pgxpool.Pool) *PartyCurrentReader {
	if pool == nil {
		panic("bob: Party current reader requires persistence")
	}
	return &PartyCurrentReader{pool: pool}
}

// RelationshipCards returns only current BOB relationship cards permitted by
// visibility. Callers therefore cannot infer the existence or count of a
// hidden relationship type.
func (r *PartyCurrentReader) RelationshipCards(ctx context.Context, partyID string, visibility PartyRelationshipVisibility) ([]PartyRelationshipCard, error) {
	if !validID(partyID) {
		return nil, domainError(ErrorValidation, "invalid Party", nil, nil)
	}
	return visiblePartyRelationshipCards(ctx, r.pool, partyID, visibility)
}

// ResolveForRelationship returns the approved current identity inside the
// caller's transaction. A merged Party has no current row and is unavailable.
func (r *PartyCurrentReader) ResolveForRelationship(ctx context.Context, tx pgx.Tx, partyID string) (PartyRelationshipResolved, error) {
	if tx == nil || !validID(partyID) {
		return PartyRelationshipResolved{}, domainError(ErrorValidation, "invalid Party", nil, nil)
	}
	var resolved PartyRelationshipResolved
	err := tx.QueryRow(ctx, `SELECT party_id,kind,display_name FROM bob_party_currents WHERE party_id=$1`, partyID).
		Scan(&resolved.ID, &resolved.Kind, &resolved.DisplayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return PartyRelationshipResolved{}, domainError(ErrorConflict, "主体不可用", nil, nil)
	}
	return resolved, err
}

func (w *PartyCurrentWriter) CreateStableRoot(ctx context.Context, tx pgx.Tx, partyID string, actorID string) (PartyIdentity, error) {
	if tx == nil || !validID(partyID) || !validID(actorID) {
		return PartyIdentity{}, domainError(ErrorValidation, "invalid Party root", nil, nil)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO bob_parties(id,created_by) VALUES($1,$2)`, partyID, actorID); err != nil {
		return PartyIdentity{}, err
	}
	return PartyIdentity{PartyID: partyID}, nil
}

func (w *PartyCurrentWriter) GetIdentity(ctx context.Context, tx pgx.Tx, partyID string) (PartyIdentity, error) {
	if tx == nil || !validID(partyID) {
		return PartyIdentity{}, domainError(ErrorValidation, "invalid Party identity", nil, nil)
	}
	var i PartyIdentity
	err := tx.QueryRow(ctx, `SELECT id FROM bob_parties WHERE id=$1 FOR UPDATE`, partyID).Scan(&i.PartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return PartyIdentity{}, domainError(ErrorValidation, "Party not found", nil, nil)
	}
	return i, err
}

func (w *PartyCurrentWriter) Apply(ctx context.Context, tx pgx.Tx, partyID, entryID string, data PartyCreateData, identifiers []PartyIdentifierInput, actorID string) (PartyIdentity, error) {
	_, err := w.GetIdentity(ctx, tx, partyID)
	if err != nil {
		return PartyIdentity{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM bob_party_identifiers WHERE party_id=$1`, partyID); err != nil {
		return PartyIdentity{}, err
	}
	if err = insertPartyIdentifiers(ctx, tx, partyID, identifiers); err != nil {
		return PartyIdentity{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO bob_party_currents(party_id,source_approval_entry_id,kind,legal_name,display_name,tax_number,phone,email,address,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (party_id) DO UPDATE SET source_approval_entry_id=EXCLUDED.source_approval_entry_id,kind=EXCLUDED.kind,legal_name=EXCLUDED.legal_name,display_name=EXCLUDED.display_name,tax_number=EXCLUDED.tax_number,phone=EXCLUDED.phone,email=EXCLUDED.email,address=EXCLUDED.address,updated_at=now(),updated_by=EXCLUDED.updated_by`, partyID, entryID, data.Kind, data.LegalName, data.DisplayName, nilIfEmpty(data.TaxNumber), nilIfEmpty(data.Phone), nilIfEmpty(data.Email), nilIfEmpty(data.Address), actorID); err != nil {
		return PartyIdentity{}, err
	}
	return w.GetIdentity(ctx, tx, partyID)
}

func (w *PartyCurrentWriter) Remove(ctx context.Context, tx pgx.Tx, partyID, actorID string) (PartyIdentity, error) {
	i, err := w.GetIdentity(ctx, tx, partyID)
	if err != nil {
		return PartyIdentity{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM bob_party_currents WHERE party_id=$1`, partyID); err != nil {
		return PartyIdentity{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM bob_party_identifiers WHERE party_id=$1`, partyID); err != nil {
		return PartyIdentity{}, err
	}
	return i, nil
}
