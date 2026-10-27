// End-to-end protocol + game-flow test: plays two (and a few hostile) clients against a
// running dev server. Start `npm run dev` first, then `npm run test:e2e [base-url]`.
import { BASE, check, client, createRoom, finish, join } from "./helpers.mjs";

const html = await fetch(BASE + "/").then((r) => r.text());
check(html.includes("Shayken"), "index.html served");
check((await fetch(BASE + "/main.js")).ok, "main.js bundle served");

const { code } = await fetch(BASE + "/api/rooms", { method: "POST" }).then((r) => r.json());
check(/^[A-Z2-9]{6}$/.test(code), `room created: ${code}`);

const a = client(code); await a.open; a.ws.send(JSON.stringify({ type: "join" }));
await a.until((c) => c.last("state"));
check(a.last("joined").seat === 0, "A gets seat 0");
check(a.last("state").view.status === "waiting" && a.last("state").view.opponent === null, "A sees waiting, no opponent");

const b = client(code.toLowerCase()); await b.open; b.ws.send(JSON.stringify({ type: "join" }));
await b.until((c) => c.last("state")?.view.status === "playing");
await a.until((c) => c.last("state")?.view.status === "playing");
const av = a.last("state").view, bv = b.last("state").view;
check(b.last("joined").seat === 1, "B gets seat 1 (lowercase code accepted)");
check(av.opponent.connected && bv.opponent.connected, "both see each other connected");
check(a.last("joined").token !== b.last("joined").token, "tokens differ");
const aRaw = JSON.stringify(a.msgs);
const bHand = bv.you.hand.map((c) => c.iid);
check(!bHand.some((iid) => aRaw.includes(`"${iid}"`)) && !aRaw.includes(b.last("joined").token), "A never receives B's hand or token");
check(!("deck" in av.you) && !("hand" in av.opponent) && av.opponent.handCount === bHand.length, "no deck contents; opponent hand is a count only");

const c3 = client(code); await c3.open; c3.ws.send(JSON.stringify({ type: "join" }));
await c3.until((c) => c.closed !== null);
check(c3.last("error")?.code === "ROOM_FULL" && c3.closed === 4002, "third player rejected ROOM_FULL");

const bad = client(code); await bad.open; bad.ws.send(JSON.stringify({ type: "join", token: "nope" }));
await bad.until((c) => c.closed !== null);
check(bad.last("error")?.code === "BAD_TOKEN", "unknown token rejected");

const a2 = client(code); await a2.open; a2.ws.send(JSON.stringify({ type: "join", token: a.last("joined").token }));
await a2.until((c) => c.last("state"));
await a.until((c) => c.closed !== null);
check(a2.last("joined").seat === 0, "A reconnects with token to seat 0");
check(JSON.stringify(a2.last("state").view.you.hand) === JSON.stringify(av.you.hand), "A's hand persisted");
check(a.closed === 4001, "old A connection replaced (4001)");

b.ws.send("not json"); b.ws.send(JSON.stringify({ type: "join", token: 5 }));
await b.until((c) => c.msgs.filter((m) => m.code === "BAD_MESSAGE").length >= 2);
check(true, "malformed messages get BAD_MESSAGE");

a2.ws.close();
await b.until((c) => c.last("state")?.view.opponent.connected === false);
check(true, "B sees opponent disconnected");

const ghost = client("ZZZZZZ"); await ghost.open; ghost.ws.send(JSON.stringify({ type: "join" }));
await ghost.until((c) => c.closed !== null);
check(ghost.last("error")?.code === "ROOM_NOT_FOUND", "unknown room rejected");
check((await fetch(BASE + "/api/rooms/bad!/ws")).status === 400, "invalid code format -> 400");

b.ws.close();

// ---- Game flow: a fresh room, played over real sockets ----

/** Send a message and wait for the next state (or error) the sender receives. */
async function act(c, msg, ms = 3000) {
  const before = c.msgs.length;
  c.ws.send(JSON.stringify(msg));
  await c.until((c) => c.msgs.slice(before).some((m) => m.type === "state" || m.type === "error"), ms);
  return c.msgs.slice(before).find((m) => m.type === "state" || m.type === "error");
}
const view = (c) => c.last("state").view;

const g = await createRoom();
const p0 = await join(g);
const p1 = await join(g);
await p0.until((c) => view(c).status === "playing");
await p1.until((c) => view(c).status === "playing");
const first = view(p0).turn.seat;
const active = first === 0 ? p0 : p1, idle = first === 0 ? p1 : p0;

check(view(active).turn.number === 1 && view(active).turn.msLeft > 0, "match starts on turn 1 with a running timer");
check(view(active).you.hand.length === 5 && view(active).you.essence === 3, "first player drew 5 and has 3 essence");
check(view(idle).you.hand.length === 0 && view(idle).you.health === 20, "other player waits with no hand, 20 health");

const someIid = view(active).you.hand[0].iid;
check((await act(idle, { type: "endTurn" })).code === "NOT_YOUR_TURN", "inactive player can't end the turn");
check((await act(idle, { type: "playCard", iid: someIid })).code === "NOT_YOUR_TURN", "inactive player can't play cards");
check((await act(active, { type: "playCard", iid: "p9-99" })).code === "CARD_NOT_IN_HAND", "can't play a card you don't hold");
check((await act(active, { type: "playCard", iid: 7 })).code === "BAD_MESSAGE", "playCard with a non-string iid is rejected");

// Every starter card costs <= 3, so the first card is always affordable on turn 1.
const played = await act(active, { type: "playCard", iid: someIid });
check(played.type === "state" && !played.view.you.hand.some((c) => c.iid === someIid), "playing a card removes it from hand");
check((await act(active, { type: "playCard", iid: someIid })).code === "CARD_NOT_IN_HAND", "can't play the same card twice");
await idle.until((c) => {
  const o = view(c).opponent;
  return o.brew.some((x) => x.iid === someIid) || o.powers.some((x) => x.iid === someIid) || o.discardCount > 0;
});
check(true, "opponent sees the played card land in brew, powers or discard");

const ended = await act(active, { type: "endTurn" });
check(ended.view.turn.seat !== first && ended.view.turn.number === 2 && ended.view.you.hand.length === 0, "end turn passes play and discards the hand");
await idle.until((c) => view(c).turn.seat !== first);
check(view(idle).you.hand.length >= 5 && view(idle).you.essence === 3, "second player drew and gained essence");

// ---- Throwing (second player's turn) ----
check((await act(idle, { type: "endTurn", throw: true })).code === "EMPTY_BREW", "throwing an empty brew is rejected");
check((await act(idle, { type: "endTurn", throw: "yes" })).code === "BAD_MESSAGE", "non-boolean throw flag is rejected");

// Play cards until something lands in the brew. Card types live in TS, so just try each card.
for (const c of [...view(idle).you.hand]) {
  const res = await act(idle, { type: "playCard", iid: c.iid });
  if (res.type === "state" && res.view.you.brew.length > 0) break;
}
const brewed = view(idle).you.brew.length;
if (brewed === 0) {
  console.log("SKIP throw checks: no ingredient was playable this hand (rare)");
} else {
  const discardBefore = view(idle).you.discardCount;
  const thrown = await act(idle, { type: "endTurn", throw: true });
  const t = thrown.view.lastThrow;
  check(t && t.seat === view(idle).you.seat && t.cards.length === brewed, "throw is recorded with its ingredients");
  check(thrown.view.opponent.health === 20 - t.damage, `opponent loses exactly the thrown damage (${t.damage})`);
  check(thrown.view.you.brew.length === 0 && thrown.view.you.discardCount >= discardBefore + brewed, "thrown brew empties into the discard pile");
  check(thrown.view.turn.seat === first, "throwing also ends the turn");
  await active.until((c) => view(c).lastThrow !== null);
  check(view(active).you.health === 20 - t.damage && view(active).lastThrow.damage === t.damage, "target sees the hit and the throw record");
}

// Concede off-turn: if the throw happened it's the first player's turn again; either way the
// second player concedes.
const conceded = await act(idle, { type: "concede" });
check(conceded.view.status === "finished" && conceded.view.winner === view(active).you.seat, "conceding ends the match");
await active.until((c) => view(c).status === "finished");
check((await act(active, { type: "endTurn" })).code === "NOT_PLAYING", "no actions after the match ends");
p0.ws.close(); p1.ws.close();

finish();
