#!/usr/bin/env node

// TimeShell - CLI for time-box.eu automation
//
// Usage:
//   node timeshell.js login                         Interactive login (saves session)
//   node timeshell.js status [--week 14] [--year 2026]    Show timetable
//   node timeshell.js book --week 14 --template week.json          Book from template
//   node timeshell.js book --week 14 --template week.json --dry    Dry run (fill but don't submit)
//   node timeshell.js templates                     List available templates
//   node timeshell.js categories                    List valid hour categories
//   node timeshell.js init-template <name>          Create a new template file

const fs = require('fs');
const path = require('path');
const { login } = require('./auth');
const { bookWeek, getStatus, CATEGORIES, DAY_NAMES, weekToMonday, fmtUI } = require('./timebox');
const { createServer, DEFAULT_PORT } = require('./editor');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

// ─── Helpers ─────────────────────────────────────────────────────────

function getCurrentISOWeek() {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + 1;
  const dayOfWeek = jan4.getDay() || 7;
  return Math.ceil((dayOfYear + dayOfWeek - 1) / 7);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--week' || a === '-w') {
      args.week = parseInt(argv[++i], 10);
    } else if (a === '--year' || a === '-y') {
      args.year = parseInt(argv[++i], 10);
    } else if (a === '--template' || a === '-t') {
      args.template = argv[++i];
    } else if (a === '--dry' || a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--headed' || a === '--visible') {
      args.headed = true;
    } else if (a.startsWith('--')) {
      args[a.slice(2)] = argv[++i] || true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

/** Strip trailing commas from JSON (common when hand-editing templates). */
function parseJSON(text) {
  const cleaned = text.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(cleaned);
}

function loadTemplate(nameOrPath) {
  // Try as a direct path first
  if (fs.existsSync(nameOrPath)) {
    return parseJSON(fs.readFileSync(nameOrPath, 'utf8'));
  }
  // Try in templates/ dir
  const inDir = path.join(TEMPLATES_DIR, nameOrPath);
  if (fs.existsSync(inDir)) {
    return parseJSON(fs.readFileSync(inDir, 'utf8'));
  }
  // Try with .json extension
  if (fs.existsSync(inDir + '.json')) {
    return parseJSON(fs.readFileSync(inDir + '.json', 'utf8'));
  }
  throw new Error(`Template not found: ${nameOrPath}`);
}

function validateTemplate(tpl) {
  if (!tpl.entries || !Array.isArray(tpl.entries)) {
    throw new Error('Template must have an "entries" array');
  }
  const errors = [];
  for (let i = 0; i < tpl.entries.length; i++) {
    const e = tpl.entries[i];
    if (!e.jiraId) errors.push(`entries[${i}]: missing jiraId`);
    if (!e.category) errors.push(`entries[${i}]: missing category`);
    if (!CATEGORIES[e.category]) errors.push(`entries[${i}]: invalid category "${e.category}"`);
    if (!e.days || typeof e.days !== 'object') errors.push(`entries[${i}]: missing days object`);
    else {
      for (const [day, hours] of Object.entries(e.days)) {
        if (!DAY_NAMES.includes(day)) errors.push(`entries[${i}]: invalid day "${day}"`);
        if (typeof hours !== 'number' || hours <= 0) errors.push(`entries[${i}]: invalid hours for ${day}: ${hours}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error('Template validation failed:\n  ' + errors.join('\n  '));
  }

  // Check daily totals
  const dailyTotals = DAY_NAMES.map((day) =>
    tpl.entries.reduce((sum, e) => sum + (e.days[day] || 0), 0)
  );
  const warnings = [];
  DAY_NAMES.forEach((day, i) => {
    if (dailyTotals[i] > 24) warnings.push(`${day}: ${dailyTotals[i]}h (>24h!)`);
    else if (dailyTotals[i] > 10) warnings.push(`${day}: ${dailyTotals[i]}h (>10h)`);
  });
  if (warnings.length > 0) {
    console.log('Warnings:');
    warnings.forEach((w) => console.log(`  ${w}`));
  }

  return dailyTotals;
}

// ─── Commands ────────────────────────────────────────────────────────

async function cmdLogin() {
  console.log('Opening browser for Atlassian login...');
  console.log('Please complete the login using 1Password.\n');
  const result = await login({ headless: false });
  if (result) {
    console.log('\nSession saved. You can now use other commands.');
    await result.browser.close();
  } else {
    console.error('\nLogin failed.');
    process.exit(1);
  }
}

async function cmdStatus(args) {
  const year = args.year || new Date().getFullYear();
  const wk = args.week || getCurrentISOWeek();
  console.log(`Fetching status for week ${wk}, ${year}...`);
  await getStatus({ year, wk, headless: !args.headed });
}

async function cmdBook(args) {
  if (!args.template) {
    console.error('Error: --template <file> is required');
    console.error('Usage: node timeshell.js book --week 14 --template myweek.json [--dry]');
    process.exit(1);
  }

  const year = args.year || new Date().getFullYear();
  const wk = args.week || getCurrentISOWeek();

  // Load and validate template
  const template = loadTemplate(args.template);
  console.log(`Template: ${template.name || args.template}`);
  if (template.description) console.log(`  ${template.description}`);

  const dailyTotals = validateTemplate(template);

  // Show week preview
  const mon = weekToMonday(year, wk);
  console.log(`\nWeek ${wk} (${year}): ${fmtUI(mon)} - ${fmtUI(new Date(mon.getTime() + 6 * 86400000))}`);
  console.log('');
  console.log('Daily totals from template:');
  DAY_NAMES.forEach((d, i) => {
    if (dailyTotals[i] > 0) console.log(`  ${d}: ${dailyTotals[i]}h`);
  });
  const weekTotal = dailyTotals.reduce((s, h) => s + h, 0);
  console.log(`  Total: ${weekTotal}h`);

  // Book
  await bookWeek(template, year, wk, {
    headless: !args.headed,
    dryRun: args.dryRun || false,
  });
}

function cmdTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.log('No templates directory. Run: node timeshell.js init-template <name>');
    return;
  }
  const files = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No templates found. Run: node timeshell.js init-template <name>');
    return;
  }
  console.log('Available templates:\n');
  for (const f of files) {
    try {
      const tpl = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8'));
      const entryCount = tpl.entries?.length || 0;
      const weekTotal = DAY_NAMES.reduce((sum, day) =>
        sum + (tpl.entries || []).reduce((s, e) => s + (e.days?.[day] || 0), 0), 0);
      console.log(`  ${f.padEnd(25)} ${(tpl.name || '').padEnd(25)} ${entryCount} entries, ${weekTotal}h/week`);
    } catch {
      console.log(`  ${f.padEnd(25)} (invalid JSON)`);
    }
  }
}

function cmdCategories() {
  console.log('Valid hours categories:\n');
  console.log('  Code      Description');
  console.log('  ─'.padEnd(42, '─'));
  for (const [code, desc] of Object.entries(CATEGORIES)) {
    console.log(`  ${code.padEnd(10)}${desc}`);
  }
}

function cmdInitTemplate(name) {
  if (!name) {
    console.error('Usage: node timeshell.js init-template <name>');
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }

  const filename = name.endsWith('.json') ? name : `${name}.json`;
  const filepath = path.join(TEMPLATES_DIR, filename);

  if (fs.existsSync(filepath)) {
    console.error(`Template already exists: ${filepath}`);
    process.exit(1);
  }

  const template = {
    name: name.replace('.json', ''),
    description: 'My weekly template',
    entries: [
      {
        jiraId: 'PROJ-123',
        category: 'SD',
        comment: 'Development work',
        days: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8 },
      },
    ],
  };

  fs.writeFileSync(filepath, JSON.stringify(template, null, 2) + '\n');
  console.log(`Template created: ${filepath}`);
  console.log('\nEdit the template, then run:');
  console.log(`  node timeshell.js book --week ${getCurrentISOWeek()} --template ${filename} --dry`);
}

function cmdEditor(args) {
  const port = args.port ? parseInt(args.port, 10) : DEFAULT_PORT;
  createServer(port);
}

function printHelp() {
  console.log(`
TimeShell - time-box.eu automation

Commands:
  login                              Open browser to log in (session is saved)
  status  [--week N] [--year Y]      Show current timetable
  book    --week N --template FILE   Book hours from a template
          [--year Y] [--dry] [--headed]
  editor  [--port N]                 Open the template editor web UI
  templates                          List saved templates
  categories                         List valid hour categories
  init-template <name>               Create a new template file

Options:
  --week, -w N       ISO week number (default: current week)
  --year, -y Y       Year (default: current year)
  --template, -t F   Template file (name in templates/ dir, or full path)
  --dry, --dry-run   Fill forms but don't submit
  --headed           Show browser window (default: headless)
  --port N           Port for the editor UI (default: 4000)

Examples:
  node timeshell.js login
  node timeshell.js status
  node timeshell.js status --week 14
  node timeshell.js editor
  node timeshell.js init-template myweek
  node timeshell.js book --week 14 --template myweek --dry
  node timeshell.js book --week 14 --template myweek
`);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  switch (command) {
    case 'login':
      return cmdLogin();
    case 'editor':
      return cmdEditor(args);
    case 'status':
      return cmdStatus(args);
    case 'book':
      return cmdBook(args);
    case 'templates':
      return cmdTemplates();
    case 'categories':
      return cmdCategories();
    case 'init-template':
      return cmdInitTemplate(args._[1]);
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      return printHelp();
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
