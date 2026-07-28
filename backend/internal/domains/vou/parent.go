package vou

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

func validateParentInput(entity, documentID string) (string, string, error) {
	entity = strings.TrimSpace(entity)
	documentID = strings.TrimSpace(documentID)
	if (entity == "") != (documentID == "") {
		return "", "", domainError(
			ErrorValidation,
			"parentEntity and parentDocumentId must both be set or both be empty",
			nil,
			nil,
		)
	}
	if entity == "" {
		return "", "", nil
	}
	if !validEntity(entity) || !validID(documentID) {
		return "", "", domainError(ErrorValidation, "invalid parent document", nil, nil)
	}
	return entity, documentID, nil
}

func validateParentExists(ctx context.Context, tx pgx.Tx, entity, documentID string) error {
	if entity == "" {
		return nil
	}
	var foundEntity string
	err := tx.QueryRow(ctx, `SELECT entity FROM vou_documents WHERE id=$1 FOR SHARE`, documentID).
		Scan(&foundEntity)
	if errors.Is(err, pgx.ErrNoRows) || foundEntity != entity {
		return domainError(ErrorValidation, "parent document does not match parentEntity", nil, nil)
	}
	if err != nil {
		return domainError(ErrorInternal, "load parent document", nil, err)
	}
	return nil
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
