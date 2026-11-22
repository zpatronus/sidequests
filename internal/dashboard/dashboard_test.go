package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

func TestProcessCPUUsesElapsedTimeAcrossCores(t *testing.T) {
	now := time.Now()
	firstCPU, secondCPU := time.Second, 7*time.Second
	first := snapshot{SampledAt: now, cpuTime: &firstCPU}
	second := snapshot{SampledAt: now.Add(5 * time.Second), cpuTime: &secondCPU}
	if percent := cpuPercent(first, second); percent == nil || *percent != 120 {
		t.Fatalf("expected 120%% CPU, got %v", percent)
	}
	if cpuPercent(snapshot{}, first) != nil || cpuPercent(second, first) != nil {
		t.Fatal("a missing baseline or reversed sample should be unavailable")
	}
}

func TestResidentMemoryHandlesMissingAndInvalidData(t *testing.T) {
	rss := readResidentMemory(strings.Fields("Name: sidequests VmRSS: 45056 kB"))
	if rss == nil || *rss != 45056 {
		t.Fatalf("expected 45056 KiB, got %v", rss)
	}
	if readResidentMemory(nil) != nil || readResidentMemory(strings.Fields("VmRSS: invalid kB")) != nil {
		t.Fatal("missing and invalid RSS should be unavailable")
	}
}

func TestNetworkRatesAndCounterReset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dev")
	const data = "lo: 900 0 0 0 0 0 0 0 900 0 0 0 0 0 0 0\n" +
		"eth0: 120 0 0 0 0 0 0 0 60 0 0 0 0 0 0 0\n"
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	current := networkInterfaces(path)
	if len(current) != 1 {
		t.Fatalf("expected one non-loopback interface, got %v", current)
	}
	previous := map[string]networkCounters{"eth0": {Received: 100, Sent: 50}}
	result := measureNetwork(previous, current, 5*time.Second)
	if result == nil || result.Totals != (networkCounters{Received: 120, Sent: 60}) ||
		result.Rate == nil || *result.Rate != (networkRate{Received: 4, Sent: 2}) {
		t.Fatalf("unexpected network reading: %+v", result)
	}
	reset := measureNetwork(current, previous, 5*time.Second)
	if reset == nil || reset.Rate != nil || reset.Totals != previous["eth0"] {
		t.Fatalf("expected totals without a rate after a counter reset: %+v", reset)
	}
	if measureNetwork(previous, nil, time.Second) != nil {
		t.Fatal("missing counters should be unavailable")
	}
}
