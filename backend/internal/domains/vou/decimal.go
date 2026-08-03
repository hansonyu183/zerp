package vou

import (
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
)

func parseFixed(value string, scale int, allowZero bool) (int64, error) {
	return fixeddecimal.ParsePositive(value, scale, allowZero)
}

func quantityMicros(value string, allowZero bool) (int64, error) {
	return parseFixed(value, 6, allowZero)
}

func moneyCents(value string) (int64, error) {
	return parseFixed(value, 2, false)
}

func lineAmountCents(quantity, unitPrice int64) (int64, error) {
	if unitPrice == 0 {
		return 0, nil
	}
	return fixeddecimal.LineAmountCents(quantity, unitPrice)
}

func formatFixed(value int64, scale int) string {
	if value < 0 {
		return ""
	}
	result := fixeddecimal.Format(value, scale, true)
	if scale > 0 && !strings.Contains(result, ".") {
		result += ".0"
	}
	return result
}

func formatQuantity(value int64) string { return formatFixed(value, 6) }
func formatMoney(value int64) string {
	if value < 0 {
		return ""
	}
	return fixeddecimal.Format(value, 2, false)
}
