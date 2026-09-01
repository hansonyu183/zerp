package typedarchiverules

import (
	"context"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/jackc/pgx/v5"
)

type businessService interface {
	ResolveOtherUnitDeclaration(context.Context, pgx.Tx, bobdomain.DetailView, bool) (bobdomain.DetailView, error)
	ResolveCurrentReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	EnsureOtherUnitUnapproveAllowed(context.Context, pgx.Tx, string) error
	EnsureSalesPartnerUnapproveAllowed(context.Context, pgx.Tx, string) error
}

// Adapter maps the typed DCL archive port to BOB's read and validation service.
type Adapter struct {
	business businessService
}

func New(business businessService) *Adapter {
	return &Adapter{business: business}
}

func (a *Adapter) ResolveOtherUnitDeclaration(ctx context.Context, tx pgx.Tx, input dcldomain.OtherUnitDeclaration, exact bool) (dcldomain.OtherUnitDeclaration, error) {
	resolved, err := a.business.ResolveOtherUnitDeclaration(ctx, tx, bobdomain.DetailView{
		ContactName: input.ContactName, ContactPhone: input.ContactPhone, Email: input.Email, Address: input.Address,
		SettlementMethodID: input.SettlementMethodID, SettlementMethodCode: input.SettlementMethodCode, SettlementMethodName: input.SettlementMethodName,
		TermCode: input.TermCode, RuleType: input.RuleType, MonthOffset: input.MonthOffset, DayOfMonth: input.DayOfMonth,
		DayOffset: input.DayOffset, Remark: input.Remark,
	}, exact)
	if err != nil {
		return dcldomain.OtherUnitDeclaration{}, err
	}
	return dcldomain.OtherUnitDeclaration{
		ContactName: resolved.ContactName, ContactPhone: resolved.ContactPhone, Email: resolved.Email, Address: resolved.Address,
		SettlementMethodID: resolved.SettlementMethodID, SettlementMethodCode: resolved.SettlementMethodCode, SettlementMethodName: resolved.SettlementMethodName,
		TermCode: resolved.TermCode, RuleType: resolved.RuleType, MonthOffset: resolved.MonthOffset, DayOfMonth: resolved.DayOfMonth,
		DayOffset: resolved.DayOffset, Remark: resolved.Remark,
	}, nil
}

func (a *Adapter) ResolveOperatingEntity(ctx context.Context, tx pgx.Tx, objectID string) (dcldomain.OperatingEntityReference, error) {
	reference, err := a.business.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, objectID)
	if err != nil {
		return dcldomain.OperatingEntityReference{}, err
	}
	return dcldomain.OperatingEntityReference{
		ObjectID: reference.ObjectID, ApprovalEntryID: reference.ApprovalEntryID, Code: reference.Code, Name: reference.Data.Name,
	}, nil
}

func (a *Adapter) EnsureOtherUnitUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	return a.business.EnsureOtherUnitUnapproveAllowed(ctx, tx, entryID)
}

func (a *Adapter) EnsureSalesPartnerUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	return a.business.EnsureSalesPartnerUnapproveAllowed(ctx, tx, entryID)
}

var _ dcldomain.TypedArchiveRules = (*Adapter)(nil)
