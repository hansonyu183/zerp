//go:build integration

package vou

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hansonyu183/zerp-back/internal/api/authorization"
)

func TestVOUIntegrationAttachmentRoundTrip(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	created, err := service.Create(t.Context(), EntityReceipt, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "customer",
		Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
		Handler: &refs.employee, Amount: "10.00",
	}}, integrationActorOne, "attachment-create")
	if err != nil {
		t.Fatalf("create receipt: %v", err)
	}
	content := []byte("%PDF-1.7\nintegration")
	sum := sha256.Sum256(content)
	initiated, err := service.InitiateAttachment(t.Context(), EntityReceipt, AttachmentInitiateInput{
		DocumentID: created.DocumentID, Revision: created.Revision, FileName: "invoice.pdf",
		ContentType: "application/pdf", Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:]),
	}, integrationActorOne, "attachment-initiate")
	if err != nil {
		t.Fatalf("initiate attachment: %v", err)
	}
	token := strings.TrimPrefix(initiated.UploadURL, "/files/attachments/upload/")
	if token == "" {
		t.Fatal("upload token is empty")
	}
	router := newVOUTestRouter(service, authorization.Func(
		func(context.Context, *http.Request, string, string) (authorization.Principal, error) {
			return authorization.Principal{ActorID: integrationActorOne}, nil
		},
	))
	uploadRequest := httptest.NewRequest(http.MethodPut, initiated.UploadURL, bytes.NewReader(content))
	uploadRequest.Header.Set("Content-Type", "application/pdf")
	uploadRecorder := httptest.NewRecorder()
	router.ServeHTTP(uploadRecorder, uploadRequest)
	if uploadRecorder.Code != http.StatusNoContent {
		t.Fatalf("upload status=%d body=%s", uploadRecorder.Code, uploadRecorder.Body.String())
	}
	replayRequest := httptest.NewRequest(http.MethodPut, initiated.UploadURL, bytes.NewReader(content))
	replayRequest.Header.Set("Content-Type", "application/pdf")
	replayRecorder := httptest.NewRecorder()
	router.ServeHTTP(replayRecorder, replayRequest)
	if replayRecorder.Code != http.StatusBadRequest {
		t.Fatalf("replay status=%d", replayRecorder.Code)
	}
	download, err := service.CreateDownload(t.Context(), EntityReceipt, AttachmentDownloadInput{
		DocumentID: created.DocumentID, FileID: initiated.FileID,
	}, integrationActorOne)
	if err != nil {
		t.Fatalf("create download: %v", err)
	}
	downloadRequest := httptest.NewRequest(http.MethodGet, download.DownloadURL, nil)
	downloadRecorder := httptest.NewRecorder()
	router.ServeHTTP(downloadRecorder, downloadRequest)
	if downloadRecorder.Code != http.StatusOK || !bytes.Equal(downloadRecorder.Body.Bytes(), content) {
		t.Fatalf("download status=%d body=%q", downloadRecorder.Code, downloadRecorder.Body.Bytes())
	}
	if downloadRecorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("download security headers = %#v", downloadRecorder.Header())
	}
	if _, err = service.RemoveAttachment(t.Context(), EntityReceipt, AttachmentRemoveInput{
		DocumentID: created.DocumentID, Revision: initiated.Revision, FileID: initiated.FileID,
	}, integrationActorOne, "attachment-remove"); err != nil {
		t.Fatalf("remove attachment: %v", err)
	}
}
