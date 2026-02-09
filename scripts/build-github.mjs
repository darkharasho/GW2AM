#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const allowedBumps = new Set(['patch', 'minor', 'major']);
const bumpType = args.find((arg) => allowedBumps.has(arg)) || null;
const releaseOwner = readArgValue('--release-owner');
const releaseRepo = readArgValue('--release-repo');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function readArgValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] || null;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    const error = new Error(`Command failed: ${command} ${commandArgs.join(' ')}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

function bumpVersion(current, type) {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unsupported version format: ${current}`);
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (type === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

const packagePath = path.resolve('package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

try {
  if (bumpType) {
    const currentVersion = String(packageJson.version || '').trim();
    if (!currentVersion) {
      console.error('package.json is missing a version.');
      process.exit(1);
    }
    packageJson.version = bumpVersion(currentVersion, bumpType);
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    run(npmCmd, ['install']);
  }

  run(npmCmd, ['run', 'build:electron']);
  run(npmCmd, ['run', 'build']);
  run(process.execPath, ['scripts/run-electron-builder.mjs']);
  const releaseArgs = ['scripts/update-github-release.mjs'];
  if (releaseOwner) releaseArgs.push('--release-owner', releaseOwner);
  if (releaseRepo) releaseArgs.push('--release-repo', releaseRepo);
  run(process.execPath, releaseArgs);
} catch (error) {
  process.exit(error?.exitCode ?? 1);
}
