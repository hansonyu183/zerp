package fixeddecimal

import (
	"errors"
	"math"
	"math/big"
	"strconv"
	"strings"
)

func ParsePositive(value string, scale int, allowZero bool) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "-") || strings.HasPrefix(value, "+") {
		return 0, errors.New("invalid decimal")
	}
	parts := strings.Split(value, ".")
	if len(parts) > 2 || parts[0] == "" {
		return 0, errors.New("invalid decimal")
	}
	for _, part := range parts {
		if part == "" {
			continue
		}
		for _, r := range part {
			if r < '0' || r > '9' {
				return 0, errors.New("invalid decimal")
			}
		}
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
		if fraction == "" || len(fraction) > scale {
			return 0, errors.New("invalid decimal scale")
		}
	}
	fraction += strings.Repeat("0", scale-len(fraction))
	digits := strings.TrimLeft(parts[0]+fraction, "0")
	if digits == "" {
		if allowZero {
			return 0, nil
		}
		return 0, errors.New("decimal must be greater than zero")
	}
	parsed, err := strconv.ParseInt(digits, 10, 64)
	if err != nil || parsed == math.MaxInt64 {
		return 0, errors.New("decimal out of range")
	}
	return parsed, nil
}

func LineAmountCents(quantityMicros, unitPriceMicros int64) (int64, error) {
	product := new(big.Int).Mul(big.NewInt(quantityMicros), big.NewInt(unitPriceMicros))
	divisor := big.NewInt(1_000_000)
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(product, divisor, remainder)
	if new(big.Int).Mul(remainder, big.NewInt(2)).Cmp(divisor) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	if !quotient.IsInt64() || quotient.Sign() <= 0 {
		return 0, errors.New("line amount out of range")
	}
	return quotient.Int64(), nil
}
