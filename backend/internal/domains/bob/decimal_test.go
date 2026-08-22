package bob

import "testing"

func TestFormatMicrosUsesCanonicalQuantitySyntax(t *testing.T) {
	for value, want := range map[int64]string{
		1_000_000: "1",
		1_500_000: "1.5",
	} {
		if got := formatMicros(value); got != want {
			t.Fatalf("formatMicros(%d) = %q, want %q", value, got, want)
		}
	}
}
