#!/usr/bin/env node
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const child = spawn(process.execPath, ['scripts/dev-runner.mjs'], {
  stdio: 'inherit',
  env: process.env,
});

let interrupted = false;

function isInterruptSignal(signal) {
  return signal === 'SIGINT' || signal === 'SIGTERM';
}

function isWindowsInterruptCode(code) {
  // Ctrl+C can bubble up as these exit codes depending on shell/process tree.
  return code === 2 || code === 130 || code === 3221225786;
}

function forwardShutdown(signal) {
  interrupted = true;
  try {
    child.kill(signal);
  } catch {
    // ignore
  }
}

process.on('SIGINT', () => forwardShutdown('SIGINT'));
process.on('SIGTERM', () => forwardShutdown('SIGTERM'));

child.on('error', (error) => {
  console.error(`[dev-entry] failed to start dev-runner: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (interrupted || isInterruptSignal(signal) || (isWin && isWindowsInterruptCode(code ?? null))) {
    process.exit(0);
    return;
  }
  process.exit(code ?? 0);
});
