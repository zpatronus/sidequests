package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/zpatronus/sidequests/internal/roomdb"
)

func TestSQLiteGameRecovery(t *testing.T) {
	t.Setenv("SIDEQUESTS_STORAGE", "")
	for _, game := range []string{"abracada", "secret-hitler"} {
		t.Run(game, func(t *testing.T) {
			dir := t.TempDir()
			open := func() (http.Handler, *roomdb.Store, context.CancelFunc) {
				t.Helper()
				ctx, cancel := context.WithCancel(context.Background())
				app, db, err := openGameHandler(ctx, dir)
				if err != nil || db == nil {
					cancel()
					t.Fatalf("open SQLite: %v", err)
				}
				return app, db, cancel
			}
			app, db, cancel := open()
			defer func() { cancel(); db.Close() }()
			names := map[string]string{}
			base := "/" + game + "/api/"
			request := func(method, path string, data map[string]any, want int) map[string]any {
				t.Helper()
				body, _ := json.Marshal(data)
				if method == "GET" {
					query := url.Values{}
					for k, v := range data {
						query.Set(k, v.(string))
					}
					path += "?" + query.Encode()
				}
				req := httptest.NewRequest(method, base+path, bytes.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				res := httptest.NewRecorder()
				app.ServeHTTP(res, req)
				if res.Code != want {
					t.Fatalf("%s %s returned %d: %s", method, path, res.Code, res.Body.String())
				}
				var out map[string]any
				if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
					t.Fatal(err)
				}
				return out
			}
			created := request("POST", "create", map[string]any{"name": "Host", "pin": "1234", "avatar": 1}, 201)
			code := created["code"].(string)
			host := created["you"].(string)
			names[host] = "Host"
			guests := 1
			if game == "secret-hitler" {
				guests = 4
			}
			for i := 0; i < guests; i++ {
				name := []string{"Ava", "Bo", "Cai", "Dee"}[i]
				joined := request("POST", "join", map[string]any{"code": code, "name": name, "pin": "1234", "avatar": i + 2}, 200)
				names[joined["you"].(string)] = name
			}
			credentials := func(id string) map[string]any {
				return map[string]any{"code": code, "username": names[id], "pin": "1234"}
			}
			bots := credentials(host)
			bots["count"] = 0
			request("POST", "bots", bots, 200)
			started := request("POST", "start", credentials(host), 200)["game"].(map[string]any)
			action := func(id string, state map[string]any) map[string]any {
				data := credentials(id)
				data["game"], data["step"] = state["id"], state["step"]
				return data
			}
			var before map[string]any
			var cast map[string]any
			var actor string
			if game == "abracada" {
				actor = started["turn"].(string)
				cast = action(actor, started)
				cast["spell"] = 1
				cast["requestId"] = "123456789012345678901234567890ab"
				before = request("POST", "cast", cast, 200)
				if before["game"].(map[string]any)["phase"] != "rolling" {
					t.Fatal("expected pending dragon roll")
				}
			} else {
				actor = started["president"].(string)
				state := request("GET", "room", credentials(actor), 200)["game"].(map[string]any)
				nominee := action(actor, state)
				nominee["target"] = state["targets"].([]any)[0]
				request("POST", "nominate", nominee, 200)
				before = request("GET", "room", credentials(actor), 200)
			}
			var private map[string]any
			if game == "secret-hitler" {
				private = request("GET", "private", credentials(actor), 200)
			}

			cancel()
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}
			app, db, cancel = open()
			after := request("GET", "room", credentials(actor), 200)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("room changed after restart")
			}
			wrong := credentials(actor)
			wrong["pin"] = "9999"
			request("GET", "room", wrong, 403)
			state := after["game"].(map[string]any)
			if game == "abracada" {
				replayed := request("POST", "cast", cast, 200)
				if !reflect.DeepEqual(before, replayed) {
					t.Fatal("replayed cast did not return its original response after restart")
				}
				cast["spell"] = 2
				request("POST", "cast", cast, 409)
				if current := request("GET", "room", credentials(actor), 200); !reflect.DeepEqual(after, current) {
					t.Fatal("replayed cast changed the room")
				}
				roll := action(actor, state)
				roll["roll"] = 2
				roll["requestId"] = "123456789012345678901234567890cd"
				firstRoll := request("POST", "roll", roll, 200)
				resolved := firstRoll["game"].(map[string]any)
				if resolved["phase"] == "rolling" {
					t.Fatal("restored dragon roll did not resolve")
				}
				if replayed := request("POST", "roll", roll, 200); !reflect.DeepEqual(firstRoll, replayed) {
					t.Fatal("replayed roll did not return the original response")
				}
			} else {
				if got := request("GET", "private", credentials(actor), 200); !reflect.DeepEqual(private, got) {
					t.Fatal("private role changed on restart")
				}
				vote := action(actor, state)
				vote["yes"] = true
				request("POST", "vote", vote, 200)
			}

			if err := db.Touch(game, code, time.Now().Add(-time.Second)); err != nil {
				t.Fatal(err)
			}
			cancel()
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}
			app, db, cancel = open()
			request("GET", "room", credentials(actor), 404)
		})
	}
}

func TestSQLiteStartupFallback(t *testing.T) {
	t.Setenv("SIDEQUESTS_STORAGE", "")
	blocked := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app, db, err := openGameHandler(ctx, blocked)
	if app == nil || db != nil || err != nil {
		t.Fatalf("expected memory fallback: %v", err)
	}
	dir := t.TempDir()
	db, err = roomdb.Open(filepath.Join(dir, "sidequests.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, _, err := openGameHandler(ctx, dir); !errors.Is(err, roomdb.ErrInUse) {
		t.Fatalf("expected existing process lock: %v", err)
	}
	t.Setenv("SIDEQUESTS_STORAGE", "memory")
	if app, db, err := openGameHandler(ctx, dir); app == nil || db != nil || err != nil {
		t.Fatalf("expected explicit memory mode: %v", err)
	}
}

func TestRoomAuthenticationDoesNotUseBrowserCookies(t *testing.T) {
	t.Setenv("SIDEQUESTS_STORAGE", "memory")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app, _, err := openGameHandler(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, game := range []string{"abracada", "secret-hitler"} {
		t.Run(game, func(t *testing.T) {
			base := "/" + game + "/api/"
			create := httptest.NewRequest("POST", base+"create", bytes.NewBufferString(`{"name":"Host","pin":"0123","avatar":1}`))
			create.Header.Set("Content-Type", "application/json")
			created := httptest.NewRecorder()
			app.ServeHTTP(created, create)
			if created.Code != 201 || len(created.Result().Cookies()) != 0 {
				t.Fatalf("expected cookie-free room creation: %s", created.Body.String())
			}
			var seat struct{ Code, You string }
			if err := json.Unmarshal(created.Body.Bytes(), &seat); err != nil {
				t.Fatal(err)
			}
			path := base + "room?code=" + seat.Code
			denied := httptest.NewRecorder()
			req := httptest.NewRequest("GET", path, nil)
			req.AddCookie(&http.Cookie{Name: "abr_" + seat.Code, Value: seat.You})
			req.AddCookie(&http.Cookie{Name: "sh_" + seat.Code, Value: seat.You})
			app.ServeHTTP(denied, req)
			if denied.Code != 403 {
				t.Fatalf("request without username and PIN returned %d", denied.Code)
			}
			recovered := httptest.NewRecorder()
			app.ServeHTTP(recovered, httptest.NewRequest("GET", path+"&username=Host&pin=0123", nil))
			if recovered.Code != 200 || !bytes.Equal(created.Body.Bytes(), recovered.Body.Bytes()) {
				t.Fatal("username and PIN did not recover the seat")
			}
		})
	}
}

func TestDashboardDatabaseSizeFollowsStorageMode(t *testing.T) {
	t.Setenv("DASHBOARD_PASSWORD", "")
	dir := t.TempDir()
	for _, mode := range []string{"", "memory"} {
		t.Setenv("SIDEQUESTS_STORAGE", mode)
		ctx, cancel := context.WithCancel(context.Background())
		t.Cleanup(cancel)
		app, db, err := openGameHandler(ctx, dir)
		if err != nil {
			t.Fatal(err)
		}
		if db != nil {
			t.Cleanup(func() { cancel(); db.Close() })
		}
		w := httptest.NewRecorder()
		app.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/dashboard/metrics", nil))
		var metrics struct {
			Database *struct{ Bytes int64 }
		}
		if err := json.Unmarshal(w.Body.Bytes(), &metrics); err != nil {
			t.Fatal(err)
		}
		if mode == "memory" {
			if metrics.Database != nil {
				t.Fatal("memory mode reported a database size")
			}
		} else if metrics.Database == nil || metrics.Database.Bytes <= 0 {
			t.Fatal("SQLite mode did not report a database size")
		}
	}
}
