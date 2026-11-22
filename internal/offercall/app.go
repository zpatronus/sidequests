package offercall

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

//go:embed web
var assets embed.FS

const (
	saves   = "sidequests_offer_call_saves"
	maxSave = 4 << 20
)

var (
	browserID = regexp.MustCompile("^[0-9a-f]{64}$")
	shareID   = regexp.MustCompile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
)

type store struct {
	base   string
	key    string
	client *http.Client
}

func Handler(projectURL, key string) http.Handler {
	return newHandler(projectURL, key, &http.Client{
		Timeout:       10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	})
}

func newHandler(projectURL, key string, client *http.Client) http.Handler {
	db := store{base: strings.TrimRight(projectURL, "/") + "/rest/v1/", key: key, client: client}
	u, err := url.Parse(projectURL)
	configured := err == nil && u.Host != "" && u.Scheme == "https" &&
		u.User == nil && u.RawQuery == "" && u.Fragment == "" && (u.Path == "" || u.Path == "/") && key != ""
	mux := http.NewServeMux()
	api := http.NewServeMux()
	api.HandleFunc("PUT /api/save", db.save)
	api.HandleFunc("POST /api/share", db.createShare)
	api.HandleFunc("GET /api/share/{id}", db.readShare)
	mux.Handle("/api/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !configured {
			http.Error(w, "Cloud storage unavailable", http.StatusServiceUnavailable)
			return
		}
		api.ServeHTTP(w, r)
	}))
	files, _ := fs.Sub(assets, "web")
	static := http.FileServer(http.FS(files))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".test.mjs") || (strings.HasSuffix(r.URL.Path, "/") && r.URL.Path != "/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		static.ServeHTTP(w, r)
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Robots-Tag", "noindex")
		w.Header().Set("X-Frame-Options", "DENY")
		mux.ServeHTTP(w, r)
	})
}

func (db store) request(ctx context.Context, method, table string, query url.Values, data any, prefer string, result any) error {
	var body io.Reader
	if data != nil {
		payload, err := json.Marshal(data)
		if err != nil {
			return err
		}
		body = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, db.base+table+"?"+query.Encode(), body)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", db.key)
	if strings.HasPrefix(db.key, "eyJ") {
		req.Header.Set("Authorization", "Bearer "+db.key)
	}
	if data != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Prefer", prefer)
	}
	resp, err := db.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Supabase %s %s returned HTTP %d", method, table, resp.StatusCode)
	}
	if result != nil {
		return json.NewDecoder(resp.Body).Decode(result)
	}
	return nil
}

func owner(w http.ResponseWriter, r *http.Request) string {
	id, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !browserID.MatchString(id) {
		http.Error(w, "Invalid browser credential", http.StatusUnauthorized)
		return ""
	}
	digest := sha256.Sum256([]byte(id))
	return hex.EncodeToString(digest[:])
}

func (db store) save(w http.ResponseWriter, r *http.Request) {
	id := owner(w, r)
	if id == "" {
		return
	}
	payload, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxSave))
	if err != nil {
		http.Error(w, "Could not read save (limit 4 MiB)", http.StatusRequestEntityTooLarge)
		return
	}
	var shape struct {
		Offers    json.RawMessage              `json:"offers"`
		CityCosts map[string]map[string]string `json:"cityCosts"`
	}
	if err := json.Unmarshal(payload, &shape); err != nil || len(shape.Offers) < 2 || shape.Offers[0] != '[' {
		http.Error(w, "Invalid save", http.StatusBadRequest)
		return
	}
	err = db.request(r.Context(), http.MethodPost, saves, url.Values{"on_conflict": {"browser_id"}, "columns": {"browser_id,save"}},
		map[string]any{"browser_id": id, "save": json.RawMessage(payload)}, "resolution=merge-duplicates,return=minimal", nil)
	if err != nil {
		storageError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (db store) createShare(w http.ResponseWriter, r *http.Request) {
	id := owner(w, r)
	if id == "" {
		return
	}
	var rows []struct {
		UUID string `json:"uuid"`
	}
	query := url.Values{"browser_id": {"eq." + id}, "select": {"uuid"}}
	err := db.request(r.Context(), http.MethodGet, saves, query, nil, "", &rows)
	if err != nil || len(rows) != 1 {
		storageError(w, err)
		return
	}
	writeJSON(w, rows[0])
}

func (db store) readShare(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !shareID.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	var rows []struct {
		Save json.RawMessage `json:"save"`
	}
	query := url.Values{"uuid": {"eq." + id}, "select": {"save"}}
	err := db.request(r.Context(), http.MethodGet, saves, query, nil, "", &rows)
	if err != nil {
		storageError(w, err)
		return
	}
	if len(rows) != 1 || len(rows[0].Save) == 0 {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, rows[0].Save)
}

func storageError(w http.ResponseWriter, err error) {
	if err != nil {
		log.Printf("offer-call storage: %v", err)
	}
	http.Error(w, "Cloud storage unavailable", http.StatusBadGateway)
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}
