package app

import "testing"

func TestPasswordHashRoundTrip(t *testing.T) {
	encoded, err := hashPassword("Strong-password-1!")
	if err != nil {
		t.Fatalf("hashPassword() error = %v", err)
	}
	if !verifyPassword(encoded, "Strong-password-1!") {
		t.Fatal("verifyPassword() rejected the original password")
	}
	if verifyPassword(encoded, "wrong-password") {
		t.Fatal("verifyPassword() accepted a wrong password")
	}
}

func TestValidatePasswordPolicy(t *testing.T) {
	if err := validatePassword("Strong-password-1!", 12); err != nil {
		t.Fatalf("strong password rejected: %v", err)
	}
	for _, password := range []string{"short1!A", "all-lowercase-1!", "NO-LOWERCASE-1!", "NoNumbersHere!", "Nosymbols1234"} {
		if err := validatePassword(password, 12); err == nil {
			t.Fatalf("weak password %q accepted", password)
		}
	}
}

func TestTokenHashComparison(t *testing.T) {
	raw, err := newRawToken()
	if err != nil {
		t.Fatalf("newRawToken() error = %v", err)
	}
	if !constantTimeHashEqual(tokenHash(raw), raw) {
		t.Fatal("token hash did not match")
	}
	if constantTimeHashEqual(tokenHash(raw), raw+"x") {
		t.Fatal("token hash matched a different token")
	}
}

func TestValidatePermissionDependencies(t *testing.T) {
	if !validSegment("role-permission2") || validSegment("Role") || validSegment("two--hyphens") {
		t.Fatal("validSegment() did not enforce canonical segments")
	}
}
