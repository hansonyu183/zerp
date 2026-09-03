package dcl

import (
	"errors"
	"testing"
)

func TestRequiredSubjectCodeRejectsMissingPersistenceFact(t *testing.T) {
	if _, err := requiredSubjectCode(nil); err == nil {
		t.Fatal("missing subject code was accepted")
	} else {
		var domainErr *DomainError
		if !errors.As(err, &domainErr) || domainErr.Kind != ErrorInternal {
			t.Fatalf("missing subject code error = %#v", err)
		}
	}
}
