package bob

import (
	"context"

	"github.com/jackc/pgx/v5"
)

func (s *Service) resolveFundAccountOperating(
	ctx context.Context, tx pgx.Tx, data DetailView,
) (DetailView, error) {
	reference, err := s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, data.OperatingEntityID)
	if err != nil {
		return DetailView{}, err
	}
	data.OperatingEntityID = reference.ObjectID
	data.OperatingEntityApprovalEntryID = reference.ApprovalEntryID
	data.OperatingEntityCode = reference.Code
	data.OperatingEntityName = reference.Data.Name
	return data, nil
}
