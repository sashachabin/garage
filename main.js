import * as THREE from "three";
import { sfx, unlock } from "./sfx.js";

// ===============================================================================
// Гараж — два помещения друг за другом (в длину):
//   • ДАЛЬНЕЕ (мастерская, z = -5.91 .. 0): столешница вплотную к правой стене,
//     барные полки и верстак у торцевой стены, постеры и кресла.
//   • ПЕРЕДНЕЕ (z = 0 .. +5.5): прихожая-гараж с воротами, свободный проезд.
// Между ними — перегородка с проёмом-аркой (шириной ~2 м), машина проезжает.
// Стеллажи/полки стоят строго у стен, без щелей за ними.
// Потолок — бетонные плиты со швами; пол — тёмные продольные доски;
// левая стена — стандартный красный кирпич. Верхней заливки нет —
// направленные споты рабочей зоны вдоль правой стены + тёплый свет в торце.
// -------------------------------------------------------------------------------

const WID = 3.6;
const HALF = WID / 2;
const IWL = -HALF;
const IWR = HALF;
const T = 0.12; // толщина стен и перегородки
const H = 2.6; // потолок чуть повыше

const ROOM_REAR_L = 6.21; // дальнее помещение (мастерская)
const ROOM_FRONT_L = 6.6; // ближнее помещение (ворота)
const Z_REAR = -ROOM_REAR_L; // задняя торцевая стена
const Z_PART = 0; // ось перегородки
const Z_FRONT = Z_PART + T + ROOM_FRONT_L; // лицевая стена (5.56)

// Проём-арка в перегородке (машина проезжает)
const ARCH_W = 2.0;
const ARCH_H = 2.1;
const ARCH_X0 = -ARCH_W / 2;
const ARCH_X1 = ARCH_W / 2;

const TOTAL_LEN = Z_FRONT - Z_REAR; // ≈ 11.5
const ZC = (Z_REAR + Z_FRONT) / 2;

let scene, camera, renderer, clock;
let character,
  localRefs,
  torso,
  leftArm,
  rightArm,
  leftElbow,
  rightElbow,
  leftLeg,
  rightLeg,
  leftKnee,
  rightKnee;
let keys = {};
let faceYaw = 0;
let walkSpeed = 0;
let animTime = 0;

// Состояние «сидит на стуле»
const chairSeats = [];
let sitting = -1; // индекс стула (-1 — не сидим)
let cWasDown = false;

function smartRoomRadioNear() {
  return (
    Math.hypot(
      character.position.x - GARAGE_RADIO_POS.x,
      character.position.z - GARAGE_RADIO_POS.z,
    ) < 1.8
  );
}
function radioNear() {
  return smartRoomRadioNear();
}

// Радио в мастерской (верстак у задней стены, рядом с красным шкафом)
const GARAGE_RADIO_POS = { x: 0.72, z: Z_REAR + 0.15 }; // у верстака
let radioEl = null; // HTMLAudioElement
let radioStation = -1; // индекс активной станции (-1 — выкл)
let radioVolume = 0.15; // громкость радио (общая для всех)
let radioMenuOpen = false; // открыто меню станций
let rdMenuBuilt = false;
let rdEDown = false; // анти-повтор по E
let radioVolBuilt = false;
const RADIO_STATIONS = [
  { name: "Европа Плюс", url: "http://ep128.hostingradio.ru:8030/ep128", freq: "103.0" },
  { name: "Русское Радио", url: "http://rusradio.hostingradio.ru/rusradio128.mp3", freq: "105.1" },
  { name: "Дорожное радио", url: "http://dorognoe.hostingradio.ru:8000/dorognoe", freq: "101.3" },
  { name: "Наше Радио", url: "http://nashe1.hostingradio.ru:80/nashe-128.mp3", freq: "106.2" },
  {
    name: "Ретро FM 70-е",
    url: "http://retro70.hostingradio.ru:80/retro70-128.mp3",
    freq: "100.9",
  },
  { name: "Ретро FM 80-е", url: "http://retro80.hostingradio.ru:80/retro80-128.mp3", freq: "99.6" },
  { name: "Ретро FM 90-е", url: "http://retro90.hostingradio.ru:80/retro90-128.mp3", freq: "98.4" },
  { name: "Радио СИ", url: "https://online.radioc.ru/radioc", freq: "90.3" },
];

function initGarageRadio() {
  radioEl = document.getElementById("garageradio");
  if (!radioEl) return;
  radioEl.volume = radioVolume;
  buildRadioMenu();
  buildRadioVol();
  const close = document.getElementById("rm-close");
  if (close) close.onclick = closeRadioMenu;
  const off = document.getElementById("rm-off");
  if (off) off.onclick = toggleRadioOff;
}
function buildRadioVol() {
  const vol = document.getElementById("rm-vol");
  if (!vol || radioVolBuilt) return;
  radioVolBuilt = true;
  vol.value = Math.round(radioVolume * 100);
  vol.oninput = () => {
    radioVolume = Math.max(0, Math.min(1, +vol.value / 100));
    if (radioEl) radioEl.volume = radioVolume;
    sendRadioState();
  };
}
function buildRadioMenu() {
  const wrap = document.getElementById("rm-stations");
  if (!wrap || rdMenuBuilt) return;
  rdMenuBuilt = true;
  wrap.innerHTML = "";
  RADIO_STATIONS.forEach((st, i) => {
    const b = document.createElement("button");
    const num = document.createElement("span");
    num.className = "rm-num";
    num.textContent = "P" + (i + 1);
    const nm = document.createElement("span");
    nm.className = "rm-name";
    nm.textContent = st.name;
    b.appendChild(num);
    b.appendChild(nm);
    b.onclick = () => selectRadioStation(i);
    wrap.appendChild(b);
  });
}
function selectRadioStation(i) {
  radioStation = i;
  unlock();
  if (radioEl) {
    radioEl.src = RADIO_STATIONS[i].url;
    radioEl.volume = radioVolume;
    radioEl.play().catch(() => {});
  }
  sendRadioState();
  paintRadioMenu();
}
function toggleRadioOff() {
  radioStation = -1;
  if (radioEl) {
    radioEl.pause();
    radioEl.src = "";
  }
  sendRadioState();
  paintRadioMenu();
}
function sendRadioState() {
  if (ws && ws.readyState === 1)
    ws.send(JSON.stringify({ type: "radio", station: radioStation, volume: radioVolume }));
}
function applyRadioState(station, volume) {
  if (typeof volume === "number") radioVolume = volume;
  const vol = document.getElementById("rm-vol");
  if (vol) vol.value = Math.round(radioVolume * 100);
  if (radioEl) radioEl.volume = radioVolume;
  const next = typeof station === "number" ? station : radioStation;
  if (next === radioStation) return;
  radioStation = next;
  if (radioStation >= 0 && radioEl) {
    radioEl.src = RADIO_STATIONS[radioStation].url;
    radioEl.volume = radioVolume;
    radioEl.play().catch(() => {});
  } else if (radioEl) {
    radioEl.pause();
    radioEl.src = "";
  }
  paintRadioMenu();
}
function openRadioMenu() {
  radioMenuOpen = true;
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.add("menu");
  const el = document.getElementById("radiomenu");
  if (el) el.classList.add("open");
  paintRadioMenu();
}
function closeRadioMenu() {
  radioMenuOpen = false;
  document.body.classList.remove("menu");
  const el = document.getElementById("radiomenu");
  if (el) el.classList.remove("open");
}
function paintRadioMenu() {
  const st = radioStation;
  const freqEl = document.getElementById("rm-freq");
  if (freqEl) freqEl.textContent = st >= 0 ? "FM " + RADIO_STATIONS[st].freq : "FM — — . —";
  const tape = document.getElementById("rm-tape-in");
  if (tape)
    tape.textContent =
      st >= 0
        ? "▶ " + RADIO_STATIONS[st].name + "   ·   " + RADIO_STATIONS[st].freq + " MHz"
        : "РАДИО ВЫКЛЮЧЕНО";
  const stLed = document.getElementById("rm-stereo");
  if (stLed) stLed.classList.toggle("on", st >= 0);
  const wrap = document.getElementById("rm-stations");
  if (!wrap) return;
  wrap.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i === radioStation));
}
// Пространственное затухание радио: в комнате с радио слышно примерно одинаково;
// в соседнем помещении — мягко тише, через арку чуть громче, через стену — глуше.
function radioSpatialGain() {
  if (!character) return 1;
  const rx = GARAGE_RADIO_POS.x,
    rz = GARAGE_RADIO_POS.z;
  const px = character.position.x,
    pz = character.position.z;
  // та же комната (радио за перегородкой) — почти ровная громкость
  if ((pz - Z_PART) * (rz - Z_PART) >= 0) return 1;
  // соседнее помещение: мягкое приглушение
  const d = Math.hypot(px - rx, pz - rz);
  const t = (Z_PART - rz) / (pz - rz);
  const cx = rx + (px - rx) * t;
  let g;
  if (Math.abs(cx) < ARCH_W / 2)
    g = 0.8; // через арку
  else g = 0.35; // сквозь стену
  g *= 1 / (1 + d * d * 0.006);
  return Math.max(0.15, g);
}
function updateGarageRadio(dt) {
  if (!radioEl || !character) return;
  const d = Math.hypot(
    character.position.x - GARAGE_RADIO_POS.x,
    character.position.z - GARAGE_RADIO_POS.z,
  );
  // Подсказка рядом с верстаком
  const hint = document.getElementById("radiohint");
  const near = d < 1.8 && !dead && !chatOpen;
  if (hint) hint.classList.toggle("show", near && !radioMenuOpen);
  if (!near && radioMenuOpen) closeRadioMenu();
  if (near && keys["KeyE"] && !rdEDown) {
    rdEDown = true;
    if (radioMenuOpen) closeRadioMenu();
    else openRadioMenu();
  }
  if (!keys["KeyE"]) rdEDown = false;
  // Радио играет постоянно для всех — громкость по пространству
  if (radioStation < 0 || dead) {
    if (radioEl.paused === false) radioEl.pause();
    return;
  }
  radioEl.volume = radioVolume * radioSpatialGain();
  if (!radioEl.paused) return;
  radioEl.play().catch(() => {});
}

const colliders = [];
const cameraColliders = []; // полки/стеллажи: блокируют камеру только на своей высоте
const RADIUS = 0.26; // чуть больше — персонаж пошире

// Реестр построенных из scene.json объектов (для текстур постеров и пр.)
const regObjs = new Map();
function reg(name, obj3d) {
  regObjs.set(name, obj3d);
  obj3d.userData.regName = name;
}

const D2R = Math.PI / 180;

// ---------------------------------------------------------------------------
// Мультиплеер: WebSocket-синхронизация игроков
// ---------------------------------------------------------------------------
const NICK_CHARS = "АБВГДЕЖИКЛМНОПРСТУФХЦЧШЩЭЮЯ";
function randomNick() {
  let n = "";
  for (let i = 0; i < 4; i++) n += NICK_CHARS[(Math.random() * NICK_CHARS.length) | 0];
  return "Гость-" + n;
}
const PLAYER_COLORS = [
  { body: 0x2266aa, sleeve: 0x1c6e4d, pants: 0x384257 },
  { body: 0xc0392b, sleeve: 0x7d241a, pants: 0x384257 },
  { body: 0xe67e22, sleeve: 0xa85a12, pants: 0x46517a },
  { body: 0x27ae60, sleeve: 0x186b37, pants: 0x384257 },
  { body: 0x8e44ad, sleeve: 0x5d2a74, pants: 0x384257 },
  { body: 0x16a085, sleeve: 0x0f6657, pants: 0x384257 },
  { body: 0x34495e, sleeve: 0x1f2c3a, pants: 0x2d3a4f },
];
const SKIN_TONES = [0xf0c79b, 0xe3a86e, 0xc88749, 0x8f5a2c, 0x9c6434, 0xd3a058];
const HAIR_COLORS = [0x2b1a0f, 0x50341c, 0x1f1208, 0x8a5a2b, 0x44323a, 0x6b3a1e];

let myId = null,
  myNick = randomNick();
let myLook = null; // внешность локального игрока: { body, sleeve, pants, skin, hair }
const remotePlayers = new Map(); // id -> { base, group, refs, pos, rotY, moveSpeed, run, sitting, animT, meshLabel }
let ws = null;
let wsReconnect = 0;

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function connectNet() {
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    try {
      ws.close();
    } catch {}
  }
  if (wsReconnect) {
    clearTimeout(wsReconnect);
    wsReconnect = null;
  }
  ws.onopen = () => {
    console.log("WS connected");
    wsReconnect = 0;
  };
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "hello") {
      myId = msg.id;
      myNick = msg.nick;

      // СОЗДАЁМ МЕТКУ ПОСЛЕ ПОЛУЧЕНИЯ НИКА ОТ СЕРВЕРА
      if (!localLabel) {
        buildLocalLabel();
      } else {
        updateLocalNick(msg.nick);
      }

      document.body.classList.add("online");
      for (const p of msg.peers || []) {
        if (p.id !== myId) spawnRemotePlayer(p);
      }
      applyRadioState(
        msg.radio ? msg.radio.station : -1,
        msg.radio ? msg.radio.volume : radioVolume,
      );
      renderPlayerList();
    } else if (msg.type === "state") {
      const p = remotePlayers.get(msg.id);
      if (!p) spawnRemotePlayer(msg);
      else updateRemotePlayer(p, msg.state);
    } else if (msg.type === "leave") {
      removeRemotePlayer(msg.id);
    } else if (msg.type === "chat") {
      pushChatMessage(msg.nick, msg.text);
    } else if (msg.type === "signal") {
      handleSignal(msg);
    } else if (msg.type === "knock") {
      onKnockReceived(msg);
    } else if (msg.type === "radio") {
      applyRadioState(msg.station, msg.volume);
    }
  };
  ws.onclose = () => {
    document.body.classList.remove("online");
    if (!wsReconnect) {
      wsReconnect = setTimeout(() => {
        wsReconnect = 0;
        connectNet();
      }, 2500);
    }
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {}
  };
}

function ownState() {
  return {
    x: +character.position.x.toFixed(3),
    y: +character.position.y.toFixed(3),
    z: +character.position.z.toFixed(3),
    r: +rotYaw.toFixed(3),
    s: +moveSpeed.toFixed(3),
    run: +(keys["ShiftLeft"] || keys["ShiftRight"]) ? 1 : 0,
    sit: sitting >= 0 ? 1 : 0,
    at: +animTime.toFixed(3),
    hp: Math.max(0, Math.round(hp)),
    dead: dead ? 1 : 0,
    kick: kickAnim > 0 ? 1 : 0,
    kt: +Math.max(0, kickAnim).toFixed(3),
    pt: punchAnim > 0 ? 1 : 0,
    hy: localRefs && localRefs.head ? +localRefs.head.rotation.y.toFixed(3) : 0,
    px: +headPitch.toFixed(3),
    ap: myLook ? [myLook.body, myLook.sleeve, myLook.pants, myLook.skin, myLook.hair] : null,
  };
}

let netTimer = 0;
function syncSend(dt) {
  netTimer += dt;
  if (netTimer < 0.05) return; // 20 Гц
  netTimer = 0;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "state", state: ownState() }));
  }
}

function idHash(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
function cycleColors(id) {
  return PLAYER_COLORS[idHash(id) % PLAYER_COLORS.length];
}
function randomVariant(colors) {
  return {
    body: colors.body,
    sleeve: colors.sleeve,
    pants: colors.pants,
    skin: SKIN_TONES[(Math.random() * SKIN_TONES.length) | 0],
    hair: HAIR_COLORS[(Math.random() * HAIR_COLORS.length) | 0],
  };
}

function remoteLook(msg) {
  // Внешность, как у игрока на его экране (приходит в каждом state)
  const a = msg.state && msg.state.ap;
  if (a && a.length === 5) {
    return { body: a[0], sleeve: a[1], pants: a[2], skin: a[3], hair: a[4] };
  }
  // Запасной вариант: стабильный набор по id
  const h = idHash(msg.id);
  const colors = cycleColors(msg.id);
  return {
    body: colors.body,
    sleeve: colors.sleeve,
    pants: colors.pants,
    skin: SKIN_TONES[h % SKIN_TONES.length],
    hair: HAIR_COLORS[(h >> 3) % HAIR_COLORS.length],
  };
}

function spawnRemotePlayer(msg) {
  const { id } = msg;
  if (remotePlayers.has(id)) return;
  const { group, refs } = createCharacter(remoteLook(msg));
  group.position.set(0, 0, 0);
  scene.add(group);
  const entry = {
    group,
    refs,
    pos: new THREE.Vector3(0, 0, 0),
    rot: 0,
    moveSpeed: 0,
    run: 0,
    sitting: 0,
    animT: 0,
    hp: 100,
    dead: 0,
    hitTint: 0,
    velX: 0,
    velZ: 0, // скорость (для предсказания)
    txPrev: 0,
    tzPrev: 0, // предыдущая цель
    updT: 0, // время последнего state
    nick: msg.nick || randomNick(),
  };
  // Метка с ником и HP
  const label = document.createElement("div");
  label.className = "player-label";
  label.innerHTML =
    `<div class="pl-name">${escapeHtml(entry.nick)}</div>` +
    `<div class="pl-hp"><i style="width:100%"></i><span class="pl-hpnum">100 HP</span></div>`;
  document.body.appendChild(label);
  entry.label = label;
  remotePlayers.set(id, entry);
  updateRemotePlayer(entry, msg.state);
  renderPlayerList();
  voicePeerJoined(id);
}

function updateRemotePlayer(p, st) {
  if (!st) return;
  // Запоминаем направление движения (dead reckoning) между пакетами
  const t = netClock;
  const ddt = t - (p.updT ?? t);
  if (ddt > 0.001) {
    const vx = (st.x - p.txPrev) / ddt;
    const vz = (st.z - p.tzPrev) / ddt;
    if (Number.isFinite(vx) && Number.isFinite(vz)) {
      p.velX += (vx - p.velX) * Math.min(1, 8 * ddt);
      p.velZ += (vz - p.velZ) * Math.min(1, 8 * ddt);
    }
  }
  p.txPrev = st.x;
  p.tzPrev = st.z;
  p.updT = t;
  p.pos.set(st.x, st.y, st.z);
  p.rot = st.r;
  p.moveSpeed = st.s;
  p.run = st.run;
  p.sitting = st.sit;
  p.animT = st.at;
  if (st.hp !== undefined) p.hp = st.hp;
  if (st.dead !== undefined) p.dead = st.dead;
  if (st.kick) p.kickT = 0.4; // запускаем пинок у удалённого игрока
  if (st.pt) p.punchT = 0.18; // и удар рукой
  if (st.hy !== undefined) p.headY = st.hy;
  if (st.px !== undefined) p.headP = st.px;
  p.hadState = true;
}

function removeRemotePlayer(id) {
  const p = remotePlayers.get(id);
  if (p) {
    scene.remove(p.group);
    if (p.label) p.label.remove();
    remotePlayers.delete(id);
  }
  const pc = radioPeers.get(id);
  if (pc) {
    try {
      pc.close();
    } catch {}
    radioPeers.delete(id);
  }
  renderPlayerList();
}

function renderPlayerList() {
  const list = document.getElementById("net");
  if (!list) return;
  let html = `<b>${escapeHtml(myNick)}</b> <span class="you">(вы)</span>`;
  for (const [id, p] of remotePlayers) {
    if (p.nick) html += `<br />${escapeHtml(p.nick)}`;
  }
  list.innerHTML = html;
}

function smoothRemote(entry, dt) {
  // Dead reckoning: если пакеты долго не приходят (afk / пауза сети),
  // продолжаем двигать удалённого игрока по его последней скорости.
  const idle = netClock - (entry.updT ?? netClock);
  if (idle > 0.2 && entry.moveSpeed > 0.05 && !entry.dead && entry.sitting === 0) {
    const deg = Math.min(1, 14 * dt) * Math.max(0, 1 - idle * 0.6);
    entry.pos.x += entry.velX * deg;
    entry.pos.z += entry.velZ * deg;
    entry.moveSpeed *= 1 - Math.min(1, 1.5 * dt); // скорость тускнеет со временем
  }
  // сглаживание позиции и поворота
  const k = 1 - Math.pow(0.0001, dt);
  entry.group.position.x += (entry.pos.x - entry.group.position.x) * k;
  entry.group.position.z += (entry.pos.z - entry.group.position.z) * k;
  entry.group.position.y += (entry.pos.y - entry.group.position.y) * k;
  let d = entry.rot - entry.group.rotation.y;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  entry.group.rotation.y += d * k;
}

function updateRemoteAnim(entry, dt) {
  const r = entry.refs;
  // Целевая поза удалённого игрока — суставы плавно тянутся к ней (без рывков)
  const P = {
    ll: 0,
    rl: 0,
    lk: 0,
    rk: 0,
    la: 0,
    ra: 0,
    le: 0,
    re: 0,
    lz: 0.1,
    rz: -0.1,
    tx: 0,
    ty: 0,
    tz: 0,
    cz: 0,
  };

  if (entry.kickT > 0) {
    entry.kickT -= dt;
    const p = 1 - Math.max(0, entry.kickT) / 0.4;
    const s = Math.sin(p * Math.PI);
    P.ll = -1.6 * s;
    P.lk = Math.max(0, -Math.cos(p * Math.PI)) * 1.1;
    P.tx = -0.25 + s * 0.3;
  } else if (entry.punchT > 0) {
    entry.punchT -= dt;
    const p = 1 - Math.max(0, entry.punchT) / 0.18;
    const s = Math.sin(p * Math.PI) * 1.6;
    P.ra = -s;
    P.re = 0.08 * s;
    P.tx = 0.1;
  } else if (entry.dead) {
    // лежит на спине после нокаута
    P.cz = -1.45;
    P.ll = -0.3;
    P.rl = -0.6;
    P.lk = 0.2;
    P.rk = 0.5;
    P.la = 1.0;
    P.ra = 0.3;
    P.le = -0.6;
    P.re = -0.3;
  } else if (entry.sitting) {
    // сидячая поза: поджатые ноги
    P.ll = -1.25;
    P.rl = -1.25;
    P.lk = 1.25;
    P.rk = 1.25;
    P.la = -0.7;
    P.ra = -0.7;
    P.le = -1.2;
    P.re = -1.2;
    P.tx = 0.06;
  } else if (entry.moveSpeed > 0.05) {
    entry.animT += dt * entry.moveSpeed * (entry.run ? 4.2 : 3.0);
    const s = Math.sin(entry.animT),
      c = Math.cos(entry.animT);
    if (entry.run) {
      const stride = 0.85;
      P.ll = s * stride;
      P.rl = -s * stride;
      P.lk = Math.max(0, -c) * 1.35;
      P.rk = Math.max(0, c) * 1.35;
      P.la = -s * 0.6;
      P.ra = s * 0.6;
      P.le = -1.25 + s * 0.15;
      P.re = -1.25 - s * 0.15;
      P.lz = 0.15;
      P.rz = -0.15;
      P.tx = 0.18 + Math.abs(s) * 0.03;
      P.tz = s * 0.08;
    } else {
      const stride = 0.5;
      P.ll = s * stride;
      P.rl = -s * stride;
      P.lk = Math.max(0, -c) * 0.25;
      P.rk = Math.max(0, c) * 0.25;
      P.la = -s * 0.22;
      P.ra = s * 0.22;
      P.le = -0.3 + Math.max(0, -s) * 0.2;
      P.re = -0.3 + Math.max(0, s) * 0.2;
      P.tx = 0.04;
    }
  } else {
    // стоим — лёгкое дыхание
    entry.animT += dt;
    const br = Math.sin(entry.animT * 2.2) * 0.04;
    P.la = -0.12 + br;
    P.ra = -0.12 - br * 0.6;
    P.le = -0.35;
    P.re = -0.35;
  }

  // Тянем суставы к целям
  const bL = 16,
    bU = 13,
    bT = 10;
  r.leftLeg.rotation.x = damp(r.leftLeg.rotation.x, P.ll, bL, dt);
  r.rightLeg.rotation.x = damp(r.rightLeg.rotation.x, P.rl, bL, dt);
  r.leftKnee.rotation.x = damp(r.leftKnee.rotation.x, P.lk, bL, dt);
  r.rightKnee.rotation.x = damp(r.rightKnee.rotation.x, P.rk, bL, dt);
  r.leftArm.rotation.x = damp(r.leftArm.rotation.x, P.la, bU, dt);
  r.rightArm.rotation.x = damp(r.rightArm.rotation.x, P.ra, bU, dt);
  r.leftElbow.rotation.x = damp(r.leftElbow.rotation.x, P.le, bU, dt);
  r.rightElbow.rotation.x = damp(r.rightElbow.rotation.x, P.re, bU, dt);
  r.leftArm.rotation.z = damp(r.leftArm.rotation.z, P.lz, 9, dt);
  r.rightArm.rotation.z = damp(r.rightArm.rotation.z, P.rz, 9, dt);
  r.torso.rotation.x = damp(r.torso.rotation.x, P.tx, bT, dt);
  r.torso.rotation.y = damp(r.torso.rotation.y, P.ty, bT, dt);
  r.torso.rotation.z = damp(r.torso.rotation.z, P.tz, bT, dt);
  if (r.head) {
    r.head.rotation.y = damp(r.head.rotation.y, entry.headY ?? 0, 14, dt);
    r.head.rotation.x = damp(r.head.rotation.x, entry.headP ?? 0, 14, dt);
  }
  entry.group.rotation.z = damp(entry.group.rotation.z, P.cz, 8, dt);
  damp(entry.group.position.y, entry.pos.y, 12, dt);

  smoothRemote(entry, dt);
}

// ФУНКЦИЯ СОЗДАНИЯ МЕТКИ - ИСПРАВЛЕНА
function buildLocalLabel() {
  const label = document.createElement("div");
  label.className = "player-label you";
  const displayName = myNick || "Вы";
  label.innerHTML =
    `<div class="pl-name">${escapeHtml(displayName)}</div>` +
    `<div class="pl-hp"><i style="width:100%"></i><span class="pl-hpnum">100 HP</span></div>`;
  document.body.appendChild(label);
  localLabel = label;
  console.log("✅ Локальная метка создана:", displayName);
}

function updateLocalNick(nick) {
  if (localLabel) {
    const nameEl = localLabel.querySelector(".pl-name");
    if (nameEl) nameEl.textContent = escapeHtml(nick);
  }
  myNick = nick;
}

function updatePlayerLabels() {
  // Обновляем метку локального игрока
  if (localLabel) {
    const v = new THREE.Vector3(0, 2.1, 0);
    character.localToWorld(v);
    v.project(camera);

    // Конвертируем в экранные координаты
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;

    // Если метка за пределами экрана - скрываем
    if (v.z > 1) {
      localLabel.style.display = "none";
    } else {
      localLabel.style.display = "block";
      // Центрируем метку над головой
      localLabel.style.left = x + "px";
      localLabel.style.top = y - 10 + "px";
      localLabel.style.transform = "translate(-50%, -100%)";
    }

    // Обновляем HP
    const hpFill = localLabel.querySelector(".pl-hp i");
    const hpNum = localLabel.querySelector(".pl-hpnum");
    const hpV = Math.max(0, Math.min(100, hp));
    if (hpFill) {
      hpFill.style.width = hpV + "%";
      const color = hpV > 55 ? "#7ddb4e" : hpV > 25 ? "#ffb13c" : "#ff4d3d";
      hpFill.style.background = color;
    }
    if (hpNum) hpNum.textContent = Math.ceil(hpV) + " HP";
  }

  // Обновляем метки удаленных игроков
  for (const [id, entry] of remotePlayers) {
    if (!entry.label) continue;
    const v = new THREE.Vector3(0, 2.1, 0);
    entry.group.localToWorld(v);
    v.project(camera);

    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;

    if (v.z > 1) {
      entry.label.style.display = "none";
    } else {
      entry.label.style.display = "block";
      entry.label.style.left = x + "px";
      entry.label.style.top = y - 10 + "px";
      entry.label.style.transform = "translate(-50%, -100%)";
    }

    const hpFill = entry.label.querySelector(".pl-hp i");
    const hpNum = entry.label.querySelector(".pl-hpnum");
    const hpV = Math.max(0, Math.min(100, entry.hp || 100));
    if (hpFill) {
      hpFill.style.width = hpV + "%";
      const color = hpV > 55 ? "#7ddb4e" : hpV > 25 ? "#ffb13c" : "#ff4d3d";
      hpFill.style.background = color;
    }
    if (hpNum) hpNum.textContent = Math.ceil(hpV) + " HP";

    const nameEl = entry.label.querySelector(".pl-name");
    if (nameEl && entry.nick) {
      nameEl.textContent = entry.nick;
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

// ---------------------------------------------------------------------------
// Текстовый чат: T — открыть, Enter — отправить, Esc — закрыть
// ---------------------------------------------------------------------------
let chatOpen = false;
let chatBuffer = "";

function toggleChat() {
  if (chatOpen) closeChat();
  else openChat();
}
function openChat() {
  chatOpen = true;
  if (document.pointerLockElement) document.exitPointerLock();
  const box = document.getElementById("chat");
  if (!box) return;
  box.classList.add("open");
  const inp = document.getElementById("chatinput");
  inp.value = chatBuffer;
  inp.focus();
}
function closeChat() {
  const inp = document.getElementById("chatinput");
  if (inp) chatBuffer = inp.value;
  chatOpen = false;
  const box = document.getElementById("chat");
  if (box) box.classList.remove("open");
}

function submitChatText() {
  const inp = document.getElementById("chatinput");
  const text = (inp.value || "").trim();
  chatBuffer = "";
  closeChat();
  if (!text) return;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "chat", text }));
  pushChatMessage(myNick, text);
}

function pushChatMessage(nick, text) {
  if (nick !== myNick) sfx.chat();
  const log = document.getElementById("chatlog");
  if (!log) return;
  const div = document.createElement("div");
  const t = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  div.innerHTML = `<span class="ct">${t}</span> <b>${escapeHtml(nick)}:</b> ${escapeHtml(text)}`;
  log.appendChild(div);
  while (log.childNodes.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
function pushChatSystem(text) {
  const log = document.getElementById("chatlog");
  if (!log) return;
  const div = document.createElement("div");
  div.className = "csys";
  div.textContent = text;
  log.appendChild(div);
  while (log.childNodes.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------------------
// Рация WebRTC (push-to-talk), клавиша V
// ---------------------------------------------------------------------------
const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];
let radioStream = null;
let radioMic = null; // MediaStreamTrack
let radioPeers = new Map(); // peerId -> RTCPeerConnection
let radioTalking = false;
let radioInit = false;

async function ensureMic() {
  if (radioMic) return true;
  try {
    const st = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    radioStream = st;
    radioMic = st.getAudioTracks()[0];
    radioInit = true;
    return true;
  } catch (e) {
    pushChatSystem("Микрофон недоступен: " + e.message);
    return false;
  }
}

function setRadioUI(on) {
  radioTalking = on;
  if (radioMic) radioMic.enabled = on;
  const el = document.getElementById("radio");
  if (el) {
    el.textContent = on ? "🔴 РАЦИЯ: говорите…" : "🎙 РАЦИЯ (V)";
    el.classList.toggle("active", !!on);
  }
}

function radioStart() {
  sfx.radio(true);
  ensureMic().then((ok) => {
    if (!ok) {
      sfx.radio(false);
      return;
    }
    setRadioUI(true);
    connectVoicePeers();
    attachMicToPeers();
  });
}
function radioStop() {
  sfx.radio(false);
  setRadioUI(false);
}

// подтянуть микрофон в уже существующие пиры (если рацию включили позже)
function attachMicToPeers() {
  if (!radioMic || !radioStream) return;
  for (const [pid, pc] of radioPeers) {
    if (pc.__trackAdded) continue;
    try {
      pc.addTrack(radioMic, radioStream);
      pc.__trackAdded = true;
    } catch {}
    if (pc.signalingState === "stable" && myId < pid) initiateOffer(pc);
  }
}

function connectVoicePeers() {
  for (const id of remotePlayers.keys()) ensureVoicePeer(id);
}

function ensureVoicePeer(peerId) {
  if (radioPeers.has(peerId)) return;
  const pc = new RTCPeerConnection({ iceServers });
  pc.peerId = peerId;
  pc.negotiating = false;
  pc.onicecandidate = (ev) => {
    if (ev.candidate && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "signal", to: peerId, data: { ice: ev.candidate } }));
    }
  };
  pc.ontrack = (ev) => {
    if (ev.streams[0]) {
      const au = document.getElementById("audiopeer");
      if (au) au.srcObject = ev.streams[0];
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      try {
        pc.close();
      } catch {}
      if (radioPeers.get(peerId) === pc) radioPeers.delete(peerId);
    }
  };
  pc.onnegotiationneeded = () => {
    if (myId < peerId) initiateOffer(pc); // главный инициатор — меньший id
  };
  if (radioMic && radioStream) {
    try {
      pc.addTrack(radioMic, radioStream);
    } catch {}
  }
  radioPeers.set(peerId, pc);
  if (myId < peerId) initiateOffer(pc);
}

function initiateOffer(pc) {
  if (pc.negotiable) return;
  pc.negotiable = true;
  pc.createOffer()
    .then((o) => pc.setLocalDescription(o))
    .then(() => {
      if (ws && ws.readyState === 1) {
        ws.send(
          JSON.stringify({ type: "signal", to: pc.peerId, data: { sdp: pc.localDescription } }),
        );
      }
    })
    .catch(() => {
      pc.negotiable = false;
    });
}

function handleSignal(msg) {
  const payload = msg.data;
  const fromId = msg.id;
  if (payload.sdp) {
    const pc = radioPeers.get(fromId) || (ensureVoicePeer(fromId), radioPeers.get(fromId));
    pc.setRemoteDescription(payload.sdp)
      .then(() => {
        if (payload.sdp.type === "offer") {
          if (radioMic && radioStream && !pc.__trackAdded) {
            pc.__trackAdded = true;
            try {
              pc.addTrack(radioMic, radioStream);
            } catch {}
          }
          pc.createAnswer()
            .then((a) => pc.setLocalDescription(a))
            .then(() => {
              if (ws && ws.readyState === 1)
                ws.send(
                  JSON.stringify({
                    type: "signal",
                    to: fromId,
                    data: { sdp: pc.localDescription },
                  }),
                );
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  } else if (payload.ice && radioPeers.has(fromId)) {
    radioPeers
      .get(fromId)
      .addIceCandidate(new RTCIceCandidate(payload.ice))
      .catch(() => {});
  }
}

function voicePeerJoined(id) {
  // когда появился новый игрок — подключим рацию из него по инициатору
  if (radioInit) ensureVoicePeer(id);
}

// ---------------------------------------------------------------------------
// Драка: F — удар по ближайшему игроку, отброс через сервер
// ---------------------------------------------------------------------------
let punchAnim = 0; // анимация замаха руки (таймер)
let kickAnim = 0; // анимация пинка с разбега (таймер)
let punchCool = 0; // кулдаун удара
let hitFlash = 0; // вспышка экрана при ударе/получении
let punchSide = 0; // поочерёдность рук (0 — правая, 1 — левая)
let strikeSeq = 0; // ротация ударов мышкой: рукаЛ→рукаП→ногаЛ→ногаП
let kickCool = 0; // кулдаун пинка
let kickSide = 0; // какой ногой пинаем (0 — правая, 1 — левая)
let punchHi = 0; // куда целимся: 0 — тело/грудь, 1 — морда
let recoilT = 0; // таймер лёгкого откидывания при получении удара
let recoilNx = 0,
  recoilNz = 0; // направление удара (единичный вектор по земле)
let netClock = 0; // монотонные секунды для сетевой синхронизации
let headPitch = 0,
  headWorld = 0,
  headLocalY = 0; // голова: наклон + непрерывный мировой угол + сглаженный поворот
let camYawAcc = 1000; // накопитель угла взгляда камеры (режим «грудь»)
let mouseAcc = 0; // накопитель мыши (режим «спина»)
let prevTheta = Math.PI / 2; // camTheta на прошлом кадре (для скорости мыши)
let prevHeadMode = ""; // прошлый режим головы: move | chest | back
let lastCamTheta = null; // прошлый угол камеры (для лёгкого наклона корпуса)
let camLeanZ = 0,
  camLeanX = 0; // сглаженный наклон корпуса от мыши
let camPulse = 0,
  camPulseTgt = 0; // отдача камеры: чуть отходит при ударах/движении и возвращается

// единичный вектор по земле к игроку по id (если класс у него есть и он близок)
function d2dNorm(id) {
  const e = id != null ? remotePlayers.get(id) : null;
  if (!e || !e.group) return null;
  const dx = e.group.position.x - character.position.x;
  const dz = e.group.position.z - character.position.z;
  const l = Math.hypot(dx, dz);
  if (l < 0.01) return null;
  return { x: dx / l, z: dz / l };
}
let hp = 100; // здоровье (броня и деньги — «по фану» убраны)
let dead = false,
  deadT = 0; // смерть: флаг + таймер до возрождения
let localTint = 0; // покраснение собственного персонажа при ударе
let localLabel = null; // метка над своим персонажем
const SPAWN_POS = { x: -0.5, z: 1.2 };

function tryPunch() {
  // Интернет/мигание: без кулдауна — каждый клик следующий удар по ротации
  if (sitting >= 0 || chatOpen || dead) return;
  punchCool = 0.15; // защита от спама на сервер
  const fwd = new THREE.Vector3(-Math.sin(rotYaw), 0, -Math.cos(rotYaw));
  // Ротация: левая рука → правая рука → левая нога → правая нога → …
  const st = strikeSeq % 4;
  strikeSeq++;
  camPulseTgt = Math.min(1, camPulseTgt + 0.5);
  const kick = st >= 2;
  if (kick) {
    kickAnim = 0.4;
    punchAnim = 0;
    kickSide = st === 3 ? 1 : 0; // 2 — левая нога, 3 — правая нога
  } else {
    punchAnim = 0.18;
    kickAnim = 0;
    punchSide = st === 0 ? 1 : 0; // 0 — левая рука, 1 — правая рука
  }
  let bestId = null,
    bestScore = -Infinity;
  for (const [id2, entry] of remotePlayers) {
    if (!entry.group) continue;
    const dvec = new THREE.Vector3(
      entry.group.position.x - character.position.x,
      0,
      entry.group.position.z - character.position.z,
    );
    const d2d = dvec.length();
    if (d2d < 1.5) {
      const score = dvec.dot(fwd) - d2d * 0.6; // передний конус
      if (score > bestScore) {
        bestScore = score;
        bestId = id2;
      }
    }
  }
  // Пинок — мощный отброс (в ротации после рук); удар рукой — лёгкий
  // Куда бьём: вплотную — в морду, чуть дальше — в тело/грудь
  punchHi = 0;
  if (bestId !== null) {
    const te = remotePlayers.get(bestId).group.position;
    const td = Math.hypot(te.x - character.position.x, te.z - character.position.z);
    punchHi = td < 0.85 ? 1 : 0;
    // корпус доворачивается к врагу в момент удара
    const want = Math.atan2(-(te.x - character.position.x), -(te.z - character.position.z));
    let dY = want - rotYaw;
    while (dY > Math.PI) dY -= 2 * Math.PI;
    while (dY < -Math.PI) dY += 2 * Math.PI;
    rotYaw += dY * 0.75; // резкий доворот куда смотрим
    rotVel = 0;
    // короткий выпад вперёд для достижения цели
    const dirN = d2dNorm(bestId);
    if (dirN) {
      velSim.px += dirN.x * 1.1;
      velSim.pz += dirN.z * 1.1;
    }
  }
  if (bestId !== null && ws && ws.readyState === 1) {
    const tgt = remotePlayers.get(bestId);
    const dir = [
      +(tgt.group.position.x - character.position.x || 0),
      0,
      +(tgt.group.position.z - character.position.z || 0),
    ];
    ws.send(JSON.stringify({ type: "knock", to: bestId, dir, pwr: kick ? 2.2 : 0.5 }));
    const ht = remotePlayers.get(bestId);
    if (ht) ht.hitTint = 0.6; // красная вспышка у цели (у нас в кадре)
  }
  if (kick) {
    velSim.px += fwd.x * 1.6;
    velSim.pz += fwd.z * 1.6;
    sfx.kick();
  } else {
    // Удар рукой: клик мгновенно запускает анимацию (рука уже выбрана выше)
    sfx.punch();
  }
  if (bestId !== null) sfx.body(0.16, 0.42, 190, 70); // соприкосновение с целью
}

function takeHit(dmg) {
  if (dead) return;
  hp = Math.max(0, hp - dmg);
  hitFlash = 0.4;
  localTint = 0.6;
  sfx.hurt();
  if (hp <= 0) die();
}

function die() {
  dead = true;
  deadT = 3.2;
  velSim.px = velSim.pz = velSim.vx = velSim.vz = 0;
  sfx.death();
}

function onKnockReceived(msg) {
  if (dead) return;
  // Pwr из сообщения: пинок — сильный отброс, рука — лёгкий
  const k = msg.pwr !== undefined ? msg.pwr : 0.5;
  const dx = (msg.dir && msg.dir[0]) || 0;
  const dz = (msg.dir && msg.dir[2]) || 0;
  let len = Math.hypot(dx, dz) || 1;
  const rl = 1 / len;
  const kb = k; // лёгкое откидывание: удар рукой — меньше, пинок — чуть больше
  velSim.px += dx * rl * kb * 1.6;
  velSim.pz += dz * rl * kb * 1.6;
  velSim.vx += dx * rl * kb * 14;
  velSim.vz += dz * rl * kb * 14;
  recoilT = 0.28;
  recoilNx = dx * rl;
  recoilNz = dz * rl;
  takeHit(k > 1 ? 22 : 16);
}

function respawn() {
  dead = false;
  deadT = 0;
  hp = 100;
  character.position.set(SPAWN_POS.x, 0, SPAWN_POS.z);
  character.rotation.y = rotYaw = 0;
  rotVel = 0;
  velSim.px = velSim.pz = velSim.vx = velSim.vz = 0;
  vy = 0;
  onGround = true;
  if (sitting >= 0) standUp();
  roomCrouchReset();
  // эффект возрождения
  hitFlash = 0.3;
  sfx.respawn();
}

function roomCrouchReset() {
  crouched = false;
  crouch = 0;
}

// ---------------------------------------------------------------------------
// Инициализация
// ---------------------------------------------------------------------------
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0e10);

  camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 200);
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  buildLights();
  buildRoom();
  buildFurniture();
  buildCharacter();
  character.position.set(-0.5, 0, 1.2);

  // НЕ СОЗДАЁМ МЕТКУ ЗДЕСЬ - ОНА БУДЕТ СОЗДАНА ПОСЛЕ ПОЛУЧЕНИЯ НИКА ОТ СЕРВЕРА
  // buildLocalLabel(); // <-- УДАЛЕНО!

  connectNet();
  sfx.ambient(true); // лёгкий гул гаража (звук начнётся после первого клика)
  initGarageRadio();

  addEventListener("keydown", (e) => {
    unlock(); // разблокировка аудио первым вводом
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code))
      e.preventDefault();
    if (e.code === "KeyT" && !e.repeat) toggleChat();
    if (e.code === "KeyV" && !e.repeat) radioStart();
    if (e.code === "KeyF" && !e.repeat) tryPunch();
    if (e.code === "Enter" && chatOpen) {
      e.preventDefault();
      submitChatText();
    }
    if (e.code === "Escape" && chatOpen) {
      closeChat();
    }
    if (e.code === "Escape" && radioMenuOpen) {
      closeRadioMenu();
    }
  });
  addEventListener("keyup", (e) => {
    keys[e.code] = false;
    if (e.code === "KeyV") radioStop();
  });
  addEventListener("resize", onResize);

  // Орбитальная камера: ЛКМ-перетаскивание и зум колесом
  addEventListener("pointerdown", (e) => {
    unlock();
    onPointerDown(e);
  });
  addEventListener("pointermove", onPointerMove);
  addEventListener("pointerup", onPointerUp);
  addEventListener("wheel", onWheel, { passive: true });

  animate();
}

// ---------------------------------------------------------------------------
// Освещение: без верхней заливки, споты рабочей зоны вдоль правой стены
// ---------------------------------------------------------------------------
function buildLights() {
  // Вертикальный градиент: ярко у потолка, сумрачно у пола.
  // Основной свет — потолочные точки с затуханием 1/d^2, поэтому потолок и
  // верх стен светлые, а пол заметно темнее.
  scene.add(new THREE.HemisphereLight(0xffe9d4, 0x2a1f14, 0.78));
  scene.add(new THREE.AmbientLight(0xffead6, 0.32));

  // Слабый боковой свет — не подсвечивает пол снизу.
  const sideLight = new THREE.DirectionalLight(0xffe5c6, 1.45);
  sideLight.position.set(-6, 5, 2);
  sideLight.target.position.set(0, H - 1, -2);
  scene.add(sideLight);
  scene.add(sideLight.target);

  // Слабые низкие светильники — смягчают переход у пола.
  const ent = new THREE.PointLight(0xffdfb2, 1.4, 26, 1.6);
  ent.position.set(0, 1.6, Z_FRONT + 1.4);
  scene.add(ent);

  const end = new THREE.PointLight(0xffd08e, 1.15, 7, 1.8);
  end.position.set(-0.4, 1.9, Z_REAR + 0.3);
  scene.add(end);

  // ---- ГЛАВНЫЙ СВЕТ: потолочные лампы (яркий верх, тёмный низ) ----
  const frontCenterZ = (Z_PART + Z_FRONT) / 2 - 0.5;
  const rearCenterZ = (Z_REAR + Z_PART) / 2;

  const ceilingLight = new THREE.PointLight(0xffe6c6, 5.8, 9.5, 1.6);
  ceilingLight.position.set(0, H - 0.1, frontCenterZ);
  scene.add(ceilingLight);

  const rearCeilLight = new THREE.PointLight(0xffe6c6, 4.6, 9.5, 1.6);
  rearCeilLight.position.set(0, H - 0.1, rearCenterZ);
  scene.add(rearCeilLight);

  // Тёплая подсветка потолочной полки с бутылками (ярче наверху, но мягкая)
  const shelfGlow = new THREE.PointLight(0xffd8a6, 0.9, 3.0, 1.8);
  shelfGlow.position.set(0, 2.1, -5.6);
  scene.add(shelfGlow);

  // Потолочный светильник (передняя)
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xcccccc, roughness: 0.6 });
  const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.08, 8), lampMat);
  lampShade.position.set(0, H - 0.05, frontCenterZ);
  scene.add(lampShade);

  // Свечение (полупрозрачная сфера)
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xfff0d4,
    transparent: true,
    opacity: 0.15,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), glowMat);
  glow.position.set(0, H - 0.1, frontCenterZ);
  scene.add(glow);

  // Направленные споты размещены прямо на левой кирпичной стене (IWL)
  const taskZ = [-2.2, -4.52];
  const spotMat = new THREE.MeshLambertMaterial({ color: 0x9fa3a8 });
  for (const z of taskZ) {
    const sp = new THREE.PointLight(0xffe6c0, 2.2, 5.2, 1.8);
    sp.position.set(IWL + 0.05, H - 0.12, z);
    scene.add(sp);

    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.1, 8), spotMat);
    housing.position.set(IWL + 0.03, H - 0.12, z);
    housing.rotation.z = Math.PI / 2;
    scene.add(housing);
  }
}

// ---------------------------------------------------------------------------
// Коробка: пол, потолок, стены, перегородка с аркой, ворота
// ---------------------------------------------------------------------------
function buildRoom() {
  // Текстуры: старый кирпич, бетонный потолок, понытый деревянный пол
  const tex = (url, repU, repV, shade = 0xffffff) => {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repU, repV);
    return new THREE.MeshLambertMaterial({ map: t, color: shade, side: THREE.DoubleSide });
  };

  // Плоский материал для кирпича (без объёма) + градиент затемнения к полу
  const texBrick = (url, repU, repV, shade = 0xffffff) =>
    new THREE.MeshLambertMaterial({
      map: (() => {
        const t = new THREE.TextureLoader().load(url);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repU, repV);
        return t;
      })(),
      color: shade,
      side: THREE.DoubleSide,
      vertexColors: true,
    });

  // Плавное потемнение снизу вверх: bottomShade (низ) → topShade (верх) по вершинам.
  const addHeightGradient = (geo, bottomShade = 0.42, topShade = 1) => {
    const pos = geo.attributes.position;
    let ymin = Infinity,
      ymax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = ymin === ymax ? 1 : (pos.getY(i) - ymin) / (ymax - ymin);
      const tt = Math.pow(t, 1.8);
      const c = bottomShade + (topShade - bottomShade) * tt;
      colors[i * 3] = c;
      colors[i * 3 + 1] = c;
      colors[i * 3 + 2] = c;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  };

  const floorMat = tex("textures/floor_wood.jpg", WID + 0.2, TOTAL_LEN + 0.6, 0x6e6e6e);
  const ceilMat = tex("textures/wall.jpg", WID / 2, TOTAL_LEN / 2, 0xc2c2c2);
  const slabMat = new THREE.MeshLambertMaterial({ color: 0x8d8d8d });
  const grayMat = new THREE.MeshLambertMaterial({ color: 0x8d8d8d, side: THREE.DoubleSide });
  const wallLftMat = tex("textures/wall.jpg", ROOM_FRONT_L, H, 0xadadad);
  const wallRgtMat = tex("textures/wall.jpg", TOTAL_LEN, H, 0xadadad);
  wallLftMat.vertexColors = true;
  wallLftMat.needsUpdate = true;
  wallRgtMat.vertexColors = true;
  wallRgtMat.needsUpdate = true;
  const wallMat = texBrick("textures/brick_old.jpg", ROOM_REAR_L, H);
  const wallY = H / 2;

  // Пол (обе комнаты)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WID + 0.2, TOTAL_LEN + 0.6), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, ZC);
  scene.add(floor);

  // Потолок (плиты)
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(WID, TOTAL_LEN), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, H - 0.02, ZC);
  scene.add(ceiling);

  // Плита сверху (толщина потолка)
  const ceilSlab = new THREE.Mesh(new THREE.BoxGeometry(WID + 0.3, 0.1, TOTAL_LEN + 0.5), slabMat);
  ceilSlab.position.set(0, H + 0.07, ZC);
  scene.add(ceilSlab);

  // Вторая (дальняя) комната: левая стена — старая грубая кирпичная кладка
  const leftRear = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_REAR_L, H), wallMat);
  leftRear.rotation.y = Math.PI / 2;
  leftRear.position.set(IWL, wallY, (Z_REAR + Z_PART) / 2);
  addHeightGradient(leftRear.geometry, 0.3, 1);
  scene.add(leftRear);

  // Первая (передняя) комната: левая стена — серый бетон
  const leftFront = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_FRONT_L + T, H), wallLftMat);
  leftFront.rotation.y = Math.PI / 2;
  leftFront.position.set(IWL, wallY, (Z_PART + T + Z_FRONT) / 2);
  addHeightGradient(leftFront.geometry, 0.3, 1);
  scene.add(leftFront);

  // Правая стена (обе комнаты) — серая штукатурка
  const right = new THREE.Mesh(new THREE.PlaneGeometry(TOTAL_LEN, H), wallRgtMat);
  right.rotation.y = -Math.PI / 2;
  right.position.set(IWR, wallY, ZC);
  addHeightGradient(right.geometry, 0.3, 1);
  scene.add(right);

  // Задняя торцевая — тот же старый кирпич, чуть темнее
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(WID, H),
    texBrick("textures/brick_old.jpg", WID, H, 0x7a7a70),
  );
  back.position.set(0, wallY, Z_REAR);
  addHeightGradient(back.geometry, 0.3, 1);
  scene.add(back);

  // Лицевая стена — серая штукатурка (wall.jpg), ворота лежат на ней
  const faceMat = tex("textures/wall.jpg", WID, H, 0x9a9a92);
  faceMat.vertexColors = true;
  faceMat.needsUpdate = true;
  const faceWall = new THREE.Mesh(new THREE.PlaneGeometry(WID + 0.06, H), faceMat);
  faceWall.position.set(0, wallY, Z_FRONT);
  addHeightGradient(faceWall.geometry, 0.3, 1);
  scene.add(faceWall);

  // Мягкое освещение у компьютеров (без светящейся ленты)
  for (const z of [-3.3, -1.4]) {
    const glow = new THREE.PointLight(0xffc078, 1.25, 4.0);
    glow.position.set(1.62, 1.48, z);
    scene.add(glow);
  }

  // Лампа из стены левее красного шкафа (у верстака)
  const lampLight = new THREE.SpotLight(0xffd8aa, 7.5, 8, 0.75, 0.5, 1.0);
  lampLight.position.set(0.4, 1.85, -6.1);
  lampLight.target.position.set(0.4, 0.95, -5.9);
  scene.add(lampLight);
  scene.add(lampLight.target);
  // мягкая заливка зоны у красного шкафа (без яркого пятна на нём)
  const lampFill = new THREE.PointLight(0xffd8aa, 1.5, 6.0, 1.6);
  lampFill.position.set(0.4, 1.85, -6.1);
  scene.add(lampFill);

  // Ворота-дверь: полигон с door.jpg, аккуратно по центру, не на всю стену
  const doorTex = new THREE.TextureLoader().load("textures/door.jpg");
  doorTex.colorSpace = THREE.SRGBColorSpace;
  doorTex.anisotropy = 8;
  const doorMat = new THREE.MeshLambertMaterial({
    map: doorTex,
    side: THREE.DoubleSide,
    color: 0xe8e8e8,
  });
  const DW = 2.95;
  const DH = DW * (569 / 953); // ≈ 1.55 — пропорция текстуры, без искажений
  const door = new THREE.Mesh(new THREE.PlaneGeometry(DW, DH), doorMat);
  door.rotation.y = Math.PI; // лицевая сторона — внутрь гаража
  door.position.set(0, DH / 2 + 0.06, Z_FRONT - 0.045);
  scene.add(door);

  // Тёмная рама вокруг ворот
  const frameMat = new THREE.MeshLambertMaterial({
    color: 0x23272c,
    roughness: 0.6,
    metalness: 0.25,
  });
  const fr = 0.07; // ширина перекладин рамы
  const fz = 0.035; // толщина рамы
  const fz0 = Z_FRONT - 0.045;
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(DW + fr * 2, fr, fz), frameMat);
  frameTop.position.set(0, DH + 0.06 + fr / 2, fz0);
  const frameBot = new THREE.Mesh(new THREE.BoxGeometry(DW + fr * 2, fr, fz), frameMat);
  frameBot.position.set(0, 0.06 - fr / 2, fz0);
  const frameL = new THREE.Mesh(new THREE.BoxGeometry(fr, DH + fr * 2, fz), frameMat);
  frameL.position.set(-DW / 2 - fr / 2, DH / 2 + 0.06, fz0);
  const frameR = new THREE.Mesh(new THREE.BoxGeometry(fr, DH + fr * 2, fz), frameMat);
  frameR.position.set(DW / 2 + fr / 2, DH / 2 + 0.06, fz0);
  scene.add(frameTop, frameBot, frameL, frameR);

  // Перегородка с проёмом-аркой (та же wall.jpg, что у стен)
  const pw = IWR - ARCH_X1; // ширина пилона с каждой боковины
  const partMat = tex("textures/wall.jpg", pw, H, 0xadadad);
  const lintelMat = tex("textures/wall.jpg", ARCH_X1 - ARCH_X0, H - ARCH_H, 0xadadad);
  partMat.vertexColors = true;
  partMat.needsUpdate = true;
  lintelMat.vertexColors = true;
  lintelMat.needsUpdate = true;
  const lp = new THREE.Mesh(new THREE.BoxGeometry(pw, H, T), partMat);
  lp.position.set((IWL + ARCH_X0) / 2, wallY, Z_PART);
  addHeightGradient(lp.geometry, 0.34, 1);
  scene.add(lp);
  const rp = new THREE.Mesh(new THREE.BoxGeometry(pw, H, T), partMat);
  rp.position.set((ARCH_X1 + IWR) / 2, wallY, Z_PART);
  addHeightGradient(rp.geometry, 0.34, 1);
  scene.add(rp);
  const lin = new THREE.Mesh(
    new THREE.BoxGeometry(ARCH_X1 - ARCH_X0 + T * 2, H - ARCH_H, T + 0.04),
    lintelMat,
  );
  lin.position.set(0, (H + ARCH_H) / 2, Z_PART);
  addHeightGradient(lin.geometry, 0.34, 1);
  scene.add(lin);

  // тёмная отделка краёв проёма
  const trimMat = new THREE.MeshLambertMaterial({
    color: 0x1f2226,
    roughness: 0.5,
    metalness: 0.4,
  });
  const edgeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, H, 0.05), trimMat);
  edgeL.position.set(ARCH_X0 - 0.04, wallY, Z_PART);
  scene.add(edgeL);
  const edgeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, H, 0.05), trimMat);
  edgeR.position.set(ARCH_X1 + 0.04, wallY, Z_PART);
  scene.add(edgeR);

  // коллизии пилонов (проход — только через арку)
  const halfZ = T / 2 + 0.05;
  colliders.push({ minX: IWL, maxX: ARCH_X0, minZ: -halfZ, maxZ: halfZ });
  colliders.push({ minX: ARCH_X1, maxX: IWR, minZ: -halfZ, maxZ: halfZ });
}

// ---------------------------------------------------------------------------
// Мебель и декор: ВСЁ строится из scene.json (контролируется /debug и файлом)
// Имена «стул_*» дают сидение + коллизию; «столешница» и «верстак_столешница»
// дают коллизию; «радио_корпус» — позицию звука радио.
// ---------------------------------------------------------------------------
const matCache = new Map();

// Плоское зеркало с настоящим отражением (three.js examples, Reflector.js r160)
class Reflector extends THREE.Mesh {
  constructor(geometry, options = {}) {
    super(geometry);
    this.isReflector = true;
    this.type = "Reflector";
    this.camera = new THREE.PerspectiveCamera();
    const scope = this;
    const color = options.color !== undefined ? new THREE.Color(options.color) : new THREE.Color(0x7f7f7f);
    const textureWidth = options.textureWidth || 512;
    const textureHeight = options.textureHeight || 512;
    const clipBias = options.clipBias || 0;
    const shader = options.shader || Reflector.ReflectorShader;
    const multisample = options.multisample !== undefined ? options.multisample : 4;
    const reflectorPlane = new THREE.Plane();
    const normal = new THREE.Vector3();
    const reflectorWorldPosition = new THREE.Vector3();
    const cameraWorldPosition = new THREE.Vector3();
    const rotationMatrix = new THREE.Matrix4();
    const lookAtPosition = new THREE.Vector3(0, 0, -1);
    const clipPlane = new THREE.Vector4();
    const view = new THREE.Vector3();
    const target = new THREE.Vector3();
    const q = new THREE.Vector4();
    const textureMatrix = new THREE.Matrix4();
    const virtualCamera = this.camera;
    const renderTarget = new THREE.WebGLRenderTarget(textureWidth, textureHeight, {
      samples: multisample,
      type: THREE.HalfFloatType,
    });
    const material = new THREE.ShaderMaterial({
      name: shader.name !== undefined ? shader.name : "unspecified",
      uniforms: THREE.UniformsUtils.clone(shader.uniforms),
      fragmentShader: shader.fragmentShader,
      vertexShader: shader.vertexShader,
    });
    material.uniforms["tDiffuse"].value = renderTarget.texture;
    material.uniforms["color"].value = color;
    material.uniforms["textureMatrix"].value = textureMatrix;
    this.material = material;
    this.onBeforeRender = function (renderer, scene, camera) {
      reflectorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
      cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
      rotationMatrix.extractRotation(scope.matrixWorld);
      normal.set(0, 0, 1);
      normal.applyMatrix4(rotationMatrix);
      view.subVectors(reflectorWorldPosition, cameraWorldPosition);
      if (view.dot(normal) > 0) return;
      view.reflect(normal).negate();
      view.add(reflectorWorldPosition);
      rotationMatrix.extractRotation(camera.matrixWorld);
      lookAtPosition.set(0, 0, -1);
      lookAtPosition.applyMatrix4(rotationMatrix);
      lookAtPosition.add(cameraWorldPosition);
      target.subVectors(reflectorWorldPosition, lookAtPosition);
      target.reflect(normal).negate();
      target.add(reflectorWorldPosition);
      virtualCamera.position.copy(view);
      virtualCamera.up.set(0, 1, 0);
      virtualCamera.up.applyMatrix4(rotationMatrix);
      virtualCamera.up.reflect(normal);
      virtualCamera.lookAt(target);
      virtualCamera.far = camera.far;
      virtualCamera.updateMatrixWorld();
      virtualCamera.projectionMatrix.copy(camera.projectionMatrix);
      textureMatrix.set(
        0.5, 0.0, 0.0, 0.5,
        0.0, 0.5, 0.0, 0.5,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0,
      );
      textureMatrix.multiply(virtualCamera.projectionMatrix);
      textureMatrix.multiply(virtualCamera.matrixWorldInverse);
      textureMatrix.multiply(scope.matrixWorld);
      reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
      reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);
      clipPlane.set(reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant);
      const projectionMatrix = virtualCamera.projectionMatrix;
      q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
      q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
      q.z = -1.0;
      q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
      clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
      projectionMatrix.elements[2] = clipPlane.x;
      projectionMatrix.elements[6] = clipPlane.y;
      projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
      projectionMatrix.elements[14] = clipPlane.w;
      scope.visible = false;
      const currentRenderTarget = renderer.getRenderTarget();
      const currentXrEnabled = renderer.xr.enabled;
      const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(renderTarget);
      renderer.state.buffers.depth.setMask(true);
      if (renderer.autoClear === false) renderer.clear();
      renderer.render(scene, virtualCamera);
      renderer.xr.enabled = currentXrEnabled;
      renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
      renderer.setRenderTarget(currentRenderTarget);
      const viewport = camera.viewport;
      if (viewport !== undefined) renderer.state.viewport(viewport);
      scope.visible = true;
    };
    this.getRenderTarget = function () {
      return renderTarget;
    };
    this.dispose = function () {
      renderTarget.dispose();
      scope.material.dispose();
    };
  }
}
Reflector.ReflectorShader = {
  name: "ReflectorShader",
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    float blendOverlay( float base, float blend ) {
      return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );
    }
    vec3 blendOverlay( vec3 base, vec3 blend ) {
      return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec4 base = texture2DProj( tDiffuse, vUv );
      gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

async function buildFurniture() {
  let list = [];
  try {
    const r = await fetch("/api/scene");
    const data = await r.json();
    if (Array.isArray(data.objects)) list = data.objects;
  } catch (e) {
    /* сцены нет — пустой гараж */
  }

  const mat = (col, op, em) => {
    if (em !== undefined) {
      // самосветящиеся ленты подсветки
      let m = matCache.get("em" + em);
      if (!m) {
        m = new THREE.MeshBasicMaterial({ color: em & 0xffffff });
        matCache.set("em" + em, m);
      }
      return m;
    }
    const neg = (col ?? 0x888888) < 0; // отрицательный цвет => прозрачный материал
    const c = (neg ? -(col ?? 0x888888) : (col ?? 0x888888)) & 0xffffff;
    const semi = op !== undefined && op < 1;
    const key = col + "|" + (op ?? "");
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({
        color: c,
        roughness: 0.65,
        transparent: neg || semi,
        opacity: op !== undefined ? op : neg ? 0.38 : 1,
        depthWrite: !(neg || semi),
      });
      matCache.set(key, m);
    }
    return m;
  };
  const makeMesh = (d) => {
    const s = d.size || [0.2, 0.2, 0.2];
    const g =
      d.kind === "box"
        ? new THREE.BoxGeometry(s[0], s[1], s[2])
        : d.kind === "plane"
          ? new THREE.PlaneGeometry(s[0], s[1])
          : d.kind === "cyl"
            ? new THREE.CylinderGeometry(s[0], s[1], s[2], 12)
            : d.kind === "sphere"
              ? new THREE.SphereGeometry(s[0], 10, 8)
              : d.kind === "torus"
                ? new THREE.TorusGeometry(s[0], s[1], 10, 24)
                : new THREE.BoxGeometry(s[0], s[1], s[2]);
    const mesh = new THREE.Mesh(g, mat(d.color, d.opacity, d.emissive));
    mesh.castShadow = true;
    return mesh;
  };
  const build = (d) => {
    const p = d.pos || [0, 0, 0];
    const r = (d.rot_deg || [0, 0, 0]).map((v) => v * D2R);
    let root;
    if (d.kind === "group") {
      root = new THREE.Group();
      for (const c of d.children || []) {
        const m = makeMesh(c);
        const cp = c.pos || [0, 0, 0];
        m.position.set(cp[0], cp[1], cp[2]);
        const cr = (c.rot_deg || [0, 0, 0]).map((v) => v * D2R);
        m.rotation.set(cr[0], cr[1], cr[2]);
        root.add(m);
      }
    } else {
      root = makeMesh(d);
    }
    root.position.set(p[0], p[1], p[2]);
    root.rotation.set(r[0], r[1], r[2]);
    scene.add(root);
    return root;
  };

  for (const d of list) {
    const n = d.name || "";
    if (n === "зеркало_1") {
      // настоящее зеркало: плоскость с отражением вместо простого box
      const s = d.size || [0.02, 0.9, 0.5];
      const refl = new Reflector(new THREE.PlaneGeometry(s[2], s[1]), {
        color: 0xf5f7fa,
        clipBias: 0.003,
      });
      refl.position.set(d.pos[0], d.pos[1], d.pos[2]);
      refl.rotation.y = Math.PI / 2;
      scene.add(refl);
      continue;
    }
    const root = build(d);
    const x = d.pos[0],
      z = d.pos[2];
    if (n.startsWith("стул_")) {
      const ry = ((d.rot_deg && d.rot_deg[1]) || 0) * D2R;
      const seatC = (d.children || []).find(
        (c) => (c.size || [0, 0, 0])[0] >= 0.4 && (c.size || [0, 0, 0])[2] >= 0.4 && (c.size || [0, 0, 0])[1] < 0.1,
      );
      root.userData.seat = {
        pos: [x, z],
        yaw: n === "стул_табл_1" ? Math.PI / 2 : ry,
        h: seatC ? seatC.pos[1] : 0.42,
        table: n.startsWith("стул_табл"),
      };
      colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 });
      chairSeats.push(root);
    } else if (n.startsWith("диван_")) {
      // диван на несколько мест: виртуальные сиденья вдоль длины, лицом к центру
      const N = 6,
        L = 2.5; // размах мест — внутри дивана, без подлокотников
      for (let i = 0; i < N; i++) {
        const zz = z + (i - (N - 1) / 2) * (L / (N - 1));
        chairSeats.push({
          position: new THREE.Vector3(x, 0, zz),
          userData: { seat: { yaw: Math.PI / 2, h: 0.4, table: false } },
        });
      }
      colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 1.4, maxZ: z + 1.4 });
    } else if (n === "столешница") {
      const w = d.size[0],
        l = d.size[2];
      colliders.push({
        minX: x - w / 2 - 0.08,
        maxX: x + w / 2 + 0.1,
        minZ: z - l / 2 - 0.1,
        maxZ: z + l / 2 + 0.1,
      });
    } else if (n === "стол_малый_стол") {
      // стол может быть повёрнут на 90° — учтём поворот в габаритах коллизии
      const w = d.size[0],
        l = d.size[2];
      const ry = ((d.rot_deg && d.rot_deg[1]) || 0) * D2R;
      const cr = Math.abs(Math.cos(ry)),
        sr = Math.abs(Math.sin(ry));
      const sx = w * cr + l * sr,
        sz = w * sr + l * cr;
      colliders.push({
        minX: x - sx / 2 - 0.1,
        maxX: x + sx / 2 + 0.1,
        minZ: z - sz / 2 - 0.12,
        maxZ: z + sz / 2 + 0.12,
      });
    } else if (n === "верстак_столешница") {
      const w = d.size[0];
      colliders.push({
        minX: x - w / 2 - 0.1,
        maxX: x + w / 2 + 0.1,
        minZ: z - 0.35,
        maxZ: z + 0.35,
      });
    } else if (n === "холодильник_корпус") {
      colliders.push({ minX: x - 0.23, maxX: x + 0.23, minZ: z - 0.22, maxZ: z + 0.22 });
    } else if (n === "сейф_корпус") {
      // сейф может быть повёрнут — считаем габариты с учётом поворота
      const w = d.size[0],
        l = d.size[2];
      const ry = ((d.rot_deg && d.rot_deg[1]) || 0) * D2R;
      const cr = Math.abs(Math.cos(ry)),
        sr = Math.abs(Math.sin(ry));
      colliders.push({
        minX: x - (w * cr + l * sr) / 2,
        maxX: x + (w * cr + l * sr) / 2,
        minZ: z - (w * sr + l * cr) / 2,
        maxZ: z + (w * sr + l * cr) / 2,
      });
    } else if (n === "вешалка_планка") {
      // вешалка с одеждой выступает из стены в комнату
      colliders.push({ minX: x - 0.04, maxX: x + 0.33, minZ: z - 0.6, maxZ: z + 0.6 });
    } else if (n === "радио_корпус") {
      GARAGE_RADIO_POS.x = x + 0.12;
      GARAGE_RADIO_POS.z = z;
    } else if (n.startsWith("полка_")) {
      // полки и стеллажи: блокируют камеру только на высоте полки
      const w = d.size[0],
        l = d.size[2];
      // полки, нависающие ниже верха проёма, — сплошная преграда для камеры:
      // нельзя «бродить» по выступающим от стены областям
      const isWall = d.pos[1] + d.size[1] / 2 < ARCH_H - 0.1;
      cameraColliders.push({
        minX: x - w / 2 - 0.04,
        maxX: x + w / 2 + 0.04,
        minZ: z - l / 2 - 0.04,
        maxZ: z + l / 2 + 0.04,
        yLow: isWall ? 0 : d.pos[1] - d.size[1] / 2 - 0.12,
        yHigh: isWall ? H : d.pos[1] + d.size[1] / 2 + 0.12,
      });
    }
    reg(n, root);
  }

  // Текстуры постеров поверх цветов из JSON (по именам)
  const posterTex = {
    постер_1: "posters/godfather.jpg",
    постер_2: "posters/taxi.jpg",
    постер_3: "posters/snatch.jpg",
    постер_4: "posters/breakfast.jpg",
    постер_5: "posters/dracula.jpg",
    постер_снач: "posters/snatch.jpg",
    постер_балтика: "posters/baltika.jpg",
    картина_мона: "posters/mona.jpg",
  };
  const loader = new THREE.TextureLoader();
  for (const [n, url] of Object.entries(posterTex)) {
    const m = regObjs.get(n);
    if (!m) continue;
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const W = 512;
        const H = 512;
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(tex.image, 0, 0, W, H);
        const vig = ctx.createRadialGradient(
          W / 2,
          H / 2,
          Math.min(W, H) * 0.44,
          W / 2,
          H / 2,
          Math.max(W, H) * 0.74,
        );
        vig.addColorStop(0, "rgba(0,0,0,0)");
        vig.addColorStop(1, "rgba(30,30,30,0.5)");
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, W, H);
        const canvasTex = new THREE.CanvasTexture(c);
        canvasTex.colorSpace = THREE.SRGBColorSpace;
        canvasTex.anisotropy = 8;
        canvasTex.wrapS = canvasTex.wrapT = THREE.ClampToEdgeWrapping;
        m.material = new THREE.MeshLambertMaterial({
          color: 0xffffff,
          map: canvasTex,
          roughness: 0.7,
          side: THREE.DoubleSide,
        });
        m.material.needsUpdate = true;
      },
      undefined,
      () => {},
    );
  }

  // Красный шкаф — текстура red.jpg (корпус и фасад двери)
  for (const n of ["шкаф_красный", "шкаф_фасад"]) {
    const m = regObjs.get(n);
    if (!m) continue;
    loader.load(
      "textures/red.jpg",
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 2);
        m.material = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex, roughness: 0.7 });
        m.material.needsUpdate = true;
      },
      undefined,
      () => {},
    );
  }

  // Синий сейф — та же red.jpg, но hue-фильтром в синий
  for (const n of ["сейф_корпус", "сейф_ручка"]) {
    const m = regObjs.get(n);
    if (!m) continue;
    loader.load(
      "textures/red.jpg",
      (tex) => {
        const cv = document.createElement("canvas");
        cv.width = 512;
        cv.height = 512;
        const g = cv.getContext("2d");
        g.filter = "hue-rotate(210deg) saturate(1.1) brightness(1.0)";
        g.drawImage(tex.image, 0, 0, 512, 512);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1, 1);
        m.material = new THREE.MeshLambertMaterial({ color: 0xffffff, map: t, roughness: 0.7 });
        m.material.needsUpdate = true;
      },
      undefined,
      () => {},
    );
  }

  // Деревянные текстуры: верстак, столешница, полки над ними и ножки
  const furnTex = {
    верстак_столешница: ["textures/verstak.jpg", 4, 1],
    столешница: ["textures/wood-light.jpg", 4, 1],
    полка_под_верстак: ["textures/verstak.jpg", 3, 1],
    полка_под_верстак_2: ["textures/verstak.jpg", 3, 1],
    полка_низ_стены: ["textures/tabletop.jpg", 2, 2],
    полка_верх_стены: ["textures/tabletop.jpg", 2, 2],
    барная_полка_1: ["textures/verstak.jpg", 2, 1],
    барная_полка_2: ["textures/verstak.jpg", 2, 1],
    ножки_стола: ["textures/tabletop.jpg", 1, 1],
    верстак_ножки: ["textures/verstak.jpg", 1, 1],
    шкаф_бок_лев: ["textures/verstak.jpg", 1, 1],
    шкаф_бок_прав: ["textures/verstak.jpg", 1, 1],
    шкаф_бок_радио: ["textures/verstak.jpg", 1, 1],
  };
  const applyTex = (m, tex, ru, rv) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(ru, rv);
    m.material = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex, roughness: 0.7 });
    m.material.needsUpdate = true;
  };
  for (const n of Object.keys(furnTex)) {
    const root = regObjs.get(n);
    if (!root) continue;
    const [url, ru, rv] = furnTex[n];
    loader.load(
      url,
      (tex) => {
        if (root.isGroup) root.children.forEach((c) => c.material && applyTex(c, tex, ru, rv));
        else applyTex(root, tex, ru, rv);
        if (n === "столешница") {
          const ms = root.isGroup ? root.children : [root];
          ms.forEach((m) => m.material && m.material.color.setHex(0xdbcdbe));
        }
      },
      undefined,
      () => {},
    );
  }

  // Доски погреба: текстура пола, но чуть светлее
  const cellarBoards = [...regObjs.keys()].filter((k) => k.startsWith("погреб_доска"));
  if (cellarBoards.length) {
    loader.load(
      "textures/floor_wood.jpg",
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(0.3, 0.15);
        for (const n of cellarBoards) {
          const m = regObjs.get(n);
          if (!m) continue;
          m.material = new THREE.MeshLambertMaterial({ color: 0x8a8a8a, map: tex, roughness: 0.7 });
          m.material.needsUpdate = true;
        }
      },
      undefined,
      () => {},
    );
  }

  // Стулья — все красные, текстура chair.jpg; кресло у верстака — обесцвеченная chair.jpg
  loader.load(
    "textures/chair.jpg",
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);
      // Обесцвеченная копия для кресла
      const grayTex = (() => {
        const cv = document.createElement("canvas");
        cv.width = 512;
        cv.height = 512;
        const g = cv.getContext("2d");
        g.filter = "grayscale(1) brightness(1.6)";
        g.drawImage(tex.image, 0, 0, 512, 512);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        return t;
      })();
      const chairSatTex = (() => {
        const cv = document.createElement("canvas");
        cv.width = 512;
        cv.height = 512;
        const g = cv.getContext("2d");
        g.filter = "saturate(0.7) brightness(1.1)";
        g.drawImage(tex.image, 0, 0, 512, 512);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        return t;
      })();
      const applyChair = (m, color, map) => {
        m.material = new THREE.MeshLambertMaterial({
          color,
          map,
          roughness: 0.7,
        });
        m.material.needsUpdate = true;
      };
      for (const [n, root] of regObjs) {
        if (!n.startsWith("стул_") || !root) continue;
        const isArmchair = n === "стул_табл_1" || n === "стул_табл_2";
        const isStool = !isArmchair && root.isGroup && root.children.length === 5; // без спинки
        const color = isArmchair ? 0xf2f2f2 : isStool ? 0xb8b8b8 : 0xffffff;
        const map = isArmchair ? grayTex : chairSatTex;
        if (root.isGroup) root.children.forEach((c) => c.material && applyChair(c, color, map));
        else if (root.material) applyChair(root, color, map);
      }
      // Диван — та же текстура и цвет, что у кресел у верстака (обесцвеченный chair.jpg)
      const divan = regObjs.get("диван_1");
      if (divan) divan.children.forEach((c) => c.material && applyChair(c, 0xf2f2f2, grayTex));
    },
    undefined,
    () => {},
  );
}

// ---------------------------------------------------------------------------
// Персонаж
// ---------------------------------------------------------------------------
function makeFaceTexture(skinHex = 0xf0c79b) {
  // «Скин»-лицо 16×16: зависит от тона кожи, Nearest-фильтр — как в Minecraft
  const cv = document.createElement("canvas");
  cv.width = 16;
  cv.height = 16;
  const g = cv.getContext("2d");
  const sk = new THREE.Color(skinHex);
  const base = "#" + sk.getHexString();
  const darker = "#" + sk.clone().multiplyScalar(0.82).getHexString();
  g.fillStyle = base;
  g.fillRect(0, 0, 16, 16);
  // лёгкая тень под подбородком
  g.fillStyle = darker;
  g.fillRect(1, 13, 14, 3);
  // глаза: тёмные целиком (без белой «полосы» под зрачком) + блик сверху
  g.fillStyle = "#243448";
  g.fillRect(3, 6, 3, 3);
  g.fillRect(10, 6, 3, 3);
  g.fillStyle = "#9fb3c4";
  g.fillRect(3, 6, 1, 1);
  g.fillRect(10, 6, 1, 1);
  // брови
  g.fillStyle = "#3a2413";
  g.fillRect(2, 4, 4, 1);
  g.fillRect(10, 4, 4, 1);
  // нос
  g.fillStyle = darker;
  g.fillRect(7, 9, 2, 3);
  // рот и бородка
  g.fillStyle = "#6b4a2f";
  g.fillRect(5, 11, 6, 1);
  g.fillRect(6, 12, 4, 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCharacter(opts = {}) {
  const group = new THREE.Group();

  // Кубический стиль в духе Minecraft: боксы вместо капсул, «пиксельное» лицо
  const matShirt = new THREE.MeshLambertMaterial({ color: opts.body ?? 0x46506b, roughness: 0.9 });
  const matSleeve = new THREE.MeshLambertMaterial({
    color: opts.sleeve ?? 0x46506b,
    roughness: 0.9,
  });
  const matPants = new THREE.MeshLambertMaterial({ color: opts.pants ?? 0x3a4358, roughness: 0.9 });
  const matSkin = new THREE.MeshLambertMaterial({ color: opts.skin ?? 0xf0c79b, roughness: 0.85 });
  const matHair = new THREE.MeshLambertMaterial({ color: opts.hair ?? 0x2b1a0f, roughness: 0.95 });
  const matShoe = new THREE.MeshLambertMaterial({ color: 0x333b47, roughness: 0.85 });

  const refs = {};
  const boxM = (w, h, d, mat, y = 0, parent, x = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    (parent || group).add(m);
    return m;
  };

  // ---- Торс: «рубашка» + пояс штанов ----
  const torso = new THREE.Group();
  refs.torso = torso;
  group.add(torso);

  boxM(0.42, 0.7, 0.26, matShirt, 1.19, torso); // грудь
  boxM(0.28, 0.12, 0.22, matPants, 0.84, torso); // таз/пояс

  // ---- Голова: куб с пиксельным лицом и шапкой волос ----
  const faceMat = new THREE.MeshLambertMaterial({
    map: makeFaceTexture(opts.skin ?? 0xf0c79b),
    roughness: 0.85,
  });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 0.34), [
    matSkin,
    matSkin,
    matHair,
    matSkin,
    faceMat,
    matSkin,
  ]);
  head.position.set(0, 1.76, 0.01);
  head.castShadow = true;
  torso.add(head);
  refs.head = head;
  boxM(0.38, 0.07, 0.38, matHair, 0.17, head, 0, 0); // волосы сверху — крутятся с головой

  // ---- Руки: «кубики» плеча и предплечья, квадратная кисть ----
  function buildArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.24, 1.52, 0);
    torso.add(pivot);
    boxM(0.16, 0.3, 0.16, matSleeve, -0.14, pivot); // плечо
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.3, 0);
    pivot.add(elbow);
    boxM(0.13, 0.24, 0.13, matSleeve, -0.12, elbow); // предплечье
    boxM(0.11, 0.13, 0.11, matSkin, -0.27, elbow); // кисть
    if (side < 0) refs.leftElbow = elbow;
    else refs.rightElbow = elbow;
    return pivot;
  }
  refs.leftArm = buildArm(-1);
  refs.rightArm = buildArm(1);

  // ---- Ноги: кубики бедра и голени, «ботинок» ----
  function buildLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.14, 0.78, 0);
    group.add(pivot);
    boxM(0.16, 0.36, 0.16, matPants, -0.18, pivot); // бедро
    const knee = new THREE.Group();
    knee.position.set(0, -0.36, 0);
    pivot.add(knee);
    boxM(0.14, 0.3, 0.14, matPants, -0.15, knee); // голень
    boxM(0.16, 0.1, 0.24, matShoe, -0.32, knee, 0, 0.03); // ботинок
    if (side < 0) refs.leftKnee = knee;
    else refs.rightKnee = knee;
    return pivot;
  }
  refs.leftLeg = buildLeg(-1);
  refs.rightLeg = buildLeg(1);

  group.scale.set(CHAR_X, CHAR_Y, CHAR_Z);

  // Реестр материалов для «покраснения» при ударе
  const mats = [];
  group.traverse((o) => {
    if (o.isMesh) {
      let m = o.material;
      if (!Array.isArray(m)) m = [m];
      for (const mm of m) {
        if (!mm.__tintBase) {
          mm.__tintBase = mm.color.getHex();
          mats.push(mm);
        }
      }
    }
  });
  refs.mats = mats;
  return { group, refs };
}
function setCharacterTint(refs, t) {
  // t: 0 (базовый цвет) … 1 (красный)
  for (const m of refs.mats || []) {
    const base = m.__tintBase;
    m.color.setHex(base).lerp(new THREE.Color(0xff2222), Math.max(0, Math.min(1, t)));
  }
}

function buildCharacter() {
  const colors = PLAYER_COLORS[(Math.random() * PLAYER_COLORS.length) | 0];
  myLook = randomVariant(colors);
  const { group, refs } = createCharacter(myLook);
  character = group;
  localRefs = refs;
  torso = refs.torso;
  leftArm = refs.leftArm;
  rightArm = refs.rightArm;
  leftElbow = refs.leftElbow;
  rightElbow = refs.rightElbow;
  leftLeg = refs.leftLeg;
  rightLeg = refs.rightLeg;
  leftKnee = refs.leftKnee;
  rightKnee = refs.rightKnee;
  scene.add(character);
}

// ---------------------------------------------------------------------------
// Управление + физика движения (порт плавного контроллера Sketchbook:
// spring-скорость, движение относительно камеры, spring-поворот, прыжок)
// ---------------------------------------------------------------------------
const MOVE_WALK = 1.6,
  MOVE_RUN = 3.3; // целевые скорости spring: по умолчанию шаг, Shift — бег
const VEL_MASS = 3,
  VEL_DAMP = 0.8; // пружина скорости: почти без инерции
const ROT_MASS = 1.2,
  ROT_DAMP = 0.78; // spring поворота модели
const JUMP_SPEED = 4.8,
  GRAV = 9.8; // прыжок + гравитация
const FLOOR_Y = 0;

let velSim = { px: 0, pz: 0, vx: 0, vz: 0 }; // spring-скорость (позиция/скорость)
let velTarget = new THREE.Vector3();
let rotYaw = 0,
  rotVel = 0; // поворот модели (уже повёрнутого угла)
let moveSpeed = 0;
let onGround = true,
  vy = 0,
  spaceWasDown = false;
let crouch = 0; // амплитуда приседа (0 — стоя, 1 — на корточках)
let crouched = false,
  eWasDown = false;
let camTheta = -0.22,
  camPhi = 0,
  camRadius = 1.9,
  camTargetRadius = 1.9; // старт: камера по центру (на уровне глаз), небольшой градус по X
let lastMX = 0,
  lastMY = 0;

function getCameraRelativeMovementVector() {
  // Управление относительно камеры (как viewVector в Sketchbook):
  // W — от камеры, S — к камере, A/D — вбок
  const fwd = new THREE.Vector3()
    .subVectors(character.position, camera.position)
    .setY(0)
    .normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  let mv = new THREE.Vector3();
  if (keys["KeyW"] || keys["ArrowUp"]) mv.add(fwd);
  if (keys["KeyS"] || keys["ArrowDown"]) mv.sub(fwd);
  if (keys["KeyD"] || keys["ArrowRight"]) mv.add(right);
  if (keys["KeyA"] || keys["ArrowLeft"]) mv.sub(right);
  return mv;
}

function updatePlayer(dt) {
  if (chatOpen) return; // набор текста — игрок не двигается
  if (radioMenuOpen) return; // меню радио — управление заблокировано

  // Обработка смерти: таймер до возрождения, падение
  if (dead) {
    deadT -= dt;
    if (deadT <= 0) respawn();
    return;
  }

  // E — сесть на стул / встать (по фронту нажатия); у верстака — радио
  const eDown = keys["KeyE"];
  if (eDown && !eWasDown && !radioNear()) toggleSit();
  eWasDown = !!eDown;

  // C — присесть на корточки (переключатель)
  const cDown = keys["KeyC"];
  if (cDown && !cWasDown) {
    crouched = !crouched;
    if (sitting >= 0) standUp();
  }
  cWasDown = !!cDown;

  if (sitting >= 0) {
    // Сидим: встаём по движению или повторной E
    if (
      keys["KeyW"] ||
      keys["KeyA"] ||
      keys["KeyS"] ||
      keys["KeyD"] ||
      keys["ArrowUp"] ||
      keys["ArrowDown"] ||
      keys["ArrowLeft"] ||
      keys["ArrowRight"] ||
      keys["KeyC"]
    )
      standUp();
    return;
  }

  // Целевая скорость (крадучись — на корточках)
  const run = keys["ShiftLeft"] || keys["ShiftRight"];
  const targetSpeed = crouched ? MOVE_WALK * 0.55 : run ? MOVE_RUN : MOVE_WALK;
  const dir = getCameraRelativeMovementVector();

  // spring-скорость: плавный разгон и торможение к target
  const l = dir.length();
  if (l > 0.0001) {
    velTarget.x = (dir.x / l) * targetSpeed;
    velTarget.z = (dir.z / l) * targetSpeed;
  } else {
    velTarget.x = 0;
    velTarget.z = 0;
  }
  // Быстрый плавный разгон/торможение (без spring-осцилляции):
  // при отпускании клавиш скорость мягко сходит на ноль, анимация ходьбы не дёргается
  const kMove = Math.min(1, 16 * dt);
  velSim.px += (velTarget.x - velSim.px) * kMove;
  velSim.pz += (velTarget.z - velSim.pz) * kMove;

  if (l > 0.01) {
    const rotTarget = Math.atan2(velSim.px, velSim.pz);
    let dA = rotTarget - rotYaw;
    while (dA > Math.PI) dA -= 2 * Math.PI;
    while (dA < -Math.PI) dA += 2 * Math.PI;
    rotYaw += dA * Math.min(1, 10 * dt); // ~100 мс плавный доворот
  }
  character.rotation.y = rotYaw + (onGround ? 0 : 0);

  moveSpeed = Math.hypot(velSim.px, velSim.pz);
  character.position.x += velSim.px * dt;
  character.position.z += velSim.pz * dt;

  // Прыжок и гравитация (плоский пол)
  const wasOnGround = onGround;
  if (keys["Space"] && !spaceWasDown && onGround && !crouched) {
    vy = JUMP_SPEED;
    onGround = false;
    sfx.jump();
  }
  spaceWasDown = !!keys["Space"];
  if (!onGround) {
    vy -= GRAV * dt;
    character.position.y += vy * dt;
    if (character.position.y <= FLOOR_Y) {
      character.position.y = FLOOR_Y;
      vy = 0;
      onGround = true;
      if (!wasOnGround) sfx.land();
    }
  }

  collideAndClamp();
}

function collideAndClamp() {
  const p = character.position;
  p.x = Math.min(Math.max(p.x, IWL + RADIUS), IWR - RADIUS);
  p.z = Math.min(Math.max(p.z, Z_REAR + RADIUS), Z_FRONT - RADIUS);

  colliders.forEach((o) => {
    if (
      p.x + RADIUS > o.minX &&
      p.x - RADIUS < o.maxX &&
      p.z + RADIUS > o.minZ &&
      p.z - RADIUS < o.maxZ
    ) {
      const dLeft = p.x + RADIUS - o.minX;
      const dRight = o.maxX - (p.x - RADIUS);
      const dFront = p.z + RADIUS - o.minZ;
      const dBack = o.maxZ - (p.z - RADIUS);
      const m = Math.min(dLeft, dRight, dFront, dBack);
      if (m === dLeft) p.x = o.minX - RADIUS;
      else if (m === dRight) p.x = o.maxX + RADIUS;
      else if (m === dFront) p.z = o.minZ - RADIUS;
      else p.z = o.maxZ + RADIUS;
    }
  });
}

function toggleSit() {
  if (sitting >= 0) {
    standUp();
    return;
  }
  // ближайший стул
  let best = -1,
    bestD = 0.9;
  for (let i = 0; i < chairSeats.length; i++) {
    const p = chairSeats[i].position;
    const d = Math.hypot(character.position.x - p.x, character.position.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return;
  sitting = best;
  camTheta = 0;
  camPhi = 0; // сели — по умолчанию смотрим прямо вперёд по сиденью
  velSim.px = velSim.pz = velSim.vx = velSim.vz = 0;
  sitPreSit.x = character.position.x;
  sitPreSit.z = character.position.z;
  const p = chairSeats[best].position;
  const seat = chairSeats[best].userData.seat || {};
  character.position.set(p.x, -0.12, p.z);
  const seatYaw = seat.yaw ?? Math.PI / 2;
  character.rotation.y = rotYaw = seatYaw; // лицом по оси стула
  rotVel = 0;
  // поза подхватится плавно через сглаживание в updateAnim
  sfx.sit();
}

function standUp() {
  if (sitting < 0) return;
  sitting = -1;
  character.position.set(sitPreSit.x, 0, sitPreSit.z);
  // поза распрямится плавно через сглаживание в updateAnim
  vy = 0;
  onGround = true;
  sfx.sit();
}

let sitPreSit = { x: 0, z: 0 };

// ---------------------------------------------------------------------------
// Анимация и орбитальная камера (style Sketchbook: theta/phi/radius)
// ---------------------------------------------------------------------------
let stepAcc = 0; // накопитель шагов для звука

function updateAnim(dt) {
  if (punchCool > 0) punchCool -= dt;
  if (kickCool > 0) kickCool -= dt;
  if (hitFlash > 0) hitFlash -= dt;
  if (punchAnim > 0) punchAnim -= dt;
  if (kickAnim > 0) kickAnim -= dt;
  if (recoilT > 0) recoilT -= dt;

  // ЦЕЛЕВАЯ ПОЗА: каждый кадр считаем, где должны быть конечности,
  // и плавно тянем к ней суставы (экспоненциальное сглаживание — без рывков).
  const P = {
    ll: 0,
    rl: 0,
    lk: 0,
    rk: 0, // ноги/колени
    la: 0,
    ra: 0,
    le: 0,
    re: 0, // плечи/локти
    lz: 0.1,
    rz: -0.1, // руки чуть наружу (стойка)
    tx: 0,
    ty: 0,
    tz: 0, // торс
    bob: 0,
    cz: 0, // прыжок по Y, наклон «лёжа»
  };
  const act = punchAnim > 0 || kickAnim > 0;
  const bL = act ? 30 : 15; // скорость тяги ног
  const bU = act ? 32 : 12; // рук
  const bT = act ? 28 : 10; // торса

  if (dead) {
    // Лежим на спине после нокаута
    P.cz = -1.45;
    P.ll = -0.3;
    P.rl = -0.6;
    P.lk = 0.2;
    P.rk = 0.5;
    P.la = 1.0;
    P.ra = 0.3;
    P.le = -0.6;
    P.re = -0.3;
    P.lz = 0;
    P.rz = 0;
  } else if (sitting >= 0) {
    // Сидим на стуле: поджатые ноги и локти, корпус чуть вперёд
    const atTable = chairSeats[sitting]?.userData.seat?.table;
    P.ll = -1.25;
    P.rl = -1.25;
    P.lk = 1.25;
    P.rk = 1.25;
    if (atTable) {
      // за столом: руки вытянуты вперёд, кисти лежат на столешнице
      P.la = -1.15;
      P.ra = -1.15;
      P.le = 0.1;
      P.re = 0.1;
      P.lz = 0;
      P.rz = 0;
    } else {
      // без стола: руки опущены, кисти на коленях (не на воздухе)
      P.la = -0.3;
      P.ra = -0.3;
      P.le = -0.5;
      P.re = -0.5;
      P.lz = 0;
      P.rz = 0;
    }
    P.tx = 0;
  } else {
    // Плавно меняем амплитуду приседа
    crouch += ((crouched ? 1 : 0) - crouch) * Math.min(1, 14 * dt);

    const run = !!(keys["ShiftLeft"] || keys["ShiftRight"]);
    const t = animTime;
    const s = Math.sin(t),
      c = Math.cos(t);

    if (moveSpeed > 0.05) {
      animTime += dt * moveSpeed * (run ? 4.2 : 3.0);

      // Шаги: звук при каждом полутакте (нога касается пола)
      const stepPeriod = (run ? 4.2 : 3.0) * moveSpeed;
      if (stepPeriod > 0) {
        stepAcc += dt * stepPeriod;
        if (stepAcc >= 1) {
          stepAcc -= 1;
          sfx.step(run);
        }
      }

      if (crouch > 0.5) {
        // === НА КОРТОЧКАХ: низкий шаг, руки вперёд ===
        const stride = 0.3;
        P.ll = s * stride - 0.75 * crouch;
        P.rl = -s * stride - 0.75 * crouch;
        P.lk = 1.15 * crouch + Math.max(0, -c) * 0.4;
        P.rk = 1.15 * crouch + Math.max(0, c) * 0.4;
        P.la = -0.5 * crouch - s * 0.12;
        P.ra = -0.5 * crouch + s * 0.12;
        P.le = -0.9 * crouch;
        P.re = -0.9 * crouch;
        P.tx = 0.22 * crouch;
        P.tz = s * 0.08 * crouch; // корпус слегка качается
        P.bob = Math.abs(c) * 0.01;
      } else if (run) {
        // === БЕГ: колени поднимаются высоко, локти прижаты, корпус вперёд ===
        const stride = 0.85;
        P.ll = s * stride;
        P.rl = -s * stride;
        P.lk = Math.max(0, -c) * 1.35;
        P.rk = Math.max(0, c) * 1.35;
        // руки: размашистый мах, локти заметно уходят назад за линию корпуса
        P.la = -s * 0.65;
        P.ra = s * 0.65;
        P.le = -1.5 + Math.max(0, s) * 0.25;
        P.re = -1.5 - Math.max(0, s) * 0.25;
        P.lz = 0.0;
        P.rz = 0.0;
        P.tx = 0.16 + Math.abs(s) * 0.03;
        P.tz = s * 0.1; // спина слегка «змеится»
        P.bob = Math.abs(c) * 0.07;
      } else {
        // === ХОДЬБА: ноги-маятник, руки в противофазе с лёгким сгибом локтей ===
        const stride = 0.5;
        P.ll = s * stride;
        P.rl = -s * stride;
        P.lk = Math.max(0, -c) * 0.25;
        P.rk = Math.max(0, c) * 0.25;
        // правая рука идёт вперёд с левой ногой (и наоборот)
        P.la = -s * 0.4;
        P.ra = s * 0.4;
        P.le = -0.55 + Math.max(0, -s) * 0.25;
        P.re = -0.55 + Math.max(0, s) * 0.25;
        P.lz = 0.1;
        P.rz = -0.1;
        P.tx = 0.05;
        P.tz = s * 0.06; // лёгкий «круиз» плеч
        P.bob = Math.abs(c) * 0.025;
      }
    } else if (crouch > 0.5) {
      // === Присед на месте: ноги согнуты, руки на коленях ===
      P.ll = -0.8 * crouch;
      P.rl = -0.8 * crouch;
      P.lk = 1.3 * crouch;
      P.rk = 1.3 * crouch;
      P.la = -0.55 * crouch;
      P.ra = -0.55 * crouch;
      P.le = -1.0 * crouch;
      P.re = -1.0 * crouch;
      P.tx = 0.24 * crouch;
      animTime = 0;
    } else {
      // === Стоим на месте: едва заметное дыхание (грудь/плечи) ===
      const br = Math.sin(animTime * 2.2) * 0.04; // «дыхание»
      P.la = -0.12 + br;
      P.ra = -0.12 - br * 0.6;
      P.le = -0.35;
      P.re = -0.35;
      P.lz = 0.08;
      P.rz = -0.08;
      P.tz = br * 0.5;
      animTime += dt; // чтобы «дыхание» шло
    }

    // === Удар: прямой джеб — кулак летит строго вперёд на уровне плеча ===
    if (punchAnim > 0) {
      const p = 1 - punchAnim / 0.3; // 0 → 1, 0.3с — удар
      let a, e, g;
      if (p < 0.22) {
        // стойка: кулак уже поднят к груди, рука согнута — замаха снизу нет
        const w = p / 0.22;
        a = -0.6 * w;
        e = -1.5 * w;
        g = 0.0;
      } else if (p < 0.74) {
        // выпад строго вперёд: локоть распрямляется, кулак идёт на одной высоте
        const w = (p - 0.22) / 0.52;
        const ease = w * w * (3 - 2 * w);
        const fin = punchHi === 1 ? -1.55 : -1.42; // морда: чуть выше, тело: на уровне груди
        a = -0.6 + (-fin - 0.6) * ease; // кулак остаётся почти горизонтальным
        e = -1.5 + 1.45 * ease; // локоть распрямляется до прямой
        g = 0.0;
      } else {
        // возврат в защиту
        const w = (p - 0.74) / 0.26;
        const fin = punchHi === 1 ? -1.15 : -1.0;
        a = fin * (1 - w) - 0.15 * w;
        e = -0.05 * (1 - w) - 1.2 * w;
        g = 0.1 * (1 - w);
      }
      if (punchSide === 0) {
        P.ra = a;
        P.re = e;
        P.rz = g;
        P.la = -0.12;
        P.le = -0.95;
        P.lz = 0.12;
      } else {
        P.la = a;
        P.le = e;
        P.lz = -g;
        P.ra = -0.12;
        P.re = -0.95;
        P.rz = -0.12;
      }
      // корпус: лёгкий доворот за плечом + наклон вперёд
      P.ty = 0.1 * (1 - p) * (punchSide === 0 ? -1 : 1);
      P.tx = 0.04 + (punchHi === 1 ? 0.06 : 0) * (1 - p);
    }

    // === Анимация пинка: высокая нога, руки прижаты вдоль тела ===
    if (kickAnim > 0) {
      const p = 1 - kickAnim / 0.4; // 0 → 1
      const swing = -2.0 * Math.sin(p * Math.PI); // большая нога вверх
      const kneeS = 0.9 * Math.sin(p * Math.PI);
      if (kickSide === 1) {
        P.rl = swing;
        P.rk = kneeS;
        P.ll = -0.15;
        P.lk = 0.3;
      } else {
        P.ll = swing;
        P.lk = kneeS;
        P.rl = -0.15;
        P.rk = 0.3;
      }
      // опорная нога устойчива, руки прижаты
      P.la = -0.2;
      P.ra = -0.1;
      P.le = -0.3;
      P.re = -0.3;
      P.tx = -0.1 - swing * 0.08;
    }
  }

  // --- Откидывание при получении удара (лёгкий наклон корпуса назад) ---
  if (recoilT > 0) {
    const rk = Math.min(1, recoilT / 0.28); // 1 → 0
    P.tx = -0.2 * rk; // корпус отклоняется назад
    P.tz = (recoilNz * 0.22 + recoilNx * 0.08) * rk; // чуть в сторону удара
    P.la = -0.55 * rk;
    P.ra = -0.55 * rk; // руки вскинуты
    P.lz = 0.4 * rk;
    P.rz = -0.4 * rk;
    P.ll = 0.12 * rk;
    P.rl = 0.2 * rk; // шаг-балансировка ногой назад
    P.bob = 0;
  }

  // --- ТЯНЕМ суставы к целям (экспоненциальное сглаживание) ---
  leftLeg.rotation.x = damp(leftLeg.rotation.x, P.ll, bL, dt);
  rightLeg.rotation.x = damp(rightLeg.rotation.x, P.rl, bL, dt);
  leftKnee.rotation.x = damp(leftKnee.rotation.x, P.lk, bL, dt);
  rightKnee.rotation.x = damp(rightKnee.rotation.x, P.rk, bL, dt);
  leftArm.rotation.x = damp(leftArm.rotation.x, P.la, bU, dt);
  rightArm.rotation.x = damp(rightArm.rotation.x, P.ra, bU, dt);
  leftElbow.rotation.x = damp(leftElbow.rotation.x, P.le, bU, dt);
  rightElbow.rotation.x = damp(rightElbow.rotation.x, P.re, bU, dt);
  leftArm.rotation.z = damp(leftArm.rotation.z, P.lz, 9, dt);
  rightArm.rotation.z = damp(rightArm.rotation.z, P.rz, 9, dt);
  torso.rotation.x = damp(torso.rotation.x, P.tx, bT, dt);
  torso.rotation.y = damp(torso.rotation.y, P.ty, bT, dt);
  torso.rotation.z = damp(torso.rotation.z, P.tz, bT, dt);
  character.rotation.z = damp(character.rotation.z, P.cz, 8, dt);
  character.position.y = damp(character.position.y, P.bob, 12, dt);

  // Приседание: сжимаем фигуру по высоте (ноги на полу остаются)
  character.scale.set(CHAR_X, CHAR_Y * (1 - 0.3 * crouch), CHAR_Z);

  // Голова — три режима (плавные переходы между ними):
  //  • move  — персонаж идёт: смотрит вперёд по ходу (мышь направляет движение);
  //  • chest — камера на грудь: следит за центром экрана (взглядом камеры);
  //  • back  — камера на спину: следует за мышкой (обход камеры).
  if (localRefs && localRefs.head) {
    const facing = character.rotation.y + torso.rotation.y;
    const chMoving = moveSpeed > 0.05;
    const backView = Math.cos(facing - camTheta) < 0;
    const dx = camera.position.x - character.position.x;
    const dz = camera.position.z - character.position.z;
    const mode = chMoving ? "move" : sitting >= 0 ? "chest" : backView ? "back" : "chest";
    if (mode !== prevHeadMode) {
      // вход в режим — продолжить плавно с текущего положения головы
      if (mode === "back") mouseAcc = headWorld - facing;
      if (mode === "chest") camYawAcc = headWorld;
      if (mode === "move") {
        mouseAcc = 0;
        camYawAcc = headWorld;
      }
    }
    prevHeadMode = mode;
    if (mode === "move") {
      headWorld = facing;
    } else if (mode === "back") {
      mouseAcc = THREE.MathUtils.clamp(mouseAcc + (camTheta - prevTheta) * 1.5, -1.2, 1.2);
      headWorld = damp(headWorld, facing + mouseAcc, 12, dt);
    } else {
      // chest: следим за взглядом камеры (центр экрана) — непрерывный угол
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const aimYaw = Math.atan2(-fwd.x, -fwd.z);
      let dd = aimYaw - camYawAcc;
      while (dd > Math.PI) dd -= 2 * Math.PI;
      while (dd < -Math.PI) dd += 2 * Math.PI;
      camYawAcc += dd;
      headWorld = damp(headWorld, camYawAcc, 10, dt);
    }
    let local = headWorld - facing;
    while (local > Math.PI) local -= 2 * Math.PI;
    while (local < -Math.PI) local += 2 * Math.PI;
    // Интерполяция поворота головы по Y: плавно, без рывков
    headLocalY = damp(headLocalY, local, 6, dt);
    localRefs.head.rotation.y = headLocalY;
    // Наклон: спина — голова смотрит туда же, куда камера; лицо — смотрит на камеру
    const fv = new THREE.Vector3();
    camera.getWorldDirection(fv);
    const pitchCam = Math.atan2(fv.y, Math.max(0.01, Math.hypot(fv.x, fv.z)));
    const dy = camera.position.y - (character.position.y + 1.05);
    const dh = Math.max(0.4, Math.hypot(dx, dz));
    const pit = chMoving
      ? 0
      : backView
        ? THREE.MathUtils.clamp(-pitchCam * 0.7, -0.7, 0.7)
        : THREE.MathUtils.clamp(-Math.atan2(dy, dh) * 0.6, -0.6, 0.6);
    headPitch = damp(headPitch, pit, 7, dt);
    localRefs.head.rotation.x = headPitch;
    prevTheta = camTheta;
  }

  // Живость корпуса: едва заметный плавный наклон в сторону движения мыши
  if (lastCamTheta === null) lastCamTheta = camTheta;
  const mM = camTheta - lastCamTheta;
  lastCamTheta = camTheta;
  camLeanZ = damp(camLeanZ, THREE.MathUtils.clamp(mM * 0.12, -0.02, 0.02), 8, dt);
  camLeanX = damp(camLeanX, THREE.MathUtils.clamp(mM * 0.04, -0.008, 0.008), 8, dt);
  torso.rotation.z += camLeanZ;
  torso.rotation.x += camLeanX;
}

// Экспоненциальное сглаживание: cur притягивается к tgt, rate — скорость (1/с)
function damp(cur, tgt, rate, dt) {
  return cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
}

// Чуть шире и ниже: присемистая фигура, ширина/глубина преобладают над ростом
const CHAR_X = 0.86;
const CHAR_Y = 0.64;
const CHAR_Z = 0.86;

let camPos = new THREE.Vector3(0, 1.7, Z_FRONT - 3);
let camLook = new THREE.Vector3();

function updateCamera(dt) {
  const eyeH = 1.84 * character.scale.y; // глаза: локальная y черепа × масштаб (присев — ниже)
  const eye = character.position.clone().add(new THREE.Vector3(0, eyeH, 0));
  if (sitting >= 0) {
    // Сидим: вид от первого лица — модель персонажа скрыта, камера чуть выше глаз
    if (character.visible) character.visible = false;
    const hp = camPhi,
      hy = camTheta;
    const cy = Math.cos(hp);
    const fwd = new THREE.Vector3(Math.sin(rotYaw + hy) * cy, Math.sin(hp), Math.cos(rotYaw + hy) * cy);
    const fpPos = new THREE.Vector3(eye.x, eye.y + 0.07, eye.z);
    fpPos.y = Math.min(Math.max(fpPos.y, 0.4), ARCH_H);
    camPos.lerp(fpPos, 1 - Math.pow(0.02, dt));
    camera.position.copy(camPos);
    camLook.lerp(camPos.clone().add(fwd), 1 - Math.pow(0.05, dt));
    camera.lookAt(camLook);
    const fovSit = 72;
    if (camera.fov !== fovSit) {
      camera.fov += (fovSit - camera.fov) * Math.min(1, 8 * dt);
      camera.updateProjectionMatrix();
    }
    return;
  }
  if (!character.visible) character.visible = true; // встали — снова 3-е лицо
  // Плавный зум: радиус догоняет цель по кадрам
  camRadius = damp(camRadius, camTargetRadius, 12, dt);
  // Мягкий «возврат» камеры: при ударах и движении камера чуть отходит и плавно возвращается
  camPulse = damp(camPulse, camPulseTgt, 5, dt);
  camPulseTgt *= Math.exp(-2.5 * dt);
  if (moveSpeed > 0.05) camPulseTgt = Math.max(camPulseTgt, 0.35);
  const rEff = camRadius * (1 + camPulse * 0.05);
  const targetPos = eye
    .clone()
    .add(
      new THREE.Vector3(
        rEff * Math.sin(camTheta) * Math.cos(camPhi),
        rEff * Math.sin(camPhi),
        rEff * Math.cos(camTheta) * Math.cos(camPhi),
      ),
    );
  // Коллизия камеры с мебелью: если цель внутри объекта — приближаем камеру
  // к персонажу вдоль направления взгляда (зум остаётся в camTargetRadius)
  {
    const camDir = targetPos.clone().sub(eye);
    let len = camDir.length();
    if (len > 0.001) {
      const dx = camDir.x / len,
        dz = camDir.z / len;
      const CAM_R = 0.15;
      for (let i = 0; i < 10; i++) {
        let hit = false;
        for (const o of colliders) {
          if (
            targetPos.x + CAM_R > o.minX &&
            targetPos.x - CAM_R < o.maxX &&
            targetPos.z + CAM_R > o.minZ &&
            targetPos.z - CAM_R < o.maxZ
          ) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          for (const o of cameraColliders) {
            if (
              targetPos.y >= o.yLow &&
              targetPos.y <= o.yHigh &&
              targetPos.x + CAM_R > o.minX &&
              targetPos.x - CAM_R < o.maxX &&
              targetPos.z + CAM_R > o.minZ &&
              targetPos.z - CAM_R < o.maxZ
            ) {
              hit = true;
              break;
            }
          }
        }
        if (!hit) break;
        len *= 0.82;
        targetPos.x = eye.x + dx * len;
        targetPos.z = eye.z + dz * len;
      }
    }
  }
  camPos.lerp(targetPos, 1 - Math.pow(0.02, dt));
  // Живость камеры: лёгкое дыхание при сидении, покачивание на ходу
  if (sitting >= 0) camPos.y += Math.sin(performance.now() * 0.0022) * 0.005;
  else if (moveSpeed > 0.05)
    camPos.y += Math.sin(animTime * 2) * 0.008 * Math.min(1, moveSpeed / 2);
  // камера не выходит за стены гаража (всего на 0.05 внутрь)
  camPos.x = Math.min(Math.max(camPos.x, IWL + 0.05), IWR - 0.05);
  camPos.z = Math.min(Math.max(camPos.z, Z_REAR + 0.05), Z_FRONT - 0.05);
  camPos.y = Math.min(Math.max(camPos.y, 0.4), ARCH_H);
  camera.position.copy(camPos);
  camLook.lerp(eye, 1 - Math.pow(0.05, dt));
  camera.lookAt(camLook);

  // GTA-Stylev: небольшой «грув» FOV при беге
  const runBoost = Math.min(1, moveSpeed / MOVE_RUN);
  const fovTarget = 72 + runBoost * 8;
  if (camera.fov !== fovTarget) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, 8 * dt);
    camera.updateProjectionMatrix();
  }
}

function onPointerDown(e) {
  // Pointer lock: клик захватывает курсор (Esc — показывает обратно).
  // Первый клик только захватывает, последующие бьют.
  if (e.button === 0) {
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock();
      return;
    }
    if (!chatOpen && !radioMenuOpen) tryPunch();
  }
}
function onPointerLockChange() {
  const locked = document.pointerLockElement === renderer.domElement;
  const hint = document.getElementById("curhint");
  if (hint) hint.style.display = locked ? "block" : "none";
}
document.addEventListener("pointerlockchange", onPointerLockChange);
function onPointerMove(e) {
  if (chatOpen || radioMenuOpen) return;
  // Движение мыши крутит камеру без нажатия.
  // Как в Sketchbook: фиксированная чувствительность (градусы на пиксель),
  // theta — горизонт, phi — вертикаль с широким диапазоном.
  const dx = e.movementX || e.clientX - lastMX;
  const dy = e.movementY || e.clientY - lastMY;
  lastMX = e.clientX;
  lastMY = e.clientY;
  camTheta -= dx * 0.006;
  // от первого лица (сидя) вертикаль мыши зеркалится
  camPhi = Math.min(1.25, Math.max(-0.5, camPhi + (sitting >= 0 ? -dy : dy) * 0.0048));
}
function onPointerUp() {}
function onWheel(e) {
  // Плавный зум: цель радиуса, приближение догоняет её по кадрам
  camTargetRadius = Math.min(4.2, Math.max(0.9, camTargetRadius * (1 + e.deltaY * 0.001)));
}

// ---------------------------------------------------------------------------
// Цикл
// ---------------------------------------------------------------------------
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  updatePlayer(dt);
  updateGarageRadio(dt);
  updateAnim(dt);
  netClock += dt;
  syncSend(dt);
  for (const entry of remotePlayers.values()) {
    if (entry.hadState) updateRemoteAnim(entry, dt);
    if (entry.hitTint > 0) entry.hitTint -= dt;
    if (entry.refs && entry.refs.mats) setCharacterTint(entry.refs, Math.max(0, entry.hitTint));
  }
  updatePlayerLabels();
  // покраснение собственного персонажа при ударе
  if (localTint > 0) localTint -= dt;
  if (localRefs) setCharacterTint(localRefs, Math.max(0, localTint));
  updateCamera(dt);

  const hf = document.getElementById("hitflash");
  if (hf) hf.classList.toggle("on", hitFlash > 0);
  const wasted = document.getElementById("wasted");
  if (wasted) wasted.hidden = !dead;
  if (wasted && dead) {
    const t = document.getElementById("wasted-t");
    if (t) t.textContent = Math.max(1, Math.ceil(deadT));
  }
  renderer.render(scene, camera);
}

// Добавляем функцию для отладки в консоль
window.debugLabels = function () {
  console.log("Локальная метка:", localLabel ? "✅ есть" : "❌ нет");
  if (localLabel) {
    console.log("  - Ник:", localLabel.querySelector(".pl-name")?.textContent);
    console.log("  - HP:", localLabel.querySelector(".pl-hpnum")?.textContent);
  }
  console.log("Удалённых игроков:", remotePlayers.size);
  for (const [id, p] of remotePlayers) {
    console.log(`  - ${id}: метка ${p.label ? "✅" : "❌"}, ник ${p.nick}`);
  }
};

init();
