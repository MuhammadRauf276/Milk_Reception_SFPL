const fs = require('fs');
const path = require('path');

function walk(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      if (file !== 'node_modules' && file !== '.next') walk(full, fileList);
    } else if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
      fileList.push(full);
    }
  }
  return fileList;
}

const files = [...walk('src/frontend'), ...walk('src/components'), ...walk('src/app')];

const buttonWithIconMatches = [];
const logButtonMatches = [];

// Regex to capture button blocks: <Button ...> ... </Button> or <button ...> ... </button>
const buttonRegex = /<(Button|button)\b([^>]*)>([\s\S]*?)<\/\1>/g;

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  let match;
  while ((match = buttonRegex.exec(content)) !== null) {
    const tag = match[1];
    const attrs = match[2];
    const body = match[3];

    // Check for arrow icons
    const hasArrow = /<\s*(ArrowRight|ArrowLeft|ChevronRight|ChevronLeft|MoveRight)\b|-->|->/i.test(body);
    // Check for check / tick icons
    const hasCheck = /<\s*(Check|CheckCircle|CheckCircle2|CheckCheck)\b/i.test(body);
    // Check for cross icons
    const hasCross = /<\s*(X|XCircle|XOctagon)\b/i.test(body);
    // Check for Log in button
    const isLog = /\bLog\b|\bLogs\b/i.test(body) || /\bLog\b|\bLogs\b/i.test(attrs);

    if (hasArrow || hasCheck || hasCross) {
      buttonWithIconMatches.push({
        file: f,
        tag,
        hasArrow,
        hasCheck,
        hasCross,
        snippet: body.trim().replace(/\s+/g, ' ').slice(0, 100),
      });
    }

    if (isLog) {
      logButtonMatches.push({
        file: f,
        tag,
        snippet: body.trim().replace(/\s+/g, ' ').slice(0, 100),
      });
    }
  }
}

console.log(`Found ${buttonWithIconMatches.length} buttons with Arrow/Check/Cross icons:`);
console.log(JSON.stringify(buttonWithIconMatches.slice(0, 30), null, 2));

console.log(`\nFound ${logButtonMatches.length} buttons related to 'Log':`);
console.log(JSON.stringify(logButtonMatches.slice(0, 30), null, 2));
