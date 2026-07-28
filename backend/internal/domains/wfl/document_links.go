package wfl

import (
	"fmt"
	"time"
)

func documentLinkDate(value time.Time) string {
	return value.Format("2006-01-02")
}

func documentLinkAmount(cents int64) string {
	return fmt.Sprintf("%.2f", float64(cents)/100)
}
