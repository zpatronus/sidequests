package dashboard

import (
	"embed"
	"encoding/json"
	"io/fs"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed web/*
var assets embed.FS

var processStarted = time.Now()

type systemMemory struct {
	TotalKiB     uint64 `json:"totalKiB"`
	AvailableKiB uint64 `json:"availableKiB"`
}

type snapshot struct {
	SampledAt     time.Time `json:"sampledAt"`
	CPUModel      string    `json:"cpuModel"`
	OS            string    `json:"os"`
	OSRelease     string    `json:"osRelease"`
	Kernel        string    `json:"kernel"`
	Architecture  string    `json:"architecture"`
	GoVersion     string    `json:"goVersion"`
	ResidentKiB   *uint64   `json:"residentKiB"`
	ProcessCPU    *float64  `json:"processCPU"`
	cpuTime       *time.Duration
	CPUs          int           `json:"cpus"`
	Load          *[3]float64   `json:"load"`
	Memory        *systemMemory `json:"memory"`
	SystemUptime  *float64      `json:"systemUptime"`
	ProcessUptime float64       `json:"processUptime"`
	HeapBytes     uint64        `json:"heapBytes"`
	Goroutines    int           `json:"goroutines"`
}

func Register(mux *http.ServeMux) {
	files, _ := fs.Sub(assets, "web")
	static := http.FileServer(http.FS(files))
	var mu sync.Mutex
	var latest snapshot
	cpuModel, osRelease, kernel := systemIdentity()
	mux.HandleFunc("GET /dashboard", dashboardHeaders(func(w http.ResponseWriter, r *http.Request) {
		page, _ := assets.ReadFile("web/index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(page)
	}))
	for _, name := range []string{"dashboard.js", "dashboard.css"} {
		mux.HandleFunc("GET /dashboard/"+name, dashboardHeaders(http.StripPrefix("/dashboard", static).ServeHTTP))
	}
	mux.HandleFunc("GET /dashboard/metrics", dashboardHeaders(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if time.Since(latest.SampledAt) >= 5*time.Second {
			next := collect("/proc")
			next.CPUModel, next.OSRelease, next.Kernel = cpuModel, osRelease, kernel
			next.ProcessCPU = cpuPercent(latest, next)
			latest = next
		}
		data := latest
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(data)
	}))
}

func dashboardHeaders(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'")
		next(w, r)
	}
}

func collect(procDir string) snapshot {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	cpuTime := processCPUTime()
	return snapshot{
		SampledAt:     time.Now(),
		OS:            runtime.GOOS,
		Architecture:  runtime.GOARCH,
		GoVersion:     runtime.Version(),
		ResidentKiB:   readResidentMemory(procFields(filepath.Join(procDir, "self", "status"))),
		cpuTime:       cpuTime,
		CPUs:          runtime.NumCPU(),
		Load:          loadAverage(procFields(filepath.Join(procDir, "loadavg"))),
		Memory:        readMemory(procFields(filepath.Join(procDir, "meminfo"))),
		SystemUptime:  uptime(procFields(filepath.Join(procDir, "uptime"))),
		ProcessUptime: time.Since(processStarted).Seconds(),
		HeapBytes:     mem.HeapAlloc,
		Goroutines:    runtime.NumGoroutine(),
	}
}

func procFields(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return strings.Fields(string(data))
}

func nonnegative(text string) (float64, bool) {
	value, err := strconv.ParseFloat(text, 64)
	return value, err == nil && value >= 0 && !math.IsInf(value, 0)
}

func loadAverage(fields []string) *[3]float64 {
	if len(fields) < 3 {
		return nil
	}
	var load [3]float64
	for i := range load {
		value, ok := nonnegative(fields[i])
		if !ok {
			return nil
		}
		load[i] = value
	}
	return &load
}

func uptime(fields []string) *float64 {
	if len(fields) == 0 {
		return nil
	}
	value, ok := nonnegative(fields[0])
	if !ok {
		return nil
	}
	return &value
}

func readMemory(fields []string) *systemMemory {
	values := make(map[string]uint64, 2)
	for i := 0; i+2 < len(fields); i++ {
		key := fields[i]
		if (key != "MemTotal:" && key != "MemAvailable:") || fields[i+2] != "kB" {
			continue
		}
		if value, err := strconv.ParseUint(fields[i+1], 10, 64); err == nil {
			values[key] = value
		}
	}
	total := values["MemTotal:"]
	available, ok := values["MemAvailable:"]
	if total == 0 || !ok || available > total {
		return nil
	}
	return &systemMemory{TotalKiB: total, AvailableKiB: available}
}

func cpuPercent(previous, current snapshot) *float64 {
	if previous.cpuTime == nil || current.cpuTime == nil {
		return nil
	}
	elapsed := current.SampledAt.Sub(previous.SampledAt)
	used := *current.cpuTime - *previous.cpuTime
	if elapsed <= 0 || used < 0 {
		return nil
	}
	percent := 100 * float64(used) / float64(elapsed)
	return &percent
}

func readResidentMemory(fields []string) *uint64 {
	for i := 0; i+2 < len(fields); i++ {
		if fields[i] == "VmRSS:" && fields[i+2] == "kB" {
			if value, err := strconv.ParseUint(fields[i+1], 10, 64); err == nil {
				return &value
			}
		}
	}
	return nil
}

func systemIdentity() (cpuModel, osRelease, kernel string) {
	kernel = strings.Join(procFields("/proc/sys/kernel/osrelease"), " ")
	cpu, _ := os.ReadFile("/proc/cpuinfo")
	for _, key := range []string{"model name", "Hardware", "Processor"} {
		cpuModel = entryValue(string(cpu), key, ":")
		if cpuModel != "" {
			break
		}
	}
	for _, path := range []string{"/etc/os-release", "/usr/lib/os-release"} {
		data, err := os.ReadFile(path)
		if err == nil {
			osRelease = strings.Trim(entryValue(string(data), "PRETTY_NAME", "="), "\"'")
			if osRelease != "" {
				break
			}
		}
	}
	return cpuModel, osRelease, kernel
}

func entryValue(data, key, separator string) string {
	for _, line := range strings.Split(data, "\n") {
		name, value, ok := strings.Cut(line, separator)
		if ok && strings.TrimSpace(name) == key {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
