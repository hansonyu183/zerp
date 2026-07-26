package vou

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"testing"
)

func TestLocalStoragePutOpenDelete(t *testing.T) {
	t.Parallel()
	storage, err := newLocalStorage(t.TempDir())
	if err != nil {
		t.Fatalf("new storage: %v", err)
	}
	content := []byte("%PDF-1.7\nsample")
	sum := sha256.Sum256(content)
	key := "01/01J00000000000000000000001"
	if err = storage.Put(context.Background(), key, bytes.NewReader(content), int64(len(content)),
		"application/pdf", hex.EncodeToString(sum[:])); err != nil {
		t.Fatalf("put: %v", err)
	}
	reader, err := storage.Open(key)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	got, err := io.ReadAll(reader)
	reader.Close()
	if err != nil || !bytes.Equal(got, content) {
		t.Fatalf("read = %q, err=%v", got, err)
	}
	if err = storage.Delete(key); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err = storage.Open(key); !os.IsNotExist(err) {
		t.Fatalf("open deleted = %v", err)
	}
}

func TestLocalStorageRejectsMismatchAndTraversal(t *testing.T) {
	t.Parallel()
	storage, err := newLocalStorage(t.TempDir())
	if err != nil {
		t.Fatalf("new storage: %v", err)
	}
	content := []byte("not a pdf")
	sum := sha256.Sum256(content)
	if err = storage.Put(context.Background(), "../escape", bytes.NewReader(content), int64(len(content)),
		"application/pdf", hex.EncodeToString(sum[:])); err == nil {
		t.Fatal("traversal key accepted")
	}
	if err = storage.Put(context.Background(), "01/file", bytes.NewReader(content), int64(len(content)),
		"application/pdf", hex.EncodeToString(sum[:])); err == nil {
		t.Fatal("invalid PDF accepted")
	}
}
