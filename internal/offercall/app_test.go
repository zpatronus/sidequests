package offercall

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type testTransport func(http.ResponseWriter, *http.Request)

func (transport testTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	w := httptest.NewRecorder()
	transport(w, r)
	return w.Result(), nil
}

func TestShareReadsLatestSaveWithoutOwnerCredential(t *testing.T) {
	const uuid = "b35d67a7-61ec-4a0f-a673-fbd8079f2274"
	ownerID := strings.Repeat("ab", 32)
	var snapshot json.RawMessage
	supabase := testTransport(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") != "sb_secret_test" {
			t.Error("missing server API key")
		}
		switch r.Method + " " + r.URL.Path {
		case "POST /rest/v1/" + saves:
			if r.URL.Query().Get("columns") != "browser_id,save" {
				t.Error("autosave must leave the share UUID out of the upsert columns")
			}
			var row struct {
				BrowserID string          `json:"browser_id"`
				Save      json.RawMessage `json:"save"`
			}
			if err := json.NewDecoder(r.Body).Decode(&row); err != nil {
				t.Error(err)
			}
			if row.BrowserID == ownerID || !browserID.MatchString(row.BrowserID) {
				t.Error("database must receive the hashed browser credential")
			}
			snapshot = row.Save
			w.WriteHeader(http.StatusCreated)
		case "GET /rest/v1/" + saves:
			if r.URL.Query().Get("uuid") == "eq."+uuid {
				w.Write([]byte(`[{"save":` + string(snapshot) + `}]`))
			} else {
				w.Write([]byte(`[{"uuid":"` + uuid + `"}]`))
			}
		default:
			t.Errorf("unexpected Supabase request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	})

	handler := newHandler("https://supabase.test", "sb_secret_test", &http.Client{Transport: supabase})
	request := func(method, path, credential string, body io.Reader, status int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, body)
		if credential != "" {
			r.Header.Set("Authorization", "Bearer "+credential)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, w.Code, status, w.Body)
		}
		return w
	}

	first := `{"version":2,"offers":[{"company":"first"}]}`
	latest := `{"version":2,"offers":[{"company":"latest"}]}`
	request("PUT", "/api/save", ownerID, strings.NewReader(first), http.StatusNoContent)
	share := request("POST", "/api/share", ownerID, nil, http.StatusOK)
	if !strings.Contains(share.Body.String(), uuid) || strings.Contains(share.Body.String(), ownerID) {
		t.Fatalf("unexpected share response: %s", share.Body)
	}
	request("PUT", "/api/save", uuid, strings.NewReader(latest), http.StatusUnauthorized)
	request("PUT", "/api/save", ownerID, strings.NewReader(latest), http.StatusNoContent)
	again := request("POST", "/api/share", ownerID, nil, http.StatusOK)
	if again.Body.String() != share.Body.String() {
		t.Fatalf("share UUID changed: %s", again.Body)
	}
	read := request("GET", "/api/share/"+uuid, "", nil, http.StatusOK)
	if !bytes.Equal(bytes.TrimSpace(read.Body.Bytes()), []byte(latest)) || read.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unexpected share data or caching headers: %s %v", read.Body, read.Header())
	}
}
