import * as THREE from "three";

/**
 * Procedurální záložní textura povrchu — kreslená do canvasu.
 * Použije se okamžitě jako placeholder a trvale v offline režimu.
 */
export function createFallbackTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 640;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // uhelný podklad
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1b1613");
  bg.addColorStop(0.5, "#241c16");
  bg.addColorStop(1, "#120e0c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // šikmé vrstevnice (sloje)
  ctx.save();
  ctx.globalAlpha = 0.16;
  for (let i = -H; i < W + H; i += 26) {
    ctx.strokeStyle = i % 130 === 0 ? "#3d2f22" : "#2e251d";
    ctx.lineWidth = i % 130 === 0 ? 3 : 1;
    ctx.beginPath();
    ctx.moveTo(i, -20);
    ctx.lineTo(i + H * 0.42, H + 20);
    ctx.stroke();
  }
  ctx.restore();

  // zrnitý šum
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const a = Math.random() * 0.14;
    ctx.fillStyle = Math.random() > 0.72 ? `rgba(242,163,60,${a * 0.5})` : `rgba(233,223,207,${a})`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }

  // jemná rastr mřížka
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = "#f2a33c";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();

  // střední záře
  const glow = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.55);
  glow.addColorStop(0, "rgba(242,163,60,0.14)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // typografie
  ctx.textAlign = "center";
  ctx.fillStyle = "#e9dfcf";
  ctx.font = "700 128px 'Space Grotesk', 'Segoe UI', sans-serif";
  ctx.fillText("HAVÍŘOV", W / 2, H / 2 - 14);

  ctx.fillStyle = "#f2a33c";
  ctx.font = "600 30px 'JetBrains Mono', monospace";
  ctx.fillText("ZÁLOŽNÍ POVRCH · OFFLINE REŽIM", W / 2, H / 2 + 52);

  ctx.strokeStyle = "#f2a33c";
  ctx.lineWidth = 3;
  ctx.strokeRect(26, 26, W - 52, H - 52);

  // rohové značky
  ctx.strokeStyle = "#b3a492";
  ctx.lineWidth = 2;
  const m = 48;
  const L = 22;
  const corners: Array<[number, number, number, number]> = [
    [m, m, 1, 1],
    [W - m, m, -1, 1],
    [m, H - m, 1, -1],
    [W - m, H - m, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * L, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * L);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Radiální přechod pro kontaktní stín pod panelem. */
export function createContactShadowTexture(): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 8, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(0,0,0,0.85)");
  g.addColorStop(0.55, "rgba(0,0,0,0.4)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Vertikální gradient pro zadní kulisu scény. */
export function createBackdropTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0d0a09");
  g.addColorStop(0.42, "#201510");
  g.addColorStop(0.62, "#2a1b11");
  g.addColorStop(1, "#0a0807");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // teplá skvrna za panelem
  const spot = ctx.createRadialGradient(W / 2, H * 0.58, 20, W / 2, H * 0.58, W * 0.5);
  spot.addColorStop(0, "rgba(217,127,34,0.32)");
  spot.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
