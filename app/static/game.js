"use strict";
const GameUI = (() => {
  const root = () => document.getElementById("game-view");
  const labels = {attack: "攻击舰", scout: "探测舰", mothership: "母舰"};
  let room = null, game = null, me = null, emit = null, selected = null, mode = "selected";
  let draft = null, targetGear = null, roleDraft = ["", "", "", "", ""], timer = null;
  let lastPhase = null, lastTurn = null, toastUntil = 0, pendingKey = "";
  let placementNotice = "", logExpanded = false;
  let target = null;
  const intel = new Map(), motions = new Map();
  const intelType = "application/x-dark-campaign-intel";
  const intelShapes = {ship: "舰船", radar: "雷达"};
  const intelColors = {blue: "推测", yellow: "确认"};
  let layoutFrame = 0;
  const layoutObserver = new ResizeObserver(() => {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(fitLayout);
  });
  function fitLayout() {
    const layout = root().querySelector(".game-layout");
    if (!layout || !layout.clientWidth || !layout.clientHeight) return;
    const viewport = layout.querySelector(".console-viewport");
    const panel = viewport.firstElementChild;
    const portrait = layout.clientWidth < 650 && layout.clientHeight > layout.clientWidth;
    layout.classList.toggle("portrait-layout", portrait);
    panel.style.height = "auto";
    const naturalHeight = panel.offsetHeight;
    const availableHeight = portrait ? layout.clientHeight * .48 : layout.clientHeight;
    const availableWidth = layout.clientWidth * (portrait ? 1 : .36);
    const scale = Math.min(availableWidth / 480, availableHeight / naturalHeight);
    viewport.style.width = 480 * scale + "px";
    viewport.style.height = availableHeight + "px";
    panel.style.transform = `scale(${scale})`;
    panel.style.height = availableHeight / scale + "px";
    layout.style.setProperty("--console-width", 480 * scale + "px");
    const space = layout.querySelector(".board-space");
    const canvas = space.firstElementChild;
    canvas.style.width = Math.max(0, Math.min(space.clientWidth, space.clientHeight * 1625 / 1536)) + "px";
  }
  const NS = "http://www.w3.org/2000/svg";
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, fn, disabled = false, cls = "secondary") {
    const node = el("button", cls, text); node.disabled = disabled; node.onclick = fn; return node;
  }
  function svg(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  function shipImage(fleet, number, cls = "") {
    const image = el("img", cls);
    image.src = `/static/assets/${fleet}-${number}.png`;
    image.alt = number + "号舰船"; image.draggable = false;
    return image;
  }
  function error(message) {
    const modal = document.getElementById("game-alert");
    document.getElementById("game-alert-text").textContent = message;
    if (!modal.open) modal.showModal();
  }
  document.getElementById("close-alert").onclick = () => document.getElementById("game-alert").close();
  function reset() {
    layoutObserver.disconnect(); cancelAnimationFrame(layoutFrame);
    root().classList.remove("match-view");
    clearTimeout(timer); selected = null; draft = null; targetGear = null; mode = "selected";
    roleDraft = ["", "", "", "", ""]; lastPhase = null; lastTurn = null; pendingKey = "";
    placementNotice = ""; logExpanded = false; toastUntil = 0;
    intel.clear(); motions.clear();
    target = null;
    GameMedia.reset();
    root().replaceChildren();
  }
  function myself() { return game.crews.find((c) => c.id === me); }
  function current() { return game.crews.find((c) => c.id === game.current_player); }
  function captain(crew) { return crew.name.endsWith("舰长") ? crew.name : crew.name + "舰长"; }
  function color(crew) { return game.fleets[crew.fleet]?.color || "#79e4f3"; }
  function busy() { return Date.now() / 1000 < Math.max(game.busy_until, game.battle_starts_at); }
  function canAct() { return game.current_player === me && !busy() && !game.resolving && !myself().eliminated && game.phase !== "finished"; }
  function capable(ship, kind) {
    return !ship.destroyed && (kind === "attack"
      ? ship.missile || (["attack", "mothership"].includes(ship.role) && ship.ammo > 0)
      : ship.probe || (["scout", "mothership"].includes(ship.role) && myself().energy >= 2));
  }
  function inRange(ship) {
    const distance = Math.abs(ship.column - myShip().column);
    return Math.min(distance, 24 - distance) <= 2;
  }
  function tacticKind() { return mode.includes("attack") ? "attack" : "scan"; }
  function selectShip(crew, ship) {
    if (!canAct() || ship.destroyed || game.phase !== "battle") return;
    if (mode.endsWith("-source")) {
      if (crew.id !== me || !capable(ship, tacticKind())) return;
      selected = ship.number; mode = tacticKind() + "-target"; draw(); return;
    }
    if (mode.endsWith("-target")) {
      if (crew.id === me || !inRange(ship)) return;
      target = {owner: crew.id, number: ship.number};
      mode = "confirm-" + tacticKind(); draw(); return;
    }
    if (crew.id !== me || mode === "shift" || mode.startsWith("confirm-") || mode === "scan-question") return;
    selected = ship.number; mode = "selected"; targetGear = null; target = null; draw();
  }
  function myShip() { return myself().ships.find((s) => s.number === selected); }
  function command(message) { emit(message); }
  function header(title, subtitle) {
    const node = el("div", "game-heading");
    const block = el("div"); block.append(el("span", "eyebrow", "DARK CAMPAIGN / " + room.room_code), el("h2", "", title), el("p", "hint", subtitle));
    node.append(block, el("span", "phase-badge", game.phase === "finished" ? "RESULT" : game.phase === "battle" ? "ROUND " + String(game.round).padStart(2, "0") : "PREPARATION"));
    return node;
  }
  function fleetSelection() {
    root().append(header("选择你的舰队", "每支舰队只能由一名指挥官带领。选择会实时展示给队友。"));
    const grid = el("div", "fleet-grid");
    for (const [key, fleet] of Object.entries(game.fleets)) {
      const card = button("", () => command({type: "choose_fleet", fleet: key}), false, "fleet-card");
      card.setAttribute("aria-label", "选择" + fleet.name); card.style.setProperty("--fleet", fleet.color);
      card.classList.toggle("chosen", myself().fleet === key);
      card.append(el("span", "eyebrow", "FLEET / " + key.toUpperCase()), el("h3", "", fleet.name));
      const silhouettes = el("div", "fleet-ships");
      for (let n = 1; n <= 5; n++) { const symbol = el("span", "fleet-ship"); symbol.append(shipImage(key, n), el("small", "", String(n))); silhouettes.append(symbol); }
      card.append(silhouettes);
      const names = game.crews.filter((c) => c.fleet === key);
      const tokens = el("div", "name-tokens");
      for (const crew of names) tokens.append(el("span", "name-token", crew.name + (crew.id === me ? "（你）" : "")));
      if (!names.length) tokens.append(el("span", "hint", "等待指挥官选择"));
      card.append(tokens); grid.append(card);
    }
    root().append(grid);
    const values = game.crews.map((c) => c.fleet).filter(Boolean);
    const duplicate = new Set(values).size !== values.length;
    const host = room.players.find((p) => p.host)?.id === me;
    const proceed = button(host ? "进入对局" : "等待房主进入对局", () => {
      if (duplicate) error("舰队只能有一名指挥官");
      else command({type: "begin_deployment"});
    }, !host || (!game.fleet_valid && !duplicate), "proceed " + (duplicate ? "invalid" : game.fleet_valid ? "valid" : ""));
    root().append(proceed);
  }
  function point(column, radius, offset = 0) {
    const angle = ((column - .5) * 15 - 90 + offset) * Math.PI / 180;
    return {x: 813 + Math.cos(angle) * radius, y: 767 + Math.sin(angle) * radius};
  }
  // Match the four concentric boundaries in the supplied map artwork.
  const radii = {A: [339, 452], B: [452, 565], C: [565, 677]};
  const ringCenter = (ring) => (radii[ring][0] + radii[ring][1]) / 2;
  function locationOf(ship) { return point(ship.column, ringCenter(ship.ring)); }
  function occupied(column, ring) {
    return game.crews.some((crew) => crew.ships.some((ship) => ship.column === column && ship.ring === ring));
  }
  function chooseCell(column, ring) {
    if (!canAct()) return;
    if (game.phase === "placement" && selected && !myShip().ring) {
      if (occupied(column, ring)) {
        draft = null; selected = null;
        placementNotice = "该格已有舰船，请重新摆放。";
      } else {
        placementNotice = "";
        draft = {column, ring, direction: 1};
      }
      draw();
    } else if (game.phase === "battle" && mode === "shift") {
      const ship = myShip();
      if (column === ship.column && Math.abs("ABC".indexOf(ring) - "ABC".indexOf(ship.ring)) === 1) {
        command({type: "shift", ship: selected, ring}); mode = "selected";
      }
    }
  }
  function pose(motion, time) {
    const progress = Math.max(0, Math.min(1, (time - motion.start) / motion.duration));
    const eased = progress * progress * (3 - 2 * progress);
    return {
      column: motion.column + motion.columns * eased,
      radius: motion.radius + (motion.endRadius - motion.radius) * eased,
      finished: progress === 1,
    };
  }
  function trackMotions(previous, next) {
    if (previous?.phase !== "battle" || next?.phase !== "battle") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const now = performance.now();
    for (const crew of next.crews) {
      const oldCrew = previous.crews.find((item) => item.id === crew.id);
      for (const ship of crew.ships) {
        const old = oldCrew?.ships.find((item) => item.number === ship.number);
        if (!old || (old.column === ship.column && old.ring === ship.ring)) continue;
        const key = crew.id + ":" + ship.number;
        const running = motions.get(key);
        const from = running ? pose(running, now) : {column: old.column, radius: ringCenter(old.ring)};
        // The largest legal angular movement is three sectors. Unwrap across 24/1.
        const columns = ((ship.column - from.column + 36) % 24) - 12;
        motions.set(key, {
          column: from.column, columns, radius: from.radius, endRadius: ringCenter(ship.ring),
          start: now, duration: Math.min(720, 260 + Math.abs(columns) * 150),
        });
      }
    }
  }
  function animateShip(token, heading, ship, key, offsetX, offsetY) {
    const motion = motions.get(key);
    if (!motion) return;
    function frame(time) {
      const currentPose = pose(motion, time);
      if (currentPose.finished && motions.get(key) === motion) motions.delete(key);
      const pos = point(currentPose.column, currentPose.radius);
      token.setAttribute("transform", `translate(${pos.x + offsetX},${pos.y + offsetY})`);
      heading.setAttribute("transform", `rotate(${(currentPose.column - .5) * 15 + (ship.direction === 1 ? 90 : -90)})`);
      if (!currentPose.finished) requestAnimationFrame((nextTime) => {
        if (token.isConnected) frame(nextTime);
      });
    }
    frame(performance.now());
  }
  function board() {
    const container = el("div", "board-canvas");
    container.classList.toggle("shifting", mode === "shift");
    container.classList.toggle("placing", game.phase === "placement");
    const map = svg("svg", {viewBox: "0 0 1625 1536", "aria-label": "24列三圈棋盘", role: "group"});
    map.append(svg("image", {href: "/static/assets/player-map.png", width: 1625, height: 1536, preserveAspectRatio: "none", class: "map-art"}));
    for (const ring of "ABC") {
      const [inner, outer] = radii[ring];
      for (let col = 1; col <= 24; col++) {
        const start = col - 1, end = col;
        const a = point(start + .5, outer), b = point(end + .5, outer);
        const c = point(end + .5, inner), d = point(start + .5, inner);
        const path = svg("path", {d: `M${a.x} ${a.y} A${outer} ${outer} 0 0 1 ${b.x} ${b.y} L${c.x} ${c.y} A${inner} ${inner} 0 0 0 ${d.x} ${d.y}Z`,
          class: "map-cell", id: `cell-${col}-${ring}`, role: "button", tabindex: "0", "aria-label": `${col}${ring}`});
        path.append(svg("title", {}));
        path.firstChild.textContent = col + ring;
        if (game.phase === "placement" && occupied(col, ring)) path.classList.add("occupied-cell");
        if (mode === "shift" && myShip()) {
          const active = col === myShip().column && Math.abs("ABC".indexOf(ring) - "ABC".indexOf(myShip().ring)) === 1;
          path.classList.add(active ? "shift-target" : "dim-cell");
        }
        if (mode.endsWith("-source") || mode.endsWith("-target")) {
          const distance = myShip() ? Math.abs(col - myShip().column) : 24;
          path.classList.add(mode.endsWith("-target") && Math.min(distance, 24 - distance) <= 2 ? "shift-target" : "dim-cell");
        }
        path.onclick = () => chooseCell(col, ring);
        path.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chooseCell(col, ring); } };
        path.ondragover = (e) => {
          if (game.phase === "placement" && canAct() && e.dataTransfer.types.includes("application/x-dark-campaign-deploy")) {
            e.preventDefault(); e.dataTransfer.dropEffect = "move"; path.classList.add("drag-over");
          }
        };
        path.ondragleave = () => path.classList.remove("drag-over");
        path.ondrop = (e) => {
          e.preventDefault();
          path.classList.remove("drag-over");
          const number = Number(e.dataTransfer.getData("application/x-dark-campaign-deploy"));
          if (myself().ships.some((s) => s.number === number && !s.ring)) { selected = number; chooseCell(col, ring); }
        };
        map.append(path);
      }
    }
    for (const pile of game.ground || []) {
      const pos = locationOf(pile);
      const items = ["energy", "missile", "probe", "repair"].filter(item => pile[item]);
      const marker = svg("g", {class: "ground-items", transform: `translate(${pos.x},${pos.y})`});
      items.forEach((item, index) => {
        const x = (index - (items.length - 1) / 2) * 29;
        marker.append(svg("image", {href: `/static/assets/${item}.png`, x: x - 14, y: -14, width: 28, height: 28}));
        const count = svg("text", {x, y: 31, class: "ship-number", "text-anchor": "middle"});
        count.textContent = pile[item]; marker.append(count);
      });
      map.append(marker);
    }
    const occupancy = {};
    for (const crew of game.crews) for (const ship of crew.ships) {
      if (!ship.ring || ship.destroyed) continue;
      const key = ship.column + ship.ring; (occupancy[key] ||= []).push({crew, ship});
    }
    for (const group of Object.values(occupancy)) group.forEach(({crew, ship}, index) => {
      const pos = locationOf(ship);
      let offsetX = 0, offsetY = 0;
      // Keep overlapping tokens separately selectable, without changing their cells.
      if (group.length > 1) {
        offsetX = Math.cos(index * 2 * Math.PI / group.length) * Math.min(46, group.length * 11);
        offsetY = Math.sin(index * 2 * Math.PI / group.length) * Math.min(46, group.length * 11);
      }
      const token = svg("g", {transform: `translate(${pos.x + offsetX},${pos.y + offsetY})`, class: "board-ship" + (selected === ship.number && crew.id === me ? " selected-ship" : ""), role: "button", tabindex: game.phase === "battle" ? "0" : "-1", "data-gear": ship.gear,
        "data-owner": crew.id, "data-number": ship.number,
        "aria-label": `${crew.name} ${ship.number}号舰船 ${ship.column}${ship.ring} ${ship.gear}档`});
      if (mode.endsWith("-source") && (crew.id !== me || !capable(ship, tacticKind()))) token.classList.add("tactical-muted");
      if (mode.endsWith("-target") && (crew.id === me || !inRange(ship))) token.classList.add("tactical-muted");
      const degrees = (ship.column - .5) * 15 + (ship.direction === 1 ? 90 : -90);
      const heading = svg("g", {transform: `rotate(${degrees})`, class: "ship-heading"});
      heading.append(svg("image", {href: `/static/assets/${crew.fleet}-${ship.number}.png`, x: -43, y: -52, width: 86, height: 104}));
      if (ship.gear > 0) heading.append(svg("image", {href: `/static/assets/gear-${ship.gear}.png`, x: -38, y: 43, width: 76, height: 13, class: "gear-marker", "aria-label": ship.gear + "档"}));
      heading.append(svg("path", {d: "M-10 -52 0 -64 10 -52Z", fill: color(crew)}));
      const num = svg("text", {x: 0, y: 76, "text-anchor": "middle", class: "ship-number"}); num.textContent = ship.number + " / " + ship.gear;
      token.append(heading, num);
      const badges = [];
      for (let i = 0; i < ship.damage; i++) badges.push("warning");
      for (const item of ["missile", "probe"]) if (ship[item]) badges.push(item);
      badges.forEach((item, index) => {
        const badge = svg("image", {href: `/static/assets/${item}.png`, x: -72, y: -60 + index * 29, width: 27, height: 27, class: "ship-badge"});
        if (crew.id === me && selected === ship.number && previewItem() === item) badge.classList.add("component-preview");
        token.append(badge);
      });
      token.onclick = (e) => { e.stopPropagation(); selectShip(crew, ship); };
      token.onkeydown = (e) => { if (e.key === "Enter") selectShip(crew, ship); };
      map.append(token);
      animateShip(token, heading, ship, crew.id + ":" + ship.number, offsetX, offsetY);
    });
    if (draft && game.phase === "placement") {
      const pos = locationOf(draft);
      const ghost = svg("g", {transform: `translate(${pos.x},${pos.y})`, class: "deployment-ghost"});
      ghost.append(svg("circle", {r: 58}));
      ghost.append(svg("image", {href: `/static/assets/${myself().fleet}-${selected}.png`, x: -43, y: -52, width: 86, height: 104,
        transform: `rotate(${(draft.column - .5) * 15 + (draft.direction === 1 ? 90 : -90)})`}));
      map.append(ghost);
    }
    container.append(map);
    return container;
  }
  function shipMenu() {
    const menu = el("div", "ship-menu");
    const ship = myShip();
    const cell = draft || ship;
    menu.append(el("strong", "", `${selected}号舰船 · ${cell.column}${cell.ring}`));
    if (game.phase === "placement") {
      menu.append(el("span", "hint", draft.column + draft.ring + " · " + (draft.direction === 1 ? "顺时针" : "逆时针")),
        button("确认部署", () => { command({type: "place_ship", ship: selected, ...draft}); draft = null; selected = null; }),
        button("转向", () => { draft.direction *= -1; draw(); }),
        button("取消", () => { draft = null; selected = null; draw(); }));
      return menu;
    }
    const locked = game.move_ship !== null && game.move_ship !== selected;
    if (mode === "selected") {
      menu.append(button("移动", () => { mode = "menu"; draw(); }, locked || (game.gear_used && game.shift_used && ship.gear !== 0)),
        button("战术", () => { mode = "tactics"; draw(); }, game.tactic_used),
        button("取消", () => { selected = null; draw(); }));
    } else if (mode === "tactics") {
      menu.append(button("攻击", () => { mode = "attack-source"; draw(); }, !myself().ships.some(s => capable(s, "attack"))),
        button("探测", () => { mode = "scan-source"; draw(); }, !myself().ships.some(s => capable(s, "scan"))),
        button("取消", () => { mode = "selected"; draw(); }));
    } else if (mode.endsWith("-source") || mode.endsWith("-target")) {
      menu.append(el("p", "hint", mode.endsWith("-source") ? "选择亮起的己方行动舰船" : "选择高亮范围内的一艘敌舰"),
        button("取消", () => { mode = mode.endsWith("-target") ? tacticKind() + "-source" : "tactics"; target = null; draw(); }));
    } else if (mode === "confirm-attack" || mode === "confirm-scan") {
      const kind = tacticKind();
      const crew = game.crews.find(c => c.id === target.owner);
      menu.append(el("p", "hint", `${kind === "attack" ? "攻击" : "探测"} ${crew.name} ${target.number}号`),
        button("确认", () => {
          if (kind === "scan") { mode = "scan-question"; draw(); }
          else submitTactic("attack");
        }),
        button("取消", () => { mode = kind + "-target"; target = null; draw(); }));
    } else if (mode === "scan-question") {
      menu.append(el("p", "hint", "请选择探测问题"), button("取消", () => { mode = "confirm-scan"; draw(); }));
    } else if (mode === "menu") {
      menu.append(button("横移 · 1能量", () => { mode = "shift"; draw(); }, game.shift_used || myself().energy < 1 || locked));
      for (const gear of [3, 2, 1, 0]) menu.append(button("档位" + gear, () => { targetGear = gear; mode = "confirm"; draw(); },
        game.gear_used || ship.gear === gear || myself().energy < Math.abs(gear - ship.gear) || locked));
      menu.append(button("0档转向", () => { command({type: "turn_ship", ship: selected}); mode = "selected"; }, ship.gear !== 0 || locked),
        button("取消", () => { mode = "selected"; draw(); }));
    } else if (mode === "shift") {
      menu.append(el("p", "hint", "点选高亮的相邻圈层"), button("取消横移", () => { mode = "menu"; draw(); }));
    } else {
      menu.append(el("p", "hint", `${ship.gear}档 → ${targetGear}档 · 消耗${Math.abs(targetGear - ship.gear)}能量`),
        button("确认调档", () => { command({type: "set_gear", ship: selected, gear: targetGear}); mode = "menu"; targetGear = null; }),
        button("取消", () => { mode = "selected"; targetGear = null; draw(); }));
    }
    return menu;
  }
  function previewItem() {
    if (!myShip()) return null;
    if (mode === "confirm-attack" && myShip().missile) return "missile";
    if (["confirm-scan", "scan-question"].includes(mode) && myShip().probe) return "probe";
    return null;
  }
  function submitTactic(kind, question) {
    const message = {type: kind, ship: selected, target_owner: target.owner, target_ship: target.number};
    if (question) message.question = question;
    mode = "selected"; target = null;
    command(message); draw();
  }
  function intelToken(shape, color) {
    const image = el("img", "intel-token");
    image.src = `/static/assets/intel-${shape}-${color}.png`;
    image.alt = `${intelShapes[shape]} · ${intelColors[color]}`;
    return image;
  }
  function intelPalette() {
    const palette = el("section", "intel-palette");
    palette.append(el("h4", "", "情报标记"));
    const groups = el("div", "intel-groups");
    for (const shape of Object.keys(intelShapes)) {
      const group = el("div", "intel-group");
      group.setAttribute("aria-label", intelShapes[shape]);
      for (const color of Object.keys(intelColors)) {
        const image = intelToken(shape, color);
        image.title = image.alt + " · 拖动放置";
        image.draggable = true;
        image.ondragstart = (event) => {
          event.dataTransfer.setData(intelType, shape + ":" + color);
          event.dataTransfer.effectAllowed = "copy";
        };
        group.append(image);
      }
      groups.append(group);
    }
    palette.append(groups, el("p", "", "蓝色 · 推测　黄色 · 确认"));
    return palette;
  }
  function intelCell(fleet, number) {
    const key = fleet + ":" + number;
    const cell = el("td", "intel-cell");
    const markers = el("div", "intel-cell-markers");
    cell.append(markers);
    function showMarkers() {
      markers.replaceChildren();
      for (const value of intel.get(key) || []) {
        const [shape, color] = value.split(":");
        const image = intelToken(shape, color);
        image.draggable = false;
        image.title = image.alt + " · 右键消除";
        image.oncontextmenu = (event) => {
          event.preventDefault();
          intel.get(key).delete(value);
          showMarkers();
        };
        markers.append(image);
      }
    }
    cell.ondragover = (event) => {
      if (!event.dataTransfer.types.includes(intelType)) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "copy";
      cell.classList.add("drag-over");
    };
    cell.ondragleave = (event) => {
      if (!cell.contains(event.relatedTarget)) cell.classList.remove("drag-over");
    };
    cell.ondrop = (event) => {
      cell.classList.remove("drag-over");
      event.preventDefault();
      const value = event.dataTransfer.getData(intelType);
      const [shape, color] = value.split(":");
      if (!Object.hasOwn(intelShapes, shape) || !Object.hasOwn(intelColors, color)) return;
      if (!intel.has(key)) intel.set(key, new Set());
      intel.get(key).add(value);
      showMarkers();
    };
    showMarkers();
    return cell;
  }
  function intelTable() {
    const table = el("table", "intel-table");
    table.setAttribute("aria-label", "舰船状态记录");
    const headings = table.createTHead().insertRow();
    headings.append(el("th", "", ""));
    for (let number = 1; number <= 5; number++) {
      const heading = el("th", "", "No." + number);
      heading.scope = "col";
      headings.append(heading);
    }
    const rows = table.createTBody();
    for (const fleet of ["blue", "red", "gray", "yellow"]) {
      const row = rows.insertRow();
      const badge = el("th", "fleet-badge");
      badge.scope = "row"; badge.title = game.fleets[fleet].name;
      badge.style.setProperty("--fleet", game.fleets[fleet].color);
      const icon = shipImage(fleet, 1);
      icon.alt = badge.title;
      badge.append(icon); row.append(badge);
      for (let number = 1; number <= 5; number++) row.append(intelCell(fleet, number));
    }
    return table;
  }
  function energyPanel() {
    const panel = el("section", "energy-panel");
    const remaining = myself().energy;
    const heading = el("h4", "energy-heading", "剩余能量");
    heading.append(el("span", "energy-count", String(remaining)));
    const energy = el("div", "energy-bank"); energy.setAttribute("aria-label", "公共能量 " + myself().energy);
    const cost = mode === "shift" ? 1 : mode === "confirm" ? Math.abs(targetGear - myShip().gear)
      : ["confirm-scan", "scan-question"].includes(mode) && !myShip().probe ? 2 : 0;
    energy.style.setProperty("--energy-columns", Math.ceil(Math.max(12, remaining) / 2));
    for (let i = 0; i < Math.max(12, remaining); i++) {
      const state = i >= remaining ? " spent" : i >= remaining - cost ? " flashing" : "";
      energy.append(el("span", "energy-block" + state));
    }
    panel.append(heading, energy);
    return panel;
  }
  function playerConsole() {
    const panel = el("aside", "player-console");
    const body = el("div", "console-body");
    const heading = el("h3", "console-title", "舰队控制台");
    heading.title = game.fleets[myself().fleet].name + " · " + myself().name;
    const indicators = el("div", "action-indicators");
    const movement = game.phase === "battle" && canAct() && !game.gear_used;
    for (const [label, available] of [["移动", movement], ["战术", game.phase === "battle" && canAct() && !game.tactic_used]]) {
      const indicator = el("div", "action-indicator" + (available ? " lit" : ""));
      indicator.append(el("span", "", label), el("span", "indicator-state", available ? "可用" : "已用"));
      indicators.append(indicator);
    }
    const summary = el("div", "ship-summary");
    for (let number = 1; number <= 5; number++) {
      const ship = myself().ships[number - 1];
      const item = el("div", "summary-ship");
      const role = el("div", "summary-role", ship?.destroyed ? "已摧毁" : labels[ship?.role] || "—");
      if (ship?.gear > 0) {
        const marker = el("img", "card-gear-marker");
        marker.src = `/static/assets/gear-${ship.gear}.png`; marker.alt = ship.gear + "档";
        role.append(marker);
      }
      item.append(el("span", "", "No." + number), role); summary.append(item);
    }
    body.append(heading, indicators, el("h4", "console-label", "己方舰种"), summary);
    const resources = el("div", "console-resources");
    const orders = el("div", "console-orders");
    orders.append(intelPalette(), button("结束回合", () => {
      selected = null; mode = "selected"; targetGear = null; command({type: "end_turn"});
    }, game.phase !== "battle" || !canAct(), "end-turn"));
    resources.append(energyPanel(), orders);
    if (game.phase === "placement") {
      const tray = el("div", "ship-tray");
      for (const ship of myself().ships.filter((s) => !s.ring)) {
        const token = button("", () => { selected = ship.number; draft = null; placementNotice = ""; draw(); }, !canAct(), selected === ship.number ? "tray-ship active" : "tray-ship secondary");
        token.setAttribute("aria-label", "部署" + ship.number + "号舰船");
        token.append(shipImage(myself().fleet, ship.number), el("span", "", ship.number + "号"));
        token.draggable = canAct(); token.style.setProperty("--fleet", color(myself()));
        token.ondragstart = (e) => {
          e.dataTransfer.setData("application/x-dark-campaign-deploy", String(ship.number));
          e.dataTransfer.effectAllowed = "move";
        };
        tray.append(token);
      }
      body.append(el("h4", "console-label", "待部署舰船"), tray);
    }
    body.append(el("h4", "console-label", "舰船状态记录"), intelTable(), resources);
    if (["placement", "battle"].includes(game.phase) && !canAct()) {
      body.inert = false;
      panel.append(el("div", "console-lock", busy() ? "正在结算移动或事件，请稍候" : "等待 " + captain(current())));
    }
    panel.prepend(body);
    const logSlot = el("div", "battle-log-slot");
    logSlot.append(battleLog());
    panel.append(logSlot);
    if (myself().eliminated || game.phase === "finished") {
      panel.classList.add("inactive-console");
      let text = "您的舰队已被全灭";
      if (game.phase === "finished") text = game.winner === null ? "平局 · 母舰同时摧毁" : game.winner === me ? "您是最后的幸存者" : text;
      panel.append(el("div", "outcome-banner", text));
    }
    return panel;
  }
  function setLogExpanded(log, expanded) {
    logExpanded = expanded;
    log.classList.toggle("expanded", expanded);
    log.querySelector(".log-toggle").setAttribute("aria-expanded", String(expanded));
    const entries = log.querySelector(".battle-log-entries");
    entries.tabIndex = expanded ? 0 : -1;
    if (!expanded || entries.scrollTop === 0) entries.scrollTop = entries.scrollHeight;
  }
  document.addEventListener("click", (event) => {
    const log = root().querySelector(".battle-log.expanded");
    if (log && !log.contains(event.target)) setLogExpanded(log, false);
  }, true);
  function battleLog() {
    const log = el("section", "battle-log");
    const toggle = button("回合记录", () => setLogExpanded(log, !logExpanded), false, "log-toggle");
    toggle.setAttribute("aria-label", "回合记录");
    toggle.setAttribute("aria-controls", "battle-log-entries");
    const entries = el("div", "battle-log-entries");
    entries.id = "battle-log-entries";
    entries.setAttribute("aria-label", "本局回合记录");
    let round = 0;
    for (const entry of game.logs) {
      if (entry.round !== round) {
        round = entry.round;
        entries.append(el("h4", "", "第 " + round + " 轮"));
      }
      entries.append(el("p", "log-" + entry.kind, entry.text));
    }
    if (!game.logs.length) entries.append(el("p", "hint", "全员放置完毕后开始记录"));
    entries.onclick = () => { if (!logExpanded) setLogExpanded(log, true); };
    log.append(toggle, entries);
    setLogExpanded(log, logExpanded);
    return log;
  }
  function rolesOverlay() {
    const overlay = el("div", "game-overlay");
    const card = el("div", "role-card");
    card.append(el("span", "eyebrow", "PRIVATE SHIP CONFIGURATION"), el("h2", "", myself().roles_ready ? "请等待其他舰长" : "请部署舰船种类"));
    if (!myself().roles_ready) {
      const slots = el("div", "role-slots");
      for (let i = 0; i < 5; i++) {
        const label = el("label", "role-slot", "No." + (i + 1));
        const select = el("select"); select.setAttribute("aria-label", (i + 1) + "号舰船种类");
        const placeholder = el("option", "", "选择舰种"); placeholder.value = ""; select.append(placeholder);
        for (const [value, name] of Object.entries(labels)) { const option = el("option", "", name); option.value = value; select.append(option); }
        select.value = roleDraft[i]; select.onchange = () => { roleDraft[i] = select.value; updateValidation(); };
        label.append(el("span", "role-icon", "▲"), select); slots.append(label);
      }
      const complete = button("部署完成", () => {
        const valid = roleDraft.filter((v) => v === "attack").length === 2 && roleDraft.filter((v) => v === "scout").length === 2 && roleDraft.filter((v) => v === "mothership").length === 1;
        if (!valid) error("请选择攻击舰*2；探测舰*2；母舰*1");
        else command({type: "set_roles", roles: roleDraft});
      }, true, "role-complete");
      function updateValidation() {
        const filled = roleDraft.every(Boolean);
        const valid = roleDraft.filter((v) => v === "attack").length === 2 && roleDraft.filter((v) => v === "scout").length === 2 && roleDraft.filter((v) => v === "mothership").length === 1;
        complete.disabled = !filled; complete.className = "role-complete " + (filled ? valid ? "valid" : "invalid" : "");
      }
      updateValidation(); card.append(slots, el("p", "hint", "仅你可见 · 攻击舰 ×2 / 探测舰 ×2 / 母舰 ×1"), complete);
    } else card.append(el("p", "hint", "你的舰种已秘密锁定。其他玩家不会收到你的舰种配置。"));
    overlay.append(card); return overlay;
  }
  function eventOverlay() {
    const pending = game.pending;
    if (mode !== "scan-question" && !pending) return null;
    if (pending?.players && !pending.players.includes(me)) return null;
    const overlay = el("div", "event-overlay");
    const card = el("div", "event-card");
    if (mode === "scan-question") {
      card.append(el("h3", "", "选择一个原生能力问题"),
        button("可攻击？", () => submitTactic("scan", "attack")),
        button("可探测？", () => submitTactic("scan", "scout")),
        button("取消", () => { mode = "confirm-scan"; draw(); }));
    } else if (pending.type === "collision_choice") {
      card.append(el("h3", "", pending.owner === me ? "是否发起碰撞？" : "撞击警告"));
      if (pending.owner === me) {
        for (const [label, collide] of [["碰撞", true], ["不碰撞", false]]) {
          card.append(button(label, () => command({type: "collision_choice", event_id: pending.id, collide})));
        }
      } else card.append(el("p", "", "等待碰撞发起方选择"));
    } else if (pending.type.startsWith("collision_")) {
      card.append(el("h3", "", pending.type === "collision_result" ? pending.success ? "撞击成功" : "撞击失败" : "碰撞判定 · D6"));
      const dice = el("div", "collision-dice");
      const rolling = pending.type === "collision_roll" && Date.now() / 1000 >= pending.started_at + 2;
      const players = [pending.owner, ...pending.players.filter(owner => owner !== pending.owner)];
      for (const owner of players) {
        const crew = game.crews.find(c => c.id === owner);
        const die = el("div", "die-player");
        const cube = el("div", "die" + (rolling ? " rolling" : ""), pending.rolls ? String(pending.rolls[owner]) : "?");
        die.append(el("p", "", crew.name + (owner === me ? "（你）" : "") + (owner === pending.owner ? " · 发起方" : " · 防守方")), cube);
        dice.append(die);
      }
      card.append(dice, el("p", "", "发起方点数 ≥ 防守方点数之和，则所有参与舰船各受2点伤害"));
    } else if (pending.type === "scan_effect") {
      return null;
    } else if (pending.type === "scan_result") {
      card.append(el("h3", "", pending.text));
    }
    overlay.append(card); return overlay;
  }
  function draw() {
    layoutObserver.disconnect(); cancelAnimationFrame(layoutFrame);
    const previousLog = root().querySelector(".battle-log-entries");
    const previousScroll = previousLog ? previousLog.scrollTop : 0;
    const followingLog = !previousLog || previousLog.scrollHeight - previousLog.clientHeight - previousScroll < 35;
    clearTimeout(timer); root().replaceChildren();
    if (!game) return;
    root().classList.toggle("match-view", game.phase !== "fleet");
    if (game.phase === "fleet") { fleetSelection(); return; }
    const phaseText = game.phase === "finished" ? "对局结束" : game.phase === "roles" ? "秘密配置舰种" : game.phase === "placement" ? "轮流部署舰船" : "第 " + game.round + " 轮 · " + captain(current()) + "的回合";
    root().append(header(phaseText, game.phase === "placement" ? "每人每次部署一艘 · 初始0档 · 确认后轮到下一位舰长" : "位置公开 / 舰种隐藏 · 移动与回合原型"));
    const layout = el("div", "game-layout");
    layout.inert = game.phase === "roles" || (game.phase === "battle" && Date.now() / 1000 < game.battle_starts_at);
    const field = el("div", "battle-field");
    const dock = el("div", "board-dock");
    if ((draft && game.phase === "placement") || (selected && game.phase === "battle" && canAct())) {
      dock.append(shipMenu());
    } else {
      const message = placementNotice || (game.phase === "placement"
        ? selected ? "点选空格，预览部署位置。" : "拖拽舰船到空格，或点选舰船后选择空格。"
        : game.resolving ? "正在结算移动或途中事件，请稍候" : "公共棋盘 · 点选己方舰船查看操作");
      const hint = el("p", "board-hint", message);
      hint.setAttribute("role", "status");
      dock.append(hint);
    }
    const space = el("div", "board-space");
    space.append(board());
    field.append(space, dock);
    const event = eventOverlay();
    if (event) field.append(event);
    const consoleViewport = el("div", "console-viewport");
    consoleViewport.append(playerConsole());
    layout.append(field, consoleViewport); root().append(layout);
    fitLayout();
    GameMedia.refresh();
    layoutObserver.observe(layout);
    layoutObserver.observe(dock);
    layoutObserver.observe(consoleViewport.querySelector(".console-body"));
    if (game.phase === "roles") root().append(rolesOverlay());
    if (game.phase === "battle" && Date.now() / 1000 < game.battle_starts_at) {
      const intro = el("div", "game-overlay battle-intro"); intro.append(el("h2", "", "战斗开始")); root().append(intro);
    } else if (game.phase === "battle" && Date.now() < toastUntil) root().append(el("div", "turn-toast", "你的回合"));
    const deadlines = [game.busy_until * 1000, game.battle_starts_at * 1000, toastUntil,
      (game.pending?.until || 0) * 1000, ((game.pending?.started_at || 0) + 2) * 1000].filter((deadline) => deadline > Date.now());
    if (deadlines.length) timer = setTimeout(draw, Math.min(...deadlines) - Date.now() + 30);
    const logKey = game.logs.length + ":" + game.phase;
    const entries = layout.querySelector(".battle-log-entries");
    entries.scrollTop = !logExpanded || (pendingKey !== logKey && followingLog) ? entries.scrollHeight : previousScroll;
    pendingKey = logKey;
  }
  function render(state, playerId, send) {
    trackMotions(game, state.game);
    room = state; me = playerId; emit = send; game = state.game;
    if (!game) { reset(); return; }
    if (lastPhase !== game.phase) { selected = null; draft = null; mode = "selected"; targetGear = null; }
    const turn = game.round + ":" + game.current_player;
    if (lastTurn !== turn) {
      selected = null; draft = null; mode = "selected"; targetGear = null; placementNotice = "";
      if (game.phase === "battle" && game.current_player === me) toastUntil = Math.max(Date.now(), game.busy_until * 1000, game.battle_starts_at * 1000) + 1100;
    }
    if (selected && myShip()?.destroyed) { selected = null; mode = "selected"; target = null; }
    if (game.resolving && mode !== "selected") { mode = "selected"; target = null; targetGear = null; }
    lastPhase = game.phase; lastTurn = turn; draw();
    GameMedia.sync(game, me);
  }
  return {render, reset, error};
})();
