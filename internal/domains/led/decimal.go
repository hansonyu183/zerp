package led

import (
	"strconv"
	"strings"

	"github.com/hansonyu183/zerp-back/internal/platform/fixeddecimal"
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
	sign := ""
	if value < 0 {
		sign = "-"
		value = -value
	}
	divisor := int64(1)
	for range scale {
		divisor *= 10
	}
	whole, fraction := value/divisor, value%divisor
	text := strconv.FormatInt(whole, 10) + "." + leftPad(strconv.FormatInt(fraction, 10), scale)
	if scale > 2 {
		text = strings.TrimRight(text, "0")
		if strings.HasSuffix(text, ".") {
			text += "0"
		}
	}
	return sign + text
}

func leftPad(value string, width int) string {
	if len(value) >= width {
		return value
	}
	return strings.Repeat("0", width-len(value)) + value
}
