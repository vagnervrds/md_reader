package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"mdreader/internal/database"
	"mdreader/internal/scanner"
	"mdreader/internal/server"
	"mdreader/internal/util"
)

const Port = 4181

func isSnapshotPath(p string) bool {
	if p == "" {
		return false
	}
	lower := strings.ToLower(p)
	return strings.Contains(lower, "snapshot") || strings.HasPrefix(lower, "\\snapshot") || strings.HasPrefix(lower, "/snapshot")
}

func getTargetFileFromArgs() string {
	for _, arg := range os.Args[1:] {
		if arg == "" || strings.HasPrefix(arg, "-") {
			continue
		}
		if isSnapshotPath(arg) {
			continue
		}
		lower := strings.ToLower(arg)
		if strings.HasSuffix(lower, ".js") || strings.HasSuffix(lower, ".exe") {
			continue
		}
		if strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".markdown") {
			abs, err := filepath.Abs(arg)
			if err == nil {
				return abs
			}
			return arg
		}
		if fi, err := os.Stat(arg); err == nil && !fi.IsDir() {
			abs, err := filepath.Abs(arg)
			if err == nil {
				return abs
			}
			return arg
		}
	}
	return ""
}

func isServerRunning(port int) bool {
	client := http.Client{
		Timeout: 600 * time.Millisecond,
	}
	resp, err := client.Get(fmt.Sprintf("http://localhost:%d/api/ping", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func main() {
	targetFile := getTargetFileFromArgs()
	var urlToOpen string
	if targetFile != "" {
		urlToOpen = fmt.Sprintf("http://localhost:%d/?file=%s", Port, url.QueryEscape(targetFile))
	} else {
		urlToOpen = fmt.Sprintf("http://localhost:%d", Port)
	}

	if isServerRunning(Port) {
		log.Printf("[mdreader] Existing instance detected. Opening URL: %s", urlToOpen)
		_ = util.OpenBrowser(urlToOpen)
		os.Exit(0)
	}

	appDir := database.GetAppDir()
	log.Printf("[mdreader] Starting in application directory: %s", appDir)

	db, err := database.InitDB(appDir)
	if err != nil {
		log.Fatalf("[mdreader] Failed to initialize database: %v", err)
	}

	sc, err := scanner.NewScanner(db)
	if err != nil {
		log.Printf("[mdreader] Warning: scanner failed to initialize: %v", err)
	} else {
		sc.Start()
		defer sc.Stop()
	}

	srv := server.NewServer(db, sc, appDir)

	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", Port),
		Handler: srv.Router(),
	}

	// Channel for graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("[mdreader] Server running at http://localhost:%d", Port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[mdreader] Server error: %v", err)
		}
	}()

	// Open the browser once the server starts
	go func() {
		time.Sleep(100 * time.Millisecond)
		log.Printf("[mdreader] Opening browser at %s", urlToOpen)
		_ = util.OpenBrowser(urlToOpen)
	}()

	<-stop
	log.Println("[mdreader] Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("[mdreader] Shutdown warning: %v", err)
	}
	log.Println("[mdreader] Stopped")
}
