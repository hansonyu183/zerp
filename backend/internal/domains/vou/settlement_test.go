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
			TermCode: bobdomain.SettlementTermArrival7, RuleType: bobdomain.SettlementRuleRelativeDays,
			DayOffset: 7, DueDays: 7, DefaultSalesSurcharge: "1.50",
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

func TestApplySettlementTermsAcceptsCustomerArrivalDueDaysSnapshot(t *testing.T) {
	draft := validatedDraft{
		BusinessDate: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
		ProductLines: []fixedProductLine{{Quantity: 1_000_000, BaseUnitPrice: 1_000}},
	}
	refs := resolvedDraft{
		CustomerSettlement: &bobdomain.EffectiveReference{Data: bobdomain.DetailView{
			TermCode: bobdomain.SettlementTermArrival7, RuleType: bobdomain.SettlementRuleRelativeDays,
			DueDays: 7, DefaultSalesSurcharge: "0.00",
		}},
		Products: []bobdomain.EffectiveReference{{Data: settlementTestProduct(bobdomain.ProductBehaviorRawMaterial)}},
	}
	if err := applySettlementTerms(EntitySaleOrder, &draft, refs); err != nil {
		t.Fatalf("apply Customer Subunit ARRIVAL_7 terms: %v", err)
	}
	fields := settlementSnapshot(refs.CustomerSettlement, 31)
	if fields.DayOffset == nil || *fields.DayOffset != 7 || fields.DueDays == nil || *fields.DueDays != 7 {
		t.Fatalf("settlement snapshot offsets = dayOffset:%v dueDays:%v, want 7/7", fields.DayOffset, fields.DueDays)
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

func TestValidateSettlementTermSnapshotRejectsLegacyAndAmbiguousFacts(t *testing.T) {
	tests := []struct {
		name, termCode, ruleType string
		monthOffset, dayOffset   int32
		wantErr                  bool
	}{
		{"arrival 7", bobdomain.SettlementTermArrival7, bobdomain.SettlementRuleRelativeDays, 0, 7, false},
		{"monthly 60", bobdomain.SettlementTermMonthly60, bobdomain.SettlementRuleMonthEnd, 2, 0, false},
		{"missing term", "", bobdomain.SettlementRuleRelativeDays, 0, 7, true},
		{"legacy due-days", bobdomain.SettlementTermArrival7, "DUE_DAYS", 0, 7, true},
		{"nearest-day candidate", bobdomain.SettlementTermArrival7, bobdomain.SettlementRuleRelativeDays, 0, 6, true},
		{"ambiguous zero-day", "", bobdomain.SettlementRuleRelativeDays, 0, 0, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateSettlementTermSnapshot(test.termCode, test.ruleType, test.monthOffset, test.dayOffset)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateSettlementTermSnapshot() error = %v, wantErr=%t", err, test.wantErr)
			}
		})
	}
}

func TestSettlementTermRequiredErrorIsStable(t *testing.T) {
	err := settlementTermRequiredError()
	business, ok := err.(*DomainError)
	if !ok {
		t.Fatalf("error type = %T, want *DomainError", err)
	}
	if business.ErrorKey != "vou_settlement_term_required" || business.Message != "订单必须具有明确账期，不得由 writer 默认补齐。" {
		t.Fatalf("settlement-term error = %+v", business)
	}
}
