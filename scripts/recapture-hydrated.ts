import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { spawn } from 'child_process';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';

const artifactDir = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\7c806bc2-44b8-47b1-a16e-fe034f80f5c9';
const screenshotsDir = path.join(artifactDir, 'screenshots');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePath = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const browserExe = fs.existsSync(edgePath) ? edgePath : chromePath;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function waitForHttp(url: string, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchJson(url);
    } catch {
      await sleep(400);
    }
  }
  throw new Error(`Timeout waiting for ${url}`);
}

class CDPClient {
  private ws: any;
  private id = 1;
  private callbacks = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

  constructor(wsUrl: string) {
    // @ts-ignore
    this.ws = new globalThis.WebSocket(wsUrl);
  }

  init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = (event: any) => {
        const parsed = JSON.parse(event.data);
        if (parsed.id && this.callbacks.has(parsed.id)) {
          const cb = this.callbacks.get(parsed.id)!;
          this.callbacks.delete(parsed.id);
          if (parsed.error) cb.reject(parsed.error);
          else cb.resolve(parsed.result);
        }
      };
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const callId = this.id++;
      this.callbacks.set(callId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: callId, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

const targets = [
  { username: 'security.gate', role: 'SECURITY_OPERATOR', url: 'http://localhost:3000/department/security', file: '01_security_gate_hydrated.png' },
  { username: 'qa.chemist', role: 'QA_LAB_ATTENDANT', url: 'http://localhost:3000/department/qa', file: '03_qa_lab_hydrated.png' },
  { username: 'production.operator', role: 'PRODUCTION_RECEPTION_OPERATOR', url: 'http://localhost:3000/department/production', file: '04_production_unloading_hydrated.png' },
  { username: 'zmcc.manager.hasilpur', role: 'ZMCC_MANAGER', url: 'http://localhost:3000/mpd/zmcc-manager', file: '08_zmcc_manager_hydrated.png' },
  { username: 'admin.superuser', role: 'SUPER_ADMIN', url: 'http://localhost:3000/super-admin/silos', file: '16_super_admin_silos_hydrated.png' },
  { username: 'admin.superuser', role: 'SUPER_ADMIN', url: 'http://localhost:3000/tv-board', file: '20_plant_tv_board_hydrated.png' },
];

async function main() {
  const tempProfile = path.join(os.tmpdir(), 'browser_recapture_' + Date.now());
  const proc = spawn(browserExe, [
    '--headless=new',
    '--remote-debugging-port=9246',
    `--user-data-dir=${tempProfile}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1600,1050',
    'http://localhost:3000/login',
  ]);

  try {
    await waitForHttp('http://127.0.0.1:9246/json/version');
    const tList = await waitForHttp('http://127.0.0.1:9246/json');
    const target = tList.find((t: any) => t.type === 'page') || tList[0];
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.init();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Network.enable');

    for (const item of targets) {
      console.log(`Recapturing: ${item.file} for ${item.username}`);
      const user = await prisma.user.findFirstOrThrow({ where: { username: item.username, is_active: true } });
      const token = await createSessionToken({
        id: String(user.id),
        username: user.username,
        name: user.full_name || user.username,
        role: user.role as any,
        department: user.department || 'OPS',
      } as any);

      await client.send('Network.setCookie', {
        name: 'auth_token',
        value: token,
        url: 'http://localhost:3000',
        path: '/',
      });

      await client.send('Page.navigate', { url: item.url });
      await sleep(5500); // Wait for full hydration

      const shotData = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(screenshotsDir, item.file), Buffer.from(shotData.data, 'base64'));
      console.log(`Saved: ${item.file}`);
    }
  } catch (err) {
    console.error('Error during recapture:', err);
  } finally {
    try {
      proc.kill();
    } catch {}
    await prisma.$disconnect();
  }
}

main();
