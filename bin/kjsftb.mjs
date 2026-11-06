#!/usr/bin/env node
/* kjsftb - KubeJS + FTB Quests modpack helper CLI.
 *
 *   kjsftb detect [dir]              inspect a pack: MC/KubeJS/FTB Quests versions + script dirs
 *   kjsftb lint [dir]                check KubeJS scripts against the detected version
 *   kjsftb ftbq [dir]                validate FTB Quests SNBT data
 *   kjsftb snbt check|format <file>  parse / reformat a single SNBT file
 *
 * All commands accept --json for machine readable output.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { detectPack, formatDetection } from '../scripts/detect.mjs';
import { lintPack, formatLintReport } from '../scripts/lint.mjs';
import {
  checkQuests,
  formatQuestReport,
  loadQuestDir,
  FTBQ_VERSIONS_KNOWN,
} from '../scripts/ftbq.mjs';
import { parseSnbt, formatSnbt } from '../scripts/snbt.mjs';
import { FTBQ_VERSIONS } from '../scripts/versions.mjs';
import { generateRecipeScript, normalizeGeneration } from '../scripts/gen-js.mjs';
import {
  addChapterToModel,
  addQuestToModel,
  mergeLang,
  newId,
  renderChapter,
  renderLangTable,
} from '../scripts/gen-quest.mjs';

const HELP = `kjsftb - KubeJS + FTB Quests modpack helper

Usage:
  kjsftb detect [dir]                     Show detected pack/kubejs/ftbquests versions
  kjsftb lint [dir] [--strict]            Lint kubejs/{server,startup,client}_scripts
  kjsftb ftbq [dir] [--ftbq <ver>]        Validate config/ftbquests/quests SNBT data
  kjsftb snbt check <file|dir>            Parse SNBT and report syntax problems
  kjsftb snbt format <file> [--write]     Reformat SNBT in FTB style
  kjsftb recipe new --spec <file> [--out <file>] [--generation <gen>] [--priority <n>]
  kjsftb quest new [dir] --spec <file> [--write]
  kjsftb quest chapter [dir] --spec <file> [--write]
  kjsftb quest id                         Print a fresh 16-digit FTB quest id
  kjsftb ui [dir] [--port <n>] [--no-open] Start the local workbench (browser UI)
  kjsftb --help

Options:
  --json        machine readable output
  --strict      treat lint warnings as errors (exit 1)
  --no-info     hide info-level diagnostics
  --ftbq <ver>  force the FTB Quests generation: ${FTBQ_VERSIONS_KNOWN.join(', ')}
  --spec <file> JSON description for recipe/quest generators
  --out <file>  write generated script here (default: stdout)
  --write       write generated chapter/lang/table files in place
  --generation  legacy | kjs6 | kjs7 | kjs8 (default: detected from the pack)
  --priority    script load priority header (higher runs first)
  --port <n>    workbench port (default: pick a free one)
  --no-open     do not open the browser automatically

Exit codes: 0 ok, 1 problems found, 2 usage error.
`;

function parseArgs(argv) {
  const args = { _: [], json: false, strict: false, info: true, write: false, ftbq: null, spec: null, out: null, generation: null, priority: null, port: null, open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--no-info') args.info = false;
    else if (a === '--write') args.write = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--ftbq') args.ftbq = argv[++i] ?? null;
    else if (a.startsWith('--ftbq=')) args.ftbq = a.slice('--ftbq='.length);
    else if (a === '--spec') args.spec = argv[++i] ?? null;
    else if (a.startsWith('--spec=')) args.spec = a.slice('--spec='.length);
    else if (a === '--out') args.out = argv[++i] ?? null;
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else if (a === '--generation') args.generation = argv[++i] ?? null;
    else if (a.startsWith('--generation=')) args.generation = a.slice('--generation='.length);
    else if (a === '--priority') args.priority = argv[++i] ?? null;
    else if (a.startsWith('--priority=')) args.priority = a.slice('--priority='.length);
    else if (a === '--port') args.port = argv[++i] ?? null;
    else if (a.startsWith('--port=')) args.port = a.slice('--port='.length);
    else if (a === '--no-open') args.open = false;
    else args._.push(a);
  }
  return args;
}

function fail(message, code = 2) {
  process.stderr.write(`kjsftb: ${message}\n`);
  process.exit(code);
}

function resolveDir(arg) {
  const dir = resolve(arg ?? process.cwd());
  if (!existsSync(dir)) fail(`directory not found: ${dir}`);
  return dir;
}

/* ---------------------------------------------------------------- commands */

function cmdDetect(args) {
  const dir = resolveDir(args._[1]);
  const detection = detectPack(dir);
  if (args.json) process.stdout.write(`${JSON.stringify(detection, null, 2)}\n`);
  else process.stdout.write(`${formatDetection(detection)}\n`);
  return 0;
}

function cmdLint(args) {
  const dir = resolveDir(args._[1]);
  const detection = detectPack(dir);
  const result = lintPack(dir, detection);
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ detection, ...result }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatDetection(detection)}\n\n`);
    process.stdout.write(`${formatLintReport(result)}\n`);
  }
  if (result.errors > 0) return 1;
  if (args.strict && result.warnings > 0) return 1;
  return 0;
}

function resolveQuestDir(dir, detection) {
  const candidates = [
    dir,
    join(dir, 'config', 'ftbquests', 'quests'),
    join(dir, 'ftbquests', 'quests'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'chapters')) || existsSync(join(c, 'data.snbt'))) return c;
  }
  return detection.ftbQuests?.questDir?.path ?? join(dir, 'config', 'ftbquests', 'quests');
}

function cmdFtbq(args) {
  const dir = resolveDir(args._[1]);
  const detection = detectPack(dir);
  const questDir = resolveQuestDir(dir, detection);
  const ftbq =
    args.ftbq ??
    (detection.ftbQuests?.version && FTBQ_VERSIONS[detection.ftbQuests.version] ? detection.ftbQuests.version : null) ??
    (detection.minecraft?.version ? ftbqVersionGuess(detection.minecraft.version) : null) ??
    '1.21.1';
  const model = loadQuestDir(questDir, { ftbq });
  const result = checkQuests(model, { ftbq });
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          questDir,
          ftbq,
          ok: result.ok,
          stats: result.stats,
          diagnostics: result.diagnostics.map((d) => ({ ...d, error: undefined })),
        },
        null,
        2
      )}\n`
    );
  } else {
    process.stdout.write(`Quest data: ${questDir} (FTB Quests ${ftbq})\n\n`);
    const { text } = formatQuestReport(result, { info: args.info });
    process.stdout.write(`${text}\n`);
  }
  if (result.missing) return 1;
  if (result.stats.errors > 0) return 1;
  if (args.strict && result.stats.warnings > 0) return 1;
  return 0;
}

function ftbqVersionGuess(mcVersion) {
  if (/^1\.16/.test(mcVersion)) return '1.16';
  if (/^1\.18/.test(mcVersion)) return '1.18';
  if (/^1\.19/.test(mcVersion)) return '1.19';
  if (/^1\.20\.1$/.test(mcVersion)) return '1.20.1';
  if (/^1\.21/.test(mcVersion)) return '1.21.1';
  return null;
}

function snbtFilesOf(target) {
  const out = [];
  const walk = (p, depth) => {
    if (depth > 4) return;
    if (p.toLowerCase().endsWith('.snbt')) {
      out.push(p);
      return;
    }
    if (!existsSync(p)) return;
    try {
      for (const entry of readdirSync(p)) walk(join(p, entry), depth + 1);
    } catch {
      /* not a directory */
    }
  };
  walk(target, 0);
  return out;
}

function cmdSnbt(args) {
  const sub = args._[1];
  const target = args._[2];
  if (!sub || !target) fail('usage: kjsftb snbt <check|format> <file|dir>');
  const path = resolve(target);
  if (!existsSync(path)) fail(`no such file: ${path}`);

  if (sub === 'check') {
    const files = snbtFilesOf(path);
    if (files.length === 0) fail(`no .snbt files under ${path}`);
    let bad = 0;
    for (const file of files) {
      try {
        parseSnbt(stripBom(readFileSync(file, 'utf8')));
        if (!args.json) process.stdout.write(`  ok    ${file}\n`);
      } catch (err) {
        bad += 1;
        if (args.json) process.stdout.write(`${JSON.stringify({ file, ok: false, error: err.message })}\n`);
        else process.stdout.write(`  FAIL  ${file}\n        ${err.message}\n`);
      }
    }
    if (!args.json) process.stdout.write(`\n${files.length - bad}/${files.length} file(s) parsed.\n`);
    return bad > 0 ? 1 : 0;
  }

  if (sub === 'format') {
    const text = stripBom(readFileSync(path, 'utf8'));
    const value = parseSnbt(text);
    const formatted = formatSnbt(value);
    if (args.write) {
      writeFileSync(path, formatted, 'utf8');
      process.stdout.write(`reformatted ${path}\n`);
    } else {
      process.stdout.write(`${formatted}\n`);
    }
    return 0;
  }

  return fail(`unknown snbt subcommand: ${sub}`);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readSpec(args) {
  if (!args.spec) fail('missing --spec <file>');
  const path = resolve(args.spec);
  if (!existsSync(path)) fail(`spec file not found: ${path}`);
  try {
    return JSON.parse(stripBom(readFileSync(path, 'utf8')));
  } catch (err) {
    return fail(`cannot parse spec ${path}: ${err.message}`);
  }
}

function resolveGeneration(args, detection) {
  if (args.generation) return normalizeGeneration(args.generation);
  const detected = detection.kubejs?.generation;
  if (detected) return detected;
  return 'kjs7';
}

function resolveFtbqFor(args, detection) {
  if (args.ftbq && FTBQ_VERSIONS[args.ftbq]) return args.ftbq;
  const detected = detection.ftbQuests?.version;
  if (detected && FTBQ_VERSIONS[detected]) return detected;
  const guess = detection.minecraft?.version ? ftbqVersionGuess(detection.minecraft.version) : null;
  return guess ?? '1.21.1';
}

function writeOut(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function cmdRecipe(args) {
  const sub = args._[1];
  if (sub !== 'new') return fail('usage: kjsftb recipe new --spec <file> [--out <file>]');
  const spec = readSpec(args);
  const dir = args._[2] ? resolveDir(args._[2]) : process.cwd();
  const detection = detectPack(dir);
  const generation = resolveGeneration(args, detection);
  // `--generation 1.20.1` doubles as a version hint so schema-dependent choices
  // (smithing template slot, smithingTrim) resolve correctly without a pack.
  const versionHint = args.generation && /^\d/.test(args.generation) ? args.generation : null;
  const recipes = Array.isArray(spec) ? spec : spec.recipes;
  if (!Array.isArray(recipes) || recipes.length === 0) fail('spec must contain a non-empty "recipes" array');
  let text;
  try {
    text = generateRecipeScript(recipes, {
      generation,
      version: versionHint ?? spec.version ?? detection.kubejs?.version,
      priority: spec.priority ?? (args.priority === null ? undefined : Number(args.priority)),
      header: spec.header,
    });
  } catch (err) {
    return fail(err.message);
  }
  if (args.out) {
    const out = resolve(args.out);
    writeOut(out, text);
    process.stdout.write(`wrote ${out} (${generation}, ${recipes.length} recipe(s))\n`);
  } else {
    process.stdout.write(text);
  }
  return 0;
}

function loadModelFor(dir, args) {
  const detection = detectPack(dir);
  const questDir = resolveQuestDir(dir, detection);
  const ftbq = resolveFtbqFor(args, detection);
  const model = loadQuestDir(questDir, { ftbq });
  if (!model.exists) fail(`no FTB Quests data under ${questDir}`);
  return { detection, questDir, ftbq, model };
}

function writeLangEntry(questDir, locale, entries) {
  if (!Object.keys(entries).length) return null;
  const langDir = join(questDir, 'lang');
  const path = join(langDir, `${locale}.snbt`);
  let table = {};
  if (existsSync(path)) {
    try {
      table = parseSnbt(stripBom(readFileSync(path, 'utf8')));
    } catch (err) {
      fail(`cannot parse ${path}: ${err.message}`);
    }
  }
  writeOut(path, renderLangTable(mergeLang(table, entries)));
  return path;
}

function cmdQuest(args) {
  const sub = args._[1];
  if (sub === 'id') {
    process.stdout.write(`${newId()}\n`);
    return 0;
  }
  if (sub !== 'new' && sub !== 'chapter') return fail('usage: kjsftb quest <new|chapter|id> [dir] --spec <file> [--write]');

  const spec = readSpec(args);
  const dir = resolveDir(args._[2]);
  const { questDir, ftbq, model } = loadModelFor(dir, args);
  const locale = spec.locale ?? 'en_us';

  if (sub === 'chapter') {
    let result;
    try {
      result = addChapterToModel(model, spec, { ftbq });
    } catch (err) {
      return fail(err.message);
    }
    const text = renderChapter(result.chapter);
    const chapterPath = join(questDir, 'chapters', `${result.chapter.filename}.snbt`);
    for (const note of result.notes) process.stdout.write(`  note  ${note}\n`);
    if (!args.write) {
      process.stdout.write(`${text}\n`);
      return 0;
    }
    writeOut(chapterPath, text);
    const langPath = writeLangEntry(questDir, locale, result.lang);
    process.stdout.write(`wrote ${chapterPath}\n`);
    if (langPath) process.stdout.write(`wrote ${langPath}\n`);
    return 0;
  }

  let result;
  try {
    result = addQuestToModel(model, spec, { ftbq });
  } catch (err) {
    return fail(err.message);
  }
  for (const note of result.notes) process.stdout.write(`  note  ${note}\n`);
  for (const warning of result.warnings) process.stdout.write(`  warn  ${warning}\n`);
  const text = renderChapter(result.chapter);
  if (!args.write) {
    process.stdout.write(`${text}\n`);
    return 0;
  }
  writeOut(result.chapterPath, text);
  process.stdout.write(`wrote ${result.chapterPath} (quest ${result.quest.id})\n`);
  const langPath = writeLangEntry(questDir, locale, result.lang);
  if (langPath) process.stdout.write(`wrote ${langPath}\n`);
  return 0;
}

async function cmdUi(args) {
  const dir = args._[1] ? resolveDir(args._[1]) : null;
  const port = args.port ? Number(args.port) : 0;
  const { startWorkbench } = await import('../ui/server.mjs');
  const { url } = await startWorkbench({ root: dir, port });
  process.stdout.write(`kjsftb workbench: ${url}\n`);
  if (!dir) process.stdout.write('pick a pack directory in the Settings tab to get started.\n');
  if (args.open) await openBrowser(url);
  await new Promise(() => {});
}

async function openBrowser(url) {
  try {
    const { spawn } = await import('node:child_process');
    const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const argv = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(command, argv, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* opening a browser is a convenience, not a requirement */
  }
}

/* -------------------------------------------------------------------- main */

function main(argv) {
  const args = parseArgs(argv);
  if (args.help || args._.length === 0) {
    process.stdout.write(HELP);
    return args._.length === 0 && !args.help ? 2 : 0;
  }
  const command = args._[0];
  if (command === 'ui') {
    cmdUi(args).catch((err) => fail(String(err?.message ?? err), 1));
    return 0;
  }
  switch (command) {
    case 'detect':
      return cmdDetect(args);
    case 'lint':
      return cmdLint(args);
    case 'ftbq':
      return cmdFtbq(args);
    case 'snbt':
      return cmdSnbt(args);
    case 'recipe':
      return cmdRecipe(args);
    case 'quest':
      return cmdQuest(args);
    default:
      fail(`unknown command: ${command}\n\n${HELP}`);
  }
}

process.exitCode = main(process.argv.slice(2));
