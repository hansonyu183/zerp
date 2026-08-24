package bob

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

type ReferenceQueryInput struct {
	Entity          string `json:"entity"`
	Keyword         string `json:"keyword"`
	SourceObjectID  string `json:"sourceObjectId"`
	BehaviorProfile string `json:"behaviorProfile"`
}

type ReferenceCandidate struct {
	ObjectID           string                  `json:"objectId"`
	VersionID          string                  `json:"versionId"`
	Code               string                  `json:"code"`
	Name               string                  `json:"name"`
	BehaviorProfile    string                  `json:"behaviorProfile,omitempty"`
	DefaultInputUnitID string                  `json:"defaultInputUnitId,omitempty"`
	PricingUnitID      string                  `json:"pricingUnitId,omitempty"`
	UnitConversions    []ProductUnitConversion `json:"unitConversions,omitempty"`
}

func (s *Service) QueryReferenceCandidates(ctx context.Context, input ReferenceQueryInput) ([]ReferenceCandidate, error) {
	if input.Entity != EntityCustomerAccount && input.Entity != EntityOperatingEntity && input.Entity != EntityEmployee && input.Entity != EntityOtherUnit &&
		input.Entity != EntitySupplier && input.Entity != EntitySalesPartner && input.Entity != EntityProduct {
		return nil, domainError(ErrorValidation, "invalid BOB reference entity", nil, nil)
	}
	if input.SourceObjectID != "" && !validID(input.SourceObjectID) {
		return nil, domainError(ErrorValidation, "invalid BOB reference source", nil, nil)
	}
	if input.BehaviorProfile != "" && (input.Entity != EntityProduct || !validProductBehavior(input.BehaviorProfile)) {
		return nil, domainError(ErrorValidation, "invalid product behavior profile", nil, nil)
	}
	rows, err := s.queries.QueryBobReferenceCandidates(ctx, dbsqlc.QueryBobReferenceCandidatesParams{
		Entity: input.Entity, Keyword: input.Keyword, SourceObjectID: input.SourceObjectID,
		BehaviorProfile: input.BehaviorProfile,
	})
	if err != nil {
		return nil, s.internal("query BOB reference candidates", err)
	}
	result := make([]ReferenceCandidate, 0, len(rows))
	for _, row := range rows {
		candidate := ReferenceCandidate{ObjectID: row.ObjectID, VersionID: deref(row.VersionID), Code: row.Code, Name: row.Name,
			BehaviorProfile: row.BehaviorProfile, DefaultInputUnitID: row.DefaultInputUnitID, PricingUnitID: row.PricingUnitID}
		if input.Entity == EntityProduct {
			candidate.UnitConversions, err = loadProductUnitConversions(ctx, s.queries, candidate.VersionID)
			if err != nil {
				return nil, s.internal("read product reference unit conversions", err)
			}
		}
		result = append(result, candidate)
	}
	return result, nil
}
