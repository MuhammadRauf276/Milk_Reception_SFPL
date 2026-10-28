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

async function captureScreen(client: CDPClient, filename: string) {
  const shotData = await client.send('Page.captureScreenshot', { format: 'png' });
  const shotPath = path.join(screenshotsDir, filename);
  fs.writeFileSync(shotPath, Buffer.from(shotData.data, 'base64'));
  console.log(`Saved screenshot: ${filename}`);
}

async function main() {
  const tempProfile = path.join(os.tmpdir(), 'browser_mes_detailed_' + Date.now());
  const proc = spawn(browserExe, [
    '--headless=new',
    '--remote-debugging-port=9245',
    `--user-data-dir=${tempProfile}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1600,1050',
    'http://localhost:3000/login',
  ]);

  try {
    await waitForHttp('http://127.0.0.1:9245/json/version');
    const targets = await waitForHttp('http://127.0.0.1:9245/json');
    const target = targets.find((t: any) => t.type === 'page') || targets[0];
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.init();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Network.enable');

    // 1. Super Admin Deep Views
    const superAdmin = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN', is_active: true } });
    const saToken = await createSessionToken({
      id: String(superAdmin.id),
      username: superAdmin.username,
      name: superAdmin.full_name || superAdmin.username,
      role: superAdmin.role as any,
      department: superAdmin.department || 'ADMIN',
    } as any);

    await client.send('Network.setCookie', {
      name: 'auth_token',
      value: saToken,
      url: 'http://localhost:3000',
      path: '/',
    });

    // 18. Daily Report
    console.log('Navigating to /super-admin/daily-report...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/super-admin/daily-report' });
    await sleep(4000);
    await captureScreen(client, '18_super_admin_daily_report.png');

    // 19. Audit Logs
    console.log('Navigating to /super-admin/audit...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/super-admin/audit' });
    await sleep(3500);
    await captureScreen(client, '19_super_admin_audit.png');

    // Super Admin Users
    console.log('Navigating to /super-admin/users...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/super-admin/users' });
    await sleep(3500);
    await captureScreen(client, '21_super_admin_users.png');

    // Super Admin QA Warnings
    console.log('Navigating to /super-admin/qa-warnings...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/super-admin/qa-warnings' });
    await sleep(3500);
    await captureScreen(client, '22_super_admin_qa_warnings.png');

    // Super Admin Weighing Policy
    console.log('Navigating to /super-admin/weighing-policy...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/super-admin/weighing-policy' });
    await sleep(3500);
    await captureScreen(client, '23_super_admin_weighing_policy.png');

    // ZMCC Manager with DISPATCH tab
    const zmccUser = await prisma.user.findFirstOrThrow({ where: { username: 'zmcc.manager.hasilpur', is_active: true } });
    const zmccToken = await createSessionToken({
      id: String(zmccUser.id),
      username: zmccUser.username,
      name: zmccUser.full_name || zmccUser.username,
      role: zmccUser.role as any,
      department: zmccUser.department || 'Milk Procurement',
    } as any);

    await client.send('Network.setCookie', {
      name: 'auth_token',
      value: zmccToken,
      url: 'http://localhost:3000',
      path: '/',
    });

    console.log('Navigating to ZMCC Manager DISPATCHES tab...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/mpd/zmcc-manager?tab=DISPATCHES' });
    await sleep(3500);
    await captureScreen(client, '24_zmcc_manager_dispatches.png');

    console.log('Navigating to ZMCC Manager TANKS tab...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/mpd/zmcc-manager?tab=TANKS' });
    await sleep(3500);
    await captureScreen(client, '25_zmcc_manager_tanks.png');

    console.log('All detailed screens captured successfully!');
  } catch (err) {
    console.error('Error during detailed capture:', err);
  } finally {
    try {
      proc.kill();
    } catch {}
    await prisma.$disconnect();
  }
}

main();
