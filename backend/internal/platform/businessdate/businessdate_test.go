package businessdate

import (
	"testing"
	"time"
)

func TestAtUsesShanghaiCalendarDateAcrossUTCBoundary(t *testing.T) {
	instant := time.Date(2026, 8, 7, 16, 30, 0, 0, time.UTC)
	if got := At(instant).Format(Layout); got != "2026-08-08" {
		t.Fatalf("business date = %s, want 2026-08-08", got)
	}
}
