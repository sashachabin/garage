const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { Innertube } = require("youtubei.js");

// APP_PORT / APP_IP задаёт хостинг (netangels)
const PORT = process.env.PORT || process.env.APP_PORT || 8223;
const HOST = process.env.APP_IP || "0.0.0.0";
const ROOT = __dirname;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let url = req.url.split("?")[0];
  if (url === "/") url = "/index.html";
  if (url === "/debug") url = "/debug.html";

  // --- API сцены (только чтение): scene.json — файл, который можно править руками ---
  if (url === "/api/scene") {
    if (req.method !== "GET") {
      res.writeHead(405);
      return res.end();
    }
    fs.readFile(path.join(ROOT, "scene.json"), (err, data) => {
      if (!err) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(data);
      }
      // scene.json нет — создаём из дефолта (scene.mjs); ?ts= ломает ESM-кэш
      const { pathToFileURL } = require("url");
      import(pathToFileURL(path.join(ROOT, "scene.mjs")).href + "?ts=" + Date.now())
        .then((m) => {
          const def = { room: m.ROOM, objects: m.defaultObjects() };
          const json = JSON.stringify(def, null, 2);
          fs.writeFile(path.join(ROOT, "scene.json"), json, () => {});
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(json);
          console.log("♥ создан scene.json из дефолта (scene.js)");
        })
        .catch((e) => {
          console.error("scene.js:", e);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ room: {}, objects: [] }));
        });
    });
    return;
  }

  const file = path.join(ROOT, path.normalize(url));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not Found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

// --- WebSocket: релей состояний игроков ---
const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> { id, nick }

let radioState = { station: -1, volume: 0.15 }; // общее состояние радио для всех игроков

let tvState = { videoId: null, title: "", playing: false, pos: 0, ts: Date.now(), vol: 0.5, playlist: [], playlistIdx: -1 };

// YouTube InnerTube client для импорта плейлистов
let innertube = null;
Innertube.create().then((yt) => { innertube = yt; console.log("♥ youtubei.js ready"); }).catch((e) => console.error("youtubei.js init error:", e));

// Извлечение playlist ID из URL YouTube / YouTube Music
function parsePlaylistUrl(url) {
  try {
    const u = new URL(url);
    const list = u.searchParams.get("list");
    if (!list) return null;
    if (/^(PL|RD|OL|UL|FL)/.test(list)) return list;
    return list;
  } catch {
    return null;
  }
}

// Загрузка плейлиста через youtubei.js
async function fetchPlaylist(listId) {
  if (!innertube) throw new Error("YouTube client not ready");
  const playlist = await innertube.getPlaylist(listId);
  const items = [];
  if (playlist && playlist.items) {
    for (const item of playlist.items) {
      const videoId = item.content_id;
      if (!videoId) continue;
      const title = item.metadata && item.metadata.title ? item.metadata.title.text || "" : "";
      items.push({ videoId, title, dur: 0 });
    }
  }
  return items;
}

// Вспомогательная функция для рассылки сообщений всем клиентам
function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  for (const [clientWs] of clients) {
    if (clientWs !== excludeWs && clientWs.readyState === 1) {
      clientWs.send(data);
    }
  }
}

let nextId = 1;
function randomNick() {
  const colors = ["красный", "синий", "белый", "чёрный", "оранжевый"];
  const animals = ["Лев", "Рысь", "Пёс", "Кот", "Волк", "Лось", "Ёж", "Мышь"];
  return (
    animals[(Math.random() * animals.length) | 0] +
    "-" +
    colors[(Math.random() * colors.length) | 0]
  );
}

wss.on("connection", (ws) => {
  const id = "p" + nextId++;
  const nick = randomNick();
  clients.set(ws, { id, nick, ws });
  const peers = [...clients.values()]
    .filter((c) => c.ws !== ws && c.state)
    .map((c) => ({ id: c.id, nick: c.nick, state: c.state }));
  ws.send(JSON.stringify({ type: "hello", id, nick, peers, radio: radioState, tv: tvState }));
  const joinTs = Date.now();
  
  broadcast({ type: "join", id, nick, ts: joinTs }, ws);
  console.log(`+ ${nick} (${id}), всего: ${clients.size}`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || !msg.type) return;
    const client = clients.get(ws);

    switch (msg.type) {
      case "state":
        client.state = msg.state;
        broadcast({ type: "state", id, state: msg.state, nick: client.nick }, ws);
        break;

      case "chat": {
        const text = String(msg.text || "").slice(0, 200);
        if (!text.trim()) break;
        const time = Date.now();
        broadcast({ type: "chat", id, nick: client.nick, text, ts: time });
        console.log(`[чат] ${client.nick}: ${text}`);
        break;
      }

      case "death": {
        broadcast({ type: "event", kind: "death", who: client.nick, killer: msg.killer || null, ts: Date.now() });
        break;
      }

      case "signal": {
        const targetId = msg.to;
        for (const [tw, tc] of clients) {
          if (tc.id === targetId && tw.readyState === 1) {
            tw.send(JSON.stringify({ type: "signal", id, to: targetId, data: msg.data }));
            break;
          }
        }
        break;
      }

      case "radio": {
        if (typeof msg.station === "number") radioState.station = msg.station;
        if (typeof msg.volume === "number")
          radioState.volume = Math.max(0, Math.min(1, msg.volume));
        
        broadcast({
          type: "radio",
          station: radioState.station,
          volume: radioState.volume,
        }, ws);
        break;
      }

      case "tv": {
        const now = Date.now();

        if (msg.cmd === "play") {
          if (tvState.playing) {
            const elapsed = (now - tvState.ts) / 1000;
            tvState.pos = (tvState.pos || 0) + elapsed;
          } else if (typeof msg.pos === "number") {
            tvState.pos = msg.pos;
          }
          if (msg.videoId) tvState.videoId = String(msg.videoId);
          if (msg.title) tvState.title = String(msg.title);
          if (Array.isArray(msg.playlist)) tvState.playlist = msg.playlist;
          if (typeof msg.playlistIdx === "number") tvState.playlistIdx = msg.playlistIdx;
          tvState.playing = true;
          tvState.ts = now;

        } else if (msg.cmd === "pause") {
          if (tvState.playing) {
            const elapsed = (now - tvState.ts) / 1000;
            tvState.pos = (tvState.pos || 0) + elapsed;
          } else if (typeof msg.pos === "number") {
            tvState.pos = msg.pos;
          }
          tvState.playing = false;
          tvState.ts = now;

        } else if (msg.cmd === "seek") {
          tvState.pos = typeof msg.pos === "number" ? Math.max(0, msg.pos) : tvState.pos;
          tvState.ts = now;

        } else if (msg.cmd === "stop") {
          tvState.videoId = null;
          tvState.title = "";
          tvState.playing = false;
          tvState.pos = 0;
          tvState.ts = now;
          tvState.playlist = [];
          tvState.playlistIdx = -1;

        } else if (msg.cmd === "vol") {
          tvState.vol = Math.max(0, Math.min(1, typeof msg.vol === "number" ? msg.vol : tvState.vol));

        } else if (msg.cmd === "playlist") {
          if (Array.isArray(msg.playlist)) tvState.playlist = msg.playlist;
          if (typeof msg.playlistIdx === "number") tvState.playlistIdx = msg.playlistIdx;

        } else if (msg.cmd === "sync") {
          if (typeof msg.pos === "number") tvState.pos = msg.pos;
          tvState.ts = now;
          if (typeof msg.dur === "number" && tvState.videoId) tvState.dur = msg.dur;
          return;

        } else if (msg.cmd === "importPlaylist") {
          const listId = parsePlaylistUrl(msg.url || "");
          if (!listId) {
            ws.send(JSON.stringify({ type: "tv", cmd: "playlistError", error: "Невалидный URL плейлиста" }));
            return;
          }
          fetchPlaylist(listId).then((items) => {
            if (ws.readyState !== 1) return;
            ws.send(JSON.stringify({ type: "tv", cmd: "playlistItems", items, listId }));
          }).catch((e) => {
            console.error("fetchPlaylist error:", e);
            if (ws.readyState === 1)
              ws.send(JSON.stringify({ type: "tv", cmd: "playlistError", error: "Не удалось загрузить плейлист: " + (e.message || e) }));
          });
          return;
        }

        broadcast({ type: "tv", state: tvState });
        break;
      }

      case "knock": {
        const targetId = msg.to;
        const dir = Array.isArray(msg.dir) && msg.dir.length === 3 ? msg.dir : [0, 0, 0];
        const pwr = typeof msg.pwr === "number" ? msg.pwr : 0.5;
        for (const [tw, tc] of clients) {
          if (tc.id === targetId && tw.readyState === 1) {
            tw.send(JSON.stringify({ type: "knock", id, dir, nick: client.nick, pwr }));
            break;
          }
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    broadcast({ type: "leave", id, nick, ts: Date.now() });
    console.log(`- ${nick}, всего: ${clients.size}`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Сервер гаража: http://localhost:${PORT}`);
});
