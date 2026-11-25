package abracada

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T, n int) *game {
	t.Helper()
	m := []member{}
	for i := 0; i < n; i++ {
		m = append(m, member{ID: fmt.Sprint(i), Name: fmt.Sprint(i)})
	}
	g, e := newGame(m, 0)
	if e != nil {
		t.Fatal(e)
	}
	return g
}
func TestSetupConservationAndExpansion(t *testing.T) {
	for n := 2; n <= 6; n++ {
		g := fixture(t, n)
		counts := [8]int{}
		for _, p := range g.Players {
			if len(p.Hand) != 5 || p.Life != 6 {
				t.Fatal("bad deal")
			}
			for _, k := range p.Hand {
				counts[k-1]++
			}
		}
		for _, k := range append(append([]int{}, g.Deck...), g.Secrets...) {
			counts[k-1]++
		}
		for i := range counts {
			counts[i] += g.Removed[i]
			if counts[i] != g.Supply[i] {
				t.Fatal("lost stone")
			}
		}
		if n == 6 && (g.Supply != expanded || len(g.Deck) != 8 || len(g.Secrets) != 5 || g.IDs != spellIDs) {
			t.Fatal("wrong expansion")
		}
	}
}
func TestHumanRollWaitsForDrawAndKeepsSpellID(t *testing.T) {
	g := fixture(t, 6)
	g.Players[0].Hand = []int{3, 8}
	g.Players[0].Life = 3
	if err := g.actHuman("0", "cast", 3, 0); err != nil || g.Phase != "rolling" || g.Players[0].Life != 3 {
		t.Fatal("human roll should wait before applying the spell", err)
	}
	if err := g.actRoll("0", 2); err != nil || g.Players[0].Life != 5 || g.Phase != "playing" {
		t.Fatal("draw result was not applied", err)
	}
	if g.IDs[7] != 8 || g.Supply[7] != 9 || len(g.Secrets) != 5 {
		t.Fatal("six-player healing count changed its spell ID or secret count")
	}
}
func TestHumanDragonBackfireWaitsForDraw(t *testing.T) {
	g := fixture(t, 2)
	g.Players[0].Hand = []int{8, 8}
	if err := g.actHuman("0", "cast", 1, 0); err != nil || g.Phase != "rolling" || g.Players[0].Life != 6 {
		t.Fatal("dragon backfire should wait for the human roll", err)
	}
	if err := g.actRoll("0", 3); err != nil || g.Players[0].Life != 3 || g.Turn != 1 {
		t.Fatal("dragon backfire did not apply the drawn result", err)
	}
	if last := g.Events[len(g.Events)-1]; last.Roll != 3 || !strings.Contains(last.Text, "反噬") {
		t.Fatal("backfire result was not recorded", last)
	}
}
func TestPrivateHandAndSecretNeverLeak(t *testing.T) {
	g := fixture(t, 3)
	g.Players[0].Tablets = []int{1}
	v := g.view("0")
	for _, k := range v.Players[0].Hand {
		if k != 0 {
			t.Fatal("own hand exposed")
		}
	}
	if len(v.Players[1].Hand) != 5 || v.Players[1].Hand[0] == 0 {
		t.Fatal("opponent not visible")
	}
	data, _ := json.Marshal(v)
	if strings.Contains(string(data), `"Tablets"`) {
		t.Fatal("private internals exposed")
	}
}
func TestOwnHandIsRevealedAfterRoundEnds(t *testing.T) {
	g := fixture(t, 3)
	g.Players[0].Hand = []int{8, 2}
	if got := g.view("0").Players[0].Hand; len(got) != 2 || got[0] != 0 || got[1] != 0 {
		t.Fatal("own hand should stay hidden during play")
	}
	g.Phase = "round-end"
	if got := g.view("0").Players[0].Hand; len(got) != 2 || got[0] != 8 || got[1] != 2 {
		t.Fatal("own hand should be revealed after the round")
	}
}
func TestNeighborsAndCounterclockwiseTurns(t *testing.T) {
	for _, kind := range []int{5, 6, 7} {
		g := fixture(t, 6)
		g.Players[0].Hand = []int{kind, 8}
		if e := g.act("0", "cast", kind, 0); e != nil {
			t.Fatal(e)
		}
		left, right := g.Players[5].Life, g.Players[1].Life
		if kind == 6 && (left != 5 || right != 6) {
			t.Fatal("wrong left")
		}
		if kind == 7 && (left != 6 || right != 5) {
			t.Fatal("wrong right")
		}
		if kind == 5 && (left != 5 || right != 5) {
			t.Fatal("wrong storm")
		}
		if e := g.act("0", "end", 0, 0); e != nil || g.Turn != 1 {
			t.Fatal("wrong turn direction")
		}
	}
}
func TestTwoPlayerStormOnlyOneDamage(t *testing.T) {
	g := fixture(t, 2)
	g.Players[0].Hand = []int{5, 8}
	g.act("0", "cast", 5, 0)
	if g.Players[1].Life != 5 {
		t.Fatal("double damage")
	}
}
func TestChainFailureOwlAndScoring(t *testing.T) {
	g := fixture(t, 3)
	g.Players[0].Hand = []int{4, 8}
	if e := g.act("0", "cast", 4, 0); e != nil || g.Phase != "owl" {
		t.Fatal(e)
	}
	if e := g.act("0", "take", 0, 0); e != nil || len(g.Players[0].Tablets) != 1 {
		t.Fatal(e)
	}
	if e := g.act("0", "cast", 3, 0); e == nil {
		t.Fatal("descending chain accepted")
	}
	g.act("0", "cast", 8, 0)
	if g.Phase != "round-end" || g.Players[0].Gain != 4 || g.Players[1].Life != 0 {
		t.Fatal("empty-hand scoring incorrect")
	}
	g.beginRound(g.Next)
	if g.Turn != 0 || g.Players[0].Life != 6 {
		t.Fatal("round reset")
	}
}
func TestDragonBackfire(t *testing.T) {
	g := fixture(t, 2)
	g.roll = func() int { return 3 }
	g.Players[0].Hand = []int{8}
	g.Players[0].Life = 3
	g.act("0", "cast", 1, 0)
	if g.Phase != "round-end" || g.Players[0].Gain != 0 || g.Players[1].Gain != 1 {
		t.Fatal("backfire scoring")
	}
}

func TestBotWaitsBetweenVisibleActions(t *testing.T) {
	g := fixture(t, 2)
	g.Players[0].Member.Bot = true
	r := &room{Code: "ABC123", Game: g}
	s := &server{rooms: map[string]*room{r.Code: r}, now: time.Now}
	defer func() { s.mu.Lock(); delete(s.rooms, r.Code); s.mu.Unlock() }()
	before := g.Step
	s.mu.Lock()
	s.runBots(r)
	s.mu.Unlock()
	time.Sleep(100 * time.Millisecond)
	s.mu.Lock()
	early := g.Step
	s.mu.Unlock()
	if early != before {
		t.Fatal("bot skipped delay")
	}
	deadline := time.Now().Add(botActionDelay + time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		step := g.Step
		s.mu.Unlock()
		if step != before {
			if step != before+1 {
				t.Fatal("several bot actions ran together")
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("delayed bot never acted")
}

func TestNextRoundStartsWithThePlayerWhoEndedTheRound(t *testing.T) {
	for _, ending := range []string{"backfire", "kill", "empty"} {
		t.Run(ending, func(t *testing.T) {
			g := fixture(t, 4)
			g.Turn = 2
			g.Players[2].Hand = []int{7, 8}
			spell := 7
			switch ending {
			case "backfire":
				g.Players[2].Hand = []int{8}
				g.Players[2].Life = 1
			case "kill":
				g.Players[3].Life = 1
			case "empty":
				g.Players[2].Hand = []int{7}
			}
			if err := g.act("2", "cast", spell, 0); err != nil {
				t.Fatal(err)
			}
			if g.Phase != "round-end" || g.Next != 2 {
				t.Fatalf("wrong next starter: phase=%s next=%d", g.Phase, g.Next)
			}
			ids := []string{}
			for _, p := range g.Players {
				ids = append(ids, p.Member.ID)
			}
			g.beginRound(g.Next)
			if g.Round != 2 || g.Turn != 2 || g.Players[2].Life != 6 {
				t.Fatal("wrong round reset")
			}
			for i, p := range g.Players {
				if p.Member.ID != ids[i] {
					t.Fatal("seat order changed")
				}
			}
		})
	}
}

func TestFinalRoundWinnerTakesPriority(t *testing.T) {
	g := fixture(t, 3)
	g.Turn = 0
	g.Players[0].Score, g.Players[0].Life = 6, 3
	g.Players[1].Score, g.Players[1].Life = 6, 4
	g.Players[1].Tablets = []int{1, 2}
	g.Players[2].Life = 0

	g.finishIfNeeded()
	if g.Phase != "finished" || len(g.Winners) != 1 || g.Winners[0] != g.Players[0].Member.ID {
		t.Fatalf("expected final-round winner to win the match, got %v", g.Winners)
	}
}
