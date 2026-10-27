# Shayken

A 2-player online card battler, built as a learning project. Browser frontend; backend is
Cloudflare Workers + Durable Objects on the **free plan**. Explain key server-side decisions
when making changes — the owner wants to understand the code, not just have it.

## Game design

**Decided** (implemented in `src/rules.ts`, numbers in `shared/rules.ts`):
- Quick (~10 min) 1v1 matches. 20 health each; reduce the opponent to 0 to win, or they concede.
- 20-card fixed starter deck (same for both players). First player is a server-side coin flip.
- Turns have no sub-phases: at turn start you draw 5 and gain 3 essence, then play any cards
  you can afford, then end your turn (or the 60s timer ends it). Spire-style hand: unplayed
  cards are discarded at end of turn; when the deck runs out, the discard pile is reshuffled.
- Essence ("the resource") accumulates: unspent essence carries over, no cap.
- Card types, inspired by deckbuilder roguelikes (don't copy any specific game's cards):
  - **attack** — goes into your brew as an ingredient.
  - **skill** — immediate effect (gain essence, draw), then discarded; may also go into the brew.
  - **power** — stays active for the rest of the match (per-turn bonuses).
- Theme: drinks/potions. The brew is the potion you're building. Both brews are fully visible
  to both players.
- **Throwing:** only when ending your turn — "end turn (hold)" or "throw & end turn". Throwing
  an empty brew is rejected. A turn that times out holds the brew. Each ingredient's `onThrow`
  effects resolve; the brew then goes to the discard pile (so it cycles back into the deck).
  Damage reduces the opponent's health; at 0 the thrower wins.
- **Throw damage: order matters.** Ingredients resolve in the order they were added, against a
  running total: `damage` adds; `damagePerIngredient` adds amount × the ingredient's 1-based
  position; `multiplyDamage` multiplies the total so far (later ingredients aren't affected).
  One implementation, `shared/brew.ts` `brewDamage`, used by the server to resolve and by the
  client to preview — never reimplement it. Brew arrays must stay in insertion order.
- **Holding a brew is rewarded only by catalyst cards** (e.g. Distillate: +1 per ingredient;
  Philosopher's Salt: ×2), not by a built-in size bonus.

**Undecided — do not invent without asking:** defense/blocking, any damage outside throwing,
disruption of the opponent's brew, card numbers/balance, tiers, deckbuilding. Card
definitions and numbers are placeholders.

## Architecture rules (decided — follow these)

- One `GameRoom` Durable Object per match. It is the single source of truth.
- Never trust the client: every action is validated server-side. The server rejects anything
  not legal in the current state/phase.
- Hidden information: the server holds full state and sends each player only their own view
  (own hand; opponent's hand count only; never deck order).
- All shuffling and randomness happen on the server, using `crypto.getRandomValues`.
- Cards are data, not code: definitions live in `shared/cards.ts` as typed `Effect` lists;
  `src/rules.ts` interprets them. A new card should need no new code unless it needs a new
  `Effect` kind.
- Rules are pure functions over `RoomState` (`src/rules.ts`, unit-tested in `test/unit/`).
  They return `{ ok: false, code }` without mutating state when an action is illegal.
  `GameRoom` only does I/O: identify the sender by socket attachment, call the rule,
  persist, broadcast.
- Client messages express intent (`playCard { iid }`), never outcomes.
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
- Three deadlines share the one alarm: the turn timer (`room.turn.endsAt`, `TURN_SECONDS` = 60),
  room reaping (`room.reap.at`; 0 joined players connected → `REAP_EMPTY_SECONDS` = 60,
  1 connected → `REAP_SOLO_SECONDS` = 600), and post-match expiry (`room.expiresAt`, set once
  in `persist()` when the match finishes → `REAP_FINISHED_SECONDS` = 300, even if both stay). `syncAlarm` sets the alarm to the earliest
  deadline; `alarm()` handles whichever are due. A new timer = a new deadline field in state,
  added to `syncAlarm` and `alarm()`. Never call `setAlarm` anywhere else.
- Always save through `persist(room)`: it refreshes the reap deadline and re-arms the alarm.

## Layout

- `src/` — Worker entry (`index.ts`), `GameRoom` Durable Object (`game-room.ts`), rules engine
  (`rules.ts`), state types (`state.ts`), randomness (`random.ts`).
- `shared/` — card definitions, starter deck, rule constants, WebSocket protocol types.
- `test/unit/` — vitest unit tests for the rules; `test/*.mjs` — end-to-end socket tests.
- `client/` — browser TypeScript, bundled by esbuild into `public/main.js` (not committed).
- `public/` — static assets served by the same Worker.

## Commands

- `npm run dev` — build the client and run `wrangler dev` (http://localhost:8787)
- `npm run check` — typecheck server, shared and client code
- `npm test` — rules unit tests (no server needed)
- `npm run test:e2e` — protocol + game-flow test against a running `npm run dev` (or pass a live URL)
- `npm run dev:fast` + `npm run test:timers` — turn-timer, reaping and post-match expiry test with short timings
- `npx wrangler types` — regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc`

## Git workflow

- Commit frequently, in small logical steps.
- All feature work goes on a branch and is merged into `main` via a GitHub PR
  (github.com/kyang0617/shayken). Don't push feature commits directly to `main`.

## Roadmap

- **Done:** rooms by code, secret tokens, per-player views, hibernation, room reaping;
  turn loop (draw / play / end turn), essence, attack/skill/power cards, brew and powers,
  turn timer, concede; throwing the brew, damage and winning.
- **Next:** playtest; then decide what else cards should do (see Undecided) and balance.
- **Later:** client auto-reconnect, deckbuilding, more cards/tiers, lobby, auto-deploy.
