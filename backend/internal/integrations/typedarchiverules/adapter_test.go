package typedarchiverules

import (
	"context"
	"errors"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/jackc/pgx/v5"
)

func TestAdapterBridgesTypedArchiveRulesWithoutChangingValuesOrErrors(t *testing.T) {
	dayOfMonth := int32(25)
	wantErr := errors.New("BOB rejected the transition")
	business := &fakeBusiness{
		otherResult: bobdomain.DetailView{
			SettlementMethodID: "settlement-id", SettlementMethodCode: "MONTHLY", SettlementMethodName: "月结",
			TermCode: "MONTH_END", RuleType: "MONTHLY", MonthOffset: 1, DayOfMonth: &dayOfMonth, DayOffset: 7,
		},
		referenceResult: bobdomain.EffectiveReference{
			ObjectID: "01JAVX00000000000000000001", ApprovalEntryID: "01JAVX00000000000000000002", Code: "ORG001",
			Data: bobdomain.DetailView{Name: "经营主体"},
		},
		otherUnapproveErr: wantErr,
		salesUnapproveErr: wantErr,
	}
	adapter := New(business)

	resolved, err := adapter.ResolveOtherUnitDeclaration(t.Context(), nil, dcldomain.OtherUnitDeclaration{
		ContactName: "联系人", ContactPhone: "13800000000", Email: "contact@example.com", Address: "地址",
		SettlementMethodID: "settlement-id",
	}, false)
	if err != nil {
		t.Fatalf("resolve Other Unit declaration: %v", err)
	}
	if business.otherInput.SettlementMethodID != "settlement-id" || business.otherInput.ContactName != "联系人" || business.otherExact {
		t.Fatalf("BOB declaration input = %+v exact=%t", business.otherInput, business.otherExact)
	}
	if resolved.SettlementMethodName != "月结" || resolved.DayOfMonth == nil || *resolved.DayOfMonth != 25 || resolved.DayOffset != 7 {
		t.Fatalf("resolved declaration = %+v", resolved)
	}

	reference, err := adapter.ResolveOperatingEntity(t.Context(), nil, "01JAVX00000000000000000001")
	if err != nil {
		t.Fatalf("resolve operating entity: %v", err)
	}
	if business.referenceEntity != bobdomain.EntityOperatingEntity || business.referenceObjectID != "01JAVX00000000000000000001" {
		t.Fatalf("BOB reference request entity=%q objectID=%q", business.referenceEntity, business.referenceObjectID)
	}
	if reference != (dcldomain.OperatingEntityReference{ObjectID: "01JAVX00000000000000000001", ApprovalEntryID: "01JAVX00000000000000000002", Code: "ORG001", Name: "经营主体"}) {
		t.Fatalf("operating entity reference = %+v", reference)
	}

	if err = adapter.EnsureOtherUnitUnapproveAllowed(t.Context(), nil, "01JAVX00000000000000000003"); !errors.Is(err, wantErr) {
		t.Fatalf("Other Unit unapprove error = %v, want %v", err, wantErr)
	}
	if err = adapter.EnsureSalesPartnerUnapproveAllowed(t.Context(), nil, "01JAVX00000000000000000004"); !errors.Is(err, wantErr) {
		t.Fatalf("Sales Partner unapprove error = %v, want %v", err, wantErr)
	}
}

type fakeBusiness struct {
	otherInput        bobdomain.DetailView
	otherExact        bool
	otherResult       bobdomain.DetailView
	otherErr          error
	referenceEntity   string
	referenceObjectID string
	referenceResult   bobdomain.EffectiveReference
	referenceErr      error
	otherUnapproveErr error
	salesUnapproveErr error
}

func (f *fakeBusiness) ResolveOtherUnitDeclaration(_ context.Context, _ pgx.Tx, input bobdomain.DetailView, exact bool) (bobdomain.DetailView, error) {
	f.otherInput, f.otherExact = input, exact
	return f.otherResult, f.otherErr
}

func (f *fakeBusiness) ResolveCurrentReference(_ context.Context, _ pgx.Tx, entity, objectID string) (bobdomain.EffectiveReference, error) {
	f.referenceEntity, f.referenceObjectID = entity, objectID
	return f.referenceResult, f.referenceErr
}

func (f *fakeBusiness) EnsureOtherUnitUnapproveAllowed(_ context.Context, _ pgx.Tx, _ string) error {
	return f.otherUnapproveErr
}

func (f *fakeBusiness) EnsureSalesPartnerUnapproveAllowed(_ context.Context, _ pgx.Tx, _ string) error {
	return f.salesUnapproveErr
}
