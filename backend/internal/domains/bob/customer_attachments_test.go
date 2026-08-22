package bob

import (
	"strings"
	"testing"
)

func TestValidateCustomerAttachmentInitiate(t *testing.T) {
	valid := CustomerAttachmentInitiateInput{
		Scope: CustomerAttachmentScopeRelationship, OwnerID: "01J00000000000000000000001", Revision: 1,
		CategoryObjectID: "01J00000000000000000000002", FileName: "license.pdf",
		ContentType: "application/pdf", Size: 12, SHA256: strings.Repeat("a", 64),
	}
	if _, err := validateCustomerAttachmentInitiate(valid); err != nil {
		t.Fatalf("valid attachment rejected: %v", err)
	}
	for name, mutate := range map[string]func(*CustomerAttachmentInitiateInput){
		"scope":        func(input *CustomerAttachmentInitiateInput) { input.Scope = "OTHER" },
		"path":         func(input *CustomerAttachmentInitiateInput) { input.FileName = "../license.pdf" },
		"type":         func(input *CustomerAttachmentInitiateInput) { input.ContentType = "text/html" },
		"size":         func(input *CustomerAttachmentInitiateInput) { input.Size = 0 },
		"upper hash":   func(input *CustomerAttachmentInitiateInput) { input.SHA256 = strings.Repeat("A", 64) },
		"bad category": func(input *CustomerAttachmentInitiateInput) { input.CategoryObjectID = "bad" },
	} {
		t.Run(name, func(t *testing.T) {
			input := valid
			mutate(&input)
			if _, err := validateCustomerAttachmentInitiate(input); err == nil {
				t.Fatal("invalid attachment accepted")
			}
		})
	}
}
