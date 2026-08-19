package aux

import "testing"

func TestSettlementMethodDataIsClosedAndFixed(t *testing.T) {
	t.Parallel()
	service := &Service{}
	valid := map[string]any{
		"name":                  "月结30天",
		"termCode":              "MONTHLY_30",
		"ruleType":              "MONTH_END",
		"monthOffset":           1,
		"dayOfMonth":            0,
		"dayOffset":             0,
		"defaultSalesSurcharge": "0.10",
		"description":           "说明",
	}

	data, err := service.validateData(t.Context(), nil, EntitySettlementMethod, "", valid)
	if err != nil {
		t.Fatalf("validate settlement method: %v", err)
	}
	if data["termCode"] != "MONTHLY_30" || data["defaultSalesSurcharge"] != "0.10" {
		t.Fatalf("validated settlement data = %#v", data)
	}

	for name, input := range map[string]map[string]any{
		"unknown term":  func() map[string]any { value := cloneData(valid); value["termCode"] = "MONTHLY_45"; return value }(),
		"changed rule":  func() map[string]any { value := cloneData(valid); value["ruleType"] = "RELATIVE_DAYS"; return value }(),
		"unknown field": func() map[string]any { value := cloneData(valid); value["dueDays"] = 30; return value }(),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := service.validateData(t.Context(), nil, EntitySettlementMethod, "", input); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestSettlementMethodOnlyChangesSurchargeAndDescription(t *testing.T) {
	t.Parallel()
	current := map[string]any{
		"name": "月结30天", "termCode": "MONTHLY_30", "ruleType": "MONTH_END",
		"monthOffset": 1, "dayOfMonth": 0, "dayOffset": 0,
		"defaultSalesSurcharge": "0.10", "description": "旧说明",
	}
	updated := cloneData(current)
	updated["defaultSalesSurcharge"] = "0.20"
	updated["description"] = "新说明"
	if err := validateSettlementMethodUpdate(current, updated); err != nil {
		t.Fatalf("allow surcharge/description update: %v", err)
	}
	for name, mutate := range map[string]func(map[string]any){
		"name": func(data map[string]any) { data["name"] = "改名" },
		"term": func(data map[string]any) { data["termCode"] = "MONTHLY_60" },
		"rule": func(data map[string]any) { data["monthOffset"] = 2 },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := cloneData(updated)
			mutate(candidate)
			if err := validateSettlementMethodUpdate(current, candidate); err == nil {
				t.Fatal("expected immutable settlement fact rejection")
			}
		})
	}
}

func TestPaymentMethodDataIsClosedAndDefaultsSurcharge(t *testing.T) {
	t.Parallel()
	service := &Service{}
	data, err := service.validateData(t.Context(), nil, EntityPaymentMethod, "", map[string]any{
		"name": "银行转账", "description": "默认收款媒介",
	})
	if err != nil {
		t.Fatalf("validate payment method: %v", err)
	}
	if data["defaultSalesSurcharge"] != "0.00" {
		t.Fatalf("defaultSalesSurcharge = %#v, want 0.00", data["defaultSalesSurcharge"])
	}
	if _, err = service.validateData(t.Context(), nil, EntityPaymentMethod, "", map[string]any{
		"name": "银行转账", "termCode": "PREPAID",
	}); err == nil {
		t.Fatal("payment method accepted settlement-only field")
	}
}
