package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCollectReturnsAvailableMetrics(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "loadavg"), []byte("NaN 0.5 0.7"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "meminfo"), []byte("MemTotal: 100 kB\nMemAvailable: 70 kB\n"), 0600); err != nil {
		t.Fatal(err)
	}
	data := collect(dir)
	if data.Load != nil || data.SystemUptime != nil {
		t.Fatalf("invalid and absent data must be unavailable: %+v", data)
	}
	if data.Memory == nil || *data.Memory != (systemMemory{TotalKiB: 100, AvailableKiB: 70}) || data.CPUs < 1 {
		t.Fatalf("valid metrics must still be available: %+v", data)
	}
}

func TestDashboardRoutes(t *testing.T) {
	mux := http.NewServeMux()
	Register(mux)
	for path, contentType := range map[string]string{
		"/dashboard":               "text/html",
		"/dashboard/dashboard.css": "text/css",
		"/dashboard/dashboard.js":  "text/javascript",
		"/dashboard/metrics":       "application/json",
	} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK || !strings.HasPrefix(w.Header().Get("Content-Type"), contentType) ||
			w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Header().Get("X-Robots-Tag"), "noindex") {
			t.Fatalf("%s: status %d, headers %v", path, w.Code, w.Header())
		}
		if path == "/dashboard/metrics" {
			var data snapshot
			if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil || data.SampledAt.IsZero() || data.CPUs < 1 {
				t.Fatalf("invalid metrics: %s (%v)", w.Body, err)
			}
		}
	}
}
