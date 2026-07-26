package vou

import (
	"strconv"
	"strings"

	"github.com/hansonyu183/zerp-back/internal/platform/fixeddecimal"
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
	return fixeddecimal.LineAmountCents(quantity, unitPrice)
}

func formatFixed(value int64, scale int) string {
	if value < 0 {
		return ""
	}
	divisor := int64(1)
	for range scale {
		divisor *= 10
	}
	whole, fraction := value/divisor, value%divisor
	if scale == 0 {
		return strconv.FormatInt(whole, 10)
	}
	result := strconv.FormatInt(whole, 10) + "." + leftPad(strconv.FormatInt(fraction, 10), scale)
	result = strings.TrimRight(result, "0")
	if strings.HasSuffix(result, ".") {
		result += "0"
	}
	return result
}

func formatQuantity(value int64) string { return formatFixed(value, 6) }
func formatMoney(value int64) string {
	if value < 0 {
		return ""
	}
	return strconv.FormatInt(value/100, 10) + "." + leftPad(strconv.FormatInt(value%100, 10), 2)
}

func leftPad(value string, width int) string {
	if len(value) >= width {
		return value
	}
	return strings.Repeat("0", width-len(value)) + value
}
