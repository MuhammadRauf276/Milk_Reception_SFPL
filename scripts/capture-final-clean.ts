// @ts-nocheck
import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePath = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const browserExe = fs.existsSync(edgePath) ? edgePath : chromePath;

const artifactDir = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\fb5d9e17-9e1f-47b0-bfd2-4e418cc70318';
const tempProfile = path.join(os.tmpdir(), 'browser_debug_profile_' + Date.now());

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

async function run() {
  console.log('Starting Edge on port 9255...');
  const proc = spawn(browserExe, [
    '--headless=new',
    '--remote-debugging-port=9255',
    `--user-data-dir=${tempProfile}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    'http://localhost:3000/login',
  ]);

  try {
    await waitForHttp('http://127.0.0.1:9255/json/version');
    const targets = await waitForHttp('http://127.0.0.1:9255/json');
    const target = targets.find((t: any) => t.type === 'page') || targets[0];
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.init();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Network.enable');

    // Super Admin Session Token
    const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } });
    if (superAdmin) {
      const token = await createSessionToken({
        id: String(superAdmin.id),
        username: superAdmin.username,
        name: superAdmin.full_name || superAdmin.username,
        role: superAdmin.role as any,
        department: superAdmin.department || 'ADMIN',
      } as any);
      await client.send('Network.setCookie', {
        name: 'auth_token',
        value: token,
        url: 'http://localhost:3000',
      });
    }

    // 1. Navigate to Policies
    console.log('Navigating to policies...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/super-admin/test-policies' });
    await sleep(4000);

    const tableShot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifactDir, 'super_admin_policies_table.png'), Buffer.from(tableShot.data, 'base64'));
    console.log('Saved table screenshot');

    // 2. Click Edit on Temperature
    console.log('Clicking Edit on Temperature...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const r1 = rows.find(r => r.textContent && r.textContent.includes('LT-000001'));
        if (r1) {
          const btn = Array.from(r1.querySelectorAll('button')).find(b => (b.innerText || b.textContent || '').includes('Edit'));
          if (btn) { btn.click(); return 'Clicked Edit on LT-000001'; }
        }
        return 'Row 1 not found';
      })()`,
    });
    await sleep(2500);

    const drawerShot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifactDir, 'super_admin_edit_drawer.png'), Buffer.from(drawerShot.data, 'base64'));
    console.log('Saved drawer screenshot');

    // 3. Scroll and simulate 11.5
    console.log('Scrolling to simulator and testing 11.5...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const scrollContainers = document.querySelectorAll('div');
        for (const el of scrollContainers) {
          if (el.scrollHeight > el.clientHeight && el.clientHeight > 300) {
            el.scrollTop = 900;
          }
        }
        const inputs = Array.from(document.querySelectorAll('input'));
        const simInput = inputs.find(i => i.placeholder && (i.placeholder.includes('sample value') || i.placeholder.includes('pick choice')));
        if (simInput) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(simInput, '11.5');
          simInput.dispatchEvent(new Event('input', { bubbles: true }));
          return 'Simulated 11.5';
        }
        return 'Simulator not found';
      })()`,
    });
    await sleep(1500);

    const simShot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifactDir, 'super_admin_simulator_bottom.png'), Buffer.from(simShot.data, 'base64'));
    console.log('Saved simulator screenshot');

    // 4. Click Tolerance Margin button
    console.log('Clicking Tolerance Margin button...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tolBtn = btns.find(b => (b.textContent || '').includes('Tolerance Margin'));
        if (tolBtn) { tolBtn.click(); return 'Clicked'; }
        return 'Not found';
      })()`,
    });
    await sleep(1500);

    const tolShot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifactDir, 'super_admin_tolerance_margin.png'), Buffer.from(tolShot.data, 'base64'));
    console.log('Saved tolerance margin screenshot');

    // 5. Close drawer and open a categorical test (e.g. Alcohol Stability or Neutralizer)
    console.log('Opening a categorical test drawer...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const closeBtn = document.querySelector('button[aria-label="Close form drawer"]');
        if (closeBtn) closeBtn.click();
      })()`,
    });
    await sleep(1000);

    await client.send('Runtime.evaluate', {
      expression: `(() => {
        // Look for alcohol stability or neutralizer or qualitative test edit button
        const rows = Array.from(document.querySelectorAll('tr'));
        const catRow = rows.find(r => (r.textContent || '').includes('Alcohol') || (r.textContent || '').includes('Neutralizer') || (r.textContent || '').includes('Adulteration'));
        if (catRow) {
          const editBtn = catRow.querySelector('button[title="Edit test"]');
          if (editBtn) { editBtn.click(); return 'Opened categorical edit'; }
        }
        return 'Not found';
      })()`,
    });
    await sleep(2000);

    const catShot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifactDir, 'super_admin_categorical_drawer.png'), Buffer.from(catShot.data, 'base64'));
    console.log('Saved categorical test screenshot');

    client.close();
    console.log('ALL SCREENSHOTS CAPTURED CLEANLY!');
  } finally {
    proc.kill();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
