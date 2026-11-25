"use strict";
const $ = (id) => document.getElementById(id);
const storageKey = "pythonfinal.session.v1";
let session = null, socket = null, heartbeat = null, latest = null;
let roomHistoryActive = false, pageLeaving = false;
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
  const oldSocket = socket;
  socket = null; session = null; latest = null;
  if (oldSocket) oldSocket.close();
  setConnected(false);
  document.body.classList.remove("in-room");
  document.body.classList.remove("playing");
  $("game-view").hidden = true;
  GameUI.reset();
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
function leaveRoom(message, navigateBack = false) {
  if (session) notifyLeave(session);
  reset(); notice(message);
  if (navigateBack && roomHistoryActive && location.hash === "#room") history.back();
  else if (location.hash === "#room") history.replaceState(null, "", location.pathname + location.search);
  roomHistoryActive = false;
}
function render(state) {
  I18n.setNames(state.players.map(player=>player.name));
  latest = state; $("players").replaceChildren();
  document.body.classList.toggle("playing", Boolean(state.game));
  $("lobby").hidden = Boolean(state.game);
  $("game-view").hidden = !state.game;
  GameUI.render(state, session.player_id, send);
  const host = state.players.find((p) => p.host);
  $("start-game").hidden = !host || host.id !== session.player_id;
  $("start-game").disabled = state.players.length < 2 || !state.players.every((p) => p.connected && p.ready);
  for (let i = 0; i < state.capacity; i++) {
    const player = state.players[i];
    const card = document.createElement("div"); card.className = "player";
    card.dataset.slot = "0" + (i + 1) + " / CHANNEL";
    const icon = document.createElement("div"); icon.className = "ship-icon"; icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong"), status = document.createElement("span");
    status.className = "player-status";
    if (player) {
      const literalName = document.createElement("span"); literalName.dataset.i18nIgnore = ""; literalName.textContent = player.name; name.append(literalName, document.createTextNode((player.id === session.player_id ? "（你）" : "") + (player.host ? " · 房主" : "")));
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
  history.pushState({room: true}, "", "#room"); roomHistoryActive = true;
  document.body.classList.add("in-room");
  $("room-code").textContent = session.room_code; $("address").textContent = location.origin;
  setConnected(false); notice("正在连接房间…");
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/" + encodeURIComponent(session.room_code));
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    ws.send(JSON.stringify({player_id: session.player_id, token: session.token}));
    clearInterval(heartbeat);
    heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type: "ping"})); }, 15000);
  };
  ws.onmessage = (event) => {
    if (socket !== ws) return;
    const data = JSON.parse(event.data);
    if (data.type === "room_state") { setConnected(true); notice("已连接 · 房间状态实时同步"); render(data); }
    else if (data.type === "error") { notice(data.message, true); GameUI.error(data.message); }
  };
  ws.onclose = (event) => {
    if (socket !== ws) return;
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
function send(data) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
$("create").onclick = () => enter("/api/rooms");
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
  $("settings-dialog").show();
};
$("continue-game").onclick = () => $("settings-dialog").close();
$("exit-game").onclick = () => { $("settings-dialog").close(); send({type: "exit_game"}); };
$("exit-room").onclick = () => { $("settings-dialog").close(); leaveRoom("已退出房间。", true); };
$("leave").onclick = () => leaveRoom("已退出房间。", true);
window.addEventListener("popstate", () => {
  if (session) leaveRoom("已退出房间。");
  else if (location.hash === "#room") history.replaceState(null, "", location.pathname + location.search);
});
window.addEventListener("pagehide", () => { pageLeaving = true; leaveRoom("已退出房间。"); });
window.addEventListener("pageshow", () => { pageLeaving = false; });
setConnected(false);
