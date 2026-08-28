package dcl

import (
	"encoding/json"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

func TestProductDataJSONIsProductOnlySnapshot(t *testing.T) {
	encoded, err := json.Marshal(ProductData{Name: "成品", UnitConversions: []bobdomain.ProductUnitConversion{}, Returnable: false})
	if err != nil {
		t.Fatalf("marshal DCL product data: %v", err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(encoded, &fields); err != nil {
		t.Fatalf("decode DCL product data: %v", err)
	}
	if _, exists := fields["bulkLiquidCapable"]; exists {
		t.Fatalf("DCL product response leaked BOB-only field: %s", encoded)
	}
	if _, exists := fields["unitConversions"]; !exists {
		t.Fatalf("DCL product response omitted required snapshot field: %s", encoded)
	}
}
