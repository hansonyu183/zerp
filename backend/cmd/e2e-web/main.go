package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	listenAddress := flag.String("listen", "127.0.0.1:15174", "HTTP listen address")
	root := flag.String("root", "", "built frontend directory")
	apiAddress := flag.String("api", "http://127.0.0.1:18081", "E2E API origin")
	flag.Parse()

	handler, err := newE2EHandler(*root, *apiAddress)
	if err != nil {
		log.Fatal(err)
	}

	server := &http.Server{
		Addr:              *listenAddress,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       time.Minute,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("E2E web shutdown: %v", err)
		}
	}()

	log.Printf("E2E web listening on %s", *listenAddress)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func newE2EHandler(root, apiAddress string) (http.Handler, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("E2E web root is required")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve E2E web root: %w", err)
	}
	indexPath := filepath.Join(root, "index.html")
	if info, err := os.Stat(indexPath); err != nil || !info.Mode().IsRegular() {
		return nil, fmt.Errorf("E2E web index is missing: %s", indexPath)
	}

	apiOrigin, err := url.Parse(apiAddress)
	if err != nil || apiOrigin.Scheme == "" || apiOrigin.Host == "" {
		return nil, fmt.Errorf("invalid E2E API origin: %q", apiAddress)
	}
	proxy := httputil.NewSingleHostReverseProxy(apiOrigin)
	proxy.ErrorHandler = func(writer http.ResponseWriter, request *http.Request, proxyErr error) {
		log.Printf("E2E API proxy %s: %v", request.URL.Path, proxyErr)
		http.Error(writer, "E2E API unavailable", http.StatusBadGateway)
	}

	static := &staticHandler{root: root, indexPath: indexPath}
	mux := http.NewServeMux()
	mux.Handle("/api/", http.StripPrefix("/api", proxy))
	mux.Handle("/files/", proxy)
	mux.Handle("/", static)
	return mux, nil
}

type staticHandler struct {
	root      string
	indexPath string
}

func (handler *staticHandler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Path == "/healthz" {
		writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte("ok\n"))
		return
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	cleanPath := filepath.Clean("/" + request.URL.Path)
	filePath := filepath.Join(handler.root, filepath.FromSlash(strings.TrimPrefix(cleanPath, "/")))
	if strings.HasPrefix(request.URL.Path, "/assets/") {
		if !regularFile(filePath) {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeFile(writer, request, filePath)
		return
	}

	if regularFile(filePath) && request.URL.Path != "/" {
		if request.URL.Path == "/index.html" {
			writer.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		}
		http.ServeFile(writer, request, filePath)
		return
	}

	writer.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	http.ServeFile(writer, request, handler.indexPath)
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
