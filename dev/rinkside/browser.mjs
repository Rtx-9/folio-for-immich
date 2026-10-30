// A tiny headless Edge/Chrome driver over the DevTools protocol, for tests and
// screenshots (dev only, no dependencies). Uses Node's built-in WebSocket.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export async function launch({ width = 1440, height = 900, profileDir } = {}) {
  const exe = CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('No Edge or Chrome found (set BROWSER=path)');
  // (A profile under the system temp folder doesn't work in some sandboxes.)
  const tmpRoot = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '.tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const profile = profileDir || fs.mkdtempSync(path.join(tmpRoot, 'browser-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(exe, [`--remote-debugging-port=${port}`, '--headless=new', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
    } catch {
      // not up yet
    }
  }
  if (!target) throw new Error('Browser did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const logs = [];
  listeners.push((m) => {
    if (m.method === 'Runtime.consoleAPICalled') logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const page = {
    logs,
    send,
    async goto(url) {
      const loaded = new Promise((r) => listeners.push((m) => m.method === 'Page.loadEventFired' && r()));
      await send('Page.navigate', { url });
      await loaded;
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async key(key, { code = key, keyCode, modifiers = 0, repeat = false, text } = {}) {
      const base = { key, code, windowsVirtualKeyCode: keyCode, modifiers, autoRepeat: repeat };
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async keyDown(key, opts = {}) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: opts.code || key, windowsVirtualKeyCode: opts.keyCode, autoRepeat: Boolean(opts.repeat) });
    },
    async keyUp(key, opts = {}) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: opts.code || key, windowsVirtualKeyCode: opts.keyCode });
    },
    async type(text) {
      await send('Input.insertText', { text });
    },
    async click(x, y, clickCount = 1) {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount });
    },
    async drag(x0, y0, x1, y1, steps = 8) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
      for (let i = 1; i <= steps; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
    },
    async initScript(source) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source });
    },
    // Put files into an <input type=file> (like choosing them in the dialog).
    async setFiles(selector, files) {
      const { root } = await send('DOM.getDocument', { depth: -1 });
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`No element ${selector}`);
      await send('DOM.setFileInputFiles', { nodeId, files });
    },
    async screenshot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async wait(fnSource, timeout = 15000) {
      const t0 = Date.now();
      for (;;) {
        if (await page.eval(`Boolean(${fnSource})`)) return;
        if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for ${fnSource}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    async close() {
      try {
        await send('Browser.close');
      } catch {
        // already gone
      }
      proc.kill();
      await new Promise((r) => setTimeout(r, 300));
      if (!profileDir) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
  return page;
}
