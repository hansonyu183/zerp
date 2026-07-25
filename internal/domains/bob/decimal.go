package bob

import (
	"errors"
	"strconv"
	"strings"
)

func fixedMicros(value string) (int64, error) {
	value = strings.TrimSpace(value)
	parts := strings.Split(value, ".")
	if value == "" || strings.HasPrefix(value, "-") || strings.HasPrefix(value, "+") ||
		len(parts) > 2 || parts[0] == "" {
		return 0, errors.New("invalid decimal")
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
		if fraction == "" || len(fraction) > 6 {
			return 0, errors.New("invalid decimal scale")
		}
	}
	for _, part := range parts {
		for _, char := range part {
			if char < '0' || char > '9' {
				return 0, errors.New("invalid decimal")
			}
		}
	}
	fraction += strings.Repeat("0", 6-len(fraction))
	parsed, err := strconv.ParseInt(strings.TrimLeft(parts[0]+fraction, "0"), 10, 64)
	if err != nil || parsed <= 0 {
		return 0, errors.New("decimal must be greater than zero")
	}
	return parsed, nil
}

func formatMicros(value int64) string {
	if value <= 0 {
		return ""
	}
	whole, fraction := value/1_000_000, value%1_000_000
	result := strconv.FormatInt(whole, 10) + "." + strings.TrimRight(
		fmtSix(fraction), "0")
	if strings.HasSuffix(result, ".") {
		result += "0"
	}
	return result
}

func fmtSix(value int64) string {
	result := strconv.FormatInt(value, 10)
	return strings.Repeat("0", 6-len(result)) + result
}
