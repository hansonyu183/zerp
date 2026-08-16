package vou

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestWorkflowDocumentViewExcludesTechnicalAndSensitiveMetadata(t *testing.T) {
	t.Parallel()
	view := workflowDocumentView(DocumentView{
		DocumentID: "01J00000000000000000000001", Entity: EntitySaleOrder,
		DocumentNo: "SO-1", Status: StatusApproved, Revision: 7, Amount: "100.00",
		CreatedBy: "01J00000000000000000000002", UpdatedBy: "01J00000000000000000000003",
		Attachments: []AttachmentView{{FileID: "secret-file-id", FileName: "order.pdf", SHA256: "secret-hash", CreatedAt: time.Now(), CreatedBy: "secret-actor"}},
	})
	encoded, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("marshal workflow view: %v", err)
	}
	for _, forbidden := range []string{"documentId", "revision", "createdBy", "updatedBy", "fileId", "sha256", "secret"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("workflow source contains %q: %s", forbidden, encoded)
		}
	}
	if !strings.Contains(string(encoded), `"fileName":"order.pdf"`) {
		t.Fatalf("workflow source omitted ordinary attachment metadata: %s", encoded)
	}
}
