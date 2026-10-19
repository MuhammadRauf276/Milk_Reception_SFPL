const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const PORT = parseInt(process.env.WHATSAPP_GATEWAY_PORT || '3001', 10);
const GATEWAY_SECRET = (process.env.WHATSAPP_GATEWAY_SECRET || '').trim();
const AUTH_DIR = path.join(process.cwd(), 'data', 'whatsapp_auth');

if (!fs.existsSync(path.dirname(AUTH_DIR))) {
  fs.mkdirSync(path.dirname(AUTH_DIR), { recursive: true });
}

let sock = null;
let currentQrDataUrl = null;
let connectionStatus = 'DISCONNECTED'; // 'DISCONNECTED' | 'CONNECTING' | 'SCAN_QR' | 'CONNECTED'
let connectedUser = null;
let reconnectTimer = null;

const logger = pino({ level: 'silent' });

async function initWhatsApp() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  connectionStatus = 'CONNECTING';

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ['Shakarganj Milk Reception', 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 8,
          });
          connectionStatus = 'SCAN_QR';
          console.log('[WhatsApp Gateway] New QR code generated. Scan in UI at /whatsapp-gateway');
        } catch (err) {
          console.error('[WhatsApp Gateway] Failed to convert QR to DataURL', err);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[WhatsApp Gateway] Connection closed (code: ${statusCode}). Reconnect: ${shouldReconnect}`);

        currentQrDataUrl = null;
        connectedUser = null;
        connectionStatus = 'DISCONNECTED';

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('[WhatsApp Gateway] Device logged out. Clearing auth credentials.');
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch (e) {
            console.error('[WhatsApp Gateway] Error cleaning auth dir:', e);
          }
          reconnectTimer = setTimeout(initWhatsApp, 3000);
        } else if (shouldReconnect) {
          reconnectTimer = setTimeout(initWhatsApp, 4000);
        }
      } else if (connection === 'open') {
        connectionStatus = 'CONNECTED';
        currentQrDataUrl = null;
        connectedUser = {
          id: sock.user?.id || '',
          name: sock.user?.name || 'Shakarganj Milk Reception',
        };
        console.log(`[WhatsApp Gateway] Connected successfully as: ${connectedUser.name} (${connectedUser.id})`);
      }
    });
  } catch (err) {
    console.error('[WhatsApp Gateway] Error initializing Baileys:', err);
    connectionStatus = 'DISCONNECTED';
    reconnectTimer = setTimeout(initWhatsApp, 5000);
  }
}

// HTTP Server for Next.js app communication
const server = http.createServer(async (req, res) => {
  // No CORS headers on purpose: only the Next.js server (server-to-server) calls this gateway.
  // A wildcard origin would let any web page open in a browser on this machine send messages.
  if (req.method === 'OPTIONS') {
    res.writeHead(403);
    res.end();
    return;
  }

  // Optional shared secret (set the same WHATSAPP_GATEWAY_SECRET for Next.js and this process).
  if (GATEWAY_SECRET) {
    const provided = String(req.headers['x-gateway-secret'] || '');
    const a = Buffer.from(provided);
    const b = Buffer.from(GATEWAY_SECRET);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized.' }));
      return;
    }
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 1. Status & QR endpoint
  if (url.pathname === '/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: connectionStatus,
        user: connectedUser,
        qr: currentQrDataUrl,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  // 2. Send Message endpoint
  if (url.pathname === '/send' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) req.destroy();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { to, message } = payload;

        if (!to || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parameters "to" and "message" are required.' }));
          return;
        }

        if (connectionStatus !== 'CONNECTED' || !sock) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'WhatsApp gateway is not connected. Please scan QR code first.',
              status: connectionStatus,
            })
          );
          return;
        }

        const digits = to.replace(/\D/g, '');
        const recipientNumber = digits.startsWith('92')
          ? digits
          : digits.startsWith('0')
          ? `92${digits.slice(1)}`
          : `92${digits}`;

        const jid = `${recipientNumber}@s.whatsapp.net`;

        const sentResult = await sock.sendMessage(jid, { text: message });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            messageId: sentResult?.key?.id,
            to: recipientNumber,
            timestamp: new Date().toISOString(),
          })
        );
      } catch (err) {
        console.error('[WhatsApp Gateway] Send error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Failed to dispatch WhatsApp message.' }));
      }
    });
    return;
  }

  // 3. Logout endpoint
  if (url.pathname === '/logout' && req.method === 'POST') {
    try {
      if (sock) {
        await sock.logout().catch(() => {});
      }
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      initWhatsApp();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Logged out. Generating fresh QR.' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Failed to log out.' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found.' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[WhatsApp Gateway Server] Listening on http://127.0.0.1:${PORT}`);
  initWhatsApp();
});
