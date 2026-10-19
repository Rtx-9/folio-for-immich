// Reverse proxy to Immich. Lets Folio sit in front of Immich on the same domain,
// which is what makes "signed in to Immich = signed in to Folio" work, and lets
// us add a "Pages" link to Immich's sidebar.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { config } from './config.js';
import { isSecure, send } from './http.js';

const target = new URL(config.immichUrl);
const lib = target.protocol === 'https:' ? https : http;
const targetPort = target.port || (target.protocol === 'https:' ? 443 : 80);
const prefix = target.pathname.replace(/\/+$/, '');
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];
const SNIPPET = '<script src="/_folio/inject.js" defer></script>';

function forwardHeaders(req) {
  const headers = { ...req.headers };
  for (const h of HOP) delete headers[h];
  headers.host = target.host;
  headers['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');
  headers['x-forwarded-proto'] ||= isSecure(req) ? 'https' : 'http';
  headers['x-forwarded-host'] ||= req.headers.host;
  return headers;
}

export function web(req, res) {
  const headers = forwardHeaders(req);
  const inject =
    config.inject && req.method === 'GET' && !req.url.startsWith('/api/') && (req.headers.accept || '').includes('text/html');
  if (inject) {
    // We need the plain HTML to add our script tag.
    headers['accept-encoding'] = 'identity';
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
  }

  const upstream = lib.request(
    { protocol: target.protocol, hostname: target.hostname, port: targetPort, method: req.method, path: prefix + req.url, headers },
    (up) => {
      const out = { ...up.headers };
      for (const h of HOP) delete out[h];
      const isHtml = (up.headers['content-type'] || '').includes('text/html') && !up.headers['content-encoding'];
      if (!inject || !isHtml) {
        res.writeHead(up.statusCode, up.statusMessage, out);
        up.pipe(res);
        return;
      }
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        html = html.includes('</head>') ? html.replace('</head>', `${SNIPPET}</head>`) : html + SNIPPET;
        delete out['content-length'];
        delete out.etag;
        delete out['last-modified'];
        send(res, up.statusCode, html, out);
      });
    },
  );
  upstream.on('error', (err) => {
    if (!res.headersSent) send(res, 502, `Folio could not reach Immich at ${config.immichUrl} (${err.code || err.message}).`, { 'content-type': 'text/plain; charset=utf-8' });
    else res.destroy();
  });
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });
  req.pipe(upstream);
}

// WebSocket upgrades (Immich's live updates) are piped straight through.
export function upgrade(req, socket, head) {
  if (!config.proxy) return socket.destroy();
  const conn =
    target.protocol === 'https:'
      ? tls.connect({ host: target.hostname, port: targetPort, servername: target.hostname })
      : net.connect(targetPort, target.hostname);
  let raw = `${req.method} ${prefix}${req.url} HTTP/1.1\r\n`;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === 'host') continue;
    raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
  }
  raw += `Host: ${target.host}\r\nX-Forwarded-For: ${req.socket.remoteAddress}\r\n\r\n`;
  conn.write(raw);
  if (head?.length) conn.write(head);
  conn.pipe(socket).pipe(conn);
  conn.on('error', () => socket.destroy());
  socket.on('error', () => conn.destroy());
}
