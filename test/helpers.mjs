// Shared helpers for the end-to-end tests: a scripted WebSocket player and pass/fail reporting.

export const BASE = process.argv[2] ?? "http://localhost:8787";
const WS = BASE.replace("http", "ws");

let failures = 0;
export const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"} ${label}`); if (!cond) failures++; };
export const finish = () => { console.log(failures ? `${failures} FAILED` : "ALL PASSED"); process.exit(failures ? 1 : 0); };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createRoom() {
  const { code } = await fetch(BASE + "/api/rooms", { method: "POST" }).then((r) => r.json());
  return code;
}

export function client(code) {
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

/** Connect and join (optionally with a token); resolves once the join is answered. */
export async function join(code, token) {
  const c = client(code);
  await c.open;
  c.ws.send(JSON.stringify({ type: "join", token }));
  await c.until((c) => c.last("state") || c.closed !== null);
  return c;
}
