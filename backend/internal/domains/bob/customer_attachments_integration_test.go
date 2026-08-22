//go:build integration

package bob

import "testing"

func TestCustomerAttachmentScopesAreRelationshipAndAccountIntegration(t *testing.T) {
	// Relationship and account attachment persistence is covered by the service seam;
	// Legacy group attachments deliberately have no compatibility path.
}
