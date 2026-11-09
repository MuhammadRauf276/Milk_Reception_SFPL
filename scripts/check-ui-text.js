#!/usr/bin/env node
/**
 * Fails when user-facing text in src/**\/*.tsx contains patterns that make the UI
 * look auto-generated: em dashes in labels, "-- Select --" options, "..." instead of
 * "…", bullet characters, emoji, stray symbols and refresh icons.
 *
 * Allowed: a lone "—" as an empty-value placeholder, and emoji in the WhatsApp
 * message templates. Add `ui-text-ignore` to a line to exempt it.
 *
 * Usage: npm run check:ui-text
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'src');
const EMOJI_OK = new Set(['app/super-admin/whatsapp/page.tsx', 'app/whatsapp-gateway/page.tsx', 'frontend/modules/super-admin/daily-report/SendReportModal.tsx']);
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿]/u;

const rules = [
  { name: 'em dash in text (use ":" or "·"; a lone "—" placeholder is fine)', test: (l) => /—/.test(l.replace(/(['"`])—\1/g, '').replace(/>\s*—\s*</g, '><').replace(/\{\s*'—'\s*\}/g, '')) },
  { name: 'en dash in label (use "," or "(…)")', test: (l) => /[A-Za-z]\s–\s[A-Za-z]/.test(l) },
  { name: '"-- Select --" style text', test: (l) => /(^|[>'"`])\s*--\s+\S/.test(l) || /\S\s+--\s*(<|['"`]|$)/.test(l) || /--:--/.test(l) },
  { name: 'three dots (use "…")', test: (l) => /(?<=[A-Za-z0-9)\]#}])\.\.\.(?=['"`<\s]|$)/.test(l) },
  { name: 'bullet character (use "·" or a real list)', test: (l) => /•|&bull;/.test(l) },
  { name: 'stray symbol (use a lucide icon)', test: (l) => /[×✕✖✗✓✔⚠]/.test(l) },
  { name: 'refresh icon (not used in this UI; use Loader2 for spinners)', test: (l) => /<(RefreshCw|RotateCw|RefreshCcw)\b/.test(l) },
  { name: 'text under 12px (use text-xs)', test: (l) => /text-\[(8|9|10|11)px\]/.test(l) },
  { name: 'browser confirm box (use confirmAction)', test: (l) => /(window\.|[^.\w])confirm\(/.test(l) },
  { name: 'off-brand colour (use tokens; amber for waiting, red for the accent)', test: (l) => /\b(?:[a-z-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:purple|violet|indigo|fuchsia|slate)-\d/.test(l) },
  { name: 'sparkle icon (pick an icon that says what it does)', test: (l) => /<Sparkles\b/.test(l) },
  { name: 'old wording: Assigned Shops (use Active shops)', test: (l) => /Assigned Shops?\b|Shops Assigned/.test(l) },
  { name: 'old wording: Local Supplier (use HC supplier)', test: (l) => />[^<{]*\bLocal Suppliers?\b[^<{]*</.test(l) },
  { name: 'old wording: MOT in visible text (use Mobile Tester)', test: (l) => />[^<{]*\bMOT\b[^<{]*</.test(l) || /\b(label|title|header|placeholder): *['"`][^'"`]*\bMOT\b/.test(l) },
  { name: 'hype word in visible text', test: (l) => />[^<{]*\b(Seamless|Enterprise|Comprehensive|Operational)\b[^<{]*</.test(l) },
  { name: 'jargon in text (say it plainly)', test: (l) => /(>|^\s*|text=")[^<{]*\b(Authoritative|immutable|canonical|strictly|Real-Time|Consolidated|Inter-facility)\b/i.test(l) && !/^\s*(\/\/|\*|import|const|let|type|if|return)/.test(l) && !/className=/.test(l.split(/\b(Authoritative|immutable|canonical|strictly|Real-Time|Consolidated|Inter-facility)\b/i)[0].slice(-1)) },
  { name: 'long text (keep it under 25 words, or put it behind an InfoTip)', test: (l) => {
    const m = l.match(/>([^<>{}]{150,})</) || l.match(/^\s*([A-Z][^<>{}=;]{150,})$/);
    return !!m && m[1].trim().split(/\s+/).length > 25;
  } },
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const problems = [];
for (const file of walk(ROOT).filter((f) => f.endsWith('.tsx'))) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let inBlock = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
    if (t.startsWith('/*') || t.startsWith('{/*')) { if (!t.includes('*/')) inBlock = true; return; }
    if (t.startsWith('//') || t.startsWith('*') || line.includes('ui-text-ignore')) return;
    for (const r of rules) if (r.test(line)) problems.push(`${rel}:${i + 1}  ${r.name}\n    ${t.slice(0, 120)}`);
    if (!EMOJI_OK.has(rel) && EMOJI.test(line)) problems.push(`${rel}:${i + 1}  emoji (use a lucide icon)\n    ${t.slice(0, 120)}`);
  });
}

if (problems.length) {
  console.error(`UI text check failed: ${problems.length} problem(s)\n`);
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('UI text check passed.');
