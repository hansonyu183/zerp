package attachmentstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Store struct {
	root string
}

func New(root string) (*Store, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, errors.New("ATTACHMENT_STORAGE_ROOT is required")
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve attachment root: %w", err)
	}
	if err = os.MkdirAll(absolute, 0o700); err != nil {
		return nil, fmt.Errorf("create attachment root: %w", err)
	}
	canonical, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return nil, fmt.Errorf("resolve attachment root symlinks: %w", err)
	}
	if err = os.MkdirAll(filepath.Join(canonical, ".tmp"), 0o700); err != nil {
		return nil, fmt.Errorf("create attachment temp directory: %w", err)
	}
	return &Store{root: canonical}, nil
}

func (s *Store) Put(
	ctx context.Context,
	key string,
	body io.Reader,
	expectedSize int64,
	expectedType, expectedSHA256 string,
) error {
	destination, err := s.path(key)
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Join(s.root, ".tmp"), "upload-*")
	if err != nil {
		return fmt.Errorf("create attachment temp file: %w", err)
	}
	tempName := temp.Name()
	defer func() {
		temp.Close()        //nolint:errcheck
		os.Remove(tempName) //nolint:errcheck
	}()
	if err = temp.Chmod(0o600); err != nil {
		return fmt.Errorf("secure attachment temp file: %w", err)
	}
	hasher := sha256.New()
	written, err := copyWithContext(ctx, io.MultiWriter(temp, hasher), io.LimitReader(body, expectedSize+1))
	if err != nil {
		return fmt.Errorf("write attachment: %w", err)
	}
	if written != expectedSize {
		return errors.New("attachment size does not match declaration")
	}
	if hex.EncodeToString(hasher.Sum(nil)) != expectedSHA256 {
		return errors.New("attachment sha256 does not match declaration")
	}
	if err = temp.Sync(); err != nil {
		return fmt.Errorf("sync attachment: %w", err)
	}
	if _, err = temp.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("rewind attachment: %w", err)
	}
	header := make([]byte, 512)
	count, readErr := io.ReadFull(temp, header)
	if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return fmt.Errorf("inspect attachment: %w", readErr)
	}
	if !matchesContentType(header[:count], expectedType) {
		return errors.New("attachment content does not match content type")
	}
	if err = temp.Close(); err != nil {
		return fmt.Errorf("close attachment: %w", err)
	}
	if err = os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return fmt.Errorf("create attachment directory: %w", err)
	}
	if err = os.Rename(tempName, destination); err != nil {
		return fmt.Errorf("store attachment: %w", err)
	}
	return nil
}

func (s *Store) Open(key string) (*os.File, error) {
	path, err := s.path(key)
	if err != nil {
		return nil, err
	}
	return os.Open(path)
}

func (s *Store) Delete(key string) error {
	path, err := s.path(key)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// RemoveOrphans deletes files outside excluded top-level namespaces that have no database reference.
func (s *Store) RemoveOrphans(known map[string]struct{}, excludedNamespaces ...string) (int, error) {
	excluded := make(map[string]struct{}, len(excludedNamespaces))
	for _, namespace := range excludedNamespaces {
		excluded[namespace] = struct{}{}
	}
	removed := 0
	err := filepath.WalkDir(s.root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path == s.root {
				return nil
			}
			relative, err := filepath.Rel(s.root, path)
			if err != nil {
				return err
			}
			if relative == ".tmp" {
				return filepath.SkipDir
			}
			if filepath.Dir(relative) == "." {
				if _, skip := excluded[filepath.ToSlash(relative)]; skip {
					return filepath.SkipDir
				}
			}
			return nil
		}
		relative, err := filepath.Rel(s.root, path)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if _, exists := known[relative]; exists {
			return nil
		}
		if err = os.Remove(path); err != nil {
			return err
		}
		removed++
		return nil
	})
	return removed, err
}

// RemoveNamespaceOrphans removes only files below one top-level namespace.
// It lets each owning domain clean its own files without learning another
// domain's database schema.
func (s *Store) RemoveNamespaceOrphans(namespace string, known map[string]struct{}) (int, error) {
	if namespace == "" || namespace == "." || namespace == ".." || filepath.Base(namespace) != namespace || strings.ContainsAny(namespace, `/\`) {
		return 0, errors.New("invalid attachment namespace")
	}
	root, err := s.path(namespace)
	if err != nil {
		return 0, err
	}
	if _, err = os.Stat(root); errors.Is(err, os.ErrNotExist) {
		return 0, nil
	} else if err != nil {
		return 0, err
	}
	removed := 0
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, relErr := filepath.Rel(s.root, path)
		if relErr != nil {
			return relErr
		}
		key := filepath.ToSlash(relative)
		if _, exists := known[key]; exists {
			return nil
		}
		if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return removeErr
		}
		removed++
		return nil
	})
	return removed, err
}

func (s *Store) RemoveStaleTemps(before time.Time) (int, error) {
	entries, err := os.ReadDir(filepath.Join(s.root, ".tmp"))
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return removed, err
		}
		if !info.ModTime().Before(before) {
			continue
		}
		if err = os.Remove(filepath.Join(s.root, ".tmp", entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

func (s *Store) path(key string) (string, error) {
	if key == "" || filepath.IsAbs(key) || strings.Contains(key, `\`) {
		return "", errors.New("invalid attachment storage key")
	}
	clean := filepath.Clean(filepath.FromSlash(key))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("invalid attachment storage key")
	}
	path := filepath.Join(s.root, clean)
	relative, err := filepath.Rel(s.root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("attachment path escapes storage root")
	}
	return path, nil
}

func copyWithContext(ctx context.Context, destination io.Writer, source io.Reader) (int64, error) {
	buffer := make([]byte, 32*1024)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		count, readErr := source.Read(buffer)
		if count > 0 {
			written, writeErr := destination.Write(buffer[:count])
			total += int64(written)
			if writeErr != nil {
				return total, writeErr
			}
			if written != count {
				return total, io.ErrShortWrite
			}
		}
		if errors.Is(readErr, io.EOF) {
			return total, nil
		}
		if readErr != nil {
			return total, readErr
		}
	}
}

func matchesContentType(header []byte, contentType string) bool {
	switch contentType {
	case "application/pdf":
		return bytes.HasPrefix(header, []byte("%PDF-"))
	case "image/jpeg":
		return len(header) >= 3 && header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff
	case "image/png":
		return bytes.HasPrefix(header, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	default:
		return false
	}
}
