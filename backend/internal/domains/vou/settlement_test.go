package vou

import (
	"testing"
	"time"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

func TestCalculateDueDateRules(t *testing.T) {
	actualDate := time.Date(2026, time.January, 25, 0, 0, 0, 0, time.UTC)
	tests := []struct {
		name       string
		date       time.Time
		settlement bobdomain.DetailView
		closingDay int32
		want       string
	}{
		{"prepaid", actualDate, bobdomain.DetailView{TermCode: bobdomain.SettlementTermPrepaid}, 31, "2026-01-25"},
		{"arrival 30", actualDate, bobdomain.DetailView{TermCode: bobdomain.SettlementTermArrival30, DayOffset: 30}, 31, "2026-02-24"},
		{"current at cutoff", actualDate, bobdomain.DetailView{TermCode: bobdomain.SettlementTermMonthlyCurrent}, 25, "2026-01-31"},
		{"current after cutoff", actualDate.AddDate(0, 0, 1), bobdomain.DetailView{TermCode: bobdomain.SettlementTermMonthlyCurrent}, 25, "2026-02-28"},
		{"monthly 30", actualDate, bobdomain.DetailView{TermCode: bobdomain.SettlementTermMonthly30, MonthOffset: 1}, 31, "2026-02-28"},
		{"monthly 90", actualDate, bobdomain.DetailView{TermCode: bobdomain.SettlementTermMonthly90, MonthOffset: 3}, 31, "2026-04-30"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			due, err := calculateDueDate(test.date, test.settlement, test.closingDay)
			if err != nil || due.Format(dateLayout) != test.want {
				t.Fatalf("due result=%s want=%s err=%v", due.Format(dateLayout), test.want, err)
			}
		})
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
			{Data: settlementTestProduct(bobdomain.ProductBehaviorRawMaterial)},
			{Data: settlementTestProduct(bobdomain.ProductBehaviorPackaging)},
		},
	}
	if err := applySettlementTerms(EntitySaleOrder, &draft, refs); err != nil {
		t.Fatalf("apply terms: %v", err)
	}
	if draft.DueDate != nil {
		t.Fatalf("order due date must remain empty, got %v", draft.DueDate)
	}
	if draft.ProductLines[0].SettlementSurcharge != 150 ||
		draft.ProductLines[0].UnitPrice != 1_150 ||
		draft.ProductLines[1].SettlementSurcharge != 0 ||
		draft.TotalAmount != 2_800 {
		t.Fatalf("draft after terms = %+v", draft)
	}
}

func settlementTestProduct(behaviorProfile string) bobdomain.DetailView {
	return bobdomain.DetailView{
		BehaviorProfile: behaviorProfile,
		PricingUnitID:   "UNIT-1",
		UnitConversions: []bobdomain.ProductUnitConversion{{
			Unit:   bobdomain.MeasurementUnitSnapshot{ObjectID: "UNIT-1"},
			Factor: "1",
		}},
	}
}

func TestSettlementTermFromLegacySnapshotPrefersPrepaidName(t *testing.T) {
	tests := []struct {
		name, termCode, settlementName, ruleType, want string
		monthOffset, dayOffset                         int32
	}{
		{"fixed term", bobSettlementCOD, "预付旧名称", "DUE_DAYS", bobSettlementCOD, 0, 0},
		{"legacy prepaid", "", "旧预付方式", "DUE_DAYS", bobSettlementPrepaid, 0, 0},
		{"legacy COD", "", "现结", "DUE_DAYS", bobSettlementCOD, 0, 0},
		{"legacy monthly 60", "", "月结", "MONTH_END", bobdomain.SettlementTermMonthly60, 2, 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := settlementTermFromSnapshot(
				test.termCode, test.settlementName, test.ruleType,
				test.monthOffset, test.dayOffset,
			)
			if got != test.want {
				t.Fatalf("term = %s, want %s", got, test.want)
			}
		})
	}
}
