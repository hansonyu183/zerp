package app

import (
	"testing"
	"time"
)

func TestSigninLimiterUsesFixedWindowPerNormalizedUsername(t *testing.T) {
	limiter := newSigninLimiter()
	now := time.Unix(1_700_000_000, 0)
	limiter.now = func() time.Time { return now }
	for attempt := 0; attempt < signinWindowLimit; attempt++ {
		username := " Alice "
		if attempt%2 == 1 {
			username = "alice"
		}
		if !limiter.allow(username) {
			t.Fatalf("attempt %d was denied too early", attempt+1)
		}
	}
	if limiter.allow("ALICE") {
		t.Fatal("request beyond the limit was allowed")
	}
	if !limiter.allow("bob") {
		t.Fatal("a different username shared the limit")
	}
	now = now.Add(signinWindow)
	if !limiter.allow("alice") {
		t.Fatal("new window did not reset the limiter")
	}
}

func TestSigninLimiterBucketsInvalidUsernames(t *testing.T) {
	limiter := newSigninLimiter()
	for attempt := 0; attempt < signinWindowLimit; attempt++ {
		if !limiter.allow("") {
			t.Fatalf("invalid attempt %d was denied too early", attempt+1)
		}
	}
	if limiter.allow("x") {
		t.Fatal("invalid usernames did not share the invalid bucket")
	}
}
