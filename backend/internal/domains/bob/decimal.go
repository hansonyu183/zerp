package bob

import "github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"

func fixedMicros(value string) (int64, error) {
	return fixeddecimal.ParsePositive(value, 6, false)
}

func formatMicros(value int64) string {
	if value <= 0 {
		return ""
	}
	return fixeddecimal.Format(value, 6, true)
}
