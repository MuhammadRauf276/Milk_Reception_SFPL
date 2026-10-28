// @ts-nocheck
import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import WebSocket from 'ws';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const artifactDir = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\fb5d9e17-9e1f-47b0-bfd2-4e418cc70318';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const port = 9265;

  console.log(`Starting Edge on port ${port}...`);
  const proc = spawn(edgePath, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    'http://localhost:3000/zmcc/lab',
  ]);

  try {
    await sleep(2500);

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

    // Authenticate as ZMCC lab operator / manager
    const user = await prisma.user.findFirst({ where: { role: { in: ['ZMCC_OPERATOR', 'ZMCC_MANAGER', 'SUPER_ADMIN'] }, is_active: true } });
    if (user) {
      const token = await createSessionToken({
        id: String(user.id),
        username: user.username,
        name: user.full_name || user.username,
        role: user.role as any,
        department: user.department || 'LAB',
      } as any);
      await client.send('Network.setCookie', {
        name: 'auth_token',
        value: token,
        url: 'http://localhost:3000',
      });
    }

    console.log('Navigating to ZMCC Lab sessions...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/zmcc/lab' });
    await sleep(4000);

    // Look for an in-progress session or open arrival
    console.log('Finding session or test...');
    const sessionRes = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const testBtns = Array.from(document.querySelectorAll('button, a'));
        const testBtn = testBtns.find(b => (b.textContent || '').includes('Perform Tests') || (b.textContent || '').includes('Test') || (b.textContent || '').includes('Open'));
        if (testBtn) {
          testBtn.click();
          return 'Clicked test button';
        }
        return 'No test button found';
      })()`,
    });
    console.log('Session action:', sessionRes);
    await sleep(3000);

    const shot1 = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifactDir, 'zmcc_lab_screen.png'), Buffer.from(shot1.data, 'base64'));
    console.log('Saved zmcc_lab_screen.png');

    client.close();
  } finally {
    proc.kill();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
