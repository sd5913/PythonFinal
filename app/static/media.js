"use strict";
const GameMedia = (() => {
  const sounds = {
    hit: "飞船碰撞.mp3", destroy: "爆炸.mp3", scan: "探测舰探测.mp3",
    move: "飞船飞行声音.mp3", energy: "获得能量 .mp3", items: "拾取物品.mp3",
  };
  const radii = {A: 395.5, B: 508.5, C: 621};
  const hidden = new Map(), jobs = new Set(), audio = new Set();
  let lastId = 0, enabled = false;
  const assets = DarkCampaignFX.loadAssets({base: "/visual-effects/assets/"}).catch(error => {
    console.error("视效素材加载失败", error);
    return null;
  });
  document.addEventListener("pointerdown", () => { enabled = true; }, {once: true});
  function sound(kind) {
    if (!enabled || !sounds[kind]) return;
    const player = new Audio("/static/audio/" + encodeURIComponent(sounds[kind]));
    player.volume = kind === "move" ? .12 : .45;
    audio.add(player);
    player.onended = () => audio.delete(player);
    player.play().catch(() => audio.delete(player));
  }
  function point(column, ring) {
    const angle = ((column - .5) * 15 - 90) * Math.PI / 180;
    return {x: 813 + Math.cos(angle) * radii[ring], y: 767 + Math.sin(angle) * radii[ring]};
  }
  function refresh() {
    for (const token of document.querySelectorAll(".board-ship")) {
      const key = token.dataset.owner + ":" + token.dataset.number;
      token.querySelector(".ship-heading").style.opacity = hidden.has(key) ? "0" : "";
    }
  }
  async function play(event, effect, duration) {
    const art = await assets;
    const board = document.querySelector(".board-canvas svg");
    if (!art || !board) return;
    const rect = board.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.className = "battle-effect";
    Object.assign(canvas.style, {left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px"});
    document.body.append(canvas);
    const key = event.owner + ":" + event.number;
    hidden.set(key, (hidden.get(key) || 0) + 1);
    refresh();
    const sizeFactor = effect === "ship_move" ? 1.25 : 1;
    const player = new DarkCampaignFX.Player(canvas, art, {width: 1625 * sizeFactor, height: 1536 * sizeFactor, pixelRatio: 1});
    const job = {player, canvas};
    jobs.add(job);
    const pos = point(event.column, event.ring);
    const options = {
      color: event.fleet, number: event.number, x: pos.x, y: pos.y,
      rotation: ((event.column - .5) * 15 + (event.direction === 1 ? 90 : -90)) * Math.PI / 180,
      scale: .8, duration,
    };
    if (effect === "ship_move") {
      const delta = ((event.column - event.from_column + 36) % 24) - 12;
      options.path = Array.from({length: 25}, (_, i) => {
        const t = i / 24;
        const radius = radii[event.from_ring] + (radii[event.ring] - radii[event.from_ring]) * t;
        const angle = ((event.from_column + delta * t - .5) * 15 - 90) * Math.PI / 180;
        return {x: (813 + Math.cos(angle) * radius) * sizeFactor, y: (767 + Math.sin(angle) * radius) * sizeFactor};
      });
    }
    try {
      await player.play(effect, options).finished;
    } finally {
      player.dispose(); canvas.remove(); jobs.delete(job);
      const count = (hidden.get(key) || 1) - 1;
      if (count) hidden.set(key, count); else hidden.delete(key);
      refresh();
    }
  }
  function flyEnergy(event) {
    const board = document.querySelector(".board-canvas svg");
    const bank = document.querySelector(".energy-bank");
    if (!board || !bank) return;
    const rect = board.getBoundingClientRect(), end = bank.getBoundingClientRect();
    const pos = point(event.column, event.ring);
    const icon = document.createElement("img");
    icon.src = "/static/assets/energy.png"; icon.className = "flying-energy";
    const x = rect.left + pos.x * rect.width / 1625;
    const y = rect.top + pos.y * rect.height / 1536;
    Object.assign(icon.style, {left: x + "px", top: y + "px"});
    document.body.append(icon);
    icon.animate([{transform: "translate(-50%,-50%)", opacity: 1},
      {transform: `translate(${end.left + end.width / 2 - x}px,${end.top + end.height / 2 - y}px) scale(.5)`, opacity: 0}],
      {duration: 850, easing: "ease-in-out"}).finished.finally(() => icon.remove());
  }
  function sync(game, viewer) {
    const fresh = (game.effects || []).filter(event => event.id > lastId);
    const destroyed = new Set(fresh.filter(e => e.kind === "destroy").map(e => e.owner + ":" + e.number));
    let chain = 0;
    for (const event of fresh) {
      lastId = Math.max(lastId, event.id);
      // Do not replay stale effects after a background tab resumes.
      if (Date.now() / 1000 - event.at > 8) continue;
      if (event.kind === "move") { sound("move"); play(event, "ship_move", 350); }
      if (event.kind === "hit" && !destroyed.has(event.owner + ":" + event.number)) { sound("hit"); play(event, "ship_hit", 650); }
      if (event.kind === "scan") { sound("scan"); play(event, "ship_detected", 1500); }
      if (event.kind === "destroy") {
        const delay = chain++ * 140;
        const id = setTimeout(() => { sound("destroy"); play(event, "ship_collision_destroy", 1000); }, delay);
        destroyTimers.add(id);
      }
      if (event.kind === "pickup") {
        if (event.items.energy) {
          sound("energy"); play(event, "ship_energy_pickup", 650);
          if (event.owner === viewer) flyEnergy(event);
        }
        if (event.items.missile || event.items.probe || event.items.repair) sound("items");
      }
    }
  }
  const destroyTimers = new Set();
  function reset() {
    lastId = 0;
    for (const id of destroyTimers) clearTimeout(id);
    destroyTimers.clear();
    for (const job of jobs) { job.player.dispose(); job.canvas.remove(); }
    jobs.clear(); hidden.clear();
    for (const player of audio) player.pause();
    audio.clear();
    for (const icon of document.querySelectorAll(".flying-energy")) icon.remove();
  }
  return {sync, reset, refresh};
})();
