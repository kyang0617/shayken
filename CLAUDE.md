# Shayken

A 2-player online card battler, built as a learning project. Browser frontend; backend is
Cloudflare Workers + Durable Objects on the **free plan**. Explain key server-side decisions
when making changes — the owner wants to understand the code, not just have it.

## Game direction (mostly undecided)

- Quick (~10 min) 1v1 matches. Each player starts at 20 health; reduce the opponent to 0 to win.
- 20-card decks. Turn timer of roughly 45–60s.
- Theme: drinks/potions. Cards add ingredients (each with an effect) to your current concoction.
  At the end of each turn you decide whether to throw the potion at the opponent (effect applies
  now, can disrupt them) or keep brewing toward a stronger potion.
- One resource to start, gained each turn.

**Everything else about the rules is undecided** — card types, tiers, effects, how holding a
potion is balanced, what the opponent can see. Do not invent or implement game mechanics
without asking. Card definitions are placeholders until the design is settled.

## Architecture rules (decided — follow these)

- One `GameRoom` Durable Object per match. It is the single source of truth.
- Never trust the client: every action is validated server-side. The server rejects anything
  not legal in the current state/phase.
- Hidden information: the server holds full state and sends each player only their own view
  (own hand; opponent's hand count only; never deck order).
- All shuffling and randomness happen on the server, using `crypto.getRandomValues`.
- Cards are data, not code: definitions live in typed data files in `shared/`; a rules engine
  (later) interprets them.
- Card data and message types live in `shared/` and are imported by both server and client.
- Players are identified by a secret token issued by the server on join, never by a seat
  number or name sent from the client.

## Free-plan constraints

- Durable Objects must be SQLite-backed: migrations use `new_sqlite_classes`.
- Use the WebSocket Hibernation API (`ctx.acceptWebSocket`, `webSocketMessage`,
  `webSocketClose`) — never `ws.accept()` — so idle rooms don't burn duration. "Idle" includes
  the gaps between messages in an active match (players thinking), which is most of a game.
- Because a hibernated DO loses in-memory state, persist room state to `ctx.storage` and
  per-socket identity via `ws.serializeAttachment`. Don't rely on instance fields surviving.
- Timers (turn timer, timeouts, cleanup) use Durable Object alarms (`ctx.storage.setAlarm` +
  an `alarm()` handler) — never `setTimeout`/`setInterval`. A pending JS timer keeps the
  object awake and billed; an alarm lets it hibernate and wakes it when due. A DO has one
  alarm at a time, so store the deadline(s) in state and set the alarm to the earliest one.
- Room reaping already uses the alarm (`room.reap`, `updateReaper`, `alarm()` in
  `src/game-room.ts`): 0 joined players connected → deleted after `REAP_EMPTY_SECONDS` (60s),
  1 connected → after `REAP_SOLO_SECONDS` (600s). Any new timer (e.g. the turn timer) must
  share that one alarm — set it to the earliest deadline and have `alarm()` dispatch — rather
  than calling `setAlarm` independently, or the two will overwrite each other.
- After any event that can change who is connected (join, close), call `updateReaper(room)`
  before saving.

## Layout

- `src/` — Worker entry (`index.ts`, HTTP routing) and the `GameRoom` Durable Object.
- `shared/` — card definitions, starter decks, WebSocket protocol types.
- `client/` — browser TypeScript, bundled by esbuild into `public/main.js` (not committed).
- `public/` — static assets served by the same Worker.

## Commands

- `npm run dev` — build the client and run `wrangler dev` (http://localhost:8787)
- `npm run check` — typecheck server, shared and client code
- `npm run test:e2e` — protocol test against a running `npm run dev` (or pass a live URL)
- `npm run dev:reap` + `npm run test:reap` — reaping test against a dev server with 2s/4s timings
- `npx wrangler types` — regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc`

## Git workflow

- Commit frequently, in small logical steps.
- All feature work goes on a branch and is merged into `main` via a GitHub PR
  (github.com/kyang0617/shayken). Don't push feature commits directly to `main`.

## Roadmap

- **Stage 1 (current):** create room → room code; two players join by code over WebSocket;
  secret player tokens; server shuffles fixed starter decks and deals hands; each screen shows
  own hand and opponent's card count. No turns, combat, or rules.
- **Later:** turn state machine, the potion/throw mechanic, card effects, turn timer,
  deckbuilding, lobby, reconnect handling.
