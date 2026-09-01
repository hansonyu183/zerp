//go:build integration

package dcl

import (
	"context"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

// typedArchiveIntegrationRules keeps same-package DCL integration tests out of
// an import cycle. Production wiring uses integrations/typedarchiverules.
type typedArchiveIntegrationRules struct {
	business *bobdomain.Service
}

func newTypedArchiveIntegrationRules(business *bobdomain.Service) typedArchiveIntegrationRules {
	return typedArchiveIntegrationRules{business: business}
}

func (r typedArchiveIntegrationRules) ResolveOtherUnitDeclaration(ctx context.Context, tx pgx.Tx, input OtherUnitDeclaration, exact bool) (OtherUnitDeclaration, error) {
	resolved, err := r.business.ResolveOtherUnitDeclaration(ctx, tx, bobdomain.DetailView{
		ContactName: input.ContactName, ContactPhone: input.ContactPhone, Email: input.Email, Address: input.Address,
		SettlementMethodID: input.SettlementMethodID, SettlementMethodCode: input.SettlementMethodCode, SettlementMethodName: input.SettlementMethodName,
		TermCode: input.TermCode, RuleType: input.RuleType, MonthOffset: input.MonthOffset, DayOfMonth: input.DayOfMonth,
		DayOffset: input.DayOffset, Remark: input.Remark,
	}, exact)
	if err != nil {
		return OtherUnitDeclaration{}, err
	}
	return OtherUnitDeclaration{
		ContactName: resolved.ContactName, ContactPhone: resolved.ContactPhone, Email: resolved.Email, Address: resolved.Address,
		SettlementMethodID: resolved.SettlementMethodID, SettlementMethodCode: resolved.SettlementMethodCode, SettlementMethodName: resolved.SettlementMethodName,
		TermCode: resolved.TermCode, RuleType: resolved.RuleType, MonthOffset: resolved.MonthOffset, DayOfMonth: resolved.DayOfMonth,
		DayOffset: resolved.DayOffset, Remark: resolved.Remark,
	}, nil
}

func (r typedArchiveIntegrationRules) ResolveOperatingEntity(ctx context.Context, tx pgx.Tx, objectID string) (OperatingEntityReference, error) {
	reference, err := r.business.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, objectID)
	if err != nil {
		return OperatingEntityReference{}, err
	}
	return OperatingEntityReference{ObjectID: reference.ObjectID, ApprovalEntryID: reference.ApprovalEntryID, Code: reference.Code, Name: reference.Data.Name}, nil
}

func (r typedArchiveIntegrationRules) EnsureOtherUnitUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	return r.business.EnsureOtherUnitUnapproveAllowed(ctx, tx, entryID)
}

func (r typedArchiveIntegrationRules) EnsureSalesPartnerUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	return r.business.EnsureSalesPartnerUnapproveAllowed(ctx, tx, entryID)
}

var _ TypedArchiveRules = typedArchiveIntegrationRules{}
