// End-to-end protocol test: plays two (and a few hostile) clients against a running dev
// server. Start `npm run dev` first, then `npm run test:e2e [base-url]`.
const BASE = process.argv[2] ?? "http://localhost:8787";
const WS = BASE.replace("http", "ws");
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"} ${label}`); if (!cond) failures++; };

function client(code) {
  const ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  const c = { ws, msgs: [], closed: null, waiters: [] };
  ws.onmessage = (e) => { c.msgs.push(JSON.parse(e.data)); c.waiters.forEach((w) => w()); };
  ws.onclose = (e) => { c.closed = e.code; c.waiters.forEach((w) => w()); };
  c.open = new Promise((r) => (ws.onopen = r));
  c.until = (pred, ms = 3000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), ms);
    const w = () => { if (pred(c)) { clearTimeout(t); res(); } };
    c.waiters.push(w); w();
  });
  c.last = (type) => [...c.msgs].reverse().find((m) => m.type === type);
  return c;
}

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
await b.until((c) => c.last("state")?.view.status === "dealt");
await a.until((c) => c.last("state")?.view.status === "dealt");
const av = a.last("state").view, bv = b.last("state").view;
check(b.last("joined").seat === 1, "B gets seat 1 (lowercase code accepted)");
check(av.you.hand.length === 5 && av.you.deckCount === 15, "A has 5 in hand, 15 in deck");
check(av.opponent.handCount === 5 && av.opponent.connected, "A sees opponent: 5 cards, connected");
check(a.last("joined").token !== b.last("joined").token, "tokens differ");
const aRaw = JSON.stringify(a.msgs);
check(!aRaw.includes("p1-") && !aRaw.includes(b.last("joined").token), "A never receives B's cards or token");
check(!("deck" in av.you) && !("hand" in av.opponent), "no deck contents / opponent hand in view");

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
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);
