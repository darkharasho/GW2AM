import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import store from './store.js';
import { deriveKey, encrypt, decrypt, generateSalt } from './crypto.js';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import { LaunchStateMachine } from './launchStateMachine.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}
let mainWindow = null;
let masterKey = null;
const STEAM_GW2_APP_ID = '1284210';
let shutdownRequested = false;
const automationPidsByAccount = new Map();
const launchStateMachine = new LaunchStateMachine();
let persistWindowStateTimer = null;
function logMain(scope, message) {
    console.log(`[GW2AM][Main][${scope}] ${message}`);
}
function logMainWarn(scope, message) {
    console.warn(`[GW2AM][Main][${scope}] ${message}`);
}
function logMainError(scope, message) {
    console.error(`[GW2AM][Main][${scope}] ${message}`);
}
function getStoredWindowState() {
    const raw = store.get('windowState') || {};
    const width = Number.isFinite(raw.width) && raw.width > 200 ? Number(raw.width) : 400;
    const height = Number.isFinite(raw.height) && raw.height > 200 ? Number(raw.height) : 600;
    const x = Number.isFinite(raw.x) ? Number(raw.x) : undefined;
    const y = Number.isFinite(raw.y) ? Number(raw.y) : undefined;
    const isMaximized = Boolean(raw.isMaximized);
    return { x, y, width, height, isMaximized };
}
function persistWindowState(immediate = false) {
    if (!mainWindow)
        return;
    const writeState = () => {
        if (!mainWindow)
            return;
        const normalBounds = mainWindow.getNormalBounds();
        const nextState = {
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
function stopAutomationPid(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return;
    try {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
            return;
        }
        process.kill(pid, 'SIGTERM');
    }
    catch {
        // ignore
    }
}
function trackAutomationProcess(accountId, pid) {
    if (!accountId || !pid || !Number.isInteger(pid) || pid <= 0)
        return;
    const current = automationPidsByAccount.get(accountId) ?? new Set();
    current.add(pid);
    automationPidsByAccount.set(accountId, current);
}
function stopAccountAutomation(accountId, reason = 'unspecified') {
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
function stopAllAutomation() {
    automationPidsByAccount.forEach((pids) => {
        logMain('automation', `Stopping automation for all accounts pids=${Array.from(pids).join(',')}`);
        pids.forEach((pid) => stopAutomationPid(pid));
    });
    automationPidsByAccount.clear();
}
function requestAppShutdown(source) {
    if (shutdownRequested)
        return;
    shutdownRequested = true;
    console.log(`Shutdown requested via ${source}`);
    stopAllAutomation();
    try {
        app.quit();
    }
    catch {
        // Ignore and rely on forced exit fallback below.
    }
    setTimeout(() => {
        app.exit(0);
    }, 1200);
}
process.on('SIGINT', () => requestAppShutdown('SIGINT'));
process.on('SIGTERM', () => requestAppShutdown('SIGTERM'));
function splitLaunchArguments(launchArguments) {
    if (!launchArguments)
        return [];
    const matches = launchArguments.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
    if (!matches)
        return [];
    return matches.map((arg) => arg.replace(/^['"]|['"]$/g, ''));
}
function getAccountMumbleName(accountId) {
    return `gw2am_${accountId.replace(/-/g, '').toLowerCase()}`;
}
function stripManagedLaunchArguments(args) {
    const valueTakingFlags = new Set(['--mumble', '-mumble', '-email', '--email', '-password', '--password', '-provider', '--provider']);
    const standaloneFlags = new Set(['-autologin', '--autologin']);
    const cleaned = [];
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        const lowerArg = arg.toLowerCase();
        if (valueTakingFlags.has(lowerArg)) {
            i += 1;
            continue;
        }
        if (lowerArg.startsWith('--mumble=') ||
            lowerArg.startsWith('-mumble=') ||
            lowerArg.startsWith('--email=') ||
            lowerArg.startsWith('-email=') ||
            lowerArg.startsWith('--password=') ||
            lowerArg.startsWith('-password=') ||
            lowerArg.startsWith('--provider=') ||
            lowerArg.startsWith('-provider=')) {
            continue;
        }
        if (standaloneFlags.has(lowerArg)) {
            continue;
        }
        cleaned.push(arg);
    }
    return cleaned;
}
function extractMumbleNameFromCommandLine(commandLine) {
    const match = commandLine.match(/(?:^|\s)(?:--mumble|-mumble)(?:=|\s+)("([^"]+)"|'([^']+)'|([^\s"']+))/i);
    if (!match)
        return null;
    return match[2] || match[3] || match[4] || null;
}
function launchViaSteam(args) {
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
async function waitForAccountProcess(accountId, timeoutMs = 25000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const active = getActiveAccountProcesses();
        if (active.some((processInfo) => processInfo.accountId === accountId)) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
}
function getGw2ProcessNames() {
    const settings = store.get('settings');
    const names = new Set(['Gw2-64.exe', 'Gw2.exe', 'Gw2-64']);
    const configuredPath = settings?.gw2Path?.trim();
    if (configuredPath) {
        names.add(path.basename(configuredPath));
    }
    return Array.from(names);
}
function getGw2CommandRegex() {
    const settings = store.get('settings');
    const configuredName = settings?.gw2Path ? path.basename(settings.gw2Path) : '';
    const escapedConfiguredName = configuredName
        ? configuredName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        : '';
    return escapedConfiguredName
        ? new RegExp(`(?:^|[\\/\\s])(?:gw2-64(?:\\.exe)?|gw2(?:\\.exe)?|${escapedConfiguredName})(?:\\s|$)`, 'i')
        : /(?:^|[\/\s])(?:gw2-64(?:\.exe)?|gw2(?:\.exe)?)(?:\s|$)/i;
}
function getAccountMumblePids(accountId) {
    const mumbleName = getAccountMumbleName(accountId);
    const found = new Set();
    if (process.platform === 'win32') {
        const query = 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8' });
        if (result.status !== 0 || !result.stdout)
            return [];
        try {
            const parsed = JSON.parse(result.stdout);
            const processes = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
            for (const processInfo of processes) {
                const pid = Number(processInfo?.ProcessId);
                const commandLine = String(processInfo?.CommandLine || '');
                if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid)
                    continue;
                if (extractMumbleNameFromCommandLine(commandLine) !== mumbleName)
                    continue;
                found.add(pid);
            }
        }
        catch {
            return [];
        }
        return Array.from(found);
    }
    const psResult = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    if (psResult.status !== 0 || !psResult.stdout)
        return [];
    const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!match)
            continue;
        const pid = Number(match[1]);
        const args = match[2];
        if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid)
            continue;
        if (extractMumbleNameFromCommandLine(args) !== mumbleName)
            continue;
        found.add(pid);
    }
    return Array.from(found);
}
function getDescendantPids(rootPid) {
    if (!Number.isInteger(rootPid) || rootPid <= 0)
        return [];
    const psResult = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
    if (psResult.status !== 0 || !psResult.stdout)
        return [];
    const childrenByParent = new Map();
    const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/);
        if (!match)
            continue;
        const pid = Number(match[1]);
        const ppid = Number(match[2]);
        if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0 || ppid <= 0)
            continue;
        const list = childrenByParent.get(ppid) ?? [];
        list.push(pid);
        childrenByParent.set(ppid, list);
    }
    const found = new Set();
    const queue = [rootPid];
    while (queue.length > 0) {
        const current = queue.shift();
        const children = childrenByParent.get(current) ?? [];
        for (const child of children) {
            if (found.has(child))
                continue;
            found.add(child);
            queue.push(child);
        }
    }
    return Array.from(found);
}
function getActiveAccountProcesses() {
    // @ts-ignore
    const accounts = store.get('accounts') || [];
    const mumbleToAccountId = new Map();
    for (const account of accounts) {
        mumbleToAccountId.set(getAccountMumbleName(account.id), account.id);
    }
    if (mumbleToAccountId.size === 0)
        return [];
    const names = getGw2ProcessNames().map((name) => name.toLowerCase());
    const foundByAccount = new Map();
    if (process.platform === 'win32') {
        const query = 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';
        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8' });
        if (result.status !== 0 || !result.stdout)
            return [];
        let processes = [];
        try {
            const parsed = JSON.parse(result.stdout);
            processes = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        }
        catch {
            return [];
        }
        for (const processInfo of processes) {
            const imageName = String(processInfo?.Name || '').toLowerCase();
            if (!imageName || !names.includes(imageName))
                continue;
            const pid = Number(processInfo?.ProcessId);
            if (!Number.isInteger(pid) || pid <= 0)
                continue;
            const commandLine = String(processInfo?.CommandLine || '');
            const mumbleName = extractMumbleNameFromCommandLine(commandLine);
            if (!mumbleName)
                continue;
            const accountId = mumbleToAccountId.get(mumbleName);
            if (!accountId)
                continue;
            if (!foundByAccount.has(accountId)) {
                foundByAccount.set(accountId, { accountId, pid, mumbleName });
            }
        }
        return Array.from(foundByAccount.values());
    }
    const psResult = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    if (psResult.status !== 0 || !psResult.stdout)
        return Array.from(foundByAccount.values());
    const gw2Regex = getGw2CommandRegex();
    const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!match)
            continue;
        const pid = Number(match[1]);
        const args = match[2];
        if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid)
            continue;
        if (!gw2Regex.test(args))
            continue;
        const mumbleName = extractMumbleNameFromCommandLine(args);
        if (!mumbleName)
            continue;
        const accountId = mumbleToAccountId.get(mumbleName);
        if (!accountId)
            continue;
        if (!foundByAccount.has(accountId)) {
            foundByAccount.set(accountId, { accountId, pid, mumbleName });
        }
    }
    return Array.from(foundByAccount.values());
}
function getRunningGw2Pids() {
    return getActiveAccountProcesses().map((processInfo) => processInfo.pid);
}
function getAllRunningGw2Pids() {
    const names = new Set(getGw2ProcessNames().map((name) => name.toLowerCase()));
    const gw2Regex = getGw2CommandRegex();
    const broadGw2Regex = /(gw2-64(?:\.exe)?|gw2(?:\.exe)?|guild wars 2)/i;
    const wineProcessRegex = /\b(wine|wine64|wine64-preloader|proton|wineserver)\b/i;
    const found = new Set();
    if (process.platform === 'win32') {
        const query = 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';
        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8' });
        if (result.status !== 0 || !result.stdout)
            return [];
        try {
            const parsed = JSON.parse(result.stdout);
            const processes = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
            for (const processInfo of processes) {
                const imageName = String(processInfo?.Name || '').toLowerCase();
                const commandLine = String(processInfo?.CommandLine || '');
                const matchesCommand = gw2Regex.test(commandLine);
                if (!matchesCommand && !names.has(imageName))
                    continue;
                const pid = Number(processInfo?.ProcessId);
                if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid)
                    continue;
                found.add(pid);
            }
        }
        catch {
            return [];
        }
        return Array.from(found);
    }
    const psResult = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    if (psResult.status !== 0 || !psResult.stdout)
        return [];
    const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!match)
            continue;
        const pid = Number(match[1]);
        const args = String(match[2] || '');
        if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid)
            continue;
        const directMatch = gw2Regex.test(args);
        const wineBroadMatch = wineProcessRegex.test(args) && broadGw2Regex.test(args);
        if (!directMatch && !wineBroadMatch)
            continue;
        found.add(pid);
    }
    return Array.from(found);
}
function terminatePid(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        if (process.platform === 'win32') {
            const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
            return result.status === 0;
        }
        process.kill(pid, 'SIGTERM');
        try {
            process.kill(pid, 0);
            process.kill(pid, 'SIGKILL');
        }
        catch {
            // Already exited or no permission.
        }
        return true;
    }
    catch {
        return false;
    }
}
function terminatePidTree(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    if (process.platform === 'win32')
        return terminatePid(pid);
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
function stopRunningGw2Processes() {
    const pids = getAllRunningGw2Pids();
    if (pids.length === 0)
        return false;
    let stoppedAny = false;
    for (const pid of pids) {
        if (terminatePid(pid))
            stoppedAny = true;
    }
    return stoppedAny;
}
function stopAccountProcess(accountId) {
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
            if (terminatePidTree(pid))
                stoppedAny = true;
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
        if (terminatePidTree(pid))
            stoppedAny = true;
    }
    if (stoppedAny) {
        launchStateMachine.setState(accountId, 'stopped', 'verified', `Stopped via fallback PID kill (${running.join(', ')})`);
        return true;
    }
    launchStateMachine.setState(accountId, 'errored', 'verified', 'Stop failed: account process could not be identified');
    return false;
}
function shouldPromptMasterPassword() {
    const settings = store.get('settings');
    const mode = settings?.masterPasswordPrompt ?? 'every_time';
    if (!masterKey && mode === 'never') {
        const cachedMasterKeyHex = String(store.get('security_v2.cachedMasterKey') || '');
        if (cachedMasterKeyHex) {
            try {
                const restored = Buffer.from(cachedMasterKeyHex, 'hex');
                if (restored.length > 0) {
                    masterKey = restored;
                    return false;
                }
            }
            catch {
                // fall back to prompting
            }
        }
    }
    // Without an in-memory key, account operations requiring decryption cannot proceed.
    if (!masterKey)
        return true;
    if (mode === 'never')
        return false;
    if (mode === 'every_time')
        return true;
    const lastUnlockAt = Number(store.get('security_v2.lastUnlockAt') || 0);
    if (!Number.isFinite(lastUnlockAt) || lastUnlockAt <= 0)
        return true;
    const now = Date.now();
    const elapsed = now - lastUnlockAt;
    const intervals = {
        daily: 24 * 60 * 60 * 1000,
        weekly: 7 * 24 * 60 * 60 * 1000,
        monthly: 30 * 24 * 60 * 60 * 1000,
    };
    if (mode in intervals) {
        return elapsed >= intervals[mode];
    }
    return true;
}
function startWindowsCredentialAutomation(accountId, pid, email, password, _playClickXPercent, _playClickYPercent) {
    if (process.platform !== 'win32')
        return;
    logMain('automation', `Windows automation start account=${accountId} pid=${pid} emailLen=${email.length}`);
    const automationScript = `
$wshell = New-Object -ComObject WScript.Shell
$pidValue = [int]$env:GW2_PID
$emailValue = $env:GW2_EMAIL
$passwordValue = $env:GW2_PASSWORD
$windowTitles = @('Guild Wars 2', 'Guild Wars2', 'ArenaNet')
$credentialAttemptCount = 0
$maxCredentialAttempts = 1
$credentialsSubmittedAt = [DateTime]::MinValue
$playAttemptCount = 0
$maxPlayAttempts = 1
$playAttemptIntervalMs = 4000
$lastPlayAttemptAt = [DateTime]::MinValue

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

function Clear-FocusedInput() {
  # Keep this conservative: a small clear sequence only.
  $wshell.SendKeys('^a')
  Start-Sleep -Milliseconds 70
  $wshell.SendKeys('{DELETE}')
  Start-Sleep -Milliseconds 70
  $wshell.SendKeys('^a')
  Start-Sleep -Milliseconds 70
  $wshell.SendKeys('{BACKSPACE}')
  Start-Sleep -Milliseconds 70
  $wshell.SendKeys('{END}')
  Start-Sleep -Milliseconds 30
  for ($n = 0; $n -lt 8; $n++) {
    $wshell.SendKeys('{BACKSPACE}')
  }
  Start-Sleep -Milliseconds 30
  $wshell.SendKeys('{HOME}')
  Start-Sleep -Milliseconds 30
  for ($n = 0; $n -lt 8; $n++) {
    $wshell.SendKeys('{DELETE}')
  }
  Start-Sleep -Milliseconds 40
}

for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep -Milliseconds 400
  $activated = $false

  if ($wshell.AppActivate($pidValue)) {
    $activated = $true
  } else {
    foreach ($title in $windowTitles) {
      if ($wshell.AppActivate($title)) {
        $activated = $true
        break
      }
    }
  }

  if ($activated) {
    $now = Get-Date

    if ($credentialAttemptCount -lt $maxCredentialAttempts) {
      # Single fixed wait so controls are writable; no retry/backoff typing loop.
      Start-Sleep -Milliseconds 10000

      $activatedAfterWait = $false
      if ($wshell.AppActivate($pidValue)) {
        $activatedAfterWait = $true
      } else {
        foreach ($title in $windowTitles) {
          if ($wshell.AppActivate($title)) {
            $activatedAfterWait = $true
            break
          }
        }
      }
      if (-not $activatedAfterWait) {
        continue
      }

      # Clear both inputs first, regardless of current focus.
      $wshell.SendKeys('+{TAB}')
      Start-Sleep -Milliseconds 100
      $wshell.SendKeys('+{TAB}')
      Start-Sleep -Milliseconds 100
      Clear-FocusedInput
      $wshell.SendKeys('{TAB}')
      Start-Sleep -Milliseconds 120
      Clear-FocusedInput
      $wshell.SendKeys('+{TAB}')
      Start-Sleep -Milliseconds 120
      Clear-FocusedInput
      $wshell.SendKeys((Escape-SendKeys $emailValue))
      Start-Sleep -Milliseconds 180
      $wshell.SendKeys('{TAB}')
      Start-Sleep -Milliseconds 180
      Clear-FocusedInput
      $wshell.SendKeys((Escape-SendKeys $passwordValue))
      Start-Sleep -Milliseconds 220
      $wshell.SendKeys('{ENTER}')
      $credentialAttemptCount++
      $credentialsSubmittedAt = $now
      continue
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

    $wshell.SendKeys('{ENTER}')
    $playAttemptCount++
    $lastPlayAttemptAt = $now

    if ($playAttemptCount -ge $maxPlayAttempts) {
      break
    }
  }
}
`;
    const encodedScript = Buffer.from(automationScript, 'utf16le').toString('base64');
    const automationProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], {
        detached: true,
        stdio: 'ignore',
        env: {
            ...process.env,
            GW2_PID: String(pid),
            GW2_EMAIL: email,
            GW2_PASSWORD: password,
        },
    });
    automationProcess.on('error', (error) => {
        logMainError('automation', `Windows automation error account=${accountId}: ${error.message}`);
    });
    automationProcess.on('exit', (code, signal) => {
        logMain('automation', `Windows automation exit account=${accountId}: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    });
    trackAutomationProcess(accountId, automationProcess.pid);
    logMain('automation', `Windows automation spawned account=${accountId} pid=${automationProcess.pid ?? 'unknown'}`);
    automationProcess.unref();
}
function startLinuxCredentialAutomation(accountId, pid, email, password) {
    if (process.platform !== 'linux')
        return;
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
    const automationProcess = spawn('/bin/bash', ['-c', automationScript], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            GW2_PID: String(pid),
            GW2_EMAIL: email,
            GW2_PASSWORD: password,
        },
    });
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
function startCredentialAutomation(accountId, pid, email, password) {
    logMain('automation', `Dispatch account=${accountId} platform=${process.platform} pid=${pid}`);
    if (process.platform === 'win32') {
        startWindowsCredentialAutomation(accountId, pid, email, password);
        return;
    }
    if (process.platform === 'linux') {
        startLinuxCredentialAutomation(accountId, pid, email, password);
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
    }
    else {
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
    if (mainWindow?.isMaximized())
        mainWindow?.unmaximize();
    else
        mainWindow?.maximize();
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
// Security & Account Management
ipcMain.handle('has-master-password', async () => {
    return !!store.get('security_v2.salt');
});
ipcMain.handle('set-master-password', async (_, password) => {
    const salt = generateSalt();
    const key = deriveKey(password, Buffer.from(salt, 'hex'));
    const validationHash = crypto.createHash('sha256').update(key).digest('hex');
    store.set('security_v2.salt', salt);
    store.set('security_v2.validationHash', validationHash);
    store.set('security_v2.lastUnlockAt', Date.now());
    const settings = store.get('settings');
    if ((settings?.masterPasswordPrompt ?? 'every_time') === 'never') {
        store.set('security_v2.cachedMasterKey', key.toString('hex'));
    }
    else {
        store.set('security_v2.cachedMasterKey', '');
    }
    masterKey = key;
    return true;
});
ipcMain.handle('verify-master-password', async (_, password) => {
    const salt = store.get('security_v2.salt');
    const storedHash = store.get('security_v2.validationHash');
    if (!salt || !storedHash)
        return false;
    // Cast salt to string because electron-store types might be inferred loosely
    const saltBuffer = Buffer.from(salt, 'hex');
    const key = deriveKey(password, saltBuffer);
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    if (hash === storedHash) {
        masterKey = key;
        store.set('security_v2.lastUnlockAt', Date.now());
        const settings = store.get('settings');
        if ((settings?.masterPasswordPrompt ?? 'every_time') === 'never') {
            store.set('security_v2.cachedMasterKey', key.toString('hex'));
        }
        else {
            store.set('security_v2.cachedMasterKey', '');
        }
        return true;
    }
    return false;
});
ipcMain.handle('should-prompt-master-password', async () => {
    return shouldPromptMasterPassword();
});
ipcMain.handle('save-account', async (_, accountData) => {
    if (!masterKey)
        throw new Error('Master key not set');
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
    const accounts = store.get('accounts') || [];
    store.set('accounts', [...accounts, newAccount]);
    // Log stored account for diagnostics
    try {
        const saved = (store.get('accounts') || []).find((a) => a.id === id);
        logMain('automation', `Saved account id=${id} playClickX=${String(saved?.playClickXPercent)} playClickY=${String(saved?.playClickYPercent)}`);
    }
    catch (e) {
        logMainWarn('automation', `Unable to read back saved account for diagnostics: ${e instanceof Error ? e.message : String(e)}`);
    }
    return true;
});
ipcMain.handle('is-gw2-running', async () => {
    return getRunningGw2Pids().length > 0;
});
ipcMain.handle('stop-gw2-process', async () => {
    return stopRunningGw2Processes();
});
ipcMain.handle('get-active-account-processes', async () => {
    return getActiveAccountProcesses();
});
ipcMain.handle('get-launch-states', async () => {
    return launchStateMachine.getAllStates();
});
ipcMain.handle('stop-account-process', async (_, accountId) => {
    return stopAccountProcess(accountId);
});
ipcMain.handle('resolve-account-profile', async (_, apiKey) => {
    const token = String(apiKey || '').trim();
    if (!token)
        return { name: '', created: '' };
    try {
        const accountResponse = await fetch('https://api.guildwars2.com/v2/account', {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        if (!accountResponse.ok)
            return { name: '', created: '' };
        const accountData = await accountResponse.json();
        return {
            name: typeof accountData?.name === 'string' ? accountData.name.trim() : '',
            created: typeof accountData?.created === 'string' ? accountData.created.trim() : '',
        };
    }
    catch {
        return { name: '', created: '' };
    }
});
ipcMain.handle('set-account-api-profile', async (_, id, profile) => {
    // @ts-ignore
    const accounts = store.get('accounts') || [];
    const index = accounts.findIndex((a) => a.id === id);
    if (index < 0)
        return false;
    accounts[index] = {
        ...accounts[index],
        apiAccountName: String(profile?.name || '').trim(),
        apiCreatedAt: String(profile?.created || '').trim(),
    };
    store.set('accounts', accounts);
    return true;
});
ipcMain.handle('update-account', async (_, id, accountData) => {
    if (!masterKey)
        throw new Error('Master key not set');
    // @ts-ignore
    const accounts = store.get('accounts') || [];
    const index = accounts.findIndex((a) => a.id === id);
    if (index < 0)
        return false;
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
    if (!masterKey)
        throw new Error('Master key not set');
    return store.get('accounts') || [];
});
ipcMain.handle('delete-account', async (_, id) => {
    // @ts-ignore
    const accounts = store.get('accounts') || [];
    const newAccounts = accounts.filter((a) => a.id !== id);
    store.set('accounts', newAccounts);
    launchStateMachine.clearState(id);
    return true;
});
ipcMain.handle('launch-account', async (_, id) => {
    if (!masterKey)
        throw new Error('Master key not set');
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
    const accounts = store.get('accounts') || [];
    const account = accounts.find((a) => a.id === id);
    if (!account) {
        logMainError('launch', `Account not found for id=${id}`);
        return false;
    }
    // @ts-ignore
    const settings = store.get('settings');
    const gw2Path = settings?.gw2Path;
    if (!gw2Path) {
        console.error("GW2 Path not set");
        logMainError('launch', `GW2 path missing for account=${id}`);
        launchStateMachine.setState(id, 'errored', 'verified', 'GW2 path not set');
        return false;
    }
    if (!fs.existsSync(gw2Path)) {
        console.error(`GW2 path does not exist: ${gw2Path}`);
        logMainError('launch', `GW2 path does not exist for account=${id}: ${gw2Path}`);
        launchStateMachine.setState(id, 'errored', 'verified', 'GW2 path missing');
        return false;
    }
    const extraArgs = splitLaunchArguments(account.launchArguments);
    const sanitizedExtraArgs = stripManagedLaunchArguments(extraArgs);
    const mumbleName = getAccountMumbleName(account.id);
    const args = ['--mumble', mumbleName, ...sanitizedExtraArgs];
    console.log('Launching via Steam:', args.join(' '));
    logMain('launch', `Launching account=${id} via Steam with ${args.length} args`);
    try {
        launchViaSteam(args);
        launchStateMachine.setState(id, 'launcher_started', 'inferred', 'Steam launch signal sent');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Steam launch failed, falling back to direct executable: ${message}`);
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
        child.unref();
        launchStateMachine.setState(id, 'launcher_started', 'inferred', 'Direct executable launch signal sent');
    }
    const password = decrypt(account.passwordEncrypted, masterKey);
    launchStateMachine.setState(id, 'credentials_waiting', 'inferred', 'Waiting before credential automation');
    logMain('launch', `Starting credential automation for account=${id}`);
    startCredentialAutomation(account.id, 0, account.email, password);
    launchStateMachine.setState(id, 'credentials_submitted', 'inferred', 'Credential automation started');
    const launched = await waitForAccountProcess(account.id, 25000);
    if (!launched) {
        console.error(`GW2 did not appear as running for account ${account.nickname} within timeout.`);
        launchStateMachine.setState(id, 'errored', 'inferred', 'Process not detected before timeout');
    }
    else {
        launchStateMachine.setState(id, 'process_detected', 'verified', 'Account process detected');
        launchStateMachine.setState(id, 'running', 'verified', 'Running with mapped process');
    }
    return launched;
});
ipcMain.handle('save-settings', async (_, settings) => {
    store.set('settings', settings);
    if ((settings?.masterPasswordPrompt ?? 'every_time') === 'never') {
        if (masterKey) {
            store.set('security_v2.cachedMasterKey', masterKey.toString('hex'));
        }
    }
    else {
        store.set('security_v2.cachedMasterKey', '');
    }
});
ipcMain.handle('get-settings', async () => {
    return store.get('settings');
});
