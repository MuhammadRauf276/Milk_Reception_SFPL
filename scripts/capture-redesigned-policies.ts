import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePath = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const browserExe = fs.existsSync(edgePath) ? edgePath : chromePath;

const artifactDir = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\fb5d9e17-9e1f-47b0-bfd2-4e418cc70318';
const userDataDir = path.join(artifactDir, 'scratch', 'browser_profile');

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

async function capture() {
  console.log(`Starting headless browser from ${browserExe}...`);
  const browserProc = spawn(browserExe, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    'http://localhost:3000/login',
  ]);

  try {
    await waitForHttp('http://127.0.0.1:9222/json/version');
    const targets = await waitForHttp('http://127.0.0.1:9222/json');
    const pageTarget = targets.find((t: any) => t.type === 'page') || targets[0];
    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.init();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Network.enable');

    // 1. Authenticate via 1-click Super Admin Station Card on /login
    console.log('Logging in via Super Admin 1-click station card...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/login' });
    await sleep(2500);

    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const saBtn = btns.find(b => b.textContent && b.textContent.includes('Super Admin'));
        if (saBtn) {
          saBtn.click();
          return 'Clicked Super Admin station login';
        }
        return 'Super admin button not found';
      })()`,
    });
    await sleep(3000);

    // 2. Navigate to test policies page
    console.log('Navigating to http://localhost:3000/super-admin/test-policies...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/super-admin/test-policies' });
    await sleep(4000);

    // Save Table Screenshot
    const tableShot = await client.send('Page.captureScreenshot', { format: 'png' });
    const tablePath = path.join(artifactDir, 'super_admin_policies_table.png');
    fs.writeFileSync(tablePath, Buffer.from(tableShot.data, 'base64'));
    console.log(`Saved screenshot: ${tablePath} (${fs.statSync(tablePath).size} bytes)`);

    // 3. Open Edit Drawer for Temperature
    console.log('Opening Edit Drawer for Temperature (LT-000001)...');
    const clickRes = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => (b.innerText || b.textContent || '').includes('Edit'));
        if (btns.length > 0) {
          btns[0].scrollIntoView();
          btns[0].click();
          return 'Clicked Edit on row 1 (Found ' + btns.length + ' edit buttons)';
        }
        return 'No Edit buttons found';
      })()`,
      returnByValue: true,
    });
    console.log('Click result:', clickRes.result.value);
    await sleep(2500);

    // Save Drawer Screenshot (Top/Structured Rules)
    const drawerShot = await client.send('Page.captureScreenshot', { format: 'png' });
    const drawerPath = path.join(artifactDir, 'super_admin_edit_drawer.png');
    fs.writeFileSync(drawerPath, Buffer.from(drawerShot.data, 'base64'));
    console.log(`Saved screenshot: ${drawerPath} (${fs.statSync(drawerPath).size} bytes)`);

    // 4. Scroll down drawer to Simulator and test with 11.5
    console.log('Testing live simulator with 11.5 in newly redesigned drawer...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const scrollContainers = document.querySelectorAll('div');
        for (const el of scrollContainers) {
          if (el.scrollHeight > el.clientHeight && el.clientHeight > 300) {
            el.scrollTop = 900;
          }
        }
        const inputs = Array.from(document.querySelectorAll('input'));
        const simInput = inputs.find(i => i.placeholder && i.placeholder.includes('Type sample value'));
        if (simInput) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(simInput, '11.5');
          simInput.dispatchEvent(new Event('input', { bubbles: true }));
          return 'Simulated 11.5 with React setter';
        }
        return 'Simulator input not found';
      })()`,
    });
    await sleep(1500);

    // Save Simulator Screenshot
    const simShot = await client.send('Page.captureScreenshot', { format: 'png' });
    const simPath = path.join(artifactDir, 'super_admin_simulator_bottom.png');
    fs.writeFileSync(simPath, Buffer.from(simShot.data, 'base64'));
    console.log(`Saved screenshot: ${simPath} (${fs.statSync(simPath).size} bytes)`);

    // 5. Click "Tolerance Margin" to demonstrate the dual warning margins
    console.log('Clicking Tolerance Margin button...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tolBtn = btns.find(b => b.textContent && b.textContent.includes('Tolerance Margin'));
        if (tolBtn) {
          tolBtn.click();
          return 'Clicked Tolerance Margin';
        }
        return 'Tolerance Margin button not found';
      })()`,
    });
    await sleep(1200);

    const tolShot = await client.send('Page.captureScreenshot', { format: 'png' });
    const tolPath = path.join(artifactDir, 'super_admin_tolerance_margin.png');
    fs.writeFileSync(tolPath, Buffer.from(tolShot.data, 'base64'));
    console.log(`Saved screenshot: ${tolPath} (${fs.statSync(tolPath).size} bytes)`);

    // 6. Close drawer and open Categorical Test (Clot on Boiling - COB)
    console.log('Opening Categorical Test (LT-000004 COB)...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Cancel'));
        if (cancelBtn) cancelBtn.click();
      })()`,
    });
    await sleep(1000);

    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const cobRow = rows.find(r => r.textContent && r.textContent.includes('LT-000004'));
        if (cobRow) {
          const editBtn = Array.from(cobRow.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Edit'));
          if (editBtn) editBtn.click();
          return 'Clicked COB edit';
        }
        return 'COB row not found';
      })()`,
    });
    await sleep(2000);

    // Scroll down to see categorical dropdowns
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const scrollContainers = document.querySelectorAll('div');
        for (const el of scrollContainers) {
          if (el.scrollHeight > el.clientHeight && el.clientHeight > 300) {
            el.scrollTop = 900;
          }
        }
      })()`,
    });
    await sleep(1000);

    const cobShot = await client.send('Page.captureScreenshot', { format: 'png' });
    const cobPath = path.join(artifactDir, 'super_admin_categorical_drawer.png');
    fs.writeFileSync(cobPath, Buffer.from(cobShot.data, 'base64'));
    console.log(`Saved screenshot: ${cobPath} (${fs.statSync(cobPath).size} bytes)`);

    client.close();
    console.log('All screenshots captured successfully!');
  } finally {
    browserProc.kill();
  }
}

capture().catch((e) => {
  console.error('Capture failed:', e);
  process.exit(1);
});
