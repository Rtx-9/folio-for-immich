// Renders one photo for export off the main thread: decode upright, crop and
// resize, apply the look on the GPU, and encode a JPEG. The page adds the
// metadata and writes the file.
import { decode, Renderer } from './look.js';

let renderer;
let canvas;

self.onmessage = async (e) => {
  const { id, blob, crop, look, longEdge, quality } = e.data;
  try {
    const { bitmap, src } = await decode(blob, { crop, maxEdge: longEdge || 0, quality: 'high' });
    canvas ||= new OffscreenCanvas(src.w, src.h);
    canvas.width = src.w;
    canvas.height = src.h;
    renderer ||= new Renderer(canvas);
    renderer.setImage(bitmap);
    renderer.draw(look, src, { x: 0, y: 0, w: src.w, h: src.h });
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: Math.max(0.3, Math.min(1, quality / 100)) });
    renderer.image = null;
    bitmap.close();
    const buf = await jpeg.arrayBuffer();
    self.postMessage({ id, ok: true, jpeg: buf, width: src.w, height: src.h }, [buf]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
