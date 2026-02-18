#!/usr/bin/env node
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';
const concurrentlyBin = path.resolve('node_modules', 'concurrently', 'dist', 'bin', 'concurrently.js');

let interrupted = false;
let terminating = false;
let activeChild = null;

function isSignalInterrupt(signal) {
  return signal === 'SIGINT' || signal === 'SIGTERM';
}

function isWindowsInterruptExit(code) {
  // On Windows, Ctrl+C in nested process trees commonly surfaces as code 2 (or 130 in some shells).
  return code === 2 || code === 130;
}

function terminateChildren() {
  if (!activeChild?.pid) return;
  try {
    activeChild.kill(isWin ? 'SIGINT' : 'SIGTERM');
  } catch {
    // ignore if already gone
  }
  if (isWin) {
    setTimeout(() => {
      if (!activeChild?.pid) return;
      spawnSync('taskkill', ['/PID', String(activeChild.pid), '/T', '/F'], { stdio: 'ignore' });
    }, 450);
    return;
  }
}

function requestShutdown() {
  if (terminating) return;
  terminating = true;
  interrupted = true;
  terminateChildren();
  setTimeout(() => {
    process.exit(0);
  }, 800);
}

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    });
    activeChild = child;

    child.on('error', (error) => {
      activeChild = null;
      reject(error);
    });

    child.on('exit', (code, signal) => {
      activeChild = null;
      resolve({ code, signal });
    });
  });
}

function runNpm(scriptName) {
  if (isWin) {
    return run('cmd.exe', ['/d', '/s', '/c', `npm run ${scriptName}`]);
  }
  return run('npm', ['run', scriptName]);
}

async function main() {
  try {
    const build = await runNpm('build:electron');
    if (interrupted || isSignalInterrupt(build.signal) || (isWin && isWindowsInterruptExit(build.code ?? null))) {
      process.exit(0);
      return;
    }
    if ((build.code ?? 0) !== 0) {
      process.exit(build.code ?? 1);
      return;
    }

    const dev = await run(process.execPath, [
      concurrentlyBin,
      '--handle-input',
      '--kill-others',
      '--kill-others-on-fail',
      'cross-env BROWSER=none npm run dev:web',
      'npm run electron',
    ]);

    if (interrupted || isSignalInterrupt(dev.signal) || (isWin && isWindowsInterruptExit(dev.code ?? null))) {
      process.exit(0);
      return;
    }
    process.exit(dev.code ?? 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dev-runner] failed: ${message}`);
    process.exit(interrupted ? 0 : 1);
  }
}

main();
