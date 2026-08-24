package attachmentstore

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveNamespaceOrphansStaysWithinOwnedNamespace(t *testing.T) {
	root := t.TempDir()
	store, err := New(root)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	for _, key := range []string{"customer/keep", "customer/remove", "supplier/keep"} {
		path, pathErr := store.path(key)
		if pathErr != nil {
			t.Fatalf("path %s: %v", key, pathErr)
		}
		if err = os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatalf("mkdir %s: %v", key, err)
		}
		if err = os.WriteFile(path, []byte(key), 0o600); err != nil {
			t.Fatalf("write %s: %v", key, err)
		}
	}
	removed, err := store.RemoveNamespaceOrphans("customer", map[string]struct{}{"customer/keep": {}})
	if err != nil || removed != 1 {
		t.Fatalf("removed=%d err=%v", removed, err)
	}
	for _, key := range []string{"customer/keep", "supplier/keep"} {
		path, _ := store.path(key)
		if _, err = os.Stat(path); err != nil {
			t.Fatalf("kept file %s: %v", key, err)
		}
	}
}
