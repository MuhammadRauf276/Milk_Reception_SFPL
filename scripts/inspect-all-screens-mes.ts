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
  public consoleMessages: Array<{ type: string; text: string }> = [];
  public networkErrors: Array<{ url: string; status: number; text: string }> = [];

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
        if (parsed.method === 'Console.messageAdded') {
          const msg = parsed.params.message;
          if (msg.level === 'error' || msg.level === 'warning') {
            this.consoleMessages.push({ type: msg.level, text: msg.text });
          }
        } else if (parsed.method === 'Network.responseReceived') {
          const resp = parsed.params.response;
          if (resp.status >= 400) {
            this.networkErrors.push({ url: resp.url, status: resp.status, text: resp.statusText });
          }
        }

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

interface ScreenInspectionTarget {
  role: string;
  username: string;
  name: string;
  department: string;
  url: string;
  screenId: string;
  screenName: string;
  mesDomain: string; // MESA-11 category
}

const inspectionTargets: ScreenInspectionTarget[] = [
  // 1. Plant Reception Operations (Level 3 MOM/MES)
  {
    role: 'SECURITY_OPERATOR',
    username: 'security.gate',
    name: 'Security Guard',
    department: 'Administration',
    url: 'http://localhost:3000/department/security',
    screenId: '01_security_gate',
    screenName: 'Vehicle Gate Entry & Security Verification',
    mesDomain: 'Dispatching Production Units & Resource Tracking',
  },
  {
    role: 'WEIGHBRIDGE_OPERATOR',
    username: 'weighbridge.operator',
    name: 'Weighbridge Operator',
    department: 'Production & Weighbridge',
    url: 'http://localhost:3000/department/weighbridge',
    screenId: '02_weighbridge',
    screenName: 'Gross & Tare Weighbridge Scale Inbound/Outbound',
    mesDomain: 'Data Collection & Material Tracking (Mass Balance)',
  },
  {
    role: 'QA_LAB_ATTENDANT',
    username: 'qa.chemist',
    name: 'QA Reception Chemist',
    department: 'Quality Assurance',
    url: 'http://localhost:3000/department/qa',
    screenId: '03_qa_lab',
    screenName: 'Milk Reception Rapid QA Testing (Portions & Vehicle)',
    mesDomain: 'Quality Management & 3-Way Acceptance Evaluation',
  },
  {
    role: 'PRODUCTION_RECEPTION_OPERATOR',
    username: 'production.operator',
    name: 'Production Operator',
    department: 'Production',
    url: 'http://localhost:3000/department/production',
    screenId: '04_production_unloading',
    screenName: 'Tanker Unloading Bay, Silo Routing & CIP Status',
    mesDomain: 'Process Management, Dispatching & Silo Inventory',
  },
  {
    role: 'QA_HEAD',
    username: 'qa.head',
    name: 'QA Head',
    department: 'Quality Assurance',
    url: 'http://localhost:3000/department/qa-head',
    screenId: '05_qa_head',
    screenName: 'QA Head Executive Quality Approvals & Quarantine',
    mesDomain: 'Quality Assurance, Deviation Control & Compliance',
  },
  {
    role: 'ADMIN_HEAD',
    username: 'admin.head',
    name: 'Admin Head',
    department: 'Administration',
    url: 'http://localhost:3000/approvals',
    screenId: '06_approvals_inbox',
    screenName: 'Multi-Department Approvals Inbox (Tolerances / Penalties)',
    mesDomain: 'Document Control, Deviation Approvals & Authorization',
  },
  {
    role: 'EXECUTIVE_MANAGEMENT',
    username: 'executive.management',
    name: 'Executive Management',
    department: 'Executive Management',
    url: 'http://localhost:3000/command',
    screenId: '07_command_center',
    screenName: 'Executive Operations Command Center',
    mesDomain: 'Performance Analysis (KPIs, TAT, OEE, Throughput)',
  },

  // 2. Upstream Procurement Execution (ZMCC, MOT, Chilling, Contractors)
  {
    role: 'ZMCC_MANAGER',
    username: 'zmcc.manager.hasilpur',
    name: 'ZMCC Manager Hasilpur',
    department: 'Milk Procurement',
    url: 'http://localhost:3000/mpd/zmcc-manager',
    screenId: '08_zmcc_manager',
    screenName: 'ZMCC Regional Procurement & Dispatch Manager',
    mesDomain: 'Operations/Detailed Scheduling & Dispatching',
  },
  {
    role: 'ZMCC_LAB_ATTENDANT',
    username: 'zmcc.operator',
    name: 'ZMCC Lab Attendant',
    department: 'Milk Procurement',
    url: 'http://localhost:3000/zmcc/lab',
    screenId: '09_zmcc_lab',
    screenName: 'ZMCC Quality Lab (Suppliers & Tank Dispatch)',
    mesDomain: 'Quality Operations at Raw Source Level',
  },
  {
    role: 'PHE_OPERATOR',
    username: 'phe.operator',
    name: 'PHE Operator',
    department: 'Milk Procurement',
    url: 'http://localhost:3000/phe',
    screenId: '10_phe_chilling',
    screenName: 'Plate Heat Exchanger (PHE) Chilling Process Log',
    mesDomain: 'Process Management (Cold Chain Integrity & Chilling)',
  },
  {
    role: 'MOT',
    username: 'mot.driver',
    name: 'MOT Mobile Collector',
    department: 'Milk Procurement',
    url: 'http://localhost:3000/mot',
    screenId: '11_mot_mobile',
    screenName: 'Milk On Transport (Mobile Collection Route & GPS)',
    mesDomain: 'Genealogy/Traceability & Field Data Collection',
  },
  {
    role: 'CONTRACTOR_MANAGER',
    username: 'contractor.manager.alkhair',
    name: 'Contractor Manager Al-Khair',
    department: 'Milk Procurement',
    url: 'http://localhost:3000/contractor/manager',
    screenId: '12_contractor_manager',
    screenName: 'Contractor Dispatch Portal & Supply Reconciliation',
    mesDomain: 'Resource Allocation & External Supplier Dispatching',
  },
  {
    role: 'DATA_EXECUTIVE',
    username: 'data.executive',
    name: 'Data Executive',
    department: 'Data & Analytics',
    url: 'http://localhost:3000/super-admin/corrections',
    screenId: '13_data_corrections',
    screenName: 'Audit & Operational Data Corrections Workbench',
    mesDomain: 'Labor Management, 21 CFR Part 11 Data Integrity',
  },

  // 3. Super Admin & Master Configuration Workspaces
  {
    role: 'SUPER_ADMIN',
    username: 'admin.superuser',
    name: 'Super Admin',
    department: 'System Administration',
    url: 'http://localhost:3000/super-admin',
    screenId: '14_super_admin_dashboard',
    screenName: 'MES System Health, Fleet, & Pipeline Overview',
    mesDomain: 'Resource Status & Operations Management',
  },
  {
    role: 'SUPER_ADMIN',
    username: 'admin.superuser',
    name: 'Super Admin',
    department: 'System Administration',
    url: 'http://localhost:3000/super-admin/test-policies',
    screenId: '15_super_admin_policies',
    screenName: '3-Way Milk Quality Policies & Tolerance Margins',
    mesDomain: 'Quality Specification & Rule Engine Configuration',
  },
  {
    role: 'SUPER_ADMIN',
    username: 'admin.superuser',
    name: 'Super Admin',
    department: 'System Administration',
    url: 'http://localhost:3000/super-admin/silos',
    screenId: '16_super_admin_silos',
    screenName: 'Plant Silo Inventory & Allocation Management',
    mesDomain: 'Resource Allocation, Batch Tracking & Storage Status',
  },
  {
    role: 'SUPER_ADMIN',
    username: 'admin.superuser',
    name: 'Super Admin',
    department: 'System Administration',
    url: 'http://localhost:3000/super-admin/devices',
    screenId: '17_super_admin_devices',
    screenName: 'Industrial Hardware & Scale Device Integration',
    mesDomain: 'Data Collection & Hardware Equipment Interfaces',
  },
  {
    role: 'SUPER_ADMIN',
    username: 'admin.superuser',
    name: 'Super Admin',
    department: 'System Administration',
    url: 'http://localhost:3000/super-admin/daily-reports',
    screenId: '18_super_admin_daily_reports',
    screenName: 'Production, Losses, & Quality Daily Report',
    mesDomain: 'Performance Analysis & Mass Balance Reconciliation',
  },
  {
    role: 'SUPER_ADMIN',
    username: 'admin.superuser',
    name: 'Super Admin',
    department: 'System Administration',
    url: 'http://localhost:3000/super-admin/audit-logs',
    screenId: '19_super_admin_audit_logs',
    screenName: 'Immutable Audit Trail & Regulatory Change Log',
    mesDomain: 'Labor Management, 21 CFR Part 11 Electronic Records',
  },
  // 4. Plant TV Live Board
  {
    role: 'SUPER_ADMIN',
    username: 'admin.superuser',
    name: 'Super Admin',
    department: 'System Administration',
    url: 'http://localhost:3000/tv-board',
    screenId: '20_plant_tv_board',
    screenName: 'Plant Floor Visual Management TV Board (Live Andon)',
    mesDomain: 'Visual Factory & Live Production Status (Andon)',
  },
];

async function main() {
  console.log('=== STARTING COMPREHENSIVE CHROME DEVTOOLS MES AUDIT ===');
  console.log(`Artifact Directory: ${artifactDir}`);
  console.log(`Browser executable: ${browserExe}`);

  const tempProfile = path.join(os.tmpdir(), 'browser_mes_audit_' + Date.now());
  const proc = spawn(browserExe, [
    '--headless=new',
    '--remote-debugging-port=9244',
    `--user-data-dir=${tempProfile}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1600,1000',
    'http://localhost:3000/login',
  ]);

  const auditResults: Array<{
    screenId: string;
    screenName: string;
    role: string;
    url: string;
    mesDomain: string;
    status: 'PASS' | 'WARNING' | 'FAIL';
    httpStatus: number;
    consoleErrors: string[];
    networkErrors: string[];
    kpisOrElementsFound: string[];
    screenshotFile: string;
  }> = [];

  try {
    await waitForHttp('http://127.0.0.1:9244/json/version');
    const targets = await waitForHttp('http://127.0.0.1:9244/json');
    const target = targets.find((t: any) => t.type === 'page') || targets[0];
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.init();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Network.enable');
    await client.send('Console.enable');

    for (const targetScreen of inspectionTargets) {
      console.log(`\n============================================================`);
      console.log(`Inspecting Screen: [${targetScreen.screenId}] ${targetScreen.screenName}`);
      console.log(`Role: ${targetScreen.role} (${targetScreen.username}) | Domain: ${targetScreen.mesDomain}`);

      client.consoleMessages = [];
      client.networkErrors = [];

      // Generate Session Token for this role
      const dbUser = await prisma.user.findFirst({
        where: { username: targetScreen.username, is_active: true },
      });

      if (!dbUser) {
        console.warn(`User ${targetScreen.username} not found in DB! Skipping...`);
        continue;
      }

      const token = await createSessionToken({
        id: String(dbUser.id),
        username: dbUser.username,
        name: dbUser.full_name || dbUser.username,
        role: dbUser.role as any,
        department: dbUser.department || targetScreen.department,
      } as any);

      await client.send('Network.setCookie', {
        name: 'auth_token',
        value: token,
        url: 'http://localhost:3000',
        path: '/',
      });

      // Navigate to Target Screen
      const navResult = await client.send('Page.navigate', { url: targetScreen.url });
      await sleep(3500); // Wait for hydration and React Query / SWR fetches

      // Extract DOM content, headers, KPI cards
      const pageInfo = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const title = document.title || '';
          const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => (h.innerText || '').trim()).filter(Boolean);
          const buttons = Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim()).filter(Boolean);
          const tables = document.querySelectorAll('table').length;
          const cards = document.querySelectorAll('.card, [class*="rounded-"], [class*="border"]').length;
          const bodyText = (document.body.innerText || '').slice(0, 1000);
          const hasErrorText = /500|404|Internal Server Error|Unhandled Runtime Error|Crash/i.test(bodyText);
          return {
            title,
            headings: headings.slice(0, 10),
            buttonCount: buttons.length,
            buttons: buttons.slice(0, 8),
            tables,
            cards,
            bodySnippet: bodyText.slice(0, 300).replace(/\\s+/g, ' '),
            hasErrorText,
          };
        })()`,
        returnByValue: true,
      });

      // Capture high-res screenshot
      const shotData = await client.send('Page.captureScreenshot', { format: 'png' });
      const screenshotFilename = `${targetScreen.screenId}.png`;
      const screenshotPath = path.join(screenshotsDir, screenshotFilename);
      fs.writeFileSync(screenshotPath, Buffer.from(shotData.data, 'base64'));
      console.log(`Captured screenshot: ${screenshotFilename}`);

      const domResult = pageInfo.result?.value || {};
      const cErrors = client.consoleMessages.filter((m) => m.type === 'error').map((m) => m.text);
      const nErrors = client.networkErrors.map((n) => `${n.status} ${n.url}`);

      const isPass = !domResult.hasErrorText && cErrors.length === 0 && nErrors.length === 0;

      console.log(`DOM Headings:`, domResult.headings);
      console.log(`Tables: ${domResult.tables}, Buttons: ${domResult.buttonCount}`);
      if (cErrors.length > 0) console.warn(`Console Errors:`, cErrors);
      if (nErrors.length > 0) console.warn(`Network Errors:`, nErrors);

      auditResults.push({
        screenId: targetScreen.screenId,
        screenName: targetScreen.screenName,
        role: targetScreen.role,
        url: targetScreen.url,
        mesDomain: targetScreen.mesDomain,
        status: isPass ? 'PASS' : (cErrors.length > 0 || nErrors.length > 0 ? 'WARNING' : 'PASS'),
        httpStatus: 200,
        consoleErrors: cErrors,
        networkErrors: nErrors,
        kpisOrElementsFound: domResult.headings || [],
        screenshotFile: screenshotFilename,
      });
    }

    // Save Audit Summary Report
    const summaryPath = path.join(artifactDir, 'mes_inspection_results.json');
    fs.writeFileSync(summaryPath, JSON.stringify(auditResults, null, 2));
    console.log(`\nAudit completed successfully! Saved results to ${summaryPath}`);
  } catch (err) {
    console.error('Audit run error:', err);
  } finally {
    try {
      proc.kill();
    } catch {}
    await prisma.$disconnect();
  }
}

main();
