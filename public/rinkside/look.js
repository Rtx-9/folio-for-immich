// The "quick look": exposure, white balance, contrast, highlights, shadows and
// saturation, applied by the GPU. The loupe and the exporter use this same code,
// so an export looks exactly like what you saw while culling.

export const LOOK_DEFAULTS = { exposure: 0, temp: 0, tint: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0 };
export const isNeutral = (look) => !look || Object.keys(LOOK_DEFAULTS).every((k) => !look[k]);

const WB = 0.005; // strength of one temp/tint step (natural-log gain)

// Per-channel gains for temp (+ warmer) and tint (+ magenta), brightness kept.
export function wbGains(temp = 0, tint = 0) {
  const r = Math.exp(WB * temp);
  const b = Math.exp(-WB * temp);
  const g = Math.exp(-WB * tint);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / y, g / y, b / y];
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// Temp/tint that make a (linear RGB) sample neutral grey — used for the ice.
export function neutralize([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((v) => Math.log(Math.max(v, 1e-4)));
  const temp = (lb - lr) / (2 * WB);
  const tint = (lg - (lr + lb) / 2) / WB;
  return { temp: Math.round(clamp(temp, -100, 100)), tint: Math.round(clamp(tint, -100, 100)) };
}

// Average linear colour of a small area of 8-bit sRGB pixels.
export function sampleAt(img, x, y, radius = 3) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let j = Math.max(0, y - radius); j <= Math.min(img.height - 1, y + radius); j++) {
    for (let i = Math.max(0, x - radius); i <= Math.min(img.width - 1, x + radius); i++) {
      const o = (j * img.width + i) * 4;
      for (let c = 0; c < 3; c++) sum[c] += toLinear(img.data[o + c] / 255);
      n++;
    }
  }
  return sum.map((v) => v / Math.max(1, n));
}

// Find the ice: bright, low-saturation pixels, not blown out. Returns their
// average linear colour, or null if there isn't enough of it in the frame.
export function iceColor(img) {
  const cands = [];
  for (let o = 0; o < img.data.length; o += 4) {
    const r = img.data[o] / 255;
    const g = img.data[o + 1] / 255;
    const b = img.data[o + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 0.97 || max < 0.45 || (max - min) / max > 0.3) continue;
    cands.push([0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b]);
  }
  if (cands.length < (img.data.length / 4) * 0.04) return null;
  cands.sort((a, b) => b[0] - a[0]);
  const top = cands.slice(0, Math.max(50, Math.floor(cands.length * 0.4)));
  const sum = [0, 0, 0];
  for (const [, r, g, b] of top) {
    sum[0] += toLinear(r);
    sum[1] += toLinear(g);
    sum[2] += toLinear(b);
  }
  return sum.map((v) => v / top.length);
}

const VERT = `#version 300 es
in vec2 a_pos;
uniform vec4 u_dst;   // destination rect in clip space: x0, y0, x1, y1
uniform vec4 u_src;   // source rect in texture space: u0, v0, u1, v1
out vec2 v_uv;
void main() {
  vec2 t = a_pos * 0.5 + 0.5;
  v_uv = mix(u_src.xy, u_src.zw, vec2(t.x, 1.0 - t.y));
  gl_Position = vec4(mix(u_dst.xy, u_dst.zw, t), 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec3 u_gain;
uniform float u_exp, u_con, u_hi, u_sh, u_sat;
uniform vec2 u_rot;      // straighten: cos, sin of the angle
uniform float u_aspect;  // image width / height
out vec4 outColor;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  // Straighten: sample the source turned back by the angle, around the image centre.
  vec2 p = (v_uv - 0.5) * vec2(u_aspect, 1.0);
  p = vec2(u_rot.x * p.x + u_rot.y * p.y, -u_rot.y * p.x + u_rot.x * p.y);
  vec2 uv = p / vec2(u_aspect, 1.0) + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { outColor = vec4(0.07, 0.075, 0.09, 1.0); return; }
  vec3 c = toLin(texture(u_tex, uv).rgb) * u_gain * exp2(u_exp);
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float y = pow(clamp(L, 0.0, 1.0), 1.0 / 2.2);
  y += u_sh * 0.8 * y * (1.0 - y) * (1.0 - y);
  y += u_hi * 0.8 * y * y * (1.0 - y);
  y += u_con * (y * y * (3.0 - 2.0 * y) - y);
  float Ln = pow(clamp(y, 0.0, 1.0), 2.2);
  c *= Ln / max(min(L, 1.0), 1e-5);
  float L2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(L2), c, 1.0 + u_sat), 0.0);
  outColor = vec4(toSrgb(c), 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL 2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.u = Object.fromEntries(['u_dst', 'u_src', 'u_gain', 'u_exp', 'u_con', 'u_hi', 'u_sh', 'u_sat', 'u_tex', 'u_rot', 'u_aspect'].map((n) => [n, gl.getUniformLocation(prog, n)]));
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.image = null;
  }

  setImage(bitmap) {
    if (this.image === bitmap) return;
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    this.image = bitmap;
    this.w = bitmap.width;
    this.h = bitmap.height;
  }

  // src: { x, y, w, h } in image pixels; dst: { x, y, w, h } in canvas pixels.
  // angle: straighten, in degrees (positive turns the photo clockwise).
  draw(look, src, dst, { background = [0.07, 0.075, 0.09], angle = 0 } = {}) {
    const { gl, u } = this;
    const L = { ...LOOK_DEFAULTS, ...look };
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(...background, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.image) return;
    gl.uniform4f(u.u_dst, (dst.x / cw) * 2 - 1, 1 - ((dst.y + dst.h) / ch) * 2, ((dst.x + dst.w) / cw) * 2 - 1, 1 - (dst.y / ch) * 2);
    gl.uniform4f(u.u_src, src.x / this.w, src.y / this.h, (src.x + src.w) / this.w, (src.y + src.h) / this.h);
    gl.uniform3f(u.u_gain, ...wbGains(L.temp, L.tint));
    gl.uniform1f(u.u_exp, L.exposure);
    gl.uniform1f(u.u_con, L.contrast / 100);
    gl.uniform1f(u.u_hi, L.highlights / 100);
    gl.uniform1f(u.u_sh, L.shadows / 100);
    gl.uniform1f(u.u_sat, L.saturation / 100);
    gl.uniform1i(u.u_tex, 0);
    const a = ((angle || 0) * Math.PI) / 180;
    gl.uniform2f(u.u_rot, Math.cos(a), Math.sin(a));
    gl.uniform1f(u.u_aspect, this.w / this.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

// Pixel size and EXIF orientation of a JPEG, read from its first bytes.
export async function jpegInfo(blob) {
  const v = new DataView(await blob.slice(0, 262144).arrayBuffer());
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let o = 2;
  let orientation = 1;
  let size = null;
  while (o + 4 <= v.byteLength) {
    if (v.getUint8(o) !== 0xff) break;
    const marker = v.getUint8(o + 1);
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const len = v.getUint16(o + 2);
    if (marker === 0xe1 && o + 10 < v.byteLength && v.getUint32(o + 4) === 0x45786966) {
      const t = o + 10;
      const le = v.getUint16(t) === 0x4949;
      const ifd = t + v.getUint32(t + 4, le);
      const n = ifd + 2 <= v.byteLength ? v.getUint16(ifd, le) : 0;
      for (let i = 0; i < n && ifd + 2 + i * 12 + 10 <= v.byteLength; i++) {
        const e = ifd + 2 + i * 12;
        if (v.getUint16(e, le) === 0x0112) orientation = v.getUint16(e + 8, le);
      }
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && o + 9 <= v.byteLength) {
      size = { w: v.getUint16(o + 7), h: v.getUint16(o + 5) };
      break;
    }
    if (marker === 0xda) break;
    o += 2 + len;
  }
  if (!size) return null;
  const swap = orientation >= 5 && orientation <= 8;
  return { w: swap ? size.h : size.w, h: swap ? size.w : size.h, orientation };
}

// Decode an image upright, scaled so that the `crop` area (a normalized 0–1
// rect of the upright image) has a long edge of at most `maxEdge`. Returns the
// bitmap and the crop area in bitmap pixels. (Cropping happens on the GPU:
// createImageBitmap's own crop ignores EXIF orientation in Chromium.)
export async function decode(blob, { crop = null, maxEdge = 0, quality = 'high' } = {}) {
  let info = await jpegInfo(blob);
  let probe = null;
  if (!info) {
    probe = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    info = { w: probe.width, h: probe.height };
  }
  const c = crop || { x: 0, y: 0, w: 1, h: 1 };
  const long = Math.max(c.w * info.w, c.h * info.h);
  const scale = maxEdge ? Math.min(1, maxEdge / long) : 1;
  let bitmap = probe;
  if (!probe || scale < 1) {
    probe?.close();
    const opts = { imageOrientation: 'from-image', resizeQuality: quality };
    if (scale < 1) Object.assign(opts, { resizeWidth: Math.max(1, Math.round(info.w * scale)), resizeHeight: Math.max(1, Math.round(info.h * scale)) });
    bitmap = await createImageBitmap(blob, opts);
  }
  const W = bitmap.width;
  const H = bitmap.height;
  const x = Math.round(c.x * W);
  const y = Math.round(c.y * H);
  const src = { x, y, w: Math.max(1, Math.min(W - x, Math.round(c.w * W))), h: Math.max(1, Math.min(H - y, Math.round(c.h * H))) };
  return { bitmap, src, full: info };
}

// ---- straightening ---------------------------------------------------------------------

// Shrink a crop (normalized, in the straightened frame) around its centre until
// it lies inside the photo turned by `angle` degrees. A = image width / height.
export function fitCrop(crop, angle, A) {
  const c = { x: 0, y: 0, w: 1, h: 1, ratio: 'free', ...crop, angle };
  const t = (angle * Math.PI) / 180;
  const [co, si] = [Math.cos(t), Math.sin(t)];
  const inside = (x, y) => {
    const px = (x - 0.5) * A;
    const py = y - 0.5;
    const sx = co * px + si * py;
    const sy = -si * px + co * py;
    return Math.abs(sx) <= A / 2 + 1e-9 && Math.abs(sy) <= 0.5 + 1e-9;
  };
  const fits = (k) => {
    const w = c.w * k;
    const h = c.h * k;
    const x = c.x + (c.w - w) / 2;
    const y = c.y + (c.h - h) / 2;
    return [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].every(([px, py]) => inside(px, py)) && { x, y, w, h };
  };
  if (fits(1)) return c;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return { ...c, ...fits(lo) };
}

// Find the tilt of the long straight lines in a rink (boards, kick plate, glass,
// lines on the ice) and return the angle that makes them level, in degrees, or
// null if there's no clear line. Uses a Hough transform limited to ±10°.
export function detectTilt(img) {
  const { width: W, height: H, data } = img;
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const pts = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1] - gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1];
      const gy = gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1] - gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1];
      // Only edges that are close to horizontal (gradient close to vertical).
      if (Math.abs(gx) > Math.abs(gy) * 0.3) continue;
      if (Math.abs(gy) < 40) continue;
      pts.push(x, y);
    }
  }
  if (pts.length < W * 0.5) return null;
  const STEP = 0.1;
  const N = Math.round(20 / STEP) + 1;
  let best = { score: 0, a: 0 };
  const bins = new Float32Array(H * 2 + W);
  for (let k = 0; k < N; k++) {
    const a = -10 + k * STEP;
    const tan = Math.tan((a * Math.PI) / 180);
    bins.fill(0);
    const off = W;
    for (let j = 0; j < pts.length; j += 2) bins[Math.round(pts[j + 1] - pts[j] * tan) + off] += 1;
    let score = 0;
    for (let b = 1; b < bins.length - 1; b++) {
      const v = bins[b - 1] * 0.5 + bins[b] + bins[b + 1] * 0.5;
      if (v > score) score = v;
    }
    if (score > best.score) best = { score, a };
  }
  // A real line runs across a good part of the photo.
  if (best.score < W * 0.35) return null;
  return Math.round(-best.a * 10) / 10 || 0;
}
