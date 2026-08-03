package led

import (
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
)

func parsePositiveFixed(value string, scale int, allowZero bool) (int64, error) {
	return fixeddecimal.ParsePositive(value, scale, allowZero)
}

func lineAmountCents(quantity, unitPrice int64) (int64, error) {
	return fixeddecimal.LineAmountCents(quantity, unitPrice)
}

func formatQuantity(value int64) string { return formatSignedFixed(value, 6) }

func formatMoney(value int64) string { return formatSignedFixed(value, 2) }

func formatAbsoluteQuantity(value int64) string {
	if value < 0 {
		value = -value
	}
	return formatQuantity(value)
}

func formatAbsoluteMoney(value int64) string {
	if value < 0 {
		value = -value
	}
	return formatMoney(value)
}

func formatSignedFixed(value int64, scale int) string {
	text := fixeddecimal.Format(value, scale, scale > 2)
	if scale > 2 && !strings.Contains(text, ".") {
		text += ".0"
	}
	return text
}
