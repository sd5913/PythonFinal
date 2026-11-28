# V3 cloud integration — local acceptance

Integration date: 28 November 2026.

Sources: V3 `1ad03c288bf2991d3630082849c5239af188801f` and professor's Cloudflare draft `90295fc5b256e2e4e2e5f479e640a68ca0779577`.

## Integrated behavior

- Both transports run the same V3 rules: combat, scans, stepwise movement, cards, fragments, droplet rounds, ground resources and elimination.
- OnlineRoom serializes the entire V3 continuation, including pending card/collision/check state, movement lanes and next deadline. Its runtime-only progress_task remains None; Durable Object alarms drive progress instead of the LAN server's asyncio task.
- Durable Object alarms use the earlier of game deadlines and seat/room expiry. Due game actions advance on alarm or the next room request, persist, then broadcast filtered snapshots. Restart does not require a player command to restart the clock.
- Staged Worker assets preserve the same /static and /visual-effects paths as LAN. The bundle includes card art, FX, audio, all three rulebook pages and bilingual UI.
- Original private ship classes and ammo filtering remain in place. Online-specific login, invite and reconnect text is localized.
- Capped cloud logs retain increasing IDs, and the console follows the newest ID even after its 200-entry cap is reached.

## Local verification completed

1. `python -m pytest -q`: **74 passed**. This includes existing LAN/V3 regressions, professor's authentication/room tests and new tests that save/reload at every V3 event deadline. Draw resolution still resumes the correct remaining movement; 4D retention, droplet movement/black domains and exit/reset survive the online room lifecycle.
2. `npm ci`, then `npm run test:worker`: real local Wrangler/workerd with local D1 and mock GitHub. Verified OAuth state/PKCE, access control, independent rooms, private snapshots, disconnect/reconnect, Worker restart persistence and logout revocation. Also verified V3 automatic droplet spawn, fragment spawn, battle intro, radial shift, forward movement and complete asset routes.
3. Optional browser extension to the same Worker test: Chromium desktop/mobile verified authenticated lobby, invitations, reload recovery, three-page rulebook and Chinese/English switching, with no page errors or failed static assets.
4. Separate local FastAPI instance: HTTP and two independent WebSocket clients verified create/join/readiness synchronization. Browser checked V3 event screens and rulebook/locale controls at 1366x768, 1920x1080 and 768x1024.

The test harness only creates temporary local databases. It starts no production deployment and uses no real OAuth credentials.

## Reproduce

```sh
python -m pytest -q
npm ci
npm run test:worker
```

For the optional browser checks, install Playwright and its Chromium (or Chrome) runtime, set PLAYWRIGHT_MODULE to an importable module/file URL and run the Worker test. The bundled validation used installed Chrome. The standard Worker test does not require Playwright.

For manual local Worker use with real GitHub sign-in, follow [online.md](online.md). `npm run dev` prepares assets automatically. Before direct `npx wrangler dev` or `npx wrangler deploy`, first run `npm run assets`. Each test run also prepares assets itself. Windows test cleanup terminates only its own spawned Wrangler process tree.

## Remaining production acceptance

- Team Cloudflare account, D1 and production OAuth credentials have not been configured here.
- No public deployment or real GitHub sign-in is claimed. Local mock login is distinct from production OAuth.
- Verify hosted alarms, restart/hibernation recovery, quota/cost behavior and two devices on different networks after deployment. Include a full V3 playtest covering collision, combat, cards, fragment teleport and droplet collisions.
- Keep the current rules unchanged until the team specifies the next gameplay corrections. The professor's PR and main branch have not been merged remotely by this integration task.
