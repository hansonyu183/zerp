package bob

import (
	"encoding/json"
	"testing"
	"time"
)

func decodeObject(t *testing.T, value any) map[string]any {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err = json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func TestTypedArchiveCurrentViewUsesDedicatedWireContract(t *testing.T) {
	view := ObjectView{
		ObjectID: "employee-1", Entity: EntityEmployee, Code: "EMP-0001", Enabled: true,
		SourceApprovalEntryID: "approval-1", SourceVersionNo: 1, UpdatedAt: time.Unix(1, 0).UTC(),
		Data: DetailView{
			Kind: "PERSON", LegalName: "Alice", DisplayName: "Alice", LegalIdentifier: "11010519491231002X",
			CurrentOperatingEntityID: "operating-1",
			CurrentOperatingEntity:   BusinessArchiveSnapshot{SourceObjectID: "operating-1", ApprovalEntryID: "operating-entry-1", Code: "OP-0001", Name: "Main"},
		},
	}
	decoded := decodeObject(t, view)
	for _, forbidden := range []string{"entity", "enabled", "relationship"} {
		if _, exists := decoded[forbidden]; exists {
			t.Fatalf("typed current view leaked legacy field %q", forbidden)
		}
	}
	data, ok := decoded["data"].(map[string]any)
	if !ok {
		t.Fatal("typed current view data is missing")
	}
	for _, required := range []string{"kind", "legalName", "legalIdentifier", "enabled", "currentOperatingEntityId", "currentOperatingEntity"} {
		if _, exists := data[required]; !exists {
			t.Fatalf("typed employee data is missing %q", required)
		}
	}
	for _, forbidden := range []string{"name", "bulkLiquidCapable", "returnable"} {
		if _, exists := data[forbidden]; exists {
			t.Fatalf("typed employee data leaked generic field %q", forbidden)
		}
	}
}

func TestTypedArchiveQueryUsesDedicatedListItem(t *testing.T) {
	item := QueryItem{
		ObjectID: "supplier-1", Entity: EntitySupplier, Code: "SUP-0001", Enabled: true,
		SourceApprovalEntryID: "approval-1", SourceVersionNo: 1, UpdatedAt: time.Unix(1, 0).UTC(),
		Data: DetailView{LegalName: "Supplier", DisplayName: "Supplier", DefaultOperatingEntityID: "operating-1", OperatingEntities: []BusinessArchiveSnapshot{{SourceObjectID: "operating-1", ApprovalEntryID: "operating-entry-1", Code: "OP-0001", Name: "Main"}}},
	}
	decoded := decodeObject(t, item)
	for _, required := range []string{"objectId", "code", "legalName", "defaultOperatingEntity", "enabled", "sourceApprovalEntryId", "sourceVersionNo", "updatedAt"} {
		if _, exists := decoded[required]; !exists {
			t.Fatalf("typed supplier list item is missing %q", required)
		}
	}
	for _, forbidden := range []string{"entity", "data", "relationship"} {
		if _, exists := decoded[forbidden]; exists {
			t.Fatalf("typed supplier list item leaked legacy field %q", forbidden)
		}
	}
}
