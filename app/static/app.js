"use strict";
const $ = (id) => document.getElementById(id);
const storageKey = "pythonfinal.session.v1";
let session = null, socket = null, heartbeat = null, latest = null;
let roomHistoryActive = false, pageLeaving = false;
let online = false, user = null, invite = null, reconnect = null, retries = 0;
const inviteKey = storageKey + ".invite", roomKey = storageKey + ".room";
function stored(key) {
  try { return sessionStorage.getItem(key); } catch (_) { return null; }
}
function store(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch (_) {}
}
// Remove credentials saved by older versions; refreshing starts in the lobby.
try { sessionStorage.removeItem(storageKey); } catch (_) {}
if (location.hash === "#room") history.replaceState(null, "", location.pathname + location.search);
function notice(message, error = false) {
  $("notice").textContent = message; $("notice").classList.toggle("error", error);
}
function setConnected(connected) { $("ready").disabled = !connected; $("signal").disabled = !connected; }
function log(message) {
  const li = document.createElement("li"); li.textContent = new Date().toLocaleTimeString() + " · " + message;
  $("events").prepend(li); while ($("events").children.length > 20) $("events").lastElementChild.remove();
}
function reset() {
  clearInterval(heartbeat);
  clearTimeout(reconnect);
  retries = 0;
  const oldSocket = socket;
  socket = null; session = null; latest = null;
  if (oldSocket) oldSocket.close();
  setConnected(false);
  document.body.classList.remove("in-room");
  document.body.classList.remove("playing");
  $("game-view").hidden = true;
  GameUI.reset();
  $("share-invite").hidden = true; $("invite-link").hidden = true; $("invite-link").value = "";
  $("entry").hidden = false; $("lobby").hidden = true; $("events").replaceChildren();
}
function notifyLeave(identity) {
  const url = "/api/rooms/" + encodeURIComponent(identity.room_code) + "/leave";
  const body = JSON.stringify({player_id: identity.player_id, token: identity.token});
  // pagehide cannot wait for a normal request; beacon is best-effort only.
  if (!navigator.sendBeacon || !navigator.sendBeacon(url, new Blob([body], {type: "application/json"}))) {
    fetch(url, {method: "POST", headers: {"Content-Type": "application/json"}, body, keepalive: true}).catch(() => {});
  }
}
async function leaveRoom(message, navigateBack = false) {
  if (session && online) {
    try {
      const response = await onlineRequest("/api/rooms/" + session.room_code + "/leave", "POST");
      if (!response.ok && ![401, 403, 404].includes(response.status)) throw new Error();
    } catch (_) { notice("暂时无法退出房间，请重试。", true); return; }
    store(roomKey, null);
  } else if (session) notifyLeave(session);
  reset(); notice(message);
  if (navigateBack && roomHistoryActive && location.hash === "#room") history.back();
  else if (location.hash === "#room") history.replaceState(null, "", location.pathname + location.search);
  roomHistoryActive = false;
}
function render(state) {
  latest = state; $("players").replaceChildren();
  document.body.classList.toggle("playing", Boolean(state.game));
  $("lobby").hidden = Boolean(state.game);
  $("game-view").hidden = !state.game;
  GameUI.render(state, session.player_id, send);
  const host = state.players.find((p) => p.host);
  $("start-game").hidden = !host || host.id !== session.player_id;
  $("share-invite").hidden = !online || !host || host.id !== session.player_id;
  if ($("share-invite").hidden) { $("invite-link").hidden = true; $("invite-link").value = ""; }
  $("start-game").disabled = state.players.length < 2 || !state.players.every((p) => p.connected && p.ready);
  for (let i = 0; i < state.capacity; i++) {
    const player = state.players[i];
    const card = document.createElement("div"); card.className = "player";
    card.dataset.slot = "0" + (i + 1) + " / CHANNEL";
    const icon = document.createElement("div"); icon.className = "ship-icon"; icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong"), status = document.createElement("span");
    status.className = "player-status";
    if (player) {
      name.textContent = player.name + (player.id === session.player_id ? "（你）" : "") + (player.host ? " · 房主" : "");
      status.textContent = !player.connected ? "正在接入" : player.ready ? "已连接 · 已准备" : "已连接 · 等待准备";
      card.classList.toggle("is-ready", player.connected && player.ready);
      card.classList.toggle("is-self", player.id === session.player_id);
    } else { name.textContent = "等待指挥官"; status.textContent = "频道待接入"; card.classList.add("is-empty"); }
    card.append(icon, name, status); $("players").append(card);
  }
  const self = state.players.find((p) => p.id === session.player_id);
  $("ready").textContent = self && self.ready ? "取消准备" : "准备";
  const allReady = state.players.length >= 2 && state.players.every((p) => p.connected && p.ready);
  $("readiness").textContent = allReady ? "所有人已准备，等待房主开始游戏。" : "已入座 " + state.players.length + "/4 · 至少两人连接并准备后，房主可以开始游戏。";
  if (state.event) log(state.event);
}
function connect() {
  $("entry").hidden = true; $("lobby").hidden = false;
  if (!roomHistoryActive) {
    history.pushState({room: true}, "", "#room"); roomHistoryActive = true;
  }
  document.body.classList.add("in-room");
  $("room-code").textContent = session.room_code; $("address").textContent = location.origin;
  setConnected(false); notice("正在连接房间…");
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/" + encodeURIComponent(session.room_code));
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    if (!online) ws.send(JSON.stringify({player_id: session.player_id, token: session.token}));
    clearInterval(heartbeat);
    heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type: "ping"})); }, 15000);
  };
  ws.onmessage = (event) => {
    if (socket !== ws) return;
    const data = JSON.parse(event.data);
    if (data.type === "room_state") { retries = 0; setConnected(true); notice("已连接 · 房间状态实时同步"); render(data); }
    else if (data.type === "error") { notice(data.message, true); GameUI.error(data.message); }
  };
  ws.onclose = (event) => {
    if (socket !== ws) return;
    if (online) { onlineClosed(event.code); return; }
    const identity = session;
    // A replaced socket must not send a leave beacon for its replacement.
    if (identity && event.code !== 4001) notifyLeave(identity);
    reset();
    if (location.hash === "#room") history.replaceState(null, "", location.pathname + location.search);
    roomHistoryActive = false;
    notice(event.code === 4001 ? "此座位已在另一个连接打开。" : "已退出房间，请重新创建或加入。", true);
  };
  ws.onerror = () => notice("无法连接服务器，请确认服务仍在运行。", true);
}
async function enter(path) {
  const name = $("name").value.trim();
  if (!name) { notice("请输入昵称。", true); $("name").focus(); return; }
  $("create").disabled = $("join").disabled = true;
  try {
    const response = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name})});
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "请检查昵称和房间号。");
    if (pageLeaving) { notifyLeave(data); return; }
    session = data; connect();
  } catch (error) { notice(error.message || "连接失败。", true); }
  finally { $("create").disabled = $("join").disabled = false; }
}
async function onlineClosed(code) {
  clearInterval(heartbeat);
  setConnected(false);
  if (![4001, 4401, 4404].includes(code) && retries < 8) {
    const previous = session;
    notice("连接中断，正在尝试重新连接…", true);
    reconnect = setTimeout(async () => {
      if (session !== previous) return;
      try {
        const response = await onlineRequest("/api/rooms/" + previous.room_code);
        if (session !== previous) return;
        if (response.status === 401) { await onlineClosed(4401); return; }
        if ([403, 404].includes(response.status)) { await onlineClosed(4404); return; }
      } catch (_) {}
      if (session === previous) connect();
    }, Math.min(1000 * 2 ** retries++, 12000));
    return;
  }
  store(roomKey, null);
  reset();
  if (location.hash === "#room") history.replaceState(null, "", location.pathname + location.search);
  roomHistoryActive = false;
  if (code === 4401) { user = null; renderAccount(); }
  notice(code === 4001 ? "此座位已在另一个连接打开。" : "无法恢复房间连接，请重新加入。", true);
}

function onlineRequest(path, method = "GET", data) {
  const options = {method, credentials: "same-origin"};
  if (data) {
    options.headers = {"Content-Type": "application/json"};
    options.body = JSON.stringify(data);
  }
  return fetch(path, options);
}

async function enterOnline(path, method = "POST", data) {
  $("create").disabled = $("accept-invite").disabled = true;
  try {
    const response = await onlineRequest(path, method, data);
    const info = await response.json();
    if (response.status === 401) { user = null; renderAccount(); }
    if (response.status === 404 && path === "/api/invitations/join") {
      invite = null; store(inviteKey, null); renderAccount();
    }
    if (!response.ok) throw new Error(info.detail || "无法进入房间。");
    if (pageLeaving) return;
    if (path === "/api/invitations/join") {
      invite = null; store(inviteKey, null); renderAccount();
    }
    session = info;
    store(roomKey, info.room_code);
    connect();
  } catch (error) {
    if (method === "GET") store(roomKey, null);
    notice(error.message || "无法进入房间。", true);
  } finally {
    $("create").disabled = $("accept-invite").disabled = !user;
  }
}

function renderAccount() {
  $("online-account").hidden = false;
  $("lan-identity").hidden = $("lan-join").hidden = true;
  $("lan-invite-strip").hidden = $("lan-channel-preview").hidden = true;
  $("network-label").textContent = "ONLINE";
  $("network-detail").textContent = " / 在线联机";
  $("network-help").textContent = "GitHub 登录 · 邀请链接";
  $("connection-help").textContent = "断线后保留席位两分钟。";
  $("sign-in").hidden = Boolean(user);
  $("sign-out").hidden = !user;
  $("online-invite").hidden = !invite;
  $("create").disabled = $("accept-invite").disabled = !user;
  $("account-status").textContent = user ? "已登录 · " + user.login : "登录后即可创建房间或接受邀请。";
  $("create-help").textContent = "创建房间后，可复制邀请链接并分享给队友。";
}

async function boot() {
  $("create").disabled = $("join").disabled = true;
  try {
    const response = await onlineRequest("/api/online");
    if (response.status === 404) { $("create").disabled = $("join").disabled = false; return; }
    const info = await response.json();
    if (!response.ok || info.mode !== "online") throw new Error();
    online = true; user = info.user;
    const match = /^#invite=([A-Za-z0-9_-]{43})$/.exec(location.hash);
    if (match) {
      invite = match[1]; store(inviteKey, invite);
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      invite = stored(inviteKey);
    }
    renderAccount();
    notice(user ? "通信待命 · 请选择创建房间或接受邀请。" : "使用 GitHub 登录以进入在线大厅。");
    if (new URLSearchParams(location.search).has("login")) {
      history.replaceState(null, "", location.pathname);
      notice("GitHub 登录未完成，请重试。", true);
    }
    const previous = stored(roomKey);
    if (user && !invite && /^[A-F0-9]{24}$/.test(previous || "")) {
      await enterOnline("/api/rooms/" + previous, "GET");
    }
  } catch (_) { notice("无法连接服务器，请刷新后重试。", true); }
}

$("accept-invite").onclick = () => {
  if (invite) enterOnline("/api/invitations/join", "POST", {invite});
};
$("sign-out").onclick = async () => {
  try {
    const response = await onlineRequest("/api/auth/logout", "POST");
    if (!response.ok) throw new Error();
    store(roomKey, null); location.assign("/");
  } catch (_) { notice("暂时无法退出登录，请重试。", true); }
};
$("share-invite").onclick = async () => {
  if (!session) return;
  const room = session.room_code;
  try {
    const response = await onlineRequest("/api/rooms/" + room + "/invite", "POST");
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!session || session.room_code !== room) return;
    const link = location.origin + "/#invite=" + encodeURIComponent(data.invite);
    try {
      await navigator.clipboard.writeText(link);
      notice("已复制房间邀请链接。");
    } catch (_) {
      $("invite-link").value = link; $("invite-link").hidden = false;
      $("invite-link").focus(); $("invite-link").select();
      notice("请复制所选的房间邀请链接。");
    }
  } catch (_) { notice("暂时无法获取邀请链接。", true); }
};
function send(data) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
$("create").onclick = () => online ? enterOnline("/api/rooms") : enter("/api/rooms");
$("join").onclick = () => {
  const code = $("code").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { notice("请输入六位字母或数字房间号。", true); return; }
  enter("/api/rooms/" + code + "/join");
};
$("ready").onclick = () => {
  const self = latest && latest.players.find((p) => p.id === session.player_id);
  if (self) send({type: "set_ready", ready: !self.ready});
};
$("signal").onclick = () => send({type: "test_signal"});
$("start-game").onclick = () => send({type: "start_game"});
$("settings-button").onclick = () => {
  $("exit-game").disabled = !latest || !latest.game;
  $("exit-room").disabled = !session;
  $("settings-dialog").showModal();
};
$("continue-game").onclick = () => $("settings-dialog").close();
$("exit-game").onclick = () => { $("settings-dialog").close(); send({type: "exit_game"}); };
$("exit-room").onclick = () => { $("settings-dialog").close(); leaveRoom("已退出房间。", true); };
$("leave").onclick = () => leaveRoom("已退出房间。", true);
window.addEventListener("popstate", () => {
  if (session) leaveRoom("已退出房间。");
  else if (location.hash === "#room") history.replaceState(null, "", location.pathname + location.search);
});
window.addEventListener("pagehide", () => {
  pageLeaving = true;
  if (online) {
    clearTimeout(reconnect);
    const old = socket; socket = null;
    if (old) old.close();
  } else leaveRoom("已退出房间。");
});
window.addEventListener("pageshow", () => {
  pageLeaving = false;
  if (online && session && !socket) connect();
});
setConnected(false);
boot();
