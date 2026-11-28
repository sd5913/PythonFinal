# Online test deployment

First published: 28 November 2026.

- URL: https://pythonfinal-online.ruiyixuan2.workers.dev
- Worker: pythonfinal-online
- Source commit: 9034463812c28af56ee8d86c5d6198dacf0aa2df
- Cloudflare version: 4ea16b04-5c53-4273-a7e5-f5a45dbdd179
- Production configuration is local and Git-ignored. GitHub Client Secret is stored as a Worker secret; its temporary upload file was deleted. No credentials are committed.
- D1 schema migration 0001_online.sql applied to the dedicated remote database. RoomObject uses SQLite-backed Durable Objects.

## Verified on the actual public URL

- Homepage: HTTP 200.
- /health: HTTP 200, status ok.
- /api/online: HTTP 200, online mode with no authenticated user before sign-in.
- All three rulebook pages, visual-effects/effects.js and i18n.js: HTTP 200.
- /api/auth/github: HTTP 302 to github.com, correct production callback and S256 PKCE.

## Next acceptance checks

The source integration's local tests remain separate evidence (see v3-cloud-integration.md). The following still require real users on the deployed service:

1. Complete real GitHub OAuth in the browser and return to the online lobby. An authorization redirect alone does not verify the Client Secret exchange.
2. Create a room and share the invitation with a second GitHub account on another device/network.
3. Verify readiness, private roles, deployment and a full V3 turn/event sequence.
4. Verify reload/reconnect, concurrent independent rooms and production runtime/quota behavior.

Do not treat the first published version as a completed multiplayer acceptance run. Do not commit .dev.vars or wrangler.production.json.
