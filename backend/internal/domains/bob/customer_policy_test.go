package bob

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCustomerListItemAlwaysSerializesVersionSlots(t *testing.T) {
	t.Parallel()

	raw, err := json.Marshal(CustomerListItem{})
	if err != nil {
		t.Fatalf("marshal customer list item: %v", err)
	}
	for _, field := range []string{`"latestApproved":null`, `"openVersion":null`} {
		if !strings.Contains(string(raw), field) {
			t.Fatalf("customer list item JSON %s is missing %s", raw, field)
		}
	}
}

func TestPricingPolicyRejectsPartialUnknownAndMixedCostRows(t *testing.T) {
	t.Parallel()

	valid := PricingPolicy{
		DefaultPremiumUnitPrice:                "1.25",
		DefaultDiscountUnitPrice:               "0.50",
		ThirdPartyIntermediaryFixedUnitCost:    "0.00",
		ThirdPartyIntermediaryVariableUnitCost: "0.10",
		CostItems: []PricingCostItem{
			{Name: "装卸费", Basis: PricingCostBasisUnitPrice, UnitPrice: "0.20"},
			{Name: "检测费", Basis: PricingCostBasisOrderAmount, OrderAmount: "100.00"},
		},
	}
	if _, err := normalizePricingPolicy(valid); err != nil {
		t.Fatalf("valid policy rejected: %v", err)
	}

	tests := []struct {
		name   string
		policy PricingPolicy
	}{
		{
			name: "mixed cost amounts",
			policy: PricingPolicy{
				DefaultPremiumUnitPrice: "0.00", DefaultDiscountUnitPrice: "0.00",
				ThirdPartyIntermediaryFixedUnitCost: "0.00", ThirdPartyIntermediaryVariableUnitCost: "0.00",
				CostItems: []PricingCostItem{{Name: "运费", Basis: PricingCostBasisUnitPrice, UnitPrice: "1.00", OrderAmount: "2.00"}},
			},
		},
		{
			name: "duplicate normalized names",
			policy: PricingPolicy{
				DefaultPremiumUnitPrice: "0.00", DefaultDiscountUnitPrice: "0.00",
				ThirdPartyIntermediaryFixedUnitCost: "0.00", ThirdPartyIntermediaryVariableUnitCost: "0.00",
				CostItems: []PricingCostItem{
					{Name: " 运 费 ", Basis: PricingCostBasisUnitPrice, UnitPrice: "1.00"},
					{Name: "运费", Basis: PricingCostBasisUnitPrice, UnitPrice: "2.00"},
				},
			},
		},
		{
			name: "zero cost row",
			policy: PricingPolicy{
				DefaultPremiumUnitPrice: "0.00", DefaultDiscountUnitPrice: "0.00",
				ThirdPartyIntermediaryFixedUnitCost: "0.00", ThirdPartyIntermediaryVariableUnitCost: "0.00",
				CostItems: []PricingCostItem{{Name: "运费", Basis: PricingCostBasisUnitPrice, UnitPrice: "0.00"}},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if _, err := normalizePricingPolicy(test.policy); err == nil {
				t.Fatal("invalid policy accepted")
			}
		})
	}
}

func TestPricingPolicyJSONIsClosedAndCostRowsAreStable(t *testing.T) {
	t.Parallel()

	var policy PricingPolicy
	err := json.Unmarshal([]byte(`{
		"defaultPremiumUnitPrice":"1.00",
		"defaultDiscountUnitPrice":"0.25",
		"costItems":[
			{"name":"装卸费","basis":"ORDER_AMOUNT","orderAmount":"20.00"},
			{"name":"检测费","basis":"UNIT_PRICE","unitPrice":"0.10"}
		],
		"thirdPartyIntermediaryFixedUnitCost":"0.00",
		"thirdPartyIntermediaryVariableUnitCost":"0.00",
		"unexpected":true
	}`), &policy)
	if err == nil {
		t.Fatal("unknown pricing policy key accepted")
	}

	policy = PricingPolicy{
		DefaultPremiumUnitPrice: "1", DefaultDiscountUnitPrice: "0.2",
		ThirdPartyIntermediaryFixedUnitCost: "0", ThirdPartyIntermediaryVariableUnitCost: "0",
		CostItems: []PricingCostItem{
			{Name: "装卸费", Basis: PricingCostBasisOrderAmount, OrderAmount: "20"},
			{Name: "检测费", Basis: PricingCostBasisUnitPrice, UnitPrice: "0.1"},
		},
	}
	normalized, err := normalizePricingPolicy(policy)
	if err != nil {
		t.Fatalf("normalize policy: %v", err)
	}
	if got := normalized.CostItems[0].Name; got != "检测费" {
		t.Fatalf("first normalized cost = %q, want 检测费", got)
	}
	if normalized.DefaultPremiumUnitPrice != "1.00" || normalized.DefaultDiscountUnitPrice != "0.20" {
		t.Fatalf("amounts not normalized: %#v", normalized)
	}
}
