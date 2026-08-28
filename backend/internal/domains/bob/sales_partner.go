package bob

import (
	"sort"
	"strings"
)

func normalizeSalesPartnerCapabilities(input []string) ([]string, error) {
	seen := make(map[string]struct{}, len(input))
	for _, raw := range input {
		capability := strings.TrimSpace(raw)
		if capability != SalesCapabilityExternalPartTime && capability != SalesCapabilityChannelPartner {
			return nil, domainError(ErrorValidation, "invalid sales relationship capability", nil, nil)
		}
		seen[capability] = struct{}{}
	}
	result := make([]string, 0, len(seen))
	for capability := range seen {
		result = append(result, capability)
	}
	sort.Strings(result)
	return result, nil
}

func validateEffectiveSalesPartnerCapabilities(input []string) error {
	capabilities, err := normalizeSalesPartnerCapabilities(input)
	if err != nil {
		return err
	}
	if len(capabilities) == 0 {
		return domainError(ErrorValidation, "sales relationship requires at least one capability", nil, nil)
	}
	return nil
}

// ValidateSalesPartnerDeclaration keeps BOB's established declaration
// invariant available to the DCL-owned Sales Partner lifecycle.
func ValidateSalesPartnerDeclaration(capabilities []string, contactName, contactPhone, email, address, remark string) error {
	if err := validateEffectiveSalesPartnerCapabilities(capabilities); err != nil {
		return err
	}
	return validateLengthsAndFormats(DetailView{
		ContactName: strings.TrimSpace(contactName), ContactPhone: strings.TrimSpace(contactPhone),
		Email: strings.TrimSpace(email), Address: strings.TrimSpace(address), Remark: strings.TrimSpace(remark),
	})
}
