// ---------------------------------------------------------------------------
// /debug — READ-ONLY просмотр сцены из scene.json.
// Выделение объекта → полный JSON (данные файла + вычисленные габариты).
// Правки делаются в scene.json, кнопка «🔄 Перечитать» обновляет вид.
// ---------------------------------------------------------------------------
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ROOM } from "./scene.mjs";

const { IWL, IWR, T, H, Z_REAR, Z_PART, Z_FRONT, ARCH_W, ARCH_H, ARCH_X0, ARCH_X1 } = ROOM;
const ZC = (Z_REAR + Z_FRONT) / 2;
const D2R = Math.PI / 180;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Сцена + статика (пол, стены, арка — только декор)
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0e10);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 300);
camera.position.set(2.5, 3.2, 6.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.getElementById("view").appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.12;

const al = new THREE.AmbientLight(0xffffff, 0.75);
al.userData.preserve = true;
scene.add(al);
const dl = new THREE.DirectionalLight(0xffffff, 0.9);
dl.position.set(3, 6, 2);
dl.userData.preserve = true;
scene.add(dl);

const grid = new THREE.GridHelper(13, 26, 0x3a4656, 0x232b36);
grid.position.y = 0.001;
grid.userData.preserve = true;
scene.add(grid);
grid.visible = true;

const axes = new THREE.AxesHelper(1.2);
axes.position.set(0, 0.02, 0);
axes.userData.preserve = true;
scene.add(axes);

function buildStatic() {
  const wall = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: 0x41474f }),
    );
    m.position.set(x, y, z);
    m.userData.preserve = true;
    scene.add(m);
  };
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(3.35, Z_FRONT - Z_REAR),
    new THREE.MeshLambertMaterial({ color: 0x2a2d33 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.userData.preserve = true;
  scene.add(floor);
  wall(3.35, H, 0.12, 0, H / 2, Z_REAR - 0.06); // задняя
  wall(3.35, H, 0.12, 0, H / 2, Z_FRONT + 0.06); // передняя
  wall(0.12, H, Z_FRONT - Z_REAR, IWL - 0.06, H / 2, ZC); // левая
  wall(0.12, H, Z_FRONT - Z_REAR, IWR + 0.06, H / 2, ZC); // правая
  const sideW = (3.35 - ARCH_W) / 2;
  wall(sideW, H, 0.12, IWL + sideW / 2, H / 2, 0); // перегородка лево
  wall(sideW, H, 0.12, IWR - sideW / 2, H / 2, 0); // перегородка право
  wall(ARCH_W, H - ARCH_H, 0.12, 0, H - (H - ARCH_H) / 2, 0); // перемычка арки
}
buildStatic();

// ---------------------------------------------------------------------------
// Объекты: данные из scene.json (rot_deg → radians для three.js)
// ---------------------------------------------------------------------------
const REG = []; // runtime-объекты (rot в радианах)
const SRC = new Map(); // runtime-объект -> исходный JSON из файла
const meshes = new Map(); // runtime-объект -> three Object3D
let selected = null;

function fromData(d) {
  return {
    name: d.name,
    kind: d.kind,
    size: (d.size || []).slice(),
    pos: (d.pos || [0, 0, 0]).slice(),
    rot: (d.rot_deg || [0, 0, 0]).map((v) => v * D2R),
    color: d.color,
    children: d.children,
  };
}

function toJSON(o) {
  return {
    name: o.name,
    kind: o.kind,
    size: o.size.map(round3),
    pos: o.pos.map(round3),
    rot_deg: o.rot.map((r) => round3(r / D2R)),
    color: o.color,
    children: o.children,
  };
}

const round3 = (v) => Math.round(v * 1000) / 1000;

async function loadScene() {
  try {
    const r = await fetch("/api/scene");
    const data = await r.json();
    REG.length = 0;
    SRC.clear();
    for (const d of data.objects || []) {
      const o = fromData(d);
      REG.push(o);
      SRC.set(o, toJSON(o));
    }
    $("cnt").textContent = `объектов: ${REG.length} · файл: scene.json`;
    selected = null;
    rebuild();
    updateStatus();
  } catch (e) {
    $("status").textContent = "⚠ не удалось загрузить сцену: " + e.message;
  }
}

function makeMesh(o) {
  const col = o.color ?? 0x888888;
  const mk = o.kind;
  const geom =
    mk === "box"
      ? new THREE.BoxGeometry(o.size[0], o.size[1], o.size[2])
      : mk === "plane"
        ? new THREE.PlaneGeometry(o.size[0], o.size[1])
        : mk === "cyl"
          ? new THREE.CylinderGeometry(o.size[0], o.size[1], o.size[2], 16)
          : mk === "sphere"
            ? new THREE.SphereGeometry(o.size[0], 14, 10)
            : new THREE.BoxGeometry(0.2, 0.2, 0.2);
  return new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: col }));
}

function buildChild(c, parent) {
  const m = makeMesh({ kind: c.kind, size: c.size, color: c.color ?? 0x888888 });
  const p = c.pos || [0, 0, 0];
  m.position.set(p[0], p[1], p[2]);
  const r = c.rot_deg || [0, 0, 0];
  m.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
  parent.add(m);
}

function rebuild() {
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const c = scene.children[i];
    if (!c.userData.editor) continue;
    scene.remove(c);
  }
  meshes.clear();
  for (const o of REG) {
    let root;
    if (o.kind === "group") {
      root = new THREE.Group();
      if (o.children) for (const c of o.children) buildChild(c, root);
    } else if (o.kind === "plane") {
      root = makeMesh(o);
    } else {
      root = makeMesh(o);
    }
    root.position.set(o.pos[0], o.pos[1], o.pos[2]);
    root.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
    scene.add(root);
    root.userData.editor = true;
    meshes.set(o, root);
    shade(o);
  }
  renderList();
  renderJSON();
}

function shade(o) {
  const root = meshes.get(o);
  if (!root) return;
  const sel = o === selected;
  const col = sel ? 0xffd479 : (o.color ?? 0x888888);
  const em = sel ? 0x5a420c : 0x000000;
  root.traverse((ch) => {
    if (ch.isMesh) {
      ch.material.color.setHex(col);
      if (ch.material.emissive) ch.material.emissive.setHex(em);
    }
  });
}

// ---------------------------------------------------------------------------
// Список объектов
// ---------------------------------------------------------------------------
function renderList() {
  const listEl = $("list");
  listEl.innerHTML = "";
  for (const o of REG) {
    const d = document.createElement("div");
    d.className = "it" + (o === selected ? " sel" : "");
    d.innerHTML = `<span>${o.name}</span><span class="coo">${o.pos[0].toFixed(2)},${o.pos[1].toFixed(2)},${o.pos[2].toFixed(2)}</span>`;
    d.onclick = () => selectObj(o);
    listEl.appendChild(d);
  }
}

function selectObj(o) {
  if (selected) shade(selected);
  selected = o;
  if (o) shade(o);
  renderList();
  renderJSON();
  updateStatus();
}

// ---------------------------------------------------------------------------
// JSON выбранного объекта (+ вычисленные габариты в 3D)
// ---------------------------------------------------------------------------
function objInfo(o) {
  const root = meshes.get(o);
  if (!root) return null;
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());
  return {
    bbox_center: [center.x, center.y, center.z].map(round3),
    bbox_size: [size.x, size.y, size.z].map(round3),
    floor_footprint: {
      min_x: round3(bb.min.x),
      max_x: round3(bb.max.x),
      min_z: round3(bb.min.z),
      max_z: round3(bb.max.z),
    },
  };
}

function renderJSON() {
  const o = selected;
  if (!o) {
    $("jsonEmpty").style.display = "";
    $("jsonText").style.display = "none";
    $("jsonBtns").style.display = "none";
    return;
  }
  $("jsonEmpty").style.display = "none";
  $("jsonText").style.display = "";
  $("jsonBtns").style.display = "";
  const info = objInfo(o);
  const json = JSON.stringify({ ...SRC.get(o), info }, null, 2);
  $("jsonText").value = json;
}

$("btnCopy").onclick = () => {
  const t = $("jsonText").value;
  navigator.clipboard.writeText(t).then(() => {
    $("btnCopy").textContent = "Скопировано ✓";
    setTimeout(() => {
      $("btnCopy").textContent = "Копировать";
    }, 1200);
  });
};
$("btnClear").onclick = () => selectObj(null);

// ---------------------------------------------------------------------------
// Клик-выбор в 3D + статус
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

renderer.domElement.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  pointer.x = (ev.clientX / innerWidth) * 2 - 1;
  pointer.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const arr = [];
  for (const [o, root] of meshes) if (root.visible) arr.push(root);
  const hits = raycaster.intersectObjects(arr, true);
  let found = null;
  for (const h of hits) {
    for (const [o, root] of meshes) {
      if (root === h.object || (root.isGroup && root.children.includes(h.object))) {
        found = o;
        break;
      }
    }
    if (found) break;
  }
  selectObj(found);
});

let hoverInfo = "";
addEventListener("pointermove", (ev) => {
  pointer.x = (ev.clientX / innerWidth) * 2 - 1;
  pointer.y = -(ev.clientY / innerHeight) * 2 + 1;
  const g = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  raycaster.setFromCamera(pointer, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(g, hit)) {
    hoverInfo = `мышь: x=${hit.x.toFixed(3)} y=0 z=${hit.z.toFixed(3)}`;
  }
});

function updateStatus() {
  const o = selected;
  $("status").textContent = o
    ? `выбран: ${o.name}  pos(${o.pos.map((v) => v.toFixed(2)).join(", ")})  rot°(${o.rot.map((r) => Math.round(r / D2R)).join(", ")})\n${hoverInfo}`
    : `никто ${hoverInfo ? "\n" + hoverInfo : ""}`;
}
setInterval(updateStatus, 150);
updateStatus();

// ---------------------------------------------------------------------------
// Управление
// ---------------------------------------------------------------------------
$("btnReload").onclick = loadScene;
$("btnGrid").onclick = () => {
  grid.visible = !grid.visible;
  $("btnGrid").classList.toggle("on", grid.visible);
};
$("btnCopyScene").onclick = async () => {
  try {
    const r = await fetch("/api/scene");
    const t = await r.text();
    navigator.clipboard.writeText(t).then(() => {
      $("btnCopyScene").textContent = "Скопировано ✓";
      setTimeout(() => {
        $("btnCopyScene").textContent = "📋 Сцена (JSON)";
      }, 1200);
    });
  } catch (e) {
    /* ignore */
  }
};

addEventListener("keydown", (e) => {
  if (e.code === "KeyG") $("btnGrid").click();
  if (e.code === "KeyR") $("btnReload").click();
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
}

loadScene();
loop();
