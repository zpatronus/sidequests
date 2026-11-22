# Sidequests

Small games and tools in one Go service, deployable anywhere that runs Go.

- `/` — project home
- `/offer-call/` — Offer Desk for recording compensation offers and comparing them
- `/formula-war/` — Formula War
- `/undercover/` — 谁是卧底: join a room, configure undercover/blank counts, and privately view cards. The host can start elimination votes. A confirmed vote is final, and an eliminated player’s role is revealed while their word stays private. Rooms expire after 15 minutes without a room request.
- `/abracada/` — 出包魔法师，中文在线魔法推理桌游，2–5 人标准玩法、六人扩展，自绘 SVG、SSE、可添加机器人。
- `/secret-hitler/` — 揭秘希特勒，1–10 人中文在线桌游，可添加机器人补足规则所需的 5–10 席

## Local development

Requires Go 1.23+. SQLite works with `CGO_ENABLED=0`. No frontend build tools are required.

```sh
SIDEQUESTS_DATA_DIR=./data go run .
```

Open http://localhost:8080. Set `PORT` to change the port.

```sh
go test -race ./...
go vet ./...
node --test internal/*/web/*.test.mjs
go build -trimpath -o bin/server .
```

Node is only needed for browser-code tests. The Go binary embeds the frontend and word bank. Game artwork is cached for 24 hours with ETag validation; HTML, CSS, and JavaScript revalidate on reload, and room/private data is never cached. Players authenticate per room with a username and four-digit PIN. There is no permanent account registry.

出包魔法师 and 揭秘希特勒 save their rooms, game state, and PIN credentials in `/data/sidequests.sqlite3` by default. The server creates the database on startup and restores active games after a restart. Run one process per database. Live connections and emoji reactions stay in memory. A dedicated cleanup loop runs every 15 minutes, and rooms stop accepting requests 15 minutes after their last activity. Formula War and 谁是卧底 keep their rooms in memory.

Set `SIDEQUESTS_DATA_DIR` to choose another directory, or `SIDEQUESTS_STORAGE=memory` to skip SQLite entirely. If the storage path is unavailable at startup, the server logs the failure and uses in-memory rooms. A database already owned by another process is rejected.

## Deployment

Build with `go build -trimpath -o bin/server .` and run `./bin/server`. The server listens on `PORT` (default `8080`) and exposes `/healthz`. Go buildpacks using `go install .` produce a `sidequests` executable.

### Deplexo

Mount persistent storage at `/data`. Leave `SIDEQUESTS_STORAGE` unset to use SQLite. The default Go build can open SQLite with CGO disabled.

## Adding an app

Put its Go handler and embedded assets in `internal/<name>`, mount it in `main.go`, and add a card to `web/index.html`. Browser links and requests must use the app's public prefix.

## 谁是卧底 word bank

`internal/undercover/words.tsv` is the only word-bank file. Existing pairs were collected from:

- [imposter-game](https://imposter-game.com/zh/words)
- [心有灵犀](https://ishindenshin.app/zh/guide/undercover-word-list/)
- [巴哈姆特](https://home.gamer.com.tw/artwork.php?sn=6065362)
- [Tooldeer](https://tooldeer.com/undercover.html)

Pairs are converted to Simplified Chinese and deduplicated regardless of order. Celebrity, adult/sexual, crude, and malformed entries are excluded; ordinary body topics such as 狐臭／香港脚 are allowed. No pairs are generated or combined from unrelated words.

## Secret Hitler credits and license

The Chinese adaptation in `internal/secrethitler/` is licensed under **CC BY-NC-SA 4.0**, including its independently written Go game engine and Chinese interface/rules. See [the subdirectory license](internal/secrethitler/LICENSE). This scope does not relicense the other projects.

- **Original game:** Secret Hitler, by Mike Boxleiter, Tommy Maranges, and Mac Schubert / Goat, Wolf & Cabbage. [Official site](https://www.secrethitler.com/) · [Official rules](https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf).
- **Artwork:** ShrimpCryptid and contributors, [Secret-Hitler-Online](https://github.com/ShrimpCryptid/Secret-Hitler-Online), revision `6b210bae0ae3c3aeb67391dcfa328135a13fb345`, adapted from the original board game. The game uses the original board tracks, role and party cards, policy cards, ballots, player artwork, and victory artwork, plus all 20 avatar SVGs.
- **Changes:** independently implemented authoritative Go rules/state and private views, a new Chinese interface and rules translation, all avatars freely available, optional bots with private-information-only decisions, and no social-sharing unlocks. Upstream game logic was not ported.
- **Terms:** [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-nc-sa/4.0/). Noncommercial use only; adaptations must retain attribution and use the same license. This is an unofficial fan adaptation, not endorsed by the original creators.

## 出包魔法师

`/abracada/` implements the Chinese game with authenticated, per-player SSE views. A player's own spell stones remain hidden during play and are revealed at round end; captured 秘法石板 are fetched separately through the private endpoint. Bots use the same public view and their own captured tablets, with 4 seconds between operations so spell announcements and results remain visible.

- Standard 2–5 player supply: **1, 2, 3, 4, 5, 6, 7, 8** (36 stones).
- Six-player supply: **1, 3, 4, 5, 6, 7, 8, 9** (43 stones). Spell IDs remain 1–8; five secret tablets leave eight stones in the draw pile after dealing.
- Seat order and the first starter are randomized once. Turns proceed counterclockwise; subsequent rounds start with the player who ended the previous round.
- Original game: **Abracada...What?**, designed by Gary Kim. [Chinese rules reference](https://gameurlife.pixnet.net/blog/posts/10335625152) · [English rules reference](https://www.rulespal.com/abracada-what/rulebook).
- Rules, UI and SVG illustrations are independently implemented. The counterclockwise sequence, subsequent-round starter and six-player supply follow this project's selected rules.

## Offer Call cloud saves and sharing

1. Run [the Offer Call SQL migration](internal/offercall/schema.sql) in the Supabase SQL Editor. It creates one table, `public.sidequests_offer_call_saves`, with a browser hash primary key, a unique share UUID, a JSONB save, and an automatically maintained `updated_at` timestamp. The SQL scopes all grants and revokes to that table.
2. Set `OFFER_CALL_SUPABASE_URL` to your Supabase Project URL and `OFFER_CALL_SUPABASE_SECRET_KEY` to a server-side secret API key in the Sidequests service environment. Supabase's legacy service role key also works. The project Data API must be enabled and expose the `public` schema.
3. Visit `/offer-call/`. Changes are stored locally and uploaded after two seconds without another edit. If you leave before sync completes, reopening Offer Call resumes any pending upload. Offer Call also works locally when cloud storage is unconfigured.

The editor uses a private random credential stored in browser local storage for this origin. Clearing site data or switching browser profiles creates a new editor identity. To bring existing Offer Desk data from a different origin, export and import the JSON backup.

The share button saves the current workspace and returns a stable, separate UUID link. Anyone with the link can see all offers, notes, and subsequent synced edits when they open or reload the page. The share link has read access only.

Offer Call payroll presets adapt the [city-salary payroll reference](https://github.com/weante/city-salary/tree/2f1be4ff07c36206430d4d02035e30f7c1bf21c1) under the [MIT license](internal/offercall/web/data/city-payroll-LICENSE.txt). City settings link to the source records and mark provisional values.

## Machine dashboard

The unlisted `/dashboard` refreshes system, process, and network readings every five seconds. On Linux it reads the interfaces visible to the service. To include interface IP and MAC addresses, set `DASHBOARD_PASSWORD` on the server, restart, and sign in over HTTPS with username `dashboard` and that password. Setting the password protects both the dashboard page and its metrics route.
