#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { id: null, extPath: null, profile: 'Default', chromeDir: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--id') out.id = args[++i];
    else if (a === '--path') out.extPath = args[++i];
    else if (a === '--profile') out.profile = args[++i];
    else if (a === '--chrome-dir') out.chromeDir = args[++i];
  }
  return out;
}

function getCandidateChromeBaseDirs() {
  const home = os.homedir();
  const platform = process.platform;
  if (platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Beta'),
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Canary'),
      path.join(home, 'Library', 'Application Support', 'Chromium')
    ];
  }
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      path.join(localAppData, 'Google', 'Chrome Beta', 'User Data'),
      path.join(localAppData, 'Google', 'Chrome SxS', 'User Data'),
      path.join(localAppData, 'Chromium', 'User Data')
    ];
  }
  // linux
  return [
    path.join(home, '.config', 'google-chrome'),
    path.join(home, '.config', 'google-chrome-beta'),
    path.join(home, '.config', 'google-chrome-unstable'),
    path.join(home, '.config', 'chromium')
  ];
}

async function findExtensionIdByPath(preferencesPath, unpackedPath) {
  const raw = await fs.readFile(preferencesPath, 'utf-8');
  const json = JSON.parse(raw);
  const settings = json?.extensions?.settings || {};

  // Resolve both paths for reliable comparison
  const resolvedUnpacked = path.resolve(unpackedPath);
  const entries = Object.entries(settings);
  for (const [id, cfg] of entries) {
    const p = cfg?.path;
    if (!p) continue;
    const resolvedCfg = path.resolve(p);
    if (resolvedCfg === resolvedUnpacked) {
      return id;
    }
  }
  return null;
}

async function findExtensionIdAcrossProfiles(chromeBase, unpackedPath) {
  const dirents = await fs.readdir(chromeBase, { withFileTypes: true }).catch(() => []);
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const profileDir = path.join(chromeBase, d.name);
    const pref = path.join(profileDir, 'Preferences');
    if (!(await fileExists(pref))) continue;
    try {
      const id = await findExtensionIdByPath(pref, unpackedPath);
      if (id) return { id, profileName: d.name };
    } catch {
      // ignore parse errors
    }
  }
  return null;
}

async function listProfilesWithPreferences(chromeBase) {
  const profiles = [];
  const dirents = await fs.readdir(chromeBase, { withFileTypes: true }).catch(() => []);
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const pref = path.join(chromeBase, d.name, 'Preferences');
    if (await fileExists(pref)) profiles.push(d.name);
  }
  return profiles;
}

async function findProfileByExtensionId(chromeBase, extensionId) {
  const profiles = await listProfilesWithPreferences(chromeBase);
  for (const p of profiles) {
    const profileDir = path.join(chromeBase, p);
    // 1) Look for Local Extension Settings directory
    const les = path.join(profileDir, 'Local Extension Settings', extensionId);
    if (await fileExists(les)) return { profileName: p };
    // 2) Fallback: see if Preferences references the extension
    const pref = path.join(profileDir, 'Preferences');
    try {
      const raw = await fs.readFile(pref, 'utf-8');
      const json = JSON.parse(raw);
      const has = Boolean(json?.extensions?.settings && json.extensions.settings[extensionId]);
      if (has) return { profileName: p };
    } catch {
      // ignore
    }
  }
  return null;
}

async function removeDirIfExists(dir) {
  if (await fileExists(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  }
  return false;
}

async function main() {
  const args = parseArgs();
  const candidateBases = args.chromeDir ? [args.chromeDir] : getCandidateChromeBaseDirs();

  let profileName = args.profile || null;
  let chromeBaseUsed = null;

  let extensionId = args.id;
  let extPath = args.extPath || path.resolve(path.join(process.cwd(), 'Streak'));
  if (!(await fileExists(extPath)) && !extensionId) {
    console.error('Could not infer extension path. Pass --path "/absolute/path/to/Streak" or --id <extensionId>.');
    process.exit(1);
  }

  if (!extensionId) {
    // Try the provided/suspected profile first if present
    if (profileName) {
      for (const base of candidateBases) {
        const pref = path.join(base, profileName, 'Preferences');
        if (await fileExists(pref)) {
          const id = await findExtensionIdByPath(pref, extPath);
          if (id) {
            extensionId = id;
            chromeBaseUsed = base;
            break;
          }
        }
      }
    }
    // Otherwise scan all profiles across candidates
    if (!extensionId) {
      for (const base of candidateBases) {
        if (!(await fileExists(base))) continue;
        const found = await findExtensionIdAcrossProfiles(base, extPath);
        if (found) {
          extensionId = found.id;
          profileName = found.profileName;
          chromeBaseUsed = base;
          break;
        }
      }
    }
    if (!extensionId) {
      console.error('Could not find extension ID in any Chrome profile/variant.');
      console.error('Open chrome://extensions to copy the ID and run with: --id <extensionId>');
      process.exit(1);
    }
  }

  // If extensionId is known, find the profile that actually has it
  if (extensionId) {
    for (const base of candidateBases) {
      if (!(await fileExists(base))) continue;
      const found = await findProfileByExtensionId(base, extensionId);
      if (found) {
        chromeBaseUsed = base;
        profileName = found.profileName;
        break;
      }
    }
  }

  // If still no base/profile resolved, select the first existing base and a profile with Preferences
  if (!chromeBaseUsed) {
    for (const base of candidateBases) {
      if (!(await fileExists(base))) continue;
      chromeBaseUsed = base;
      break;
    }
  }
  if (!chromeBaseUsed) {
    console.error('No Chrome user data directory found. Provide --chrome-dir.');
    process.exit(1);
  }

  if (!profileName) {
    const profiles = await listProfilesWithPreferences(chromeBaseUsed);
    if (profiles.length === 0) {
      console.error('Could not determine a profile directory. Provide --profile.');
      process.exit(1);
    }
    profileName = profiles.includes('Default') ? 'Default' : profiles[0];
  }

  const profileDir = path.join(chromeBaseUsed, profileName);
  const preferencesPath = path.join(profileDir, 'Preferences');
  if (!(await fileExists(preferencesPath))) {
    console.error(`Preferences not found: ${preferencesPath}`);
    console.error('Pass a valid --profile or --chrome-dir.');
    process.exit(1);
  }

  const localExtSettings = path.join(profileDir, 'Local Extension Settings', extensionId);
  const indexedDbLevelDb = path.join(profileDir, 'IndexedDB', `chrome-extension_${extensionId}_0.indexeddb.leveldb`);
  const indexedDbDir = path.join(profileDir, 'IndexedDB', `chrome-extension_${extensionId}_0`);

  const removedA = await removeDirIfExists(localExtSettings);
  const removedB = await removeDirIfExists(indexedDbLevelDb);
  const removedC = await removeDirIfExists(indexedDbDir);

  if (removedA || removedB || removedC) {
    console.log('Streak data cleared. If Chrome is open, reload the extension to see changes.');
    console.log(`Extension ID: ${extensionId}`);
    console.log(`Profile: ${profileName}`);
    console.log(`Chrome base: ${chromeBaseUsed}`);
  } else {
    console.log('Nothing to remove. Data may already be clear or paths differ.');
    console.log(`Checked paths:\n- ${localExtSettings}\n- ${indexedDbLevelDb}\n- ${indexedDbDir}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

