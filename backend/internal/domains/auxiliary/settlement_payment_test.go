package aux

import (
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

func TestProductTypeDataUsesClosedBehaviorProfiles(t *testing.T) {
	t.Parallel()
	service := &Service{}
	valid := map[string]any{
		"name":            "溶剂原料",
		"behaviorProfile": ProductBehaviorRawMaterial,
		"description":     "使用原材料行为模板",
	}

	data, err := service.validateData(t.Context(), nil, EntityProductType, "", valid)
	if err != nil {
		t.Fatalf("validate product type: %v", err)
	}
	if data["behaviorProfile"] != ProductBehaviorRawMaterial {
		t.Fatalf("behaviorProfile = %#v", data["behaviorProfile"])
	}

	unknown := cloneData(valid)
	unknown["behaviorProfile"] = "CONFIGURABLE"
	if _, err = service.validateData(t.Context(), nil, EntityProductType, "", unknown); err == nil {
		t.Fatal("unknown product behavior profile was accepted")
	}

	unexpected := cloneData(valid)
	unexpected["allowFormula"] = true
	if _, err = service.validateData(t.Context(), nil, EntityProductType, "", unexpected); err == nil {
		t.Fatal("arbitrary product behavior switch was accepted")
	}
}

func TestProductTypeQueryRejectsUnknownBehaviorProfile(t *testing.T) {
	t.Parallel()
	service := &Service{}
	_, err := service.Query(t.Context(), EntityProductType, QueryInput{
		Page: 1, PageSize: 20, Filters: QueryFilters{BehaviorProfile: "CONFIGURABLE"},
	}, trustedTestActor(t))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorValidation {
		t.Fatalf("unknown behavior profile query error = %v", err)
	}
}

func trustedTestActor(t *testing.T) approval.Actor {
	t.Helper()
	actor, err := approval.TrustedSystemActor("test")
	if err != nil {
		t.Fatalf("create trusted test actor: %v", err)
	}
	return actor
}

func TestReferencedProductTypeKeepsBehaviorProfile(t *testing.T) {
	t.Parallel()
	current := map[string]any{
		"name": "溶剂原料", "behaviorProfile": ProductBehaviorRawMaterial,
		"description": "旧说明",
	}
	renamed := cloneData(current)
	renamed["name"] = "液体原料"
	renamed["description"] = "新说明"
	if err := validateReferencedProductTypeUpdate(current, renamed); err != nil {
		t.Fatalf("allow name and description update: %v", err)
	}

	reprofiled := cloneData(renamed)
	reprofiled["behaviorProfile"] = ProductBehaviorPackaging
	if err := validateReferencedProductTypeUpdate(current, reprofiled); err == nil {
		t.Fatal("referenced product type behavior profile changed")
	}
}

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
