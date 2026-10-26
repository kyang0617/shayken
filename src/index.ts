import type { CreateRoomResponse } from "../shared/protocol";
import { randomRoomCode, ROOM_CODE_PATTERN } from "./random";

export { GameRoom } from "./game-room";

// The Worker is a thin, stateless router. It owns no game state: it just finds the right
// GameRoom Durable Object for a room code and hands the request over. Static files in
// `public/` are served by the assets layer before this code runs; only `/api/*` reaches here.

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/rooms" && request.method === "POST") {
			return createRoom(env);
		}

		const wsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
		if (wsMatch && request.method === "GET") {
			const code = wsMatch[1].toUpperCase();
			if (!ROOM_CODE_PATTERN.test(code)) return new Response("Invalid room code", { status: 400 });
			// `getByName` always maps the same code to the same object, anywhere in the world.
			return env.GAME_ROOM.getByName(code).fetch(request);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

async function createRoom(env: Env): Promise<Response> {
	// 32^6 ≈ 1 billion codes, so collisions are rare — but the room itself is the only place
	// that knows whether a code is taken, so we ask it and retry on a clash.
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = randomRoomCode();
		if (await env.GAME_ROOM.getByName(code).create(code)) {
			return Response.json({ code } satisfies CreateRoomResponse);
		}
	}
	return new Response("Could not allocate a room code", { status: 503 });
}
