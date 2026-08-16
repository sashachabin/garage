const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8123;
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

let nextId = 1;
const NICK_CHARS = "РУКБКГТПЛ"; // wtf russian
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
  ws.send(JSON.stringify({ type: "hello", id, nick, peers, radio: radioState }));
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
        const out = JSON.stringify({ type: "state", id, state: msg.state });
        for (const [otherWs, other] of clients) {
          if (otherWs !== ws && otherWs.readyState === 1) otherWs.send(out);
        }
        break;

      case "chat": {
        const text = String(msg.text || "").slice(0, 200);
        if (!text.trim()) break;
        const time = Date.now();
        const outC = JSON.stringify({ type: "chat", id, nick: client.nick, text, ts: time });
        for (const [otherWs] of clients) {
          if (otherWs.readyState === 1) otherWs.send(outC);
        }
        console.log(`[чат] ${client.nick}: ${text}`);
        break;
      }

      // WebRTC-сигналинг (рация): пересылка только адресату
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
        // Общее состояние радио: станция и громкость — слышат все
        if (typeof msg.station === "number") radioState.station = msg.station;
        if (typeof msg.volume === "number")
          radioState.volume = Math.max(0, Math.min(1, msg.volume));
        const outR = JSON.stringify({
          type: "radio",
          station: radioState.station,
          volume: radioState.volume,
        });
        for (const [otherWs] of clients) {
          if (otherWs !== ws && otherWs.readyState === 1) otherWs.send(outR);
        }
        break;
      }

      case "knock": {
        // простой «хватка»/удар по другому игроку: отброс
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
    const out = JSON.stringify({ type: "leave", id });
    for (const [other] of clients) {
      if (other.readyState === 1) other.send(out);
    }
    console.log(`- ${nick}, всего: ${clients.size}`);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Сервер гаража: http://localhost:${PORT}`);
});
