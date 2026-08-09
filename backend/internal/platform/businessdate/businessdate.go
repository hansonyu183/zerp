package businessdate

import "time"

const Layout = "2006-01-02"

var location = time.FixedZone("Asia/Shanghai", 8*60*60)

// Today returns the current calendar date in ZERP's business timezone.
func Today() time.Time {
	return At(time.Now())
}

// At converts an instant to its calendar date in ZERP's business timezone.
// The returned UTC midnight represents a date-only value without timezone drift.
func At(instant time.Time) time.Time {
	local := instant.In(location)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
}
