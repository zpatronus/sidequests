package abracada

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRoomPrivacyLifecycleAndExpiry(t *testing.T) {
	now := time.Date(2026, 11, 15, 0, 0, 0, 0, time.UTC)
	s := &server{rooms: map[string]*room{}, now: func() time.Time { return now }}
	h := s.handler()
	call := func(method, path string, data any, cookie *http.Cookie, want int) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(data)
		req := httptest.NewRequest(method, "/api/"+path, bytes.NewReader(body))
		if method == "POST" {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s: got %d, want %d: %s", path, w.Code, want, w.Body.String())
		}
		return w
	}
	decode := func(w *httptest.ResponseRecorder) roomView {
		t.Helper()
		var v roomView
		if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	created := call("POST", "create", map[string]any{"name": "月桂"}, nil, 201)
	host := created.Result().Cookies()[0]
	v := decode(created)
	code := v.Code
	hostID := v.You
	cookies := []*http.Cookie{host}
	for i := 1; i < 6; i++ {
		joined := call("POST", "join", map[string]any{"code": code, "name": fmt.Sprintf("法师%d", i)}, nil, 200)
		cookies = append(cookies, joined.Result().Cookies()[0])
	}
	call("GET", "room?code="+code, nil, nil, 403)
	call("GET", "tablets?code="+code, nil, nil, 403)
	call("POST", "join", map[string]any{"code": code, "name": "第七位"}, nil, 409)
	call("POST", "start", map[string]any{"code": code}, cookies[1], 403)
	v = decode(call("POST", "start", map[string]any{"code": code}, host, 200))
	if len(v.Game.Players) != 6 || v.Game.Supply != expanded || v.Game.Deck != 8 || len(v.Game.Secrets) != 5 || v.Game.IDs != spellIDs {
		t.Fatal("invalid six-player setup")
	}
	seats := []string{}
	foundTurn := false
	for _, p := range v.Game.Players {
		seats = append(seats, p.ID)
		foundTurn = foundTurn || p.ID == v.Game.Turn
		for _, k := range p.Hand {
			if (p.ID == hostID) != (k == 0) {
				t.Fatal("wrong hand visibility")
			}
		}
	}
	if !foundTurn {
		t.Fatal("starter is not a seated player")
	}
	call("POST", "cast", map[string]any{"code": code, "game": v.Game.ID, "step": v.Game.Step - 1, "spell": 8}, host, 409)
	g := s.rooms[code].Game
	g.Players[g.index(hostID)].Tablets = []int{1, 8}
	private := call("GET", "tablets?code="+code, nil, host, 200)
	if !strings.Contains(private.Body.String(), `"tablets":[1,8]`) {
		t.Fatal("missing private tablets")
	}
	guest := call("GET", "tablets?code="+code, nil, cookies[1], 200)
	if !strings.Contains(guest.Body.String(), `"tablets":[]`) {
		t.Fatal("another player received private tablets")
	}
	public := call("GET", "room?code="+code, nil, host, 200)
	if strings.Contains(public.Body.String(), `"tablets":[`) {
		t.Fatal("tablets leaked into public room")
	}
	again := decode(public)
	for i, p := range again.Game.Players {
		if p.ID != seats[i] {
			t.Fatal("reading room reshuffled seats")
		}
	}
	// Reactions are authenticated, ephemeral, and do not advance the game.
	reactions := make(chan reaction, 2)
	s.rooms[code].reactions = map[chan reaction]struct{}{reactions: {}}
	step, eventCount := g.Step, len(g.Events)
	call("POST", "react", map[string]any{"code": code, "emoji": "㊗️", "player": "spoofed"}, host, 200)
	select {
	case value := <-reactions:
		if value.Player != hostID || value.Emoji != "㊗️" {
			t.Fatal("reaction identity not authenticated")
		}
	default:
		t.Fatal("reaction was not broadcast")
	}
	if g.Step != step || len(g.Events) != eventCount {
		t.Fatal("reaction changed game state or history")
	}
	call("POST", "react", map[string]any{"code": code, "emoji": "not-an-emoji"}, host, 400)
	call("POST", "react", map[string]any{"code": code, "emoji": "🤣"}, nil, 403)
	delete(s.rooms[code].reactions, reactions)
	// The stream uses the same personalized view and removes its listener on disconnect.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest("GET", "/api/events?code="+code, nil).WithContext(ctx)
	req.AddCookie(host)
	stream := &cancelStream{ResponseRecorder: httptest.NewRecorder(), cancel: cancel}
	h.ServeHTTP(stream, req)
	if stream.Header().Get("Content-Type") != "text/event-stream" || len(s.rooms[code].listeners) != 0 {
		t.Fatal("stream headers or cleanup failed")
	}
	if strings.Contains(stream.Body.String(), `"tablets":[`) {
		t.Fatal("private tablets leaked into SSE")
	}
	req = httptest.NewRequest("POST", "/api/reset", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://elsewhere.test")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("cross-origin action accepted")
	}
	now = now.Add(15 * time.Minute)
	call("GET", "room?code="+code, nil, host, 404)
	if len(s.rooms) != 0 {
		t.Fatal("expired room retained")
	}
}

type cancelStream struct {
	*httptest.ResponseRecorder
	cancel context.CancelFunc
}

func (w *cancelStream) Flush() { w.ResponseRecorder.Flush(); w.cancel() }
