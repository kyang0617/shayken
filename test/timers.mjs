// Timer tests (turn timer + room reaping). Needs a dev server with tiny timings:
//   npm run dev:fast        (REAP_EMPTY_SECONDS=2, REAP_SOLO_SECONDS=4, TURN_SECONDS=3)
//   npm run test:timers
// Scenarios run in parallel, each in its own room, so the whole test takes ~8s. Turn and
// reap deadlines share one Durable Object alarm, so running them together also checks that
// neither overwrites the other.
import { check, createRoom, finish, join, sleep } from "./helpers.mjs";

const EMPTY_MS = 2000;
const SOLO_MS = 4000;
const TURN_MS = 3000;
const SLACK_MS = 2500; // alarms aren't to-the-millisecond

async function neverJoined() {
  const code = await createRoom();
  await sleep(EMPTY_MS + SLACK_MS);
  const a = await join(code);
  check(a.last("error")?.code === "ROOM_NOT_FOUND", "room nobody joined is reaped after the empty grace");
}

async function soloPlayer() {
  const code = await createRoom();
  const a = await join(code);
  await sleep(SOLO_MS - 1500);
  check(a.closed === null, "solo player still connected before the solo timeout");
  await a.until((c) => c.closed !== null, 1500 + SLACK_MS);
  check(a.last("error")?.code === "ROOM_EXPIRED" && a.closed === 4003, "solo player is told ROOM_EXPIRED and closed (4003)");
  const again = await join(code, a.last("joined").token);
  check(again.last("error")?.code === "ROOM_NOT_FOUND", "expired room is gone");
}

async function bothLeave() {
  const code = await createRoom();
  const a = await join(code);
  const b = await join(code);
  a.ws.close(); b.ws.close();
  await sleep(EMPTY_MS + SLACK_MS);
  const back = await join(code, a.last("joined").token);
  check(back.last("error")?.code === "ROOM_NOT_FOUND", "room is reaped once both players leave");
}

async function refreshWithinGrace() {
  const code = await createRoom();
  const a = await join(code);
  const b = await join(code);
  a.ws.close(); b.ws.close();
  await sleep(500);
  const a2 = await join(code, a.last("joined").token);
  const b2 = await join(code, b.last("joined").token);
  check(a2.last("joined")?.seat === 0 && b2.last("joined")?.seat === 1, "both reconnect within the grace period");
  await sleep(SOLO_MS + SLACK_MS);
  check(a2.closed === null && b2.closed === null, "room with both players connected is never reaped");
  a2.ws.close(); b2.ws.close();
}

async function opponentReturns() {
  const code = await createRoom();
  const a = await join(code);
  const b = await join(code);
  b.ws.close();
  await sleep(SOLO_MS / 2);
  const b2 = await join(code, b.last("joined").token); // cancels the solo countdown
  await sleep(SOLO_MS / 2 + SLACK_MS);
  check(a.closed === null && b2.closed === null, "opponent returning cancels the solo countdown");
  a.ws.close(); b2.ws.close();
}

async function turnTimer() {
  const code = await createRoom();
  const a = await join(code);
  const b = await join(code);
  await a.until((c) => c.last("state")?.view.status === "playing");
  const first = a.last("state").view.turn.seat;
  const active = first === 0 ? a : b;
  check(active.last("state").view.you.hand.length === 5, "first player has a hand before the timer runs out");
  await a.until((c) => c.last("state").view.turn?.number === 2, TURN_MS + SLACK_MS);
  check(a.last("state").view.turn.seat !== first, "turn auto-passes when the timer runs out");
  check(active.last("state").view.you.hand.length === 0, "timed-out player's hand is discarded");
  await a.until((c) => c.last("state").view.turn?.number === 3, TURN_MS + SLACK_MS);
  check(a.last("state").view.turn.seat === first, "timer keeps running on the following turn");
  a.ws.close(); b.ws.close();
}

await Promise.all([neverJoined(), soloPlayer(), bothLeave(), refreshWithinGrace(), opponentReturns(), turnTimer()]);
finish();
