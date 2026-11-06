/**
 * Pack detection: figure out Minecraft version, mod loader, KubeJS
 * generation and FTB Quests layout from a pack directory.
 *
 * Detection order (highest confidence first):
 *   1. modrinth.index.json      -> dependencies.minecraft / .forge / .neoforge
 *   2. manifest.json            -> minecraft.version / minecraft.modLoaders[]
 *   3. minecraftinstance.json   -> gameVersion / baseModLoader.name
 *   4. mmc-pack.json            -> components[uid=net.minecraft|net.minecraftforge]
 *   5. installed mod jars      -> kubejs-<loader>-<prefix>.<ver>-build.<n>.jar
 *   6. field presence in config/ftbquests/quests (lang/ means 1.21+)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import {
  GENERATIONS,
  FTBQ_VERSIONS,
  generationForKubeJS,
  generationForMc,
  ftbqVersionForMc,
  ftbqVersionForMod,
} from './versions.mjs';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listFiles(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Find the actual pack root: the given dir, or its single pack-ish child. */
export function findPackRoot(startDir) {
  const start = resolve(startDir);
  if (looksLikePack(start)) return start;
  const children = listFiles(start).filter((e) => e.isDirectory());
  const candidates = children
    .map((e) => join(start, e.name))
    .filter((p) => looksLikePack(p));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    // Prefer a child that has an explicit launcher manifest.
    const withManifest = candidates.filter((p) =>
      ['manifest.json', 'modrinth.index.json', 'mmc-pack.json', 'minecraftinstance.json'].some((f) =>
        existsSync(join(p, f)),
      ),
    );
    if (withManifest.length >= 1) return withManifest[0];
    return candidates[0];
  }
  return start;
}

function looksLikePack(dir) {
  return (
    existsSync(join(dir, 'mods')) ||
    existsSync(join(dir, 'config')) ||
    existsSync(join(dir, 'manifest.json')) ||
    existsSync(join(dir, 'modrinth.index.json')) ||
    existsSync(join(dir, 'mmc-pack.json'))
  );
}

/* ------------------------------------------------------------------ */
/* launcher manifests                                                  */
/* ------------------------------------------------------------------ */

function parseCurseManifest(root) {
  const j = readJson(join(root, 'manifest.json'));
  if (!j?.minecraft) return undefined;
  const mc = j.minecraft.version;
  const loaders = (j.minecraft.modLoaders ?? []).map((l) => String(l.id ?? ''));
  const loader = pickLoader(loaders);
  return {
    mcVersion: mc,
    loader: loader?.name,
    loaderVersion: loader?.version,
    source: 'manifest.json (CurseForge)',
    confidence: 'high',
  };
}

function parseModrinthIndex(root) {
  const j = readJson(join(root, 'modrinth.index.json'));
  if (!j?.dependencies) return undefined;
  const deps = j.dependencies;
  let loader;
  let loaderVersion;
  if (deps.neoforge) {
    loader = 'neoforge';
    loaderVersion = deps.neoforge;
  } else if (deps.forge) {
    loader = 'forge';
    loaderVersion = deps.forge;
  } else if (deps['fabric-loader']) {
    loader = 'fabric';
    loaderVersion = deps['fabric-loader'];
  } else if (deps.quilt_loader) {
    loader = 'quilt';
    loaderVersion = deps.quilt_loader;
  }
  const declared = j.name ?? j.versionId;
  return {
    mcVersion: deps.minecraft,
    loader,
    loaderVersion,
    source: 'modrinth.index.json',
    confidence: 'high',
    name: declared,
  };
}

function parseCurseInstance(root) {
  const j = readJson(join(root, 'minecraftinstance.json'));
  if (!j) return undefined;
  const ml = j.baseModLoader ?? {};
  const name = String(ml.name ?? '');
  const loader = pickLoader([name]);
  return {
    mcVersion: j.gameVersion ?? ml.gameVersion,
    loader: loader?.name,
    loaderVersion: loader?.version,
    source: 'minecraftinstance.json (CurseForge app)',
    confidence: 'high',
    name: j.name,
  };
}

function parseMmcPack(root) {
  const j = readJson(join(root, 'mmc-pack.json'));
  if (!j?.components) return undefined;
  const byUid = Object.fromEntries(j.components.map((c) => [c.uid, c.version]));
  const pick = (...uids) => uids.map((u) => byUid[u]).find(Boolean);
  const loaderVersion = pick(
    'net.neoforged',
    'net.minecraftforge',
    'org.quiltmc.quilt-loader',
    'net.fabricmc.fabric-loader',
  );
  let loader;
  if (byUid['net.neoforged']) loader = 'neoforge';
  else if (byUid['net.minecraftforge']) loader = 'forge';
  else if (byUid['org.quiltmc.quilt-loader']) loader = 'quilt';
  else if (byUid['net.fabricmc.fabric-loader']) loader = 'fabric';
  return {
    mcVersion: pick('net.minecraft'),
    loader,
    loaderVersion,
    source: 'mmc-pack.json (Prism/MultiMC)',
    confidence: 'high',
  };
}

function pickLoader(ids) {
  const clean = ids.filter(Boolean);
  const find = (re) => clean.map((id) => re.exec(id)).find(Boolean);
  const neo = find(/^(?:neoforge|neo)-?([\d.]+)/i);
  if (neo) return { name: 'neoforge', version: neo[1] };
  const forge = find(/^(?:forge)-?([\d.]+)/i);
  if (forge) return { name: 'forge', version: forge[1] };
  const fabric = find(/^(?:fabric(?:-loader)?)-?([\d.+]+)/i);
  if (fabric) return { name: 'fabric', version: fabric[1] };
  const quilt = find(/^(?:quilt(?:-loader)?)-?([\d.+]+)/i);
  if (quilt) return { name: 'quilt', version: quilt[1] };
  return undefined;
}

/* ------------------------------------------------------------------ */
/* mod jars                                                            */
/* ------------------------------------------------------------------ */

const FTBQ_JAR = /^ftb-quests[-_](?:(forge|neoforge|fabric)[-_])?(.+?)\.jar$/i;

function scanMods(root) {
  const modsDir = join(root, 'mods');
  const out = { kubejs: undefined, ftbQuests: undefined, others: [] };
  for (const e of listFiles(modsDir)) {
    if (!e.isFile()) continue;
    const name = e.name;
    if (!/\.jar$/i.test(name)) continue;

    if (/^kubejs/i.test(name)) {
      const parts = name.replace(/\.jar$/i, '');
      const version = extractKubeJSVersion(parts);
      // a bare "kubejs.jar" carries no version; do not report the stem as one
      const known = version?.version && /\d/.test(version.version) ? version.version : undefined;
      out.kubejs = { jar: name, version: known, loader: version?.loader };
      continue;
    }
    const q = FTBQ_JAR.exec(name);
    if (q) {
      const version = q[2].replace(/-(forge|neoforge|fabric)$/i, '');
      out.ftbQuests = { jar: name, version, loader: q[1]?.toLowerCase() };
      continue;
    }
    if (/^(ftb-library|ftb-teams|ftb-ranks)/i.test(name)) out.others.push(name);
  }
  // Multi-loader jar names such as kubejs-2101.7.2-build.381+neoforge.jar
  return out;
}

/**
 * kubejs-forge-2001.6.5-build.26      -> 2001.6.5-build.26 (forge)
 * kubejs-neoforge-2101.7.2-build.381  -> 2101.7.2-build.381 (neoforge)
 * kubejs-2001.6.5-build.26            -> 2001.6.5-build.26
 * kubejs-neoforge-26.1.2-8.0.8        -> 8.0.8 (neoforge, mcVersionHint 26.1.2)
 */
export function extractKubeJSVersion(stem) {
  let s = stem.replace(/\.(jar|zip|disabled)$/i, '').replace(/^kubejs[-_]/i, '');
  let loader;
  const loaderMatch = /^(forge|neoforge|fabric|common)[-_]/i.exec(s);
  if (loaderMatch) {
    loader = loaderMatch[1].toLowerCase();
    s = s.slice(loaderMatch[0].length);
  }
  // KubeJS <= 7 uses a 4-digit build prefix (2101.7.2-build.381); KubeJS 8
  // puts a Minecraft version first (26.1.2-8.0.8). Only strip the latter.
  let mcVersionHint;
  if (!/^\d{4}\.\d/.test(s)) {
    const mcPrefix = /^(1\.\d+(?:\.\d+)?|26\.\d+(?:\.\d+)?)[-_]/.exec(s);
    if (mcPrefix) {
      mcVersionHint = mcPrefix[1];
      s = s.slice(mcPrefix[0].length);
    }
  }
  const version = s.replace(/\+.*$/, '').replace(/-(forge|neoforge|fabric)$/i, '');
  return { version, loader, mcVersionHint };
}

/* ------------------------------------------------------------------ */
/* kubejs + ftbquests directories                                      */
/* ------------------------------------------------------------------ */

function scanKubeJSDir(root) {
  const dir = join(root, 'kubejs');
  if (!isDir(dir)) return { exists: false };
  const out = { exists: true, path: dir, scripts: {}, assets: [], data: [] };
  for (const e of listFiles(dir)) {
    if (e.isDirectory() && /_(scripts)$/.test(e.name)) {
      const files = listScriptFiles(join(dir, e.name));
      out.scripts[e.name] = files;
    } else if (e.isDirectory() && (e.name === 'assets' || e.name === 'data')) {
      out[e.name] = listFiles(join(dir, e.name)).map((x) => x.name);
    }
  }
  out.scriptCount = Object.values(out.scripts).reduce((n, f) => n + f.length, 0);
  return out;
}

function listScriptFiles(dir, base = dir, depth = 0) {
  /** @type {string[]} */
  const out = [];
  if (depth > 6) return out;
  for (const e of listFiles(dir)) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listScriptFiles(full, base, depth + 1));
    else if (/\.(js|d\.ts)$/.test(e.name)) out.push(full.slice(base.length + 1).replace(/\\/g, '/'));
  }
  return out;
}

function scanQuestDir(root) {
  const dir = join(root, 'config', 'ftbquests', 'quests');
  if (!isDir(dir)) {
    // Some packs put quests at config/ftbquests/<file>.snbt (pre-1.16), or
    // the whole folder may be missing because FTB Quests is not installed.
    const anyFtb = existsSync(join(root, 'config', 'ftbquests'));
    return { exists: false, configDirExists: anyFtb, path: dir };
  }
  const names = listFiles(dir).map((e) => e.name);
  const chapters = listFiles(join(dir, 'chapters'))
    .filter((e) => e.isFile() && e.name.endsWith('.snbt'))
    .map((e) => e.name);
  const rewardTables = listFiles(join(dir, 'reward_tables'))
    .filter((e) => e.isFile() && e.name.endsWith('.snbt'))
    .map((e) => e.name);
  const lang = listFiles(join(dir, 'lang'))
    .filter((e) => e.isFile() && e.name.endsWith('.snbt'))
    .map((e) => e.name);
  return {
    exists: true,
    path: dir,
    files: names,
    chapters,
    rewardTables,
    lang,
    hasDataFile: names.includes('data.snbt'),
    hasChapterGroups: names.includes('chapter_groups.snbt'),
  };
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

/**
 * @param {string} dir pack directory (or a directory containing one)
 * @param {{ mcVersion?: string, kubejsVersion?: string, ftbqVersion?: string }} [overrides]
 */
export function detectPack(dir, overrides = {}) {
  const root = findPackRoot(dir);
  const warnings = [];

  const manifest =
    parseModrinthIndex(root) ??
    parseCurseManifest(root) ??
    parseCurseInstance(root) ??
    parseMmcPack(root);

  const mods = scanMods(root);
  const kubejsDir = scanKubeJSDir(root);
  const questDir = scanQuestDir(root);

  let mcVersion = overrides.mcVersion ?? manifest?.mcVersion;
  let loader = manifest?.loader;
  let loaderVersion = manifest?.loaderVersion;
  let mcSource = manifest ? `${manifest.source}` : undefined;
  let mcConfidence = manifest ? 'high' : 'unknown';

  if (!mcVersion && mods.kubejs?.version) {
    const hint = /^(\d{4})/.exec(mods.kubejs.version);
    const mcHint = extractKubeJSVersion(mods.kubejs.jar.replace(/\.jar$/i, '')).mcVersionHint;
    if (mcHint) {
      mcVersion = mcHint;
      mcSource = 'KubeJS jar name';
      mcConfidence = 'medium';
    } else if (hint) {
      const gen = generationForKubeJS(mods.kubejs.version);
      mcVersion = gen?.mcVersions?.[0];
      mcSource = 'KubeJS build prefix';
      mcConfidence = 'medium';
    }
  }

  if (!loader && mods.kubejs?.loader) loader = mods.kubejs.loader;
  if (!loader && mods.ftbQuests?.loader) loader = mods.ftbQuests.loader;

  if (!mcVersion) {
    warnings.push(
      'Could not determine the Minecraft version: no launcher manifest and no recognisable KubeJS jar name. Pass --mc explicitly.',
    );
  }

  const kubejsVersion = overrides.kubejsVersion ?? mods.kubejs?.version;
  let generation = kubejsVersion ? generationForKubeJS(kubejsVersion) : undefined;
  let generationSource = kubejsVersion ? 'KubeJS version' : undefined;
  if (!generation && mcVersion) {
    generation = generationForMc(mcVersion);
    generationSource = 'Minecraft version';
  }
  if (!generation) {
    warnings.push(
      'Could not decide the KubeJS generation. Assuming the newest syntax is dangerous: pass --kubejs or --mc.',
    );
  }
  if (kubejsVersion && generation && !generationForKubeJS(kubejsVersion) && generation) {
    warnings.push(
      `KubeJS version "${kubejsVersion}" was not recognised; generation inferred from Minecraft ${mcVersion}.`,
    );
  }

  // FTB Quests layout
  let ftbq = undefined;
  let ftbqSource;
  const ftbqVersion = overrides.ftbqVersion ?? mods.ftbQuests?.version;
  if (ftbqVersion) {
    ftbq = ftbqVersionForMod(ftbqVersion);
    ftbqSource = 'FTB Quests version';
  }
  if (!ftbq && mcVersion) {
    ftbq = ftbqVersionForMc(mcVersion);
    ftbqSource = ftbq ? 'Minecraft version' : undefined;
  }
  if (!ftbq && questDir.exists) {
    if (questDir.lang.length > 0) {
      ftbq = FTBQ_VERSIONS['1.21.1'];
      ftbqSource = 'quest layout (lang/ directory present)';
    } else {
      ftbq = ftbqVersionForMc(mcVersion);
    }
  }
  if (ftbq && questDir.exists) {
    const layoutHasLang = ftbq.hasLangFiles;
    const dirHasLang = questDir.lang.length > 0;
    if (layoutHasLang && !dirHasLang) {
      warnings.push(
        `FTB Quests ${Object.keys(FTBQ_VERSIONS).find((k) => FTBQ_VERSIONS[k] === ftbq)} uses translation files (lang/*.snbt), but this pack has none yet.`,
      );
    }
    if (!layoutHasLang && dirHasLang) {
      warnings.push(
        'Quest folder contains lang/*.snbt but the detected FTB Quests version predates translation files — check the mod version.',
      );
    }
    if (!questDir.hasDataFile) {
      warnings.push('config/ftbquests/quests/data.snbt is missing; FTB Quests will regenerate defaults on load.');
    }
  } else if (questDir.configDirExists && !questDir.exists) {
    warnings.push('config/ftbquests exists but quests/ does not — the pack may never have opened the quest editor.');
  }

  if (kubejsDir.exists && kubejsDir.scriptCount === 0) {
    warnings.push('kubejs/ exists but contains no .js scripts yet.');
  }

  const assumed = !generation;
  const gen = generation ?? GENERATIONS.kjs7;

  return {
    root,
    name: manifest?.name ?? basename(root),
    minecraft: { version: mcVersion, loader, loaderVersion, source: mcSource, confidence: mcConfidence },
    kubejs: {
      installed: Boolean(mods.kubejs),
      version: kubejsVersion,
      jar: mods.kubejs?.jar,
      loader: mods.kubejs?.loader,
      generation: gen.id,
      generationLabel: gen.label,
      generationSource: generationSource ?? (assumed ? 'assumed (newest)' : undefined),
      generationAssumed: assumed,
      syntax: gen.syntax,
      onEvent: gen.onEvent ?? 'supported',
      scriptDirs: gen.scriptDirs,
      docs: gen.docs,
      dir: kubejsDir,
    },
    ftbQuests: {
      installed: Boolean(ftbqVersion ?? questDir.exists),
      version: ftbqVersion,
      jar: mods.ftbQuests?.jar,
      generation: ftbq ? Object.keys(FTBQ_VERSIONS).find((k) => FTBQ_VERSIONS[k] === ftbq) : undefined,
      generationSource: ftbqSource,
      hasLangFiles: Boolean(ftbq?.hasLangFiles),
      questDir,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* CLI helpers                                                         */
/* ------------------------------------------------------------------ */

export function formatDetection(d) {
  const lines = [];
  const yn = (v) => (v ? 'yes' : 'no');
  lines.push(`pack      ${d.name}  (${d.root})`);
  lines.push(
    `minecraft ${d.minecraft.version ?? '?'}${d.minecraft.loader ? ` / ${d.minecraft.loader} ${d.minecraft.loaderVersion ?? ''}` : ''}` +
      `${d.minecraft.source ? `  [${d.minecraft.source}, confidence ${d.minecraft.confidence}]` : ''}`,
  );
  lines.push(
    `kubejs    ${d.kubejs.installed ? `${d.kubejs.version ?? '?'} installed` : 'not installed'}  -> generation ${d.kubejs.generation}` +
      `  (${d.kubejs.generationSource ?? 'assumed'})`,
  );
  lines.push(`          syntax: ${d.kubejs.syntax}; onEvent(): ${d.kubejs.onEvent}`);
  lines.push(
    `ftbq      ${d.ftbQuests.installed ? `${d.ftbQuests.version ?? '?'} installed` : 'not installed'}  -> layout ${d.ftbQuests.generation ?? '?'}` +
      `  (lang/ translations: ${yn(d.ftbQuests.hasLangFiles)})`,
  );
  if (d.kubejs.dir.exists) {
    const dirs = Object.entries(d.kubejs.dir.scripts ?? {})
      .map(([k, v]) => `${k} (${v.length})`)
      .join(', ');
    lines.push(`scripts   ${dirs || 'none'}`);
  }
  if (d.ftbQuests.questDir.exists) {
    const q = d.ftbQuests.questDir;
    lines.push(
      `quests    ${q.chapters.length} chapters, ${q.rewardTables.length} reward tables, ${q.lang.length} lang files`,
    );
  }
  if (d.warnings.length) {
    lines.push('warnings:');
    for (const w of d.warnings) lines.push(`  - ${w}`);
  }
  return lines.join('\n');
}
