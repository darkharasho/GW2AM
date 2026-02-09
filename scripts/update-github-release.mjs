#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const releaseNotesPath = path.join(rootDir, 'RELEASE_NOTES.md');

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;
    const key = match[1];
    let value = match[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
};

loadEnvFile(path.join(rootDir, '.env'));

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN (or GH_TOKEN) is not set. Aborting release upload.');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson?.version || '0.0.0';
const tagName = `v${version}`;
const outputDir = path.join(rootDir, packageJson?.build?.directories?.output || 'dist_out');
const notes = fs.existsSync(releaseNotesPath)
  ? fs.readFileSync(releaseNotesPath, 'utf8').trim()
  : `Release ${tagName}`;

const args = process.argv.slice(2);
const readArgValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] || null;
};

const publishConfig = packageJson?.build?.publish || {};
const owner = readArgValue('--release-owner') || process.env.GITHUB_RELEASE_OWNER || publishConfig.owner;
const repo = readArgValue('--release-repo') || process.env.GITHUB_RELEASE_REPO || publishConfig.repo;
const releaseType = String(publishConfig.releaseType || '').toLowerCase();
const shouldDraft = releaseType === 'draft';

if (!owner || !repo) {
  console.error('Missing GitHub release owner/repo. Configure build.publish or pass --release-owner/--release-repo.');
  process.exit(1);
}

const allowedAssetNames = new Set(['latest.yml', 'latest-linux.yml']);
const allowedAssetExts = new Set(['.AppImage', '.exe', '.blockmap']);
const shouldIncludeAsset = (fileName) => {
  if (allowedAssetNames.has(fileName)) return true;
  return allowedAssetExts.has(path.extname(fileName));
};

const collectReleaseFiles = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const filesByName = new Map();
  for (const entry of entries) {
    // Only upload top-level artifacts from dist_out.
    if (!entry.isFile()) continue;
    if (!shouldIncludeAsset(entry.name)) continue;
    const absPath = path.join(dir, entry.name);
    filesByName.set(entry.name, { absPath, name: entry.name });
  }
  return Array.from(filesByName.values());
};

const request = async (method, url, body) => {
  const resp = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 404) return { ok: false, status: 404, data: null };
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, data };
};

const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

let releaseResp = await request('GET', `${baseUrl}/releases/tags/${tagName}`);
if (releaseResp.status === 404) {
  releaseResp = await request('POST', `${baseUrl}/releases`, {
    tag_name: tagName,
    name: tagName,
    body: notes,
    draft: shouldDraft,
    prerelease: false,
  });
}

if (!releaseResp.ok || !releaseResp.data?.id) {
  console.error(`Failed to create/load release for ${tagName}.`);
  process.exit(1);
}

let releaseData = releaseResp.data;
if (releaseResp.status === 200 && releaseData?.id && releaseData?.tag_name === tagName) {
  const patchResp = await request('PATCH', `${baseUrl}/releases/${releaseData.id}`, {
    name: tagName,
    body: notes,
    draft: shouldDraft,
    prerelease: false,
  });
  if (!patchResp.ok || !patchResp.data?.id) {
    console.error(`Failed to update release ${tagName}.`);
    process.exit(1);
  }
  releaseData = patchResp.data;
}

const releaseId = releaseData?.id;
const uploadUrl = releaseData?.upload_url?.replace('{?name,label}', '');
if (!uploadUrl) {
  console.error('Release upload URL missing. Aborting asset upload.');
  process.exit(1);
}

const files = collectReleaseFiles(outputDir);
if (files.length === 0) {
  console.error(`No release artifacts found in ${outputDir}. Aborting upload.`);
  process.exit(1);
}

const existingAssets = Array.isArray(releaseData?.assets) ? releaseData.assets : [];
for (const file of files) {
  const existing = existingAssets.find((asset) => asset?.name === file.name);
  if (existing?.id) {
    await request('DELETE', `${baseUrl}/releases/assets/${existing.id}`);
  }

  const uploadResp = await fetch(`${uploadUrl}?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: fs.readFileSync(file.absPath),
  });
  if (!uploadResp.ok) {
    console.error(`Failed to upload ${file.name} (${uploadResp.status}).`);
    process.exit(1);
  }
}

if (releaseData?.draft) {
  const publishResp = await request('PATCH', `${baseUrl}/releases/${releaseId}`, { draft: false });
  if (!publishResp.ok) {
    console.error(`Failed to publish draft release ${tagName}.`);
    process.exit(1);
  }
}

console.log(`Published GitHub release ${tagName} with ${files.length} assets.`);
