import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import log from 'electron-log';
import electronUpdaterPkg from 'electron-updater';
import store from './store.js';
import { deriveKey, encrypt, decrypt, generateSalt } from './crypto.js';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import { LaunchStateMachine } from './launchStateMachine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { autoUpdater } = electronUpdaterPkg;

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let masterKey: Buffer | null = null;
let shutdownRequested = false;
const automationPidsByAccount = new Map<string, Set<number>>();
const launchStateMachine = new LaunchStateMachine();

const SAFE_STORAGE_PREFIX = 'safe:';
const STEAM_GW2_APP_ID = '1284210';
const WINDOWS_AUTOMATION_SCRIPT_VERSION = 'win-autologin-v3';
const WINDOWS_PROCESS_SNAPSHOT_TTL_MS = 1500;
let windowsProcessSnapshotCache: { timestamp: number; processes: any[] } = { timestamp: 0, processes: [] };

function encryptForStorage(key: Buffer): string {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key.toString('hex'));
    return SAFE_STORAGE_PREFIX + encrypted.toString('base64');
  }
  log.warn('safeStorage encryption not available — falling back to plaintext key cache');
  return key.toString('hex');
}

function decryptFromStorage(stored: string): Buffer | null {
  try {
    if (stored.startsWith(SAFE_STORAGE_PREFIX)) {
      const encrypted = Buffer.from(stored.slice(SAFE_STORAGE_PREFIX.length), 'base64');
      const hex = safeStorage.decryptString(encrypted);
      return Buffer.from(hex, 'hex');
    }
    // Legacy plaintext hex — read as-is
    return Buffer.from(stored, 'hex');
  } catch {
    return null;
  }
}
let persistWindowStateTimer: NodeJS.Timeout | null = null;
let autoUpdateEnabled = false;
const isDevFakeUpdate = process.env.GW2AM_DEV_FAKE_UPDATE === '1';
const isDevFakeWhatsNew = process.env.GW2AM_DEV_FAKE_WHATS_NEW === '1' || isDevFakeUpdate;
const isDevShowcase = process.env.GW2AM_DEV_SHOWCASE === '1';
let fakeUpdateTimer: NodeJS.Timeout | null = null;
const showcaseActiveAccounts = new Set<string>(['showcase-a']);
const showcaseAccounts = [
  {
    id: 'showcase-a',
    nickname: 'WvW Main',
    email: 'wvw.main@example.com',
    passwordEncrypted: '',
    launchArguments: '-windowed -mapLoadinfo -fps 60',
    apiKey: 'showcase-key-1',
    apiAccountName: 'DarkHarasho.1234',
    apiCreatedAt: '2018-03-12T10:05:00Z',
  },
  {
    id: 'showcase-b',
    nickname: 'PvE Alt',
    email: 'pve.alt@example.com',
    passwordEncrypted: '',
    launchArguments: '-dx11 -windowed',
    apiKey: 'showcase-key-2',
    apiAccountName: 'LightHerald.5678',
    apiCreatedAt: '2021-07-04T13:22:00Z',
  },
  {
    id: 'showcase-c',
    nickname: 'Raid Support',
    email: 'raid.support@example.com',
    passwordEncrypted: '',
    launchArguments: '-windowed -shareArchive',
    apiKey: 'showcase-key-3',
    apiAccountName: 'QuickBoon.9012',
    apiCreatedAt: '2019-11-21T18:44:00Z',
  },
] as const;

log.transports.file.level = 'info';
if (app.isPackaged) {
  // AppImage can run without an attached terminal; avoid writing logs to broken stdio pipes.
  log.transports.console.level = false;
}
autoUpdater.logger = log;

process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

function logMain(scope: string, message: string): void {
  console.log(`[GW2AM][Main][${scope}] ${message}`);
}

function logMainWarn(scope: string, message: string): void {
  console.warn(`[GW2AM][Main][${scope}] ${message}`);
}

function logMainError(scope: string, message: string): void {
  console.error(`[GW2AM][Main][${scope}] ${message}`);
}



/** Capture mouse position relative to the window under the cursor (uses WINDOW from getmouselocation). */








type StoredWindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
};

function getStoredWindowState(): StoredWindowState {
  const raw = (store.get('windowState') as Partial<StoredWindowState> | undefined) || {};
  const width = Number.isFinite(raw.width) && (raw.width as number) > 200 ? Number(raw.width) : 400;
  const height = Number.isFinite(raw.height) && (raw.height as number) > 200 ? Number(raw.height) : 600;
  const x = Number.isFinite(raw.x) ? Number(raw.x) : undefined;
  const y = Number.isFinite(raw.y) ? Number(raw.y) : undefined;
  const isMaximized = Boolean(raw.isMaximized);
  return { x, y, width, height, isMaximized };
}

function persistWindowState(immediate = false): void {
  if (!mainWindow) return;

  const writeState = () => {
    if (!mainWindow) return;
    const normalBounds = mainWindow.getNormalBounds();
    const nextState: StoredWindowState = {
      x: normalBounds.x,
      y: normalBounds.y,
      width: normalBounds.width,
      height: normalBounds.height,
      isMaximized: mainWindow.isMaximized(),
    };
    store.set('windowState', nextState);
  };

  if (immediate) {
    if (persistWindowStateTimer) {
      clearTimeout(persistWindowStateTimer);
      persistWindowStateTimer = null;
    }
    writeState();
    return;
  }

  if (persistWindowStateTimer) {
    clearTimeout(persistWindowStateTimer);
  }
  persistWindowStateTimer = setTimeout(() => {
    persistWindowStateTimer = null;
    writeState();
  }, 250);
}

function stopAutomationPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
      return;
    }
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore
  }
}

function trackAutomationProcess(accountId: string, pid?: number): void {
  if (!accountId || !pid || !Number.isInteger(pid) || pid <= 0) return;
  const current = automationPidsByAccount.get(accountId) ?? new Set<number>();
  current.add(pid);
  automationPidsByAccount.set(accountId, current);
}

function stopAccountAutomation(accountId: string, reason = 'unspecified'): boolean {
  const pids = automationPidsByAccount.get(accountId);
  if (!pids || pids.size === 0) {
    logMain('automation', `No tracked automation pids to stop for account=${accountId} reason=${reason}`);
    return false;
  }
  logMain('automation', `Stopping automation for account=${accountId} reason=${reason} pids=${Array.from(pids).join(',')}`);
  pids.forEach((pid) => stopAutomationPid(pid));
  automationPidsByAccount.delete(accountId);
  return true;
}

function stopAllAutomation(): void {
  automationPidsByAccount.forEach((pids) => {
    logMain('automation', `Stopping automation for all accounts pids=${Array.from(pids).join(',')}`);
    pids.forEach((pid) => stopAutomationPid(pid));
  });
  automationPidsByAccount.clear();
}

function requestAppShutdown(source: string): void {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.log(`Shutdown requested via ${source}`);
  stopAllAutomation();
  try {
    app.quit();
  } catch {
    // Ignore and rely on forced exit fallback below.
  }
  setTimeout(() => {
    app.exit(0);
  }, 1200);
}

function sendUpdaterEvent(channel: string, payload?: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function setupAutoUpdater(): void {
  autoUpdater.on('checking-for-update', () => {
    log.info('[AutoUpdater] Checking for update...');
    sendUpdaterEvent('update-message', 'Checking for update...');
  });
  autoUpdater.on('update-available', (info) => {
    log.info('[AutoUpdater] Update available', info);
    sendUpdaterEvent('update-available', info);
  });
  autoUpdater.on('update-not-available', (info) => {
    log.info('[AutoUpdater] Update not available', info);
    sendUpdaterEvent('update-not-available', info);
  });
  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[AutoUpdater] Error: ${message}`);
    sendUpdaterEvent('update-error', { message });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendUpdaterEvent('download-progress', progress);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[AutoUpdater] Update downloaded', info);
    sendUpdaterEvent('update-downloaded', info);
  });
}

async function checkForUpdates(reason: 'startup' | 'manual'): Promise<void> {
  if (isDevFakeUpdate) {
    if (fakeUpdateTimer) {
      clearTimeout(fakeUpdateTimer);
      fakeUpdateTimer = null;
    }
    sendUpdaterEvent('update-message', `Checking for update (${reason})...`);
    fakeUpdateTimer = setTimeout(() => {
      sendUpdaterEvent('update-available', { version: `${app.getVersion()}+fake` });
      let percent = 0;
      const interval = setInterval(() => {
        percent = Math.min(100, percent + 20);
        sendUpdaterEvent('download-progress', {
          percent,
          bytesPerSecond: 1500000,
          transferred: Math.floor(percent * 1024 * 1024),
          total: 100 * 1024 * 1024,
        });
        if (percent >= 100) {
          clearInterval(interval);
          sendUpdaterEvent('update-downloaded', { version: `${app.getVersion()}+fake` });
        }
      }, 350);
    }, 900);
    return;
  }

  if (!autoUpdateEnabled) {
    sendUpdaterEvent('update-error', { message: 'Auto-updates are unavailable for this build.' });
    return;
  }

  if (!app.isPackaged) {
    log.info(`[AutoUpdater] Skipping ${reason} update check in development mode.`);
    sendUpdaterEvent('update-not-available', { version: app.getVersion() });
    return;
  }

  try {
    await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Update check timed out after 30s')), 30000)),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`[AutoUpdater] ${reason} update check failed: ${message}`);
    sendUpdaterEvent('update-error', { message });
  }
}

process.on('SIGINT', () => requestAppShutdown('SIGINT'));
process.on('SIGTERM', () => requestAppShutdown('SIGTERM'));

function splitLaunchArguments(launchArguments?: string): string[] {
  if (!launchArguments) return [];
  const matches = launchArguments.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!matches) return [];
  return matches.map((arg) => arg.replace(/^['"]|['"]$/g, ''));
}

function getAccountMumbleName(accountId: string): string {
  return `gw2am_${accountId.replace(/-/g, '').toLowerCase()}`;
}

function stripManagedLaunchArguments(args: string[]): string[] {
  const valueTakingFlags = new Set(['--mumble', '-mumble', '-email', '--email', '-password', '--password', '-provider', '--provider']);
  const standaloneFlags = new Set(['-autologin', '--autologin']);
  const cleaned: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const lowerArg = arg.toLowerCase();

    if (valueTakingFlags.has(lowerArg)) {
      i += 1;
      continue;
    }

    if (
      lowerArg.startsWith('--mumble=') ||
      lowerArg.startsWith('-mumble=') ||
      lowerArg.startsWith('--email=') ||
      lowerArg.startsWith('-email=') ||
      lowerArg.startsWith('--password=') ||
      lowerArg.startsWith('-password=') ||
      lowerArg.startsWith('--provider=') ||
      lowerArg.startsWith('-provider=')
    ) {
      continue;
    }

    if (standaloneFlags.has(lowerArg)) {
      continue;
    }
    cleaned.push(arg);
  }
  return cleaned;
}

function extractMumbleNameFromCommandLine(commandLine: string): string | null {
  const match = commandLine.match(/(?:^|\s)(?:--mumble|-mumble)(?:=|\s+)("([^"]+)"|'([^']+)'|([^\s"']+))/i);
  if (!match) return null;
  return match[2] || match[3] || match[4] || null;
}

function getWindowsProcessSnapshot(): any[] {
  if (process.platform !== 'win32') return [];
  const now = Date.now();
  if (now - windowsProcessSnapshotCache.timestamp < WINDOWS_PROCESS_SNAPSHOT_TTL_MS) {
    return windowsProcessSnapshotCache.processes;
  }

  const query = 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    return windowsProcessSnapshotCache.processes;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const processes = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    windowsProcessSnapshotCache = { timestamp: now, processes };
    return processes;
  } catch {
    return windowsProcessSnapshotCache.processes;
  }
}

function launchViaSteam(args: string[]): void {
  if (process.platform === 'linux') {
    const child = spawn('steam', ['-applaunch', STEAM_GW2_APP_ID, ...args], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  if (process.platform === 'win32') {
    const encodedArgs = encodeURIComponent(args.join(' '));
    const steamUri = `steam://rungameid/${STEAM_GW2_APP_ID}//${encodedArgs}`;
    const child = spawn('cmd.exe', ['/c', 'start', '""', steamUri], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }

  // Fallback for other platforms with desktop integration.
  const encodedArgs = encodeURIComponent(args.join(' '));
  const steamUri = `steam://rungameid/${STEAM_GW2_APP_ID}//${encodedArgs}`;
  const child = spawn('xdg-open', [steamUri], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function waitForAccountProcess(accountId: string, timeoutMs = 25000): Promise<boolean> {
  const startedAt = Date.now();
  const pollIntervalMs = process.platform === 'win32' ? 1200 : 500;
  while (Date.now() - startedAt < timeoutMs) {
    const active = getActiveAccountProcesses();
    if (active.some((processInfo) => processInfo.accountId === accountId)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

function getGw2ProcessNames(): string[] {
  const settings = store.get('settings') as { gw2Path?: string } | undefined;
  const names = new Set<string>(['Gw2-64.exe', 'Gw2.exe', 'Gw2-64']);
  const configuredPath = settings?.gw2Path?.trim();
  if (configuredPath) {
    names.add(path.basename(configuredPath));
  }
  return Array.from(names);
}

function getGw2CommandRegex(): RegExp {
  const settings = store.get('settings') as { gw2Path?: string } | undefined;
  const configuredName = settings?.gw2Path ? path.basename(settings.gw2Path) : '';
  const escapedConfiguredName = configuredName
    ? configuredName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : '';

  return escapedConfiguredName
    ? new RegExp(`(?:^|[\\/\\s])(?:gw2-64(?:\\.exe)?|gw2(?:\\.exe)?|${escapedConfiguredName})(?:\\s|$)`, 'i')
    : /(?:^|[\/\s])(?:gw2-64(?:\.exe)?|gw2(?:\.exe)?)(?:\s|$)/i;
}

function getAccountMumblePids(accountId: string): number[] {
  const mumbleName = getAccountMumbleName(accountId);
  const found = new Set<number>();

  if (process.platform === 'win32') {
    const processes = getWindowsProcessSnapshot();
    for (const processInfo of processes) {
      const pid = Number(processInfo?.ProcessId);
      const commandLine = String(processInfo?.CommandLine || '');
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      if (extractMumbleNameFromCommandLine(commandLine) !== mumbleName) continue;
      found.add(pid);
    }
    return Array.from(found);
  }

  const psResult = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  if (psResult.status !== 0 || !psResult.stdout) return [];

  const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = match[2];
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (extractMumbleNameFromCommandLine(args) !== mumbleName) continue;
    found.add(pid);
  }
  return Array.from(found);
}

function getDescendantPids(rootPid: number): number[] {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
  const psResult = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
  if (psResult.status !== 0 || !psResult.stdout) return [];

  const childrenByParent = new Map<number, number[]>();
  const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0 || ppid <= 0) continue;
    const list = childrenByParent.get(ppid) ?? [];
    list.push(pid);
    childrenByParent.set(ppid, list);
  }

  const found = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    const children = childrenByParent.get(current) ?? [];
    for (const child of children) {
      if (found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }

  return Array.from(found);
}

function getActiveAccountProcesses(): Array<{ accountId: string; pid: number; mumbleName: string }> {
  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const mumbleToAccountId = new Map<string, string>();
  for (const account of accounts) {
    mumbleToAccountId.set(getAccountMumbleName(account.id), account.id);
  }
  if (mumbleToAccountId.size === 0) return [];

  const names = getGw2ProcessNames().map((name) => name.toLowerCase());
  const foundByAccount = new Map<string, { accountId: string; pid: number; mumbleName: string }>();

  if (process.platform === 'win32') {
    const processes = getWindowsProcessSnapshot();

    for (const processInfo of processes) {
      const imageName = String(processInfo?.Name || '').toLowerCase();
      if (!imageName || !names.includes(imageName)) continue;
      const pid = Number(processInfo?.ProcessId);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const commandLine = String(processInfo?.CommandLine || '');
      const mumbleName = extractMumbleNameFromCommandLine(commandLine);
      if (!mumbleName) continue;
      const accountId = mumbleToAccountId.get(mumbleName);
      if (!accountId) continue;
      if (!foundByAccount.has(accountId)) {
        foundByAccount.set(accountId, { accountId, pid, mumbleName });
      }
    }
    return Array.from(foundByAccount.values());
  }

  const psResult = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  if (psResult.status !== 0 || !psResult.stdout) return Array.from(foundByAccount.values());

  const gw2Regex = getGw2CommandRegex();

  const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = match[2];
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (!gw2Regex.test(args)) continue;
    const mumbleName = extractMumbleNameFromCommandLine(args);
    if (!mumbleName) continue;
    const accountId = mumbleToAccountId.get(mumbleName);
    if (!accountId) continue;
    if (!foundByAccount.has(accountId)) {
      foundByAccount.set(accountId, { accountId, pid, mumbleName });
    }
  }
  return Array.from(foundByAccount.values());
}

function getRunningGw2Pids(): number[] {
  return getActiveAccountProcesses().map((processInfo) => processInfo.pid);
}

function getAllRunningGw2Pids(): number[] {
  const names = new Set(getGw2ProcessNames().map((name) => name.toLowerCase()));
  const gw2Regex = getGw2CommandRegex();
  const broadGw2Regex = /(gw2-64(?:\.exe)?|gw2(?:\.exe)?|guild wars 2)/i;
  const wineProcessRegex = /\b(wine|wine64|wine64-preloader|proton|wineserver)\b/i;
  const found = new Set<number>();

  if (process.platform === 'win32') {
    const processes = getWindowsProcessSnapshot();
    for (const processInfo of processes) {
      const imageName = String(processInfo?.Name || '').toLowerCase();
      const commandLine = String(processInfo?.CommandLine || '');
      const matchesCommand = gw2Regex.test(commandLine);
      if (!matchesCommand && !names.has(imageName)) continue;
      const pid = Number(processInfo?.ProcessId);
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      found.add(pid);
    }
    return Array.from(found);
  }

  const psResult = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  if (psResult.status !== 0 || !psResult.stdout) return [];

  const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = String(match[2] || '');
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    const directMatch = gw2Regex.test(args);
    const wineBroadMatch = wineProcessRegex.test(args) && broadGw2Regex.test(args);
    if (!directMatch && !wineBroadMatch) continue;
    found.add(pid);
  }
  return Array.from(found);
}

function terminatePid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
      return result.status === 0;
    }
    process.kill(pid, 'SIGTERM');
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already exited or no permission.
    }
    return true;
  } catch {
    return false;
  }
}

function terminatePidTree(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === 'win32') return terminatePid(pid);

  const descendants = getDescendantPids(pid);
  const ordered = [...descendants, pid];

  let terminatedAny = false;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (terminatePid(ordered[i])) {
      terminatedAny = true;
    }
  }
  return terminatedAny;
}

function stopRunningGw2Processes(): boolean {
  const pids = getAllRunningGw2Pids();
  if (pids.length === 0) return false;

  let stoppedAny = false;
  for (const pid of pids) {
    if (terminatePid(pid)) stoppedAny = true;
  }
  return stoppedAny;
}

function stopAccountProcess(accountId: string): boolean {
  launchStateMachine.setState(accountId, 'stopping', 'verified', 'Stop requested');
  stopAccountAutomation(accountId, 'stop-account-process');
  const mappedPids = getActiveAccountProcesses()
    .filter((processInfo) => processInfo.accountId === accountId)
    .map((processInfo) => processInfo.pid);
  const mumblePids = getAccountMumblePids(accountId);
  const targetPids = Array.from(new Set([...mappedPids, ...mumblePids]));

  if (targetPids.length > 0) {
    logMain('stop', `Account=${accountId} target pids=${targetPids.join(',')}`);
    let stoppedAny = false;
    for (const pid of targetPids) {
      if (terminatePidTree(pid)) stoppedAny = true;
    }
    const remaining = getAccountMumblePids(accountId);
    if (stoppedAny && remaining.length === 0) {
      launchStateMachine.setState(accountId, 'stopped', 'verified', `Killed account-bound PIDs: ${targetPids.join(', ')}`);
      return true;
    }
  }

  const running = getAllRunningGw2Pids();
  logMain('stop', `Account=${accountId} fallback running pids=${running.join(',')}`);
  if (running.length === 0) {
    launchStateMachine.setState(accountId, 'stopped', 'inferred', 'No running GW2 process found');
    return true;
  }
  let stoppedAny = false;
  for (const pid of running) {
    if (terminatePidTree(pid)) stoppedAny = true;
  }
  if (stoppedAny) {
    launchStateMachine.setState(accountId, 'stopped', 'verified', `Stopped via fallback PID kill (${running.join(', ')})`);
    return true;
  }
  launchStateMachine.setState(accountId, 'errored', 'verified', 'Stop failed: account process could not be identified');
  return false;
}

function shouldPromptMasterPassword(): boolean {
  const settings = store.get('settings') as { masterPasswordPrompt?: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never' } | undefined;
  const mode = settings?.masterPasswordPrompt ?? 'every_time';

  if (!masterKey && mode === 'never') {
    const cachedValue = String(store.get('security_v2.cachedMasterKey') || '');
    if (cachedValue) {
      const restored = decryptFromStorage(cachedValue);
      if (restored && restored.length > 0) {
        masterKey = restored;
        return false;
      }
    }
  }

  // Without an in-memory key, account operations requiring decryption cannot proceed.
  if (!masterKey) return true;

  // If we have a masterKey in memory, the user is already authenticated in this session.
  // For 'never' and 'every_time' modes, don't prompt again until app restart.
  if (mode === 'never' || mode === 'every_time') return false;

  const lastUnlockAt = Number(store.get('security_v2.lastUnlockAt') || 0);
  if (!Number.isFinite(lastUnlockAt) || lastUnlockAt <= 0) return true;

  const now = Date.now();
  const elapsed = now - lastUnlockAt;
  const intervals: Record<'daily' | 'weekly' | 'monthly', number> = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  };

  if (mode in intervals) {
    return elapsed >= intervals[mode as 'daily' | 'weekly' | 'monthly'];
  }
  return true;
}

function startWindowsCredentialAutomation(
  accountId: string,
  pid: number,
  email: string,
  password: string,
  _playClickXPercent?: number,
  _playClickYPercent?: number,
): void {
  if (process.platform !== 'win32') return;
  logMain('automation', `Windows automation start account=${accountId} pid=${pid} emailLen=${email.length} script=${WINDOWS_AUTOMATION_SCRIPT_VERSION}`);

  const automationScript = `
$ProgressPreference = 'SilentlyContinue'
$wshell = New-Object -ComObject WScript.Shell
$pidValue = [int]$env:GW2_PID
$emailValue = $env:GW2_EMAIL
$passwordValue = $env:GW2_PASSWORD
$windowTitles = @('Guild Wars 2', 'Guild Wars2', 'ArenaNet')
$credentialAttemptCount = 0
$maxCredentialAttempts = 1
$emailSubmitted = $false
$passwordSubmitted = $false
$passwordSubmitAttempted = $false
$passwordFocusLocked = $false
$passwordTabNudgeUsed = $false
$emailSubmittedAt = [DateTime]::MinValue
$lastStageAdvanceAt = [DateTime]::MinValue
$resolvedWindowHandle = [IntPtr]::Zero
$credentialsSubmittedAt = [DateTime]::MinValue
$playAttemptCount = 0
$maxPlayAttempts = 3
$playAttemptIntervalMs = 4000
$lastPlayAttemptAt = [DateTime]::MinValue

function Log-Automation([string]$message) {
  Write-Output "[gw2am-automation] $message"
}
Log-Automation "script-start pid=$pidValue version=${WINDOWS_AUTOMATION_SCRIPT_VERSION}"
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  Log-Automation "uia-load-failed"
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class GW2AMInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion U;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  public static IntPtr MakeLParam(int x, int y) {
    int packed = (y << 16) | (x & 0xFFFF);
    return (IntPtr)packed;
  }
  public static uint SendTab() {
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = 1u;
    inputs[0].U.ki.wVk = 0x09;
    inputs[0].U.ki.wScan = 0;
    inputs[0].U.ki.dwFlags = 0u;
    inputs[1].type = 1u;
    inputs[1].U.ki.wVk = 0x09;
    inputs[1].U.ki.wScan = 0;
    inputs[1].U.ki.dwFlags = 0x0002u;
    return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint SendShiftTab() {
    INPUT[] inputs = new INPUT[4];
    inputs[0].type = 1u; // SHIFT down
    inputs[0].U.ki.wVk = 0x10;
    inputs[1].type = 1u; // TAB down
    inputs[1].U.ki.wVk = 0x09;
    inputs[2].type = 1u; // TAB up
    inputs[2].U.ki.wVk = 0x09;
    inputs[2].U.ki.dwFlags = 0x0002u;
    inputs[3].type = 1u; // SHIFT up
    inputs[3].U.ki.wVk = 0x10;
    inputs[3].U.ki.dwFlags = 0x0002u;
    return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@

function Focus-GW2Window([int]$preferredPid, [string[]]$titles) {
  if ($preferredPid -gt 0 -and $wshell.AppActivate($preferredPid)) {
    Start-Sleep -Milliseconds 120
    return $true
  }
  foreach ($title in $titles) {
    if ($wshell.AppActivate($title)) {
      Start-Sleep -Milliseconds 120
      return $true
    }
  }
  return $false
}

function Is-UsableWindowHandle([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) {
    return $false
  }
  try {
    $rect = New-Object GW2AMInput+RECT
    return [GW2AMInput]::GetClientRect($handle, [ref]$rect)
  } catch {
    return $false
  }
}

function Find-LauncherHandleByTitle([string[]]$titles) {
  try {
    $processes = Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.MainWindowHandle -and $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle)
    }
    foreach ($title in $titles) {
      $match = $processes | Where-Object { $_.MainWindowTitle.IndexOf($title, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1
      if ($match -and $match.MainWindowHandle -and $match.MainWindowHandle -ne 0) {
        return [IntPtr]::new([int64]$match.MainWindowHandle)
      }
    }
    $fallback = $processes | Where-Object {
      $_.MainWindowTitle.IndexOf('Guild Wars', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $_.MainWindowTitle.IndexOf('ArenaNet', [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object -First 1
    if ($fallback -and $fallback.MainWindowHandle -and $fallback.MainWindowHandle -ne 0) {
      return [IntPtr]::new([int64]$fallback.MainWindowHandle)
    }
  } catch {}
  return [IntPtr]::Zero
}

function Get-MainWindowHandle([int]$preferredPid) {
  if (Is-UsableWindowHandle $resolvedWindowHandle) {
    return $resolvedWindowHandle
  }

  if ($preferredPid -le 0) {
    $preferredPid = 0
  }

  try {
    if ($preferredPid -gt 0) {
      $p = Get-Process -Id $preferredPid -ErrorAction SilentlyContinue
      if ($p -and $p.MainWindowHandle -and $p.MainWindowHandle -ne 0) {
        $h = [IntPtr]::new([int64]$p.MainWindowHandle)
        if (Is-UsableWindowHandle $h) {
          $script:resolvedWindowHandle = $h
          return $h
        }
      }
    }
  } catch {}

  $titleHandle = Find-LauncherHandleByTitle -titles $windowTitles
  if (Is-UsableWindowHandle $titleHandle) {
    $script:resolvedWindowHandle = $titleHandle
    return $titleHandle
  }

  $foregroundHandle = [GW2AMInput]::GetForegroundWindow()
  if (Is-UsableWindowHandle $foregroundHandle) {
    $script:resolvedWindowHandle = $foregroundHandle
    return $foregroundHandle
  }

  return [IntPtr]::Zero
}

function Click-LauncherBackground([int]$preferredPid) {
  $h = Get-MainWindowHandle -preferredPid $preferredPid
  if ($h -eq [IntPtr]::Zero) {
    Log-Automation "background-click-no-handle"
    return $false
  }
  $x = 24
  $y = 24
  try {
    $rect = New-Object GW2AMInput+RECT
    if ([GW2AMInput]::GetClientRect($h, [ref]$rect)) {
      $width = $rect.Right - $rect.Left
      $height = $rect.Bottom - $rect.Top
      if ($width -gt 40 -and $height -gt 40) {
        $x = [Math]::Max(20, [Math]::Min($width - 20, [int]($width * 0.8)))
        $y = [Math]::Max(20, [Math]::Min($height - 20, [int]($height * 0.5)))
      }
    }
  } catch {}

  $lp = [GW2AMInput]::MakeLParam($x, $y)
  [void][GW2AMInput]::SendMessage($h, 0x0201, [IntPtr]1, $lp) # WM_LBUTTONDOWN
  [void][GW2AMInput]::SendMessage($h, 0x0202, [IntPtr]0, $lp) # WM_LBUTTONUP
  Start-Sleep -Milliseconds 90
  return $true
}

function Send-KeyToWindow([int]$preferredPid, [int]$virtualKey) {
  $h = Get-MainWindowHandle -preferredPid $preferredPid
  if ($h -eq [IntPtr]::Zero) {
    return $false
  }
  $scanCode = [GW2AMInput]::MapVirtualKey([uint32]$virtualKey, 0)
  $lParamBase = [int64](($scanCode -shl 16) -bor 1)
  [void][GW2AMInput]::SendMessage($h, 0x0100, [IntPtr]$virtualKey, [IntPtr]$lParamBase) # WM_KEYDOWN
  [void][GW2AMInput]::SendMessage($h, 0x0101, [IntPtr]$virtualKey, [IntPtr]($lParamBase -bor 0xC0000000)) # WM_KEYUP
  Start-Sleep -Milliseconds 110
  return $true
}

function Send-TabCountToWindow([int]$preferredPid, [int]$count) {
  if ($count -lt 1) {
    return $false
  }
  $h = Get-MainWindowHandle -preferredPid $preferredPid
  if ($h -eq [IntPtr]::Zero) {
    return $false
  }
  $scanCode = [GW2AMInput]::MapVirtualKey([uint32]0x09, 0)
  $lParamBase = [int64](($scanCode -shl 16) -bor 1)
  for ($i = 0; $i -lt $count; $i++) {
    [void][GW2AMInput]::SendMessage($h, 0x0100, [IntPtr]0x09, [IntPtr]$lParamBase) # WM_KEYDOWN Tab
  }
  [void][GW2AMInput]::SendMessage($h, 0x0101, [IntPtr]0x09, [IntPtr]($lParamBase -bor 0xC0000000)) # WM_KEYUP Tab
  Start-Sleep -Milliseconds 110
  return $true
}

function Press-TabKey([int]$preferredPid) {
  $sentToWindow = Send-KeyToWindow -preferredPid $preferredPid -virtualKey 0x09
  if (-not $sentToWindow) {
    $sent = [GW2AMInput]::SendTab()
    if ($sent -lt 2) {
      $wshell.SendKeys('{TAB}')
    }
    Start-Sleep -Milliseconds 110
  }
}

function Press-EnterKey([int]$preferredPid) {
  if (-not (Send-KeyToWindow -preferredPid $preferredPid -virtualKey 0x0D)) {
    $wshell.SendKeys('{ENTER}')
    Start-Sleep -Milliseconds 110
  }
}

function Clear-FocusedInput() {
  # Keep this conservative and deterministic.
  $wshell.SendKeys('^a')
  Start-Sleep -Milliseconds 70
  $wshell.SendKeys('{DELETE}')
  Start-Sleep -Milliseconds 80
}

function Escape-SendKeys([string]$text) {
  $special = '+-^%~()[]{}'
  $sb = New-Object System.Text.StringBuilder
  foreach ($char in $text.ToCharArray()) {
    if ($special.Contains($char)) {
      [void]$sb.Append('{').Append($char).Append('}')
    } else {
      [void]$sb.Append($char)
    }
  }
  return $sb.ToString()
}

function Type-IntoFocusedInput([string]$text) {
  if ([string]::IsNullOrEmpty($text)) {
    return $false
  }
  $encoded = Escape-SendKeys $text
  if ([string]::IsNullOrEmpty($encoded)) {
    return $false
  }
  Start-Sleep -Milliseconds 80
  $wshell.SendKeys($encoded)
  Start-Sleep -Milliseconds 120
  return $true
}

function Set-ClipboardSafe([string]$text) {
  try {
    Set-Clipboard -Value $text
    # CEF/launcher can briefly lock clipboard paths; a short settle improves reliability.
    Start-Sleep -Milliseconds 180
    return $true
  } catch {
    return $false
  }
}

function Paste-IntoFocusedInput([string]$text) {
  if ([string]::IsNullOrEmpty($text)) {
    return $false
  }
  if (-not (Set-ClipboardSafe $text)) {
    return $false
  }
  $wshell.SendKeys('^v')
  Start-Sleep -Milliseconds 140
  return $true
}

function Read-FocusedInputText() {
  $marker = "__GW2AM_NO_COPY__$([Guid]::NewGuid().ToString('N'))"
  if (-not (Set-ClipboardSafe $marker)) {
    Log-Automation 'clipboard-seed-failed'
    return ''
  }
  try {
    $wshell.SendKeys('^a')
    Start-Sleep -Milliseconds 80
    $wshell.SendKeys('^c')
    Start-Sleep -Milliseconds 120
    $text = [string](Get-Clipboard -Raw)
    if ($text -eq $marker) {
      return '__GW2AM_NO_COPY__'
    }
    return $text
  } catch {
    return ''
  }
}

function Test-LooksLikeEmailField([string]$probeText, [string]$emailText) {
  if ([string]::IsNullOrEmpty($probeText) -or $probeText -eq '__GW2AM_NO_COPY__') {
    return $false
  }
  $probe = $probeText.Trim().ToLowerInvariant()
  $expected = $emailText.Trim().ToLowerInvariant()
  if ([string]::IsNullOrEmpty($probe)) {
    return $false
  }
  return ($probe -eq $expected) -or ($probe -like '*@*')
}

function Focus-ByTabCount([int]$preferredPid, [int]$tabCount) {
  if (-not (Focus-GW2Window -preferredPid $preferredPid -titles $windowTitles)) {
    return $false
  }
  $clicked = Click-LauncherBackground -preferredPid $preferredPid
  if (-not $clicked) {
    Log-Automation "background-click-fallback tabs=$tabCount"
  }
  if (-not (Send-TabCountToWindow -preferredPid $preferredPid -count $tabCount)) {
    for ($n = 0; $n -lt $tabCount; $n++) {
      Press-TabKey -preferredPid $preferredPid
    }
  }
  Start-Sleep -Milliseconds 90
  return $true
}

function Detect-EmailTabCount([int]$preferredPid, [string]$emailText) {
  $detectStart = Get-Date
  foreach ($tabs in @(1, 14, 2, 6)) {
    if (((Get-Date) - $detectStart).TotalMilliseconds -gt 3000) {
      Log-Automation "email-focus-detect-timeout"
      break
    }
    if (-not (Focus-ByTabCount -preferredPid $preferredPid -tabCount $tabs)) {
      Log-Automation "email-focus-candidate tabs=$tabs unavailable"
      continue
    }
    $probe = Read-FocusedInputText
    $looksEmail = Test-LooksLikeEmailField -probeText $probe -emailText $emailText
    $probeLen = if ($probe -eq '__GW2AM_NO_COPY__') { -1 } else { $probe.Length }
    Log-Automation "email-focus-candidate tabs=$tabs probeLen=$probeLen looksEmail=$looksEmail"
    if ($looksEmail) {
      return $tabs
    }
  }
  return -1
}

function Try-FocusPasswordFromCurrentField([int]$preferredPid, [string]$emailText) {
  if (-not (Focus-GW2Window -preferredPid $preferredPid -titles $windowTitles)) {
    return $false
  }
  Press-TabKey -preferredPid $preferredPid
  Start-Sleep -Milliseconds 90
  $probe = Read-FocusedInputText
  $probeUsable = $probe -ne '__GW2AM_NO_COPY__'
  $looksEmail = Test-LooksLikeEmailField -probeText $probe -emailText $emailText
  $probeLen = if ($probe -eq '__GW2AM_NO_COPY__') { -1 } else { $probe.Length }
  Log-Automation "password-focus-direct-tab probeLen=$probeLen looksEmail=$looksEmail usable=$probeUsable"
  return ($probeUsable -and -not $looksEmail)
}

function Focus-PasswordFromEmailAnchor([int]$preferredPid, [int]$emailTabs, [string]$emailText) {
  if ($emailTabs -lt 1) {
    return $false
  }
  if (-not (Focus-ByTabCount -preferredPid $preferredPid -tabCount $emailTabs)) {
    return $false
  }

  $emailProbe = Read-FocusedInputText
  $emailProbeUsable = $emailProbe -ne '__GW2AM_NO_COPY__'
  $emailLooksRight = Test-LooksLikeEmailField -probeText $emailProbe -emailText $emailText
  $emailProbeLen = if ($emailProbe -eq '__GW2AM_NO_COPY__') { -1 } else { $emailProbe.Length }
  if (-not $emailProbeUsable -or -not $emailLooksRight) {
    Log-Automation "email-anchor-miss tabs=$emailTabs probeLen=$emailProbeLen usable=$emailProbeUsable"
    return $false
  }

  Press-TabKey -preferredPid $preferredPid
  Start-Sleep -Milliseconds 90
  $passwordProbe = Read-FocusedInputText
  $passwordProbeUsable = $passwordProbe -ne '__GW2AM_NO_COPY__'
  $passwordLooksEmail = Test-LooksLikeEmailField -probeText $passwordProbe -emailText $emailText
  $passwordProbeLen = if ($passwordProbe -eq '__GW2AM_NO_COPY__') { -1 } else { $passwordProbe.Length }
  Log-Automation "password-focus-probe emailTabs=$emailTabs probeLen=$passwordProbeLen looksEmail=$passwordLooksEmail usable=$passwordProbeUsable"
  if (-not $passwordProbeUsable) {
    return $false
  }
  return (-not $passwordLooksEmail)
}

function Type-IntoWindowViaPostMessage([int]$preferredPid, [string]$text) {
  if ([string]::IsNullOrEmpty($text)) {
    return $false
  }
  $h = Get-MainWindowHandle -preferredPid $preferredPid
  if ($h -eq [IntPtr]::Zero) {
    return $false
  }
  foreach ($char in $text.ToCharArray()) {
    [void][GW2AMInput]::PostMessage($h, 0x0102, [IntPtr]([int][char]$char), [IntPtr]0) # WM_CHAR
  }
  Start-Sleep -Milliseconds 140
  return $true
}

function Try-FocusPasswordViaUIA([int]$preferredPid) {
  try {
    if ($preferredPid -le 0) { return $false }
    $p = Get-Process -Id $preferredPid -ErrorAction SilentlyContinue
    if (-not $p -or -not $p.MainWindowHandle -or $p.MainWindowHandle -eq 0) { return $false }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([int64]$p.MainWindowHandle))
    if (-not $root) { return $false }

    $editCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
    $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
    if (-not $edits -or $edits.Count -eq 0) { return $false }

    for ($idx = 0; $idx -lt $edits.Count; $idx++) {
      $edit = $edits.Item($idx)
      $isPassword = $false
      try { $isPassword = [bool]$edit.Current.IsPassword } catch {}
      if (-not $isPassword) { continue }
      try { $edit.SetFocus() } catch {}
      Start-Sleep -Milliseconds 100
      Log-Automation "uia-password-focus idx=$idx"
      return $true
    }
    return $false
  } catch {
    return $false
  }
}

function Try-SetPasswordViaUIA([int]$preferredPid, [string]$passwordText) {
  try {
    if ($preferredPid -le 0) { return $false }
    $p = Get-Process -Id $preferredPid -ErrorAction SilentlyContinue
    if (-not $p -or -not $p.MainWindowHandle -or $p.MainWindowHandle -eq 0) { return $false }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([int64]$p.MainWindowHandle))
    if (-not $root) { return $false }

    $editCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
    $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
    if (-not $edits -or $edits.Count -eq 0) { return $false }

    for ($idx = 0; $idx -lt $edits.Count; $idx++) {
      $edit = $edits.Item($idx)
      $isPassword = $false
      try { $isPassword = [bool]$edit.Current.IsPassword } catch {}
      if (-not $isPassword) { continue }

      $valuePatternObj = $null
      if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePatternObj)) {
        $valuePattern = [System.Windows.Automation.ValuePattern]$valuePatternObj
        $valuePattern.SetValue($passwordText)
        Log-Automation "uia-password-set idx=$idx"
        return $true
      }

      # Fallback: set focus then paste if ValuePattern is unavailable.
      try { $edit.SetFocus() } catch {}
      Start-Sleep -Milliseconds 100
      if (Paste-IntoFocusedInput $passwordText) {
        Log-Automation "uia-password-focus-paste idx=$idx"
        return $true
      }
    }
    return $false
  } catch {
    Log-Automation "uia-password-set-exception"
    return $false
  }
}

function Try-SetPasswordInFocusedField([string]$emailText, [string]$passwordText, [bool]$allowBlindOnNonCopyable = $false) {
  $probe = Read-FocusedInputText
  $probeUsable = $probe -ne '__GW2AM_NO_COPY__'
  $looksEmail = Test-LooksLikeEmailField -probeText $probe -emailText $emailText
  $probeLen = if ($probe -eq '__GW2AM_NO_COPY__') { -1 } else { $probe.Length }
  Log-Automation "focused-password-attempt probeLen=$probeLen looksEmail=$looksEmail usable=$probeUsable"

  # Never type if focus still appears to be in email.
  if ($looksEmail) {
    return $false
  }
  # Non-copyable alone is not enough unless focus was already positively locked.
  if (-not $probeUsable -and -not $allowBlindOnNonCopyable) {
    return $false
  }

  Clear-FocusedInput
  $passwordSet = Type-IntoFocusedInput $passwordText
  if (-not $passwordSet) {
    $passwordSet = Paste-IntoFocusedInput $passwordText
  }
  if ($passwordSet) {
    Log-Automation "focused-password-set"
  }
  return $passwordSet
}

for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep -Milliseconds 400
  $activated = Focus-GW2Window -preferredPid $pidValue -titles $windowTitles

  if ($activated) {
    Log-Automation "window-activated loop=$i"
    $now = Get-Date

    if ($credentialAttemptCount -lt $maxCredentialAttempts) {
      $activatedAfterWait = Focus-GW2Window -preferredPid $pidValue -titles $windowTitles
      if (-not $activatedAfterWait) {
        Log-Automation "activation-lost-before-credentials loop=$i"
        continue
      }

      if (-not $emailSubmitted) {
        # On Windows the email field is typically ready early.
        Start-Sleep -Milliseconds 600
        Clear-FocusedInput
        $emailSet = (Type-IntoFocusedInput $emailValue)
        if (-not $emailSet) {
          $emailSet = (Paste-IntoFocusedInput $emailValue)
        }
        if (-not $emailSet) {
          Log-Automation "email-entry-failed loop=$i"
          continue
        }
        Start-Sleep -Milliseconds 80
        Press-EnterKey -preferredPid $pidValue
        $emailSubmitted = $true
        $passwordSubmitAttempted = $false
        $passwordFocusLocked = $false
        $passwordTabNudgeUsed = $false
        $emailSubmittedAt = Get-Date
        Log-Automation "email-submitted loop=$i"
        continue
      }

      if (-not $passwordSubmitted) {
        # Wait for launcher transition from email stage to password stage.
        $elapsedMs = [int](($now - $emailSubmittedAt).TotalMilliseconds)
        if ($elapsedMs -lt 900) {
          Log-Automation "waiting-password-stage loop=$i elapsedMs=$([int](($now - $emailSubmittedAt).TotalMilliseconds))"
          continue
        }
        if ($passwordSubmitAttempted) {
          continue
        }
        $passwordSubmitAttempted = $true

        # Single intentional tab transition from email -> password.
        if (-not $passwordTabNudgeUsed) {
          Press-TabKey -preferredPid $pidValue
          $passwordTabNudgeUsed = $true
          Log-Automation "password-tab-sent loop=$i"
          Start-Sleep -Milliseconds 80
        }

        $passwordSet = Try-SetPasswordInFocusedField -emailText $emailValue -passwordText $passwordValue -allowBlindOnNonCopyable $true
        if (-not $passwordSet) {
          $passwordSet = Try-SetPasswordViaUIA -preferredPid $pidValue -passwordText $passwordValue
        }
        if (-not $passwordSet) {
          Clear-FocusedInput
          $passwordSet = Type-IntoFocusedInput $passwordValue
        }
        Log-Automation "password-write-attempt loop=$i success=$passwordSet"
        Start-Sleep -Milliseconds 120
        Press-EnterKey -preferredPid $pidValue
        $passwordSubmitted = $true
        $credentialAttemptCount++
        $credentialsSubmittedAt = Get-Date
        Log-Automation "credentials-submitted attempt=$credentialAttemptCount mode=single-pass"
        continue
      }
    }

    # After credentials are submitted, login can take a few seconds before Play is available.
    if ($credentialAttemptCount -eq 0) {
      continue
    }
    if (($now - $credentialsSubmittedAt).TotalMilliseconds -lt 4500) {
      continue
    }

    if (($now - $lastPlayAttemptAt).TotalMilliseconds -lt $playAttemptIntervalMs) {
      continue
    }

    Press-EnterKey -preferredPid $pidValue
    $playAttemptCount++
    $lastPlayAttemptAt = $now
    Log-Automation "play-enter attempt=$playAttemptCount"

    if ($playAttemptCount -ge $maxPlayAttempts) {
      Log-Automation 'script-finished max-play-attempts reached'
      break
    }
  }
}
Log-Automation "script-finished timeout-or-loop-end credentialAttempts=$credentialAttemptCount playAttempts=$playAttemptCount"
`;

  try {
    const automationDir = path.join(app.getPath('temp'), 'gw2am-automation');
    fs.mkdirSync(automationDir, { recursive: true });
    const automationScriptPath = path.join(automationDir, `win-autologin-${accountId}-${Date.now()}.ps1`);
    fs.writeFileSync(automationScriptPath, automationScript, 'utf8');

    const automationProcess = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', automationScriptPath],
      {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GW2_PID: String(pid),
          GW2_EMAIL: email,
          GW2_PASSWORD: password,
        },
      },
    );
    automationProcess.stdout?.on('data', (buf) => {
      logMain('automation', `Windows automation stdout account=${accountId}: ${String(buf).trim()}`);
    });
    automationProcess.stderr?.on('data', (buf) => {
      logMainWarn('automation', `Windows automation stderr account=${accountId}: ${String(buf).trim()}`);
    });
    automationProcess.on('error', (error) => {
      logMainError('automation', `Windows automation error account=${accountId}: ${error.message}`);
    });
    automationProcess.on('exit', (code, signal) => {
      try {
        if (fs.existsSync(automationScriptPath)) {
          fs.unlinkSync(automationScriptPath);
        }
      } catch {
        // ignore temp cleanup failures
      }
      logMain('automation', `Windows automation exit account=${accountId}: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    });
    trackAutomationProcess(accountId, automationProcess.pid);
    logMain('automation', `Windows automation spawned account=${accountId} pid=${automationProcess.pid ?? 'unknown'}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMainError('automation', `Windows automation spawn setup failed account=${accountId}: ${message}`);
  }
}

function startLinuxCredentialAutomation(
  accountId: string,
  pid: number,
  email: string,
  password: string,
  bypassPortalPrompt = false,
): void {
  if (process.platform !== 'linux') return;
  logMain('automation', `Linux automation start account=${accountId} pid=${pid} emailLen=${email.length}`);

  const xdotoolCheck = spawnSync('which', ['xdotool'], { encoding: 'utf8' });
  if (xdotoolCheck.status !== 0) {
    logMainError('automation', 'Credential automation on Linux requires xdotool to be installed.');
    return;
  }

  const automationScript = `
log_automation() {
  printf '[gw2am-automation] %s\\n' "$1" >&2
}

log_automation "script-start pid=$GW2_PID"
credential_attempt_count=0
max_credential_attempts=1
credentials_submitted_epoch=0
play_click_not_before_epoch=0
play_attempt_count=0
max_play_attempts=1
last_play_attempt_epoch=0
seen_window=0
post_login_geometry_logged=0

is_blocking_prompt_visible() {
    if [ "\${GW2_BYPASS_PORTAL_PROMPT:-0}" = "1" ]; then
      return 1
    fi
    # Check for KDE's specific window title for XWayland/Wayland bridge permissions
    if xdotool search --onlyvisible --name "Legacy X11 App Support" 2>/dev/null >/dev/null; then
      return 0
    fi
    # Check for other potential portal/permission prompts
    if xdotool search --onlyvisible --name "Remote Desktop" 2>/dev/null >/dev/null; then
      return 0
    fi
     if xdotool search --onlyvisible --name "Input Capture" 2>/dev/null >/dev/null; then
      return 0
    fi
    return 1
  }

  find_launcher_window() {
    local id=""
    if [ -n "$GW2_PID" ] && [ "$GW2_PID" -gt 0 ] 2>/dev/null; then
      id="$(xdotool search --onlyvisible --pid "$GW2_PID" 2>/dev/null | head -n 1)"
    fi
    if [ -z "$id" ]; then
      id="$(xdotool search --onlyvisible --name 'Guild Wars 2' 2>/dev/null | head -n 1)"
    fi
    if [ -z "$id" ]; then
      id="$(xdotool search --onlyvisible --name 'Guild Wars' 2>/dev/null | head -n 1)"
    fi
    if [ -z "$id" ]; then
      id="$(xdotool search --onlyvisible --name 'ArenaNet' 2>/dev/null | head -n 1)"
    fi
    echo "$id"
  }

  clear_focused_input() {
    xdotool key --clearmodifiers --window "$win_id" ctrl+a
    sleep 0.08
    xdotool key --clearmodifiers --window "$win_id" Delete
    sleep 0.08
    xdotool key --clearmodifiers --window "$win_id" ctrl+a
    sleep 0.08
    xdotool key --clearmodifiers --window "$win_id" BackSpace
    sleep 0.08

    # Conservative fallback clear path.
    xdotool key --clearmodifiers --window "$win_id" End
    sleep 0.04
    for _ in $(seq 1 8); do
      xdotool key --clearmodifiers --window "$win_id" BackSpace
    done
    sleep 0.04
    xdotool key --clearmodifiers --window "$win_id" Home
    sleep 0.04
    for _ in $(seq 1 8); do
      xdotool key --clearmodifiers --window "$win_id" Delete
    done
    sleep 0.05
  }

  click_play_button() {
    local attempt="$1"
    local cx cy
    eval "$(xdotool getwindowgeometry --shell "$win_id" 2>/dev/null)" || return 1
    
    if [ -n "$HEIGHT" ] && [ "$HEIGHT" -gt 150 ] 2>/dev/null && [ -n "$WIDTH" ] && [ "$WIDTH" -gt 250 ] 2>/dev/null; then
      cx=$((WIDTH - 250))
      cy=$((HEIGHT - 250))
      xdotool mousemove --window "$win_id" "$cx" "$cy" click 1
      log_automation "play-click fixed-offset-v2 x=$cx y=$cy win_w=$WIDTH win_h=$HEIGHT"
      sleep 0.08
      return 0
    fi
    
    log_automation "play-click broken (geometry invalid) win_w=$WIDTH win_h=$HEIGHT attempt=$attempt"
    return 1
  }

  for i in $(seq 1 180); do
    sleep 0.4

    if is_blocking_prompt_visible; then
      log_automation "waiting-for-blocking-prompt"
      sleep 1.0
      continue
    fi

    win_id="$(find_launcher_window)"

    if [ -n "$win_id" ] && [ "$win_id" -gt 0 ] 2>/dev/null; then
      if [ "$seen_window" -eq 0 ]; then
        log_automation "window-detected id=$win_id"
        if eval "$(xdotool getwindowgeometry --shell "$win_id" 2>/dev/null)"; then
          log_automation "window-geometry x=$X y=$Y width=$WIDTH height=$HEIGHT"
        fi
        seen_window=1
      fi
      now_epoch="$(date +%s)"

      xdotool windowraise "$win_id" 2>/dev/null || true
      xdotool windowactivate --sync "$win_id"
      xdotool windowfocus --sync "$win_id" 2>/dev/null || true
      active_id="$(xdotool getactivewindow 2>/dev/null || true)"
      if [ "$active_id" != "$win_id" ]; then
        continue
      fi

      if [ "$credential_attempt_count" -lt "$max_credential_attempts" ]; then
      # Single fixed wait so controls are writable; no retry/backoff typing loop.
      sleep 2
      active_id="$(xdotool getactivewindow 2>/dev/null || true)"
      if [ "$active_id" != "$win_id" ]; then
        continue
      fi

      # Keyboard-only credential flow tuned for launcher defaulting to password focus.
      xdotool key --clearmodifiers --window "$win_id" Shift+Tab
      sleep 0.08
      clear_focused_input
      log_automation "focus-email via single Shift+Tab and type"
      xdotool type --clearmodifiers --window "$win_id" --delay 1 "$GW2_EMAIL"
      sleep 0.12

      xdotool key --clearmodifiers --window "$win_id" Tab
      sleep 0.10
      clear_focused_input
      log_automation "focus-password via Tab and type"
      xdotool type --clearmodifiers --window "$win_id" --delay 1 "$GW2_PASSWORD"
      sleep 0.16
      xdotool key --clearmodifiers --window "$win_id" Return
      sleep 3

      credential_attempt_count=$((credential_attempt_count + 1))
      credentials_submitted_epoch="$(date +%s)"
      play_click_not_before_epoch=$((credentials_submitted_epoch + 3))
      log_automation "credentials-submitted attempt=$credential_attempt_count"
      continue
    fi

    if [ "$credential_attempt_count" -eq 0 ]; then
      continue
    fi
    if [ "$now_epoch" -lt "$play_click_not_before_epoch" ]; then
      continue
    fi

    if [ $((now_epoch - last_play_attempt_epoch)) -lt 4 ]; then
      continue
    fi

    if [ "$post_login_geometry_logged" -eq 0 ]; then
      if eval "$(xdotool getwindowgeometry --shell "$win_id" 2>/dev/null)"; then
        log_automation "post-login window-geometry x=$X y=$Y width=$WIDTH height=$HEIGHT"
      fi
      post_login_geometry_logged=1
    fi

    click_play_button "$play_attempt_count" || true
    play_attempt_count=$((play_attempt_count + 1))
    last_play_attempt_epoch="$now_epoch"
    log_automation "play-click attempt=$play_attempt_count"
    if [ "$play_attempt_count" -ge "$max_play_attempts" ]; then
      log_automation "script-finished max-play-attempts reached"
      exit 0
    fi
  fi
done
log_automation "script-finished timeout waiting for launcher interaction"
`;

  const automationProcess = spawn(
    '/bin/bash',
    ['-c', automationScript],
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GW2_PID: String(pid),
        GW2_EMAIL: email,
        GW2_PASSWORD: password,
        GW2_BYPASS_PORTAL_PROMPT: bypassPortalPrompt ? '1' : '0',
      },
    },
  );
  automationProcess.stdout?.on('data', (buf) => {
    logMain('automation', `Linux automation stdout account=${accountId}: ${String(buf).trim()}`);
  });
  automationProcess.stderr?.on('data', (buf) => {
    const output = String(buf).trim();
    logMainWarn('automation', `Linux automation stderr account=${accountId}: ${output}`);
  });
  automationProcess.on('error', (error) => {
    logMainError('automation', `Linux automation error account=${accountId}: ${error.message}`);
  });
  automationProcess.on('exit', (code, signal) => {
    logMain('automation', `Linux automation exit account=${accountId}: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });
  trackAutomationProcess(accountId, automationProcess.pid);
  logMain('automation', `Linux automation spawned account=${accountId} pid=${automationProcess.pid ?? 'unknown'}`);
  automationProcess.unref();
}

function startCredentialAutomation(
  accountId: string,
  pid: number,
  email: string,
  password: string,
  bypassPortalPrompt = false,
): void {
  logMain('automation', `Dispatch account=${accountId} platform=${process.platform} pid=${pid}`);
  if (process.platform === 'win32') {
    startWindowsCredentialAutomation(accountId, pid, email, password);
    return;
  }
  if (process.platform === 'linux') {
    startLinuxCredentialAutomation(accountId, pid, email, password, bypassPortalPrompt);
    return;
  }
  console.error(`Credential automation is not implemented for platform: ${process.platform}`);
}

const createWindow = () => {
  const appIconPath = app.isPackaged
    ? path.join(__dirname, '../dist/img/GW2AM-square.png')
    : path.join(process.cwd(), 'public/img/GW2AM-square.png');
  const storedWindowState = getStoredWindowState();

  mainWindow = new BrowserWindow({
    width: storedWindowState.width,
    height: storedWindowState.height,
    x: storedWindowState.x,
    y: storedWindowState.y,
    frame: false,
    icon: appIconPath,
    // titleBarStyle: 'hidden', 
    resizable: true, // Allow resize but keep default small
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    console.log("Loading URL:", process.env.VITE_DEV_SERVER_URL);
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // mainWindow.webContents.openDevTools();
  } else {
    console.log("Loading URL: dist/index.html (Production)");
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('resize', () => persistWindowState());
  mainWindow.on('move', () => persistWindowState());
  mainWindow.on('maximize', () => persistWindowState());
  mainWindow.on('unmaximize', () => persistWindowState());
  mainWindow.on('close', () => persistWindowState(true));

  if (storedWindowState.isMaximized) {
    mainWindow.maximize();
  }
};

app.on('ready', () => {
  console.log("User Data Path:", app.getPath('userData'));
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.gw2am.app');
  }
  createWindow();

  const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE);
  autoUpdateEnabled = app.isPackaged && !isPortable && fs.existsSync(updateConfigPath);
  if (!autoUpdateEnabled) {
    log.info('[AutoUpdater] Disabled: no app-update.yml, unpackaged app, or portable build.');
    if (isDevFakeUpdate) {
      log.info('[AutoUpdater] Dev fake updater mode enabled.');
      setTimeout(() => {
        void checkForUpdates('startup');
      }, 1800);
    }
  } else {
    setupAutoUpdater();
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    setTimeout(() => {
      void checkForUpdates('startup');
    }, 3000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAllAutomation();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Window Controls
ipcMain.on('minimize-window', () => {
  console.log('Main: minimize-window received');
  mainWindow?.minimize();
});
ipcMain.on('maximize-window', () => {
  console.log('Main: maximize-window received');
  if (mainWindow?.isMaximized()) mainWindow?.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('close-window', () => {
  console.log('Main: close-window received');
  mainWindow?.close();
});

ipcMain.on('reset-app', () => {
  store.clear();
  app.relaunch();
  app.exit();
});

ipcMain.on('check-for-updates', () => {
  void checkForUpdates('manual');
});

ipcMain.on('restart-app', () => {
  if (isDevFakeUpdate || !app.isPackaged) {
    app.relaunch();
    app.exit(0);
    return;
  }
  autoUpdater.quitAndInstall();
});

ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

ipcMain.handle('get-whats-new', async () => {
  const version = app.getVersion();
  if (isDevFakeWhatsNew) {
    return {
      version,
      releaseNotes: `# Release Notes\n\nVersion v${version}\n\n## 🌟 Highlights\n- Fake update mode is active for local UI testing.\n\n## 🛠️ Improvements\n- Added a simulated updater flow (checking, downloading, restart).\n\n## 🧯 Fixes\n- What\\'s New can now be previewed without publishing a GitHub release.\n\n## ⚠️ Breaking Changes\n- None.`,
    };
  }
  const tag = `v${version}`;
  const releaseUrl = `https://api.github.com/repos/darkharasho/GW2AM/releases/tags/${tag}`;

  try {
    const resp = await fetch(releaseUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GW2AM-Updater',
      },
    });
    if (resp.ok) {
      const data = await resp.json() as { body?: string };
      const body = String(data?.body || '').trim();
      if (body) {
        return { version, releaseNotes: body };
      }
    }
  } catch {
    // Fall back to local release notes if GitHub is unavailable.
  }

  try {
    const basePath = app.isPackaged ? process.resourcesPath : process.cwd();
    const notesPath = path.join(basePath, 'RELEASE_NOTES.md');
    const releaseNotes = fs.readFileSync(notesPath, 'utf8').trim();
    return { version, releaseNotes: releaseNotes || `Release notes unavailable for ${tag}.` };
  } catch {
    return { version, releaseNotes: `Release notes unavailable for ${tag}.` };
  }
});

ipcMain.handle('should-show-whats-new', async () => {
  const version = app.getVersion();
  if (isDevFakeWhatsNew) {
    return { version, shouldShow: true };
  }
  const lastSeenVersion = String(store.get('lastSeenVersion', '') || '');
  return { version, shouldShow: lastSeenVersion !== version };
});

ipcMain.handle('set-last-seen-version', async (_event, version: string) => {
  store.set('lastSeenVersion', String(version || '').trim());
  return true;
});

ipcMain.handle('open-external', async (_event, url: string) => {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) return false;
  try {
    await shell.openExternal(target);
    return true;
  } catch (error) {
    logMainWarn('external', `shell.openExternal failed for ${target}: ${error instanceof Error ? error.message : String(error)}`);
    if (process.platform === 'linux') {
      try {
        const child = spawn('xdg-open', [target], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return true;
      } catch (fallbackError) {
        logMainError('external', `xdg-open fallback failed for ${target}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
      }
    }
    return false;
  }
});

// Security & Account Management
ipcMain.handle('has-master-password', async () => {
  if (isDevShowcase) return true;
  return !!store.get('security_v2.salt');
});

ipcMain.handle('set-master-password', async (_, password) => {
  const salt = generateSalt();
  const key = deriveKey(password, Buffer.from(salt, 'hex'));
  const validationHash = crypto.createHash('sha256').update(key).digest('hex');

  store.set('security_v2.salt', salt);
  store.set('security_v2.validationHash', validationHash);
  store.set('security_v2.lastUnlockAt', Date.now());
  const settings = store.get('settings') as { masterPasswordPrompt?: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never' } | undefined;
  if ((settings?.masterPasswordPrompt ?? 'every_time') === 'never') {
    store.set('security_v2.cachedMasterKey', encryptForStorage(key));
  } else {
    store.set('security_v2.cachedMasterKey', '');
  }
  masterKey = key;
  return true;
});

ipcMain.handle('verify-master-password', async (_, password) => {
  if (isDevShowcase) return true;
  const salt = store.get('security_v2.salt');
  const storedHash = store.get('security_v2.validationHash');

  if (!salt || !storedHash) return false;

  // Cast salt to string because electron-store types might be inferred loosely
  const saltBuffer = Buffer.from(salt as string, 'hex');
  const key = deriveKey(password, saltBuffer);
  const hash = crypto.createHash('sha256').update(key).digest('hex');

  if (hash === storedHash) {
    masterKey = key;
    store.set('security_v2.lastUnlockAt', Date.now());
    const settings = store.get('settings') as { masterPasswordPrompt?: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never' } | undefined;
    if ((settings?.masterPasswordPrompt ?? 'every_time') === 'never') {
      store.set('security_v2.cachedMasterKey', encryptForStorage(key));
    } else {
      store.set('security_v2.cachedMasterKey', '');
    }
    return true;
  }
  return false;
});

ipcMain.handle('should-prompt-master-password', async () => {
  if (isDevShowcase) return false;
  return shouldPromptMasterPassword();
});

ipcMain.handle('save-account', async (_, accountData) => {
  if (!masterKey) throw new Error('Master key not set');
  const rawPassword = accountData.passwordEncrypted;
  const encryptedPassword = encrypt(rawPassword, masterKey);

  const id = crypto.randomUUID();
  const newAccount = {
    id,
    nickname: accountData.nickname,
    email: accountData.email,
    passwordEncrypted: encryptedPassword,
    launchArguments: accountData.launchArguments,
    playClickXPercent: Number.isFinite(accountData.playClickXPercent) ? Number(accountData.playClickXPercent) : undefined,
    playClickYPercent: Number.isFinite(accountData.playClickYPercent) ? Number(accountData.playClickYPercent) : undefined,
    apiKey: accountData.apiKey ?? '',
    apiAccountName: '',
    apiCreatedAt: '',
  };

  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  store.set('accounts', [...accounts, newAccount]);
  // Log stored account for diagnostics
  try {
    const saved = ((store.get('accounts') as any[]) || []).find((a: any) => a.id === id);
    logMain('automation', `Saved account id=${id} playClickX=${String(saved?.playClickXPercent)} playClickY=${String(saved?.playClickYPercent)}`);
  } catch (e) {
    logMainWarn('automation', `Unable to read back saved account for diagnostics: ${e instanceof Error ? e.message : String(e)}`);
  }
  return true;
});

ipcMain.handle('is-gw2-running', async () => {
  if (isDevShowcase) return showcaseActiveAccounts.size > 0;
  return getRunningGw2Pids().length > 0;
});

ipcMain.handle('stop-gw2-process', async () => {
  if (isDevShowcase) {
    showcaseActiveAccounts.clear();
    return true;
  }
  return stopRunningGw2Processes();
});

ipcMain.handle('get-active-account-processes', async () => {
  if (isDevShowcase) {
    return showcaseAccounts
      .filter((account) => showcaseActiveAccounts.has(account.id))
      .map((account, index) => ({
        accountId: account.id,
        pid: 41000 + index,
        mumbleName: getAccountMumbleName(account.id),
      }));
  }
  return getActiveAccountProcesses();
});

ipcMain.handle('get-launch-states', async () => {
  if (isDevShowcase) {
    return showcaseAccounts.map((account) => ({
      accountId: account.id,
      phase: showcaseActiveAccounts.has(account.id) ? 'running' : 'idle',
      certainty: 'verified' as const,
      updatedAt: Date.now(),
      note: showcaseActiveAccounts.has(account.id) ? 'Showcase running state' : 'Showcase idle state',
    }));
  }
  return launchStateMachine.getAllStates();
});



ipcMain.handle('stop-account-process', async (_, accountId) => {
  if (isDevShowcase) {
    showcaseActiveAccounts.delete(String(accountId));
    return true;
  }
  return stopAccountProcess(accountId);
});

ipcMain.handle('resolve-account-profile', async (_, apiKey) => {
  if (isDevShowcase) {
    const lookup = showcaseAccounts.find((account) => account.apiKey === String(apiKey || '').trim());
    return {
      name: lookup?.apiAccountName || 'ShowcaseAccount.0000',
      created: lookup?.apiCreatedAt || '2020-01-01T00:00:00Z',
    };
  }
  const token = String(apiKey || '').trim();
  if (!token) return { name: '', created: '' };
  try {
    const accountResponse = await fetch('https://api.guildwars2.com/v2/account', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!accountResponse.ok) return { name: '', created: '' };
    const accountData = await accountResponse.json() as { name?: string; created?: string };
    return {
      name: typeof accountData?.name === 'string' ? accountData.name.trim() : '',
      created: typeof accountData?.created === 'string' ? accountData.created.trim() : '',
    };
  } catch {
    return { name: '', created: '' };
  }
});

ipcMain.handle('set-account-api-profile', async (_, id, profile) => {
  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const index = accounts.findIndex((a: any) => a.id === id);
  if (index < 0) return false;
  accounts[index] = {
    ...accounts[index],
    apiAccountName: String(profile?.name || '').trim(),
    apiCreatedAt: String(profile?.created || '').trim(),
  };
  store.set('accounts', accounts);
  return true;
});

ipcMain.handle('update-account', async (_, id, accountData) => {
  if (!masterKey) throw new Error('Master key not set');

  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const index = accounts.findIndex((a: any) => a.id === id);
  if (index < 0) return false;

  const existing = accounts[index];
  const passwordEncrypted = accountData.passwordEncrypted
    ? encrypt(accountData.passwordEncrypted, masterKey)
    : existing.passwordEncrypted;
  const nextApiKey = accountData.apiKey ?? existing.apiKey ?? '';
  const existingApiKey = existing.apiKey ?? '';

  accounts[index] = {
    ...existing,
    nickname: accountData.nickname,
    email: accountData.email,
    passwordEncrypted,
    launchArguments: accountData.launchArguments ?? existing.launchArguments ?? '',
    playClickXPercent: Number.isFinite(accountData.playClickXPercent) ? Number(accountData.playClickXPercent) : existing.playClickXPercent,
    playClickYPercent: Number.isFinite(accountData.playClickYPercent) ? Number(accountData.playClickYPercent) : existing.playClickYPercent,
    apiKey: nextApiKey,
    apiAccountName: nextApiKey === existingApiKey ? (existing.apiAccountName ?? '') : '',
    apiCreatedAt: nextApiKey === existingApiKey ? (existing.apiCreatedAt ?? '') : '',
  };

  store.set('accounts', accounts);
  return true;
});

ipcMain.handle('get-accounts', async () => {
  if (isDevShowcase) {
    return showcaseAccounts;
  }
  if (!masterKey) throw new Error('Master key not set');
  return store.get('accounts') || [];
});

ipcMain.handle('delete-account', async (_, id) => {
  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const newAccounts = accounts.filter((a: any) => a.id !== id);
  store.set('accounts', newAccounts);
  launchStateMachine.clearState(id);
  return true;
});

ipcMain.handle('launch-account', async (_, id) => {
  if (isDevShowcase) {
    showcaseActiveAccounts.clear();
    showcaseActiveAccounts.add(String(id));
    return true;
  }
  if (!masterKey) throw new Error('Master key not set');

  // Linux: prevent multiple instances
  if (process.platform === 'linux') {
    const runningPids = getAllRunningGw2Pids();
    if (runningPids.length > 0) {
      logMainWarn('launch', `Aborting launch for account=${id}: Linux instance already running (pids=${runningPids.join(',')})`);
      launchStateMachine.setState(id, 'errored', 'verified', 'Another GW2 instance is already running');
      return false;
    }
  }

  launchStateMachine.setState(id, 'launch_requested', 'verified', 'Launch requested');

  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const account = accounts.find((a: any) => a.id === id);
  if (!account) {
    logMainError('launch', `Account not found for id=${id}`);
    return false;
  }

  // @ts-ignore
  const settings = store.get('settings') as { gw2Path: string; bypassLinuxPortalPrompt?: boolean };
  const gw2Path = settings?.gw2Path?.trim();
  const bypassLinuxPortalPrompt = Boolean(settings?.bypassLinuxPortalPrompt);

  if (gw2Path && !fs.existsSync(gw2Path)) {
    console.error(`GW2 path does not exist: ${gw2Path}`);
    logMainError('launch', `GW2 path does not exist for account=${id}: ${gw2Path}`);
    launchStateMachine.setState(id, 'errored', 'verified', 'GW2 path missing');
    return false;
  }

  const extraArgs = splitLaunchArguments(account.launchArguments);
  const sanitizedExtraArgs = stripManagedLaunchArguments(extraArgs);
  const mumbleName = getAccountMumbleName(account.id);
  const args = ['--mumble', mumbleName, ...sanitizedExtraArgs];
  let launchedPid = 0;
  try {
    if (gw2Path) {
      console.log('Launching direct executable:', args.join(' '));
      logMain('launch', `Launching account=${id} via direct executable with ${args.length} args`);
      const gw2WorkingDirectory = path.dirname(gw2Path);
      const child = spawn(gw2Path, args, {
        cwd: gw2WorkingDirectory,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.on('error', (spawnError) => {
        console.error(`Spawn error: ${spawnError.message}`);
      });
      launchedPid = child.pid ?? 0;
      child.unref();
      launchStateMachine.setState(id, 'launcher_started', 'inferred', 'Direct executable launch signal sent');
    } else {
      console.log('Launching via Steam:', args.join(' '));
      logMain('launch', `Launching account=${id} via Steam with ${args.length} args`);
      launchViaSteam(args);
      launchStateMachine.setState(id, 'launcher_started', 'inferred', 'Steam launch signal sent');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const launchMode = gw2Path ? 'Direct executable' : 'Steam';
    console.error(`${launchMode} launch failed: ${message}`);
    logMainError('launch', `${launchMode} launch failed for account=${id}: ${message}`);
    launchStateMachine.setState(id, 'errored', 'verified', `${launchMode} launch failed`);
    return false;
  }
  const password = decrypt(account.passwordEncrypted, masterKey);
  launchStateMachine.setState(id, 'credentials_waiting', 'inferred', 'Waiting before credential automation');
  logMain('launch', `Starting credential automation for account=${id}`);
  startCredentialAutomation(
    account.id,
    launchedPid,
    account.email,
    password,
    bypassLinuxPortalPrompt,
  );
  launchStateMachine.setState(id, 'credentials_submitted', 'inferred', 'Credential automation started');

  const launched = await waitForAccountProcess(account.id, 25000);
  if (!launched) {
    console.error(`GW2 did not appear as running for account ${account.nickname} within timeout.`);
    launchStateMachine.setState(id, 'errored', 'inferred', 'Process not detected before timeout');
  } else {
    launchStateMachine.setState(id, 'process_detected', 'verified', 'Account process detected');
    launchStateMachine.setState(id, 'running', 'verified', 'Running with mapped process');
  }
  return launched;
});

ipcMain.handle('save-settings', async (_, settings) => {
  store.set('settings', settings);
  if ((settings?.masterPasswordPrompt ?? 'every_time') === 'never') {
    if (masterKey) {
      store.set('security_v2.cachedMasterKey', encryptForStorage(masterKey));
    }
  } else {
    store.set('security_v2.cachedMasterKey', '');
  }
});

ipcMain.handle('get-settings', async () => {
  if (isDevShowcase) {
    return {
      gw2Path: '/usr/bin/gw2-showcase',
      masterPasswordPrompt: 'never',
      themeId: 'blood_legion',
      bypassLinuxPortalPrompt: false,
    };
  }
  return store.get('settings');
});

ipcMain.handle('get-runtime-flags', async () => {
  return {
    isDevShowcase,
  };
});

ipcMain.handle('check-portal-permissions', async () => {
  if (process.platform !== 'linux') {
    return { configured: false, message: 'Only available on Linux' };
  }

  const homeDir = process.env.HOME || os.homedir();
  const permissionsFile = path.join(homeDir, '.local/share/xdg-desktop-portal/permissions/remote-desktop');

  try {
    if (fs.existsSync(permissionsFile)) {
      const content = fs.readFileSync(permissionsFile, 'utf8');
      const appName = path.basename(process.execPath).replace('.AppImage', '').toLowerCase();
      const hasPermission = content.includes(`[${appName}]`) || content.includes('[gw2am]');
      if (hasPermission) {
        return { configured: true, message: 'Portal permissions already configured' };
      }
    }
    return { configured: false, message: 'Portal permissions not configured' };
  } catch (error) {
    return { configured: false, message: `Error checking permissions: ${error instanceof Error ? error.message : String(error)}` };
  }
});

ipcMain.handle('configure-portal-permissions', async () => {
  if (process.platform !== 'linux') {
    return { success: false, message: 'Only available on Linux' };
  }

  const homeDir = process.env.HOME || os.homedir();
  const permissionsDir = path.join(homeDir, '.local/share/xdg-desktop-portal/permissions');
  const permissionsFile = path.join(permissionsDir, 'remote-desktop');
  const appName = path.basename(process.execPath).replace('.AppImage', '').toLowerCase();

  try {
    // Create directory if it doesn't exist
    if (!fs.existsSync(permissionsDir)) {
      fs.mkdirSync(permissionsDir, { recursive: true });
    }

    // Read existing content if file exists
    let existingContent = '';
    if (fs.existsSync(permissionsFile)) {
      existingContent = fs.readFileSync(permissionsFile, 'utf8');
    }

    // Check if already configured
    if (existingContent.includes(`[${appName}]`) || existingContent.includes('[gw2am]')) {
      return { success: true, message: 'Already configured' };
    }

    // Add our app's permissions
    const newEntry = `\n[gw2am]\nallow=true\n`;
    fs.writeFileSync(permissionsFile, existingContent + newEntry, 'utf8');

    // Restart xdg-desktop-portal service
    try {
      spawnSync('systemctl', ['--user', 'restart', 'xdg-desktop-portal.service'], { encoding: 'utf8' });
    } catch {
      // Service restart might fail in some environments, but the config will still work
    }

    logMain('portal', 'Successfully configured xdg-desktop-portal permissions');
    return { success: true, message: 'Portal permissions configured successfully. Restart may be required.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMainError('portal', `Failed to configure portal permissions: ${message}`);
    return { success: false, message: `Failed to configure: ${message}` };
  }
});
