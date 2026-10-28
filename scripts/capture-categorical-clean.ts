// @ts-nocheck
import 'dotenv/config';
import { spawn } from 'child_process';
import http from 'http';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const artifactDir = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\fb5d9e17-9e1f-47b0-bfd2-4e418cc70318';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const port = 9260;

  console.log(`Starting Edge on port ${port}...`);
  const proc = spawn(edgePath, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    'http://localhost:3000/super-admin/test-policies',
  ]);

  try {
    await sleep(2500);

    const versionData = await new Promise<any>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve(JSON.parse(raw)));
      }).on('error', reject);
    });

    const pages = await new Promise<any[]>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve(JSON.parse(raw)));
      }).on('error', reject);
    });

    const targetPage = pages.find((p) => p.type === 'page') || pages[0];
    const ws = new WebSocket(targetPage.webSocketDebuggerUrl);

    await new Promise((resolve) => ws.on('open', resolve));

    let msgId = 1;
    const pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.id && pending.has(parsed.id)) {
        const { resolve, reject } = pending.get(parsed.id)!;
        pending.delete(parsed.id);
        if (parsed.error) reject(parsed.error);
        else resolve(parsed.result);
      }
    });

    const client = {
      send: (method: string, params?: any) =>
        new Promise<any>((resolve, reject) => {
          const id = msgId++;
          pending.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
        }),
      close: () => ws.close(),
    };

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

    // Navigate to Policies
    console.log('Navigating to policies...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/super-admin/test-policies' });
    await sleep(4000);

    // Click Edit on Row 4 (Clot on Boiling)
    console.log('Clicking Edit on Clot on Boiling...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const cobRow = rows.find(r => (r.textContent || '').includes('Clot on Boiling'));
        if (cobRow) {
          const editBtn = Array.from(cobRow.querySelectorAll('button')).find(b => (b.textContent || '').includes('Edit'));
          if (editBtn) {
            editBtn.click();
            return 'Clicked COB Edit';
          }
        }
        return 'COB Row or Edit button not found';
      })()`,
    });
    await sleep(2500);

    // Scroll to ChoiceEditor & Simulator in the drawer
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const drawers = Array.from(document.querySelectorAll('form'));
        if (drawers.length > 0) {
          const parent = drawers[0].parentElement;
          if (parent) parent.scrollTop = 350;
        }
      })()`,
    });
    await sleep(1000);

    const catShot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifactDir, 'super_admin_categorical_drawer.png'), Buffer.from(catShot.data, 'base64'));
    console.log('Saved categorical test screenshot');

    // Scroll down to Live Simulator
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const drawers = Array.from(document.querySelectorAll('form'));
        if (drawers.length > 0) {
          const parent = drawers[0].parentElement;
          if (parent) parent.scrollTop = 800;
        }
      })()`,
    });
    await sleep(1000);

    // Click the "Positive" test pill in the Live Simulator
    console.log('Testing Positive in Live Simulator...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const posBtn = btns.find(b => (b.textContent || '').trim() === 'Positive');
        if (posBtn) {
          posBtn.click();
          return 'Clicked Positive pill';
        }
        return 'Positive pill not found';
      })()`,
    });
    await sleep(1500);

    const simCatShot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifactDir, 'super_admin_categorical_simulator.png'), Buffer.from(simCatShot.data, 'base64'));
    console.log('Saved categorical simulator test screenshot');

    client.close();
    console.log('ALL CATEGORICAL SCREENSHOTS CAPTURED CLEANLY!');
  } finally {
    proc.kill();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
