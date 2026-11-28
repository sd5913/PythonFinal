import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {once} from "node:events";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {fileURLToPath} from "node:url";
import WebSocket from "ws";
import './prepare-assets.mjs';

const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const origin = "http://127.0.0.1:" + port;
const scratch = await mkdtemp(join(tmpdir(), "pythonfinal-test-"));
const configPath = join(scratch, "wrangler.json");
const config = JSON.parse(await readFile(join(root, "wrangler.json"), "utf8"));
config.main = join(root, config.main);
config.assets.directory = join(root, config.assets.directory);
config.d1_databases[0].migrations_dir = join(root, config.d1_databases[0].migrations_dir);
config.vars = {APP_URL: origin, GITHUB_CLIENT_ID: "fixture-id", GITHUB_CLIENT_SECRET: "fixture-secret"};
config.services = [{binding: "GITHUB_TEST", service: "pythonfinal-github-fixture"}];
delete config.triggers;
const providerPath = join(scratch, "github-fixture.json");
const provider = JSON.parse(await readFile(join(root, "tests/fixtures/wrangler.json"), "utf8"));
provider.main = join(root, "tests/fixtures", provider.main);
const env = {...process.env, NODE_ENV: "test", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_INCLUDE_PROCESS_ENV: "false"};
const childOptions = {cwd: scratch, env, windowsHide: true};
let server, logs = "";
const watchdog = setTimeout(() => { if (server && server.exitCode === null) server.kill(); }, 180000);
const sockets = new Set();

async function start() {
  logs = "";
  server = spawn(process.execPath, [wrangler, "dev", "--local", "--ip", "127.0.0.1",
    "--port", String(port), "--persist-to", scratch, "--log-level", "warn",
    "--config", configPath, "--config", providerPath], childOptions);
  server.stdout.on("data", (chunk) => { logs = (logs + chunk).slice(-16000); });
  server.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-16000); });
  for (let tries = 0; tries < 100; tries++) {
    if (server.exitCode !== null) break;
    try {
      const health = await fetch(origin + "/health", {signal: AbortSignal.timeout(700)});
      if (health.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error("Local Worker did not become ready.");
}

async function stop() {
  for (const ws of sockets) ws.terminate();
  sockets.clear();
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const closed = once(server, "exit");
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {windowsHide:true,stdio:'ignore'}); }
    catch { server.kill(); }
  } else server.kill();
  const timer = setTimeout(() => server.kill("SIGKILL"), 3000);
  try { await closed; } finally { clearTimeout(timer); }
}

function request(path, {method = "GET", cookie, data, from = origin} = {}) {
  const headers = {Origin: from};
  if (cookie) headers.Cookie = cookie;
  if (data !== undefined) headers["Content-Type"] = "application/json";
  return fetch(origin + path, {
    method, headers, body: data === undefined ? undefined : JSON.stringify(data),
    redirect: "manual", signal: AbortSignal.timeout(5000),
  });
}

async function verify(responsePromise, status) {
  const response = await responsePromise;
  assert.equal(response.status, status, await response.clone().text());
  return response;
}

async function login(who, checkState = false) {
  const start = await verify(request("/api/auth/github"), 302);
  assert.equal(start.headers.get("referrer-policy"), "no-referrer");
  const authorization = new URL(start.headers.get("location"));
  assert.equal(authorization.origin, "https://github.com");
  assert.equal(authorization.searchParams.get("scope"), "");
  assert.equal(authorization.searchParams.get("redirect_uri"), origin + "/api/auth/github/callback");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  const browserCookie = start.headers.getSetCookie()[0].split(";", 1)[0];
  const state = authorization.searchParams.get("state");
  const challenge = authorization.searchParams.get("code_challenge");
  const callback = "/api/auth/github/callback?" + new URLSearchParams({
    state, code: who + "." + challenge, next: "https://example.invalid/",
  });
  if (checkState) {
    const wrong = await verify(request(callback), 303);
    assert.equal(wrong.headers.get("location"), "/?login=failed");
    const mismatched = await verify(request(callback.replace(state, "Z".repeat(43)), {cookie: browserCookie}), 303);
    assert.equal(mismatched.headers.get("location"), "/?login=failed");
  }
  const signed = await verify(request(callback, {cookie: browserCookie}), 303);
  assert.equal(signed.headers.get("location"), "/");
  const session = signed.headers.getSetCookie().find((value) => value.startsWith("pf_session="));
  assert.match(session, /^pf_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200$/);
  if (checkState) {
    const replay = await verify(request(callback, {cookie: browserCookie}), 303);
    assert.equal(replay.headers.get("location"), "/?login=failed");
  }
  return session.split(";", 1)[0];
}

async function openSocket(room, cookie, from = origin) {
  const ws = new WebSocket(origin.replace("http:", "ws:") + "/ws/" + room, {
    headers: cookie ? {Cookie: cookie} : {}, origin: from, handshakeTimeout: 5000,
  });
  sockets.add(ws);
  ws.on("error", () => {});
  ws.queue = [];
  ws.on("message", (data) => ws.queue.push(JSON.parse(data)));
  await once(ws, "open");
  return ws;
}

async function rejectSocket(room, cookie, from, status) {
  const ws = new WebSocket(origin.replace("http:", "ws:") + "/ws/" + room, {
    headers: cookie ? {Cookie: cookie} : {}, origin: from, handshakeTimeout: 5000,
  });
  ws.on("error", () => {});
  const [req, response] = await once(ws, "unexpected-response");
  assert.equal(response.statusCode, status);
  req.destroy();
}

async function next(ws, predicate) {
  for (let tries = 0; tries < 1000; tries++) {
    const found = ws.queue.findIndex(predicate);
    if (found >= 0) return ws.queue.splice(found, 1)[0];
    await delay(40);
  }
  throw new Error("Timed out waiting for room state or error.");
}
const state = (ws, predicate) => next(ws, (msg) => msg.type === "room_state" && predicate(msg));
const send = (ws, type, extra = {}) => ws.send(JSON.stringify({type, ...extra}));
const crew = (snapshot, id) => snapshot.game?.crews.find((row) => row.id === id);

try {
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(providerPath, JSON.stringify(provider));
  execFileSync(process.execPath, [wrangler, "d1", "migrations", "apply", "DB",
    "--local", "--persist-to", scratch, "--config", configPath], {...childOptions, stdio: "inherit"});
  await start();
  const page = await verify(request("/"), 200);
  assert.match(await page.text(), /id="accept-invite"/);
  const client = await verify(request("/static/app.js?v=5"), 200);
  assert.match(await client.text(), /async function boot/);
  for (const asset of ['/visual-effects/effects.js','/visual-effects/assets/droplet.png',
    '/static/i18n.js','/static/reference.js','/static/rulebook/page-1.png',
    '/static/rulebook/page-2.png','/static/rulebook/page-3.png','/static/assets/nebula-back.png']) {
    await verify(request(asset),200);
  }
  await verify(request("/api/rooms", {method: "POST"}), 401);
  const canceled = await verify(request("/api/auth/github"), 302);
  const authorize = new URL(canceled.headers.get("location"));
  const canceledState = authorize.searchParams.get("state");
  const canceledCookie = canceled.headers.getSetCookie()[0].split(";", 1)[0];
  const callbackPath = "/api/auth/github/callback?state=" + canceledState;
  await verify(request(callbackPath + "&error=access_denied", {cookie: canceledCookie}), 303);
  const code = "beta." + authorize.searchParams.get("code_challenge");
  const rejected = await verify(request(callbackPath + "&code=" + code, {cookie: canceledCookie}), 303);
  assert.equal(rejected.headers.get("location"), "/?login=failed");
  const beta = await login("beta");
  const alpha = await login("alpha", true);
  const gamma = await login("gamma");
  assert.deepEqual(await (await verify(request("/api/online", {cookie: alpha}), 200)).json(),
    {mode: "online", user: {login: "flight-alpha"}});
  await verify(request("/api/rooms", {method: "POST", cookie: alpha, from: "https://elsewhere.test"}), 403);
  await verify(request("/api/rooms", {method: "POST", cookie: alpha, from: ""}), 403);
  const create = async (cookie) => (await verify(request("/api/rooms", {method: "POST", cookie}), 201)).json();
  const a = await create(alpha);
  const c = await create(gamma);
  assert.notEqual(a.room_code, c.room_code);
  assert.deepEqual(Object.keys(a).sort(), ["player_id", "room_code"]);
  const endpoint = "/api/rooms/" + a.room_code;
  await verify(request(endpoint, {cookie: beta}), 403);
  await verify(request(endpoint + "/leave", {method: "POST", cookie: beta}), 403);
  await rejectSocket(a.room_code, undefined, origin, 401);
  await rejectSocket(a.room_code, beta, origin, 403);
  await rejectSocket(a.room_code, alpha, "https://elsewhere.test", 403);
  const share = await verify(request(endpoint + "/invite", {method: "POST", cookie: alpha}), 200);
  const {invite} = await share.json();
  assert.match(invite, /^[\w-]{43}$/);
  await verify(request("/api/invitations/join", {method: "POST", cookie: beta, data: {invite: "0".repeat(43)}}), 404);
  const joinRoom = async () => (await verify(request("/api/invitations/join", {
    method: "POST", cookie: beta, data: {invite},
  }), 201)).json();
  await verify(request("/api/invitations/join", {method: "POST", cookie: beta}), 415);
  const b = await joinRoom();
  assert.deepEqual(b, await joinRoom());
  await verify(request(endpoint + "/invite", {method: "POST", cookie: beta}), 403);

  const [wa, wb, wc] = await Promise.all([openSocket(a.room_code, alpha),
    openSocket(b.room_code, beta), openSocket(c.room_code, gamma)]);
  await state(wa, (s) => s.players.length === 2 && s.players.every((p) => p.connected));
  await state(wc, (s) => s.players.length === 1 && s.players[0].id === c.player_id);
  send(wa, "set_ready", {ready: true});
  send(wb, "set_ready", {ready: true});
  await state(wa, (s) => s.players.every((p) => p.ready));
  send(wb, "start_game");
  await next(wb, (m) => m.type === "error");
  send(wa, "start_game");
  await state(wb, (s) => s.game?.phase === "fleet");
  send(wa, "choose_fleet", {fleet: "blue"});
  send(wb, "choose_fleet", {fleet: "red"});
  await state(wa, (s) => s.game?.fleet_valid);
  send(wa, "begin_deployment");
  await state(wa, (s) => s.game?.phase === "roles");
  send(wa, "set_roles", {roles: ["attack", "attack", "scout", "scout", "mothership"]});
  const original = await state(wa, (s) => crew(s, a.player_id)?.roles_ready);
  const opponent = await state(wb, (s) => s.game && crew(s, a.player_id)?.roles_ready);
  assert.equal(crew(original, a.player_id).ships[0].role, "attack");
  assert.equal(Object.hasOwn(crew(opponent, a.player_id).ships[0], "role"), false);
  assert.equal(JSON.stringify(opponent).includes(invite), false);
  assert.equal(JSON.stringify(opponent).includes("fixture-access"), false);
  assert.equal(wc.queue.some((s) => s.game || s.room_code === a.room_code), false);

  wa.close(1000);
  await state(wb, (s) => s.game && s.players.some((p) => p.id === a.player_id && !p.connected));
  const resumed = await openSocket(a.room_code, alpha);
  const reconnected = await state(resumed, (s) => s.game?.phase === "roles");
  assert.equal(crew(reconnected, a.player_id).ships[0].role, "attack");
  await stop();
  await start();
  const restarted = await openSocket(a.room_code, alpha);
  const persisted = await state(restarted, (s) => s.game?.phase === "roles");
  assert.equal(crew(persisted, a.player_id).ships[0].role, "attack");
  const after = await openSocket(b.room_code, beta);
  await state(after, (s) => s.game?.phase === "roles");
  send(after,'set_roles',{roles:['attack','attack','scout','scout','mothership']});
  const deployment=await state(restarted,s=>s.game?.phase==='placement'&&!s.game.resolving);
  assert.equal(deployment.game.world.nebulae.length,9);
  assert(deployment.game.world.droplet);
  const droplet=deployment.game.world.droplet;
  const occupied=new Set();
  let column=1;
  for(let number=1;number<=5;number++)for(const [ws,identity] of [[restarted,a],[after,b]]){
    while(occupied.has(column+'B')||(droplet.column===column&&droplet.ring==='B'))column++;
    const cell=column++;occupied.add(cell+'B');
    send(ws,'place_ship',{ship:number,column:cell,ring:'B',direction:1});
    await state(ws,s=>crew(s,identity.player_id)?.ships[number-1]?.column===cell);
  }
  let active=await state(restarted,s=>s.game?.phase==='battle'&&s.game.world.fragments.length===2&&!s.game.resolving);
  const own=crew(active,a.player_id);
  const moving=own.ships.find(s=>!s.phased&&![...active.game.world.fragments,active.game.world.droplet,...active.game.world.nebulae]
    .some(t=>t.ring==='A'&&(t.column===s.column||t.column===s.column%24+1)));
  assert(moving,'an unblocked ship is available');
  send(restarted,'shift',{ship:moving.number,ring:'A'});
  await state(restarted,s=>!s.game?.resolving&&crew(s,a.player_id)?.ships[moving.number-1].ring==='A');
  send(restarted,'set_gear',{ship:moving.number,gear:1});
  const moved=await state(restarted,s=>!s.game?.resolving&&crew(s,a.player_id)?.ships[moving.number-1].column===moving.column%24+1);
  assert.equal(crew(moved,a.player_id).ships[moving.number-1].gear,1);
  console.log('V3 Worker: automatic droplet spawn, fragment spawn, intro and stepwise movement passed.');
  if(process.env.PLAYWRIGHT_MODULE){
    const {verifyBrowser}=await import('./test-browser.mjs');
    await verifyBrowser(origin,gamma,c.room_code);
  }
  await verify(request("/api/auth/logout", {method: "POST", cookie: beta}), 303);
  const closed = once(after, "close", {signal: AbortSignal.timeout(5000)});
  send(after, "ping");
  assert.equal((await closed)[0], 4401);
  await verify(request(endpoint, {cookie: beta}), 401);
  await verify(request(endpoint + "/leave", {method: "POST", cookie: alpha}), 204);
  await verify(request(endpoint, {cookie: alpha}), 403);
  console.log("Local Python Worker passed OAuth, D1, two rooms, WebSocket authorization, fleet privacy, reconnect and restart.");
} catch (failure) {
  await delay(150);
  console.error(logs);
  throw failure;
} finally {
  clearTimeout(watchdog);
  await stop();
  assert(scratch.startsWith(join(tmpdir(),'pythonfinal-test-')));
  await rm(scratch, {recursive: true, force: true,maxRetries:10,retryDelay:250});
}
