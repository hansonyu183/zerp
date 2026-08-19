package bob

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"sort"
	"strings"
	"unicode"

	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
)

const (
	PricingCostBasisUnitPrice   = "UNIT_PRICE"
	PricingCostBasisOrderAmount = "ORDER_AMOUNT"
)

var pricingPolicyKeys = []string{
	"costItems",
	"defaultDiscountUnitPrice",
	"defaultPremiumUnitPrice",
	"thirdPartyIntermediaryFixedUnitCost",
	"thirdPartyIntermediaryVariableUnitCost",
}

type PricingCostItem struct {
	Name        string `json:"name"`
	Basis       string `json:"basis"`
	UnitPrice   string `json:"unitPrice,omitempty"`
	OrderAmount string `json:"orderAmount,omitempty"`
}

func (item *PricingCostItem) UnmarshalJSON(raw []byte) error {
	type plain PricingCostItem
	var decoded plain
	if err := decodeClosedJSON(raw, &decoded); err != nil {
		return err
	}
	*item = PricingCostItem(decoded)
	return nil
}

type PricingPolicy struct {
	DefaultPremiumUnitPrice                string            `json:"defaultPremiumUnitPrice"`
	DefaultDiscountUnitPrice               string            `json:"defaultDiscountUnitPrice"`
	CostItems                              []PricingCostItem `json:"costItems"`
	ThirdPartyIntermediaryFixedUnitCost    string            `json:"thirdPartyIntermediaryFixedUnitCost"`
	ThirdPartyIntermediaryVariableUnitCost string            `json:"thirdPartyIntermediaryVariableUnitCost"`
}

func (policy *PricingPolicy) UnmarshalJSON(raw []byte) error {
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keys); err != nil {
		return err
	}
	got := make([]string, 0, len(keys))
	for key := range keys {
		got = append(got, key)
	}
	sort.Strings(got)
	if !slices.Equal(got, pricingPolicyKeys) {
		return fmt.Errorf("pricing policy must contain exactly %v", pricingPolicyKeys)
	}
	type plain PricingPolicy
	var decoded plain
	if err := decodeClosedJSON(raw, &decoded); err != nil {
		return err
	}
	if decoded.CostItems == nil {
		decoded.CostItems = []PricingCostItem{}
	}
	*policy = PricingPolicy(decoded)
	return nil
}

func normalizePricingPolicy(policy PricingPolicy) (PricingPolicy, error) {
	var err error
	policy.DefaultPremiumUnitPrice, err = normalizePolicyAmount(policy.DefaultPremiumUnitPrice, true)
	if err != nil {
		return PricingPolicy{}, fmt.Errorf("defaultPremiumUnitPrice: %w", err)
	}
	policy.DefaultDiscountUnitPrice, err = normalizePolicyAmount(policy.DefaultDiscountUnitPrice, true)
	if err != nil {
		return PricingPolicy{}, fmt.Errorf("defaultDiscountUnitPrice: %w", err)
	}
	policy.ThirdPartyIntermediaryFixedUnitCost, err = normalizePolicyAmount(policy.ThirdPartyIntermediaryFixedUnitCost, true)
	if err != nil {
		return PricingPolicy{}, fmt.Errorf("thirdPartyIntermediaryFixedUnitCost: %w", err)
	}
	policy.ThirdPartyIntermediaryVariableUnitCost, err = normalizePolicyAmount(policy.ThirdPartyIntermediaryVariableUnitCost, true)
	if err != nil {
		return PricingPolicy{}, fmt.Errorf("thirdPartyIntermediaryVariableUnitCost: %w", err)
	}

	seen := make(map[string]struct{}, len(policy.CostItems))
	for index := range policy.CostItems {
		item := &policy.CostItems[index]
		item.Name = strings.TrimSpace(item.Name)
		key := normalizeCostName(item.Name)
		if key == "" {
			return PricingPolicy{}, errors.New("cost item name is required")
		}
		if _, duplicate := seen[key]; duplicate {
			return PricingPolicy{}, fmt.Errorf("duplicate cost item name %q", item.Name)
		}
		seen[key] = struct{}{}
		switch item.Basis {
		case PricingCostBasisUnitPrice:
			if item.OrderAmount != "" {
				return PricingPolicy{}, fmt.Errorf("cost item %q cannot contain orderAmount", item.Name)
			}
			item.UnitPrice, err = normalizePolicyAmount(item.UnitPrice, false)
		case PricingCostBasisOrderAmount:
			if item.UnitPrice != "" {
				return PricingPolicy{}, fmt.Errorf("cost item %q cannot contain unitPrice", item.Name)
			}
			item.OrderAmount, err = normalizePolicyAmount(item.OrderAmount, false)
		default:
			return PricingPolicy{}, fmt.Errorf("cost item %q has invalid basis", item.Name)
		}
		if err != nil {
			return PricingPolicy{}, fmt.Errorf("cost item %q: %w", item.Name, err)
		}
	}
	sort.Slice(policy.CostItems, func(left, right int) bool {
		return normalizeCostName(policy.CostItems[left].Name) < normalizeCostName(policy.CostItems[right].Name)
	})
	if policy.CostItems == nil {
		policy.CostItems = []PricingCostItem{}
	}
	return policy, nil
}

func normalizePolicyAmount(value string, allowZero bool) (string, error) {
	minor, err := fixeddecimal.ParsePositive(strings.TrimSpace(value), 2, allowZero)
	if err != nil {
		return "", err
	}
	return fixeddecimal.Format(minor, 2, false), nil
}

func normalizeCostName(value string) string {
	return strings.ToLower(strings.Map(func(char rune) rune {
		if unicode.IsSpace(char) {
			return -1
		}
		return char
	}, strings.TrimSpace(value)))
}

func decodeClosedJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
