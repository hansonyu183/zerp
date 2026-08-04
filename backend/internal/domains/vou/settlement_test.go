package vou

import (
	"testing"
	"time"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

func TestCalculateDueDateRules(t *testing.T) {
	businessDate := time.Date(2026, time.January, 25, 0, 0, 0, 0, time.UTC)
	due, err := calculateDueDate(businessDate, bobdomain.DetailView{
		RuleType: "DUE_DAYS", DueDays: 30,
	}, 31)
	if err != nil || due.Format(dateLayout) != "2026-02-24" {
		t.Fatalf("due-days result=%s err=%v", due.Format(dateLayout), err)
	}
	due, err = calculateDueDate(businessDate, bobdomain.DetailView{
		RuleType: "MONTH_END",
	}, 25)
	if err != nil || due.Format(dateLayout) != "2026-01-31" {
		t.Fatalf("before-cutoff result=%s err=%v", due.Format(dateLayout), err)
	}
	due, err = calculateDueDate(businessDate.AddDate(0, 0, 1), bobdomain.DetailView{
		RuleType: "MONTH_END",
	}, 25)
	if err != nil || due.Format(dateLayout) != "2026-02-28" {
		t.Fatalf("after-cutoff result=%s err=%v", due.Format(dateLayout), err)
	}
}

func TestApplySettlementSurchargeExcludesPackaging(t *testing.T) {
	draft := validatedDraft{
		BusinessDate: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
		ProductLines: []fixedProductLine{
			{Quantity: 2_000_000, BaseUnitPrice: 1_000},
			{Quantity: 1_000_000, BaseUnitPrice: 500},
		},
	}
	refs := resolvedDraft{
		CustomerSettlement: &bobdomain.EffectiveReference{Data: bobdomain.DetailView{
			RuleType: "DUE_DAYS", DueDays: 10, DefaultSalesSurcharge: "1.50",
		}},
		Products: []bobdomain.EffectiveReference{
			{Data: bobdomain.DetailView{ProductKind: bobdomain.ProductKindRawMaterial}},
			{Data: bobdomain.DetailView{ProductKind: bobdomain.ProductKindPackaging}},
		},
	}
	if err := applySettlementTerms(EntitySaleOrder, &draft, refs); err != nil {
		t.Fatalf("apply terms: %v", err)
	}
	if draft.ProductLines[0].SettlementSurcharge != 150 ||
		draft.ProductLines[0].UnitPrice != 1_150 ||
		draft.ProductLines[1].SettlementSurcharge != 0 ||
		draft.TotalAmount != 2_800 {
		t.Fatalf("draft after terms = %+v", draft)
	}
}
