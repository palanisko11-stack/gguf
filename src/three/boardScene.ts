import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  createFallbackTexture,
  createContactShadowTexture,
  createBackdropTexture,
} from "./fallbackTexture";

export const TEXTURE_URL =
  "https://raw.githubusercontent.com/palanisko11-stack/3D-assety/933acce83c61de5a97dc6cd13cfd43f35617850c/havirov.webp";

export type FramePreset = "uhel" | "ocel" | "mosaz";

export interface BoardParams {
  amplitude: number; // 0 – 0.45   výška vlnění povrchu
  frequency: number; // 0.4 – 3.5  prostorová frekvence vln
  speed: number; //     0 – 3      rychlost animace povrchu
  bumpScale: number; // 0 – 0.15   reliéf z textury
  roughness: number; // 0 – 1
  metalness: number; // 0 – 1
  clearcoat: number; // 0 – 1
  texRepeat: number; //   0.4 – 2  měřítko textury
  keyLight: number; //    0 – 6    teplé klíčové světlo
  rimLight: number; //    0 – 6    studené obrysové světlo
  exposure: number; //    0.4 – 2  expozice
  scanLight: boolean; //  stěhovací reflektor
  scanSpeed: number; //   0.1 – 2.5
  autoRotate: boolean;
  paused: boolean;
  frame: FramePreset;
}

export const DEFAULT_PARAMS: BoardParams = {
  amplitude: 0.07,
  frequency: 1.25,
  speed: 1,
  bumpScale: 0.045,
  roughness: 0.5,
  metalness: 0.14,
  clearcoat: 0.38,
  texRepeat: 1,
  keyLight: 2.6,
  rimLight: 1.9,
  exposure: 1.12,
  scanLight: true,
  scanSpeed: 0.65,
  autoRotate: false,
  paused: false,
  frame: "uhel",
};

export interface Telemetry {
  fps: number;
  ms: number;
  calls: number;
  triangles: number;
  vertices: number;
  camDist: number;
  azimuth: number;
  polar: number;
  texWidth: number;
  texHeight: number;
}

export interface TextureState {
  status: "loading" | "ready" | "fallback";
  source: "github" | "procedurální";
  width: number;
  height: number;
}

export interface SceneCallbacks {
  onTelemetry: (t: Telemetry) => void;
  onTexture: (s: TextureState) => void;
}

export interface SceneAPI {
  setParams: (p: Partial<BoardParams>) => void;
  resetCamera: () => void;
  dispose: () => void;
}

const FRAME_PRESETS: Record<FramePreset, { color: number; metalness: number; roughness: number }> = {
  uhel: { color: 0x211d1a, metalness: 0.68, roughness: 0.46 },
  ocel: { color: 0x9aa1ab, metalness: 0.92, roughness: 0.34 },
  mosaz: { color: 0xc8a25a, metalness: 1.0, roughness: 0.3 },
};

const BOARD_H = 4;
const BOARD_Y = 2.9; // výška středu panelu nad podlahou
const clamp = THREE.MathUtils.clamp;

function sanitize(p: BoardParams): BoardParams {
  return {
    amplitude: clamp(p.amplitude, 0, 0.45),
    frequency: clamp(p.frequency, 0.4, 3.5),
    speed: clamp(p.speed, 0, 3),
    bumpScale: clamp(p.bumpScale, 0, 0.15),
    roughness: clamp(p.roughness, 0, 1),
    metalness: clamp(p.metalness, 0, 1),
    clearcoat: clamp(p.clearcoat, 0, 1),
    texRepeat: clamp(p.texRepeat, 0.4, 2),
    keyLight: clamp(p.keyLight, 0, 6),
    rimLight: clamp(p.rimLight, 0, 6),
    exposure: clamp(p.exposure, 0.4, 2),
    scanLight: !!p.scanLight,
    scanSpeed: clamp(p.scanSpeed, 0.1, 2.5),
    autoRotate: !!p.autoRotate,
    paused: !!p.paused,
    frame: FRAME_PRESETS[p.frame] ? p.frame : "uhel",
  };
}

export function createBoardScene(container: HTMLElement, cb: SceneCallbacks): SceneAPI {
  let params = sanitize({ ...DEFAULT_PARAMS });
  let disposed = false;

  // ── renderer / scéna / kamera ─────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = params.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0a09);
  scene.fog = new THREE.FogExp2(0x0d0a09, 0.042);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
  camera.position.set(5.8, 3.4, 8.4);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2.7, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 2.6;
  controls.maxDistance = 18;
  controls.maxPolarAngle = 1.52;
  controls.minPolarAngle = 0.12;
  controls.autoRotateSpeed = 0.9;
  controls.update();
  controls.saveState();

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // ── materiály ─────────────────────────────────────────
  const fallbackTex = createFallbackTexture();
  let currentTex: THREE.Texture = fallbackTex;
  let texInfo = { width: 1024, height: 640 };

  const surfaceMat = new THREE.MeshPhysicalMaterial({
    map: currentTex,
    bumpMap: currentTex,
    bumpScale: params.bumpScale,
    color: 0xffffff,
    roughness: params.roughness,
    metalness: params.metalness,
    clearcoat: params.clearcoat,
    clearcoatRoughness: 0.55,
    envMapIntensity: 0.75,
  });

  const frameMat = new THREE.MeshStandardMaterial({ envMapIntensity: 1.0 });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x1a1512,
    metalness: 0.55,
    roughness: 0.6,
    envMapIntensity: 0.5,
  });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x4a3218,
    emissive: 0xf2a33c,
    emissiveIntensity: 2.4,
    roughness: 0.4,
    metalness: 0.2,
  });

  // ── prostředí: podlaha, kulisa, prach ─────────────────
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 72),
    new THREE.MeshStandardMaterial({
      color: 0x181310,
      roughness: 0.34,
      metalness: 0.55,
      envMapIntensity: 0.55,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // kruhové podium
  const stageRing = new THREE.Mesh(
    new THREE.RingGeometry(5.4, 5.52, 96),
    new THREE.MeshBasicMaterial({ color: 0xf2a33c, transparent: true, opacity: 0.22 })
  );
  stageRing.rotation.x = -Math.PI / 2;
  stageRing.position.y = 0.015;
  scene.add(stageRing);

  const stageDisc = new THREE.Mesh(
    new THREE.CircleGeometry(5.4, 96),
    new THREE.MeshStandardMaterial({ color: 0x201812, roughness: 0.5, metalness: 0.3, envMapIntensity: 0.35 })
  );
  stageDisc.rotation.x = -Math.PI / 2;
  stageDisc.position.y = 0.008;
  stageDisc.receiveShadow = true;
  scene.add(stageDisc);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 38),
    new THREE.MeshBasicMaterial({ map: createBackdropTexture(), fog: false })
  );
  backdrop.position.set(0, 13, -16);
  scene.add(backdrop);

  // prachové částice
  const DUST = 340;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST * 3);
  const dustBaseX = new Float32Array(DUST);
  const dustPhase = new Float32Array(DUST);
  const dustVel = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustBaseX[i] = (Math.random() - 0.5) * 19;
    dustPos[i * 3] = dustBaseX[i];
    dustPos[i * 3 + 1] = Math.random() * 7.5;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 13;
    dustPhase[i] = Math.random() * Math.PI * 2;
    dustVel[i] = 0.06 + Math.random() * 0.22;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0xf2c37a,
      size: 0.035,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  scene.add(dust);

  // ── osvětlení ─────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0x4a3d33, 0x161009, 0.55));

  const keyLight = new THREE.DirectionalLight(0xffd9a0, params.keyLight);
  keyLight.position.set(4.6, 6.4, 5.2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -8;
  keyLight.shadow.camera.right = 8;
  keyLight.shadow.camera.top = 9;
  keyLight.shadow.camera.bottom = -3;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 24;
  keyLight.shadow.bias = -0.0006;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x6f9ec4, params.rimLight);
  rimLight.position.set(-6.5, 4.6, -5);
  scene.add(rimLight);

  const scanSpot = new THREE.SpotLight(0xffb45e, 40, 30, 0.46, 0.65, 1.35);
  scanSpot.position.set(0, 6.6, 3.6);
  const scanTarget = new THREE.Object3D();
  scanTarget.position.set(0, BOARD_Y, 0);
  scene.add(scanTarget);
  scanSpot.target = scanTarget;
  scene.add(scanSpot);

  const lampLight = new THREE.PointLight(0xf2a33c, 6, 7, 1.6);
  lampLight.position.set(0, 0.75, 1.4);
  scene.add(lampLight);

  // ── panel (tabule) ────────────────────────────────────
  const boardGroup = new THREE.Group();
  boardGroup.position.set(0, BOARD_Y, 0);
  scene.add(boardGroup);

  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: createContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    })
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.02;
  scene.add(contactShadow);

  let surfaceGeo: THREE.PlaneGeometry | null = null;
  let basePositions: Float32Array = new Float32Array(0);
  let surfaceMesh: THREE.Mesh | null = null;
  let boardWidth = 6.4;
  let forceSurfaceSync = true;

  function clearBoard() {
    for (const child of [...boardGroup.children]) {
      boardGroup.remove(child);
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    }
    surfaceGeo = null;
    surfaceMesh = null;
  }

  function buildBoard(aspect: number) {
    clearBoard();
    const safeAspect = Number.isFinite(aspect) && aspect > 0.2 ? aspect : 1.6;
    boardWidth = clamp(BOARD_H * safeAspect, 3.2, 9.6);
    const w = boardWidth;
    const h = BOARD_H;
    const t = 0.24; // síla rámu
    const d = 0.26; // hloubka rámu

    // povrch — jemně segmentovaná rovina pro vlnění
    const segX = 148;
    const segY = clamp(Math.round((segX * h) / w), 48, 170);
    surfaceGeo = new THREE.PlaneGeometry(w, h, segX, segY);
    basePositions = new Float32Array(surfaceGeo.attributes.position.array);
    surfaceMesh = new THREE.Mesh(surfaceGeo, surfaceMat);
    surfaceMesh.position.z = 0.05;
    surfaceMesh.castShadow = true;
    surfaceMesh.receiveShadow = true;
    boardGroup.add(surfaceMesh);

    // zadní deska
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.16), darkMat);
    back.position.z = -0.08;
    back.castShadow = true;
    boardGroup.add(back);

    // rám — 4 lišty
    const mkBar = (bw: number, bh: number, x: number, y: number) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), frameMat);
      bar.position.set(x, y, -0.02);
      bar.castShadow = true;
      boardGroup.add(bar);
    };
    mkBar(w + t * 2, t, 0, h / 2 + t / 2);
    mkBar(w + t * 2, t, 0, -(h / 2 + t / 2));
    mkBar(t, h, w / 2 + t / 2, 0);
    mkBar(t, h, -(w / 2 + t / 2), 0);

    // nohy stojanu
    const legH = BOARD_Y - (h / 2 + t);
    const legGeo = new THREE.BoxGeometry(0.15, Math.max(legH + 0.12, 0.2), 0.15);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, darkMat);
      leg.position.set(sx * w * 0.33, -(BOARD_Y - legH / 2 + 0.06), -0.19);
      leg.castShadow = true;
      boardGroup.add(leg);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.34), darkMat);
      pad.position.set(sx * w * 0.33, -(BOARD_Y - 0.03), -0.19);
      pad.castShadow = true;
      boardGroup.add(pad);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(w * 0.66 + 0.15, 0.09, 0.12), darkMat);
    cross.position.set(0, -(BOARD_Y - 0.24), -0.19);
    boardGroup.add(cross);

    // světelná lišta pod rámem („důlní lampa“)
    const lampBar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, 0.05, 0.05), lampMat);
    lampBar.position.set(0, -(h / 2 + t + 0.09), 0.14);
    boardGroup.add(lampBar);

    // kontaktní stín podle šířky
    contactShadow.scale.set(w * 0.85, 2.4, 1);
    contactShadow.position.set(0, 0.02, 0.15);

    applyTextureRepeat();
    forceSurfaceSync = true;
  }

  buildBoard(1.6);

  function applyTextureRepeat() {
    currentTex.repeat.set(params.texRepeat, params.texRepeat);
    currentTex.needsUpdate = true;
  }

  // ── textura z GitHubu ─────────────────────────────────
  cb.onTexture({ status: "loading", source: "github", width: 0, height: 0 });
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  loader.load(
    TEXTURE_URL,
    (tex) => {
      if (disposed) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = Math.max(1, renderer.capabilities.getMaxAnisotropy());
      const img = tex.image as { width?: number; height?: number } | null;
      const iw = img && img.width ? img.width : 1600;
      const ih = img && img.height ? img.height : 1000;
      currentTex = tex;
      texInfo = { width: iw, height: ih };
      surfaceMat.map = tex;
      surfaceMat.bumpMap = tex;
      surfaceMat.needsUpdate = true;
      buildBoard(iw / ih);
      cb.onTexture({ status: "ready", source: "github", width: iw, height: ih });
    },
    undefined,
    () => {
      if (disposed) return;
      cb.onTexture({ status: "fallback", source: "procedurální", width: texInfo.width, height: texInfo.height });
    }
  );

  // ── parametry → scéna ─────────────────────────────────
  function applyParams() {
    surfaceMat.roughness = params.roughness;
    surfaceMat.metalness = params.metalness;
    surfaceMat.clearcoat = params.clearcoat;
    surfaceMat.bumpScale = params.bumpScale;
    applyTextureRepeat();

    const fp = FRAME_PRESETS[params.frame];
    frameMat.color.setHex(fp.color);
    frameMat.metalness = fp.metalness;
    frameMat.roughness = fp.roughness;

    keyLight.intensity = params.keyLight;
    rimLight.intensity = params.rimLight;
    scanSpot.visible = params.scanLight;
    renderer.toneMappingExposure = params.exposure;
    controls.autoRotate = params.autoRotate;
    forceSurfaceSync = true;
  }
  applyParams();

  // ── vlnění povrchu ────────────────────────────────────
  let surfaceActive = false;
  function updateSurface(t: number) {
    if (!surfaceGeo || !surfaceMesh) return;
    const amp = params.amplitude;
    const pos = surfaceGeo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    if (amp < 0.001) {
      if (surfaceActive || forceSurfaceSync) {
        for (let i = 2; i < arr.length; i += 3) arr[i] = 0;
        pos.needsUpdate = true;
        surfaceGeo.computeVertexNormals();
        surfaceActive = false;
      }
      return;
    }
    const f = params.frequency;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      const x = basePositions[ix];
      const y = basePositions[ix + 1];
      arr[ix + 2] =
        amp *
        (Math.sin(x * f + t * 1.25) * 0.55 +
          Math.sin(y * f * 1.65 - t * 0.85) * 0.3 +
          Math.sin((x + y) * f * 0.62 + t * 0.6) * 0.15);
    }
    pos.needsUpdate = true;
    surfaceGeo.computeVertexNormals();
    surfaceActive = true;
  }

  // ── smyčka ────────────────────────────────────────────
  const clock = new THREE.Clock();
  let animT = 0;
  let scanAngle = 0;
  let raf = 0;
  let fpsFrames = 0;
  let fpsAcc = 0;

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (!params.paused) {
      animT += dt * params.speed;
      scanAngle += dt * params.scanSpeed;

      // prach
      const dp = dustGeo.attributes.position as THREE.BufferAttribute;
      const darr = dp.array as Float32Array;
      for (let i = 0; i < DUST; i++) {
        let y = darr[i * 3 + 1] + dustVel[i] * dt;
        if (y > 7.6) y = 0.05;
        darr[i * 3 + 1] = y;
        darr[i * 3] = dustBaseX[i] + Math.sin(animT * 0.35 + dustPhase[i]) * 0.5;
      }
      dp.needsUpdate = true;

      // stěhovací reflektor
      scanSpot.position.x = Math.sin(scanAngle) * boardWidth * 0.72;
      scanSpot.position.z = 3.4 + Math.cos(scanAngle * 0.7) * 1.2;

      // cukání důlní lampy
      lampLight.intensity = 6 + Math.sin(animT * 6.3) * 0.5 + Math.sin(animT * 17.7) * 0.25;
      lampMat.emissiveIntensity = 2.4 + Math.sin(animT * 6.3) * 0.25;
    }

    if (!params.paused || forceSurfaceSync) {
      updateSurface(animT);
      forceSurfaceSync = false;
    }

    controls.update();
    renderer.render(scene, camera);

    // telemetrie
    fpsFrames++;
    fpsAcc += dt;
    if (fpsAcc >= 0.3) {
      cb.onTelemetry({
        fps: fpsFrames / fpsAcc,
        ms: (fpsAcc / fpsFrames) * 1000,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        vertices: surfaceGeo ? surfaceGeo.attributes.position.count : 0,
        camDist: camera.position.distanceTo(controls.target),
        azimuth: THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()),
        polar: THREE.MathUtils.radToDeg(controls.getPolarAngle()),
        texWidth: texInfo.width,
        texHeight: texInfo.height,
      });
      fpsFrames = 0;
      fpsAcc = 0;
    }
  }
  tick();

  // ── API ───────────────────────────────────────────────
  return {
    setParams(next: Partial<BoardParams>) {
      params = sanitize({ ...params, ...next });
      applyParams();
    },
    resetCamera() {
      controls.reset();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => disposeMat(m));
        else if (mat) disposeMat(mat);
      });
      fallbackTex.dispose();
      if (currentTex !== fallbackTex) currentTex.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };

  function disposeMat(m: THREE.Material) {
    const anyM = m as THREE.MeshStandardMaterial;
    if (anyM.map) anyM.map.dispose();
    m.dispose();
  }
}
