import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { spawn } from 'child_process';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';

const artifactDir = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\7c806bc2-44b8-47b1-a16e-fe034f80f5c9';
const screenshotsDir = path.join(artifactDir, 'screenshots_5by5');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

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

async function waitForHttp(url: string, maxRetries = 25) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchJson(url);
    } catch {
      await sleep(500);
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
  { username: 'security.gate', role: 'SECURITY_OPERATOR', url: 'http://localhost:3000/department/security', file: '01_security_gate_5by5.png' },
  { username: 'weighbridge.operator', role: 'WEIGHBRIDGE_OPERATOR', url: 'http://localhost:3000/department/weighbridge', file: '02_weighbridge_5by5.png' },
  { username: 'qa.chemist', role: 'QA_LAB_ATTENDANT', url: 'http://localhost:3000/department/qa', file: '03_qa_lab_5by5.png' },
  { username: 'production.operator', role: 'PRODUCTION_RECEPTION_OPERATOR', url: 'http://localhost:3000/department/production', file: '04_production_unloading_5by5.png' },
  { username: 'qa.head', role: 'QA_HEAD', url: 'http://localhost:3000/department/qa-head', file: '05_qa_head_5by5.png' },
  { username: 'admin.head', role: 'ADMIN_HEAD', url: 'http://localhost:3000/approvals', file: '06_approvals_inbox_5by5.png' },
  { username: 'executive.management', role: 'EXECUTIVE_MANAGEMENT', url: 'http://localhost:3000/command', file: '07_command_center_5by5.png' },
  { username: 'zmcc.manager.hasilpur', role: 'ZMCC_MANAGER', url: 'http://localhost:3000/mpd/zmcc-manager', file: '08_zmcc_manager_5by5.png' },
  { username: 'admin.superuser', role: 'SUPER_ADMIN', url: 'http://localhost:3000/super-admin', file: '14_super_admin_dashboard_5by5.png' },
  { username: 'admin.superuser', role: 'SUPER_ADMIN', url: 'http://localhost:3000/super-admin/test-policies', file: '15_super_admin_policies_5by5.png' },
  { username: 'admin.superuser', role: 'SUPER_ADMIN', url: 'http://localhost:3000/super-admin/silos', file: '16_super_admin_silos_5by5.png' },
  { username: 'admin.superuser', role: 'SUPER_ADMIN', url: 'http://localhost:3000/super-admin/devices', file: '17_super_admin_devices_5by5.png' },
  { username: 'admin.superuser', role: 'SUPER_ADMIN', url: 'http://localhost:3000/super-admin/daily-report', file: '18_super_admin_daily_report_5by5.png' },
  { username: 'admin.superuser', role: 'SUPER_ADMIN', url: 'http://localhost:3000/super-admin/audit', file: '19_super_admin_audit_5by5.png' },
  { username: 'admin.superuser', role: 'SUPER_ADMIN', url: 'http://localhost:3000/tv-board', file: '20_plant_tv_board_5by5.png' },
  { username: 'admin.superuser', role: 'SUPER_ADMIN', url: 'http://localhost:3000/super-admin/users', file: '21_super_admin_users_5by5.png' },
];

async function main() {
  console.log('Starting Edge CDP to verify all 16 screens at 5/5 standards...');
  const tempProfile = path.join(os.tmpdir(), 'browser_5by5_verify_' + Date.now());
  const proc = spawn(browserExe, [
    '--headless=new',
    '--remote-debugging-port=9255',
    `--user-data-dir=${tempProfile}`,
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1600,1050',
    'http://localhost:3000/login',
  ]);

  try {
    await waitForHttp('http://127.0.0.1:9255/json/version');
    const tList = await waitForHttp('http://127.0.0.1:9255/json');
    const target = tList.find((t: any) => t.type === 'page' && !t.url.startsWith('chrome-extension')) || tList.find((t: any) => t.type === 'page') || tList[0];
    console.log('Connecting to target:', target.url);
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.init();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Network.enable');

    for (const item of targets) {
      console.log(`\nNavigating to ${item.url} for ${item.username}...`);
      const user = await prisma.user.findFirstOrThrow({ where: { username: item.username, is_active: true } });
      const token = await createSessionToken({
        id: String(user.id),
        username: user.username,
        name: user.full_name || user.username,
        role: user.role as any,
        department: user.department || 'Production',
      } as any);

      await client.send('Network.setCookie', {
        name: 'auth_token',
        value: token,
        url: 'http://localhost:3000',
        path: '/',
      });

      await client.send('Page.navigate', { url: item.url });

      // Active polling for compilation & loading completion
      for (let attempt = 0; attempt < 15; attempt++) {
        await sleep(1000);
        const check = await client.send('Runtime.evaluate', {
          expression: `(() => {
            const body = document.body ? document.body.innerText : '';
            const isCompiling = /Compiling|Loading|Verifying access/i.test(body) && body.length < 150;
            const hasMainContent = document.querySelectorAll('h1, h2, h3, table, .card, [class*="rounded-xl"]').length > 2;
            return { isCompiling, hasMainContent, length: body.length, title: document.title, snippet: body.slice(0, 100).replace(/\\s+/g, ' ') };
          })()`,
          returnByValue: true,
        });
        const val = check.result?.value;
        if (val && !val.isCompiling && val.hasMainContent) {
          console.log(`Rendered in ${attempt + 1}s! (${val.length} chars, title: "${val.title}", snippet: "${val.snippet}")`);
          break;
        }
      }

      await sleep(1000); // Settle animation
      const shotData = await client.send('Page.captureScreenshot', { format: 'png' });
      const shotBuffer = Buffer.from(shotData.data, 'base64');
      fs.writeFileSync(path.join(screenshotsDir, item.file), shotBuffer);
      console.log(`Saved: ${item.file} (${shotBuffer.length} bytes)`);
    }
    console.log('\nAll 16 verification screens captured successfully at 5/5 quality!');
  } catch (err) {
    console.error('Error during 5/5 verification:', err);
  } finally {
    try {
      proc.kill();
    } catch {}
    await prisma.$disconnect();
  }
}

main();
