/*
MIT License

Copyright (c) 2019 Healix

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
export const WINDOWS_AUTOMATION_SCRIPT_VERSION = 'win-autologin-v24';
export type AutomationDeps = {
  logMain: (scope: string, message: string) => void;
  logMainWarn: (scope: string, message: string) => void;
  logMainError: (scope: string, message: string) => void;
  trackAutomationProcess: (accountId: string, pid?: number) => void;
};

function resolveWindowsPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const absoluteCandidates = [
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(systemRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];
  for (const candidate of absoluteCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'powershell.exe';
}

export function startWindowsCredentialAutomation(
  accountId: string,
  pid: number,
  email: string,
  password: string,
  playClickXPercent?: number,
  playClickYPercent?: number,
  deps?: AutomationDeps,
): void {
  if (!deps) return;
  if (process.platform !== 'win32') return;
  const normalizedPlayClickXPercent = Number.isFinite(playClickXPercent)
    ? Math.max(0, Math.min(1, Number(playClickXPercent)))
    : undefined;
  const normalizedPlayClickYPercent = Number.isFinite(playClickYPercent)
    ? Math.max(0, Math.min(1, Number(playClickYPercent)))
    : undefined;
  const hasCustomPlayClick = typeof normalizedPlayClickXPercent === 'number' && typeof normalizedPlayClickYPercent === 'number';
  deps.logMain(
    'automation',
    `Windows automation start account=${accountId} pid=${pid} emailLen=${email.length} script=${WINDOWS_AUTOMATION_SCRIPT_VERSION} customPlayClick=${hasCustomPlayClick ? `${normalizedPlayClickXPercent},${normalizedPlayClickYPercent}` : 'none'}`,
  );

  const automationScript = `
$ProgressPreference = 'SilentlyContinue'
$wshell = New-Object -ComObject WScript.Shell
$pidValue = [int]$env:GW2_PID
$emailValue = $env:GW2_EMAIL
$passwordValue = $env:GW2_PASSWORD
$windowTitles = @('Guild Wars 2', 'Guild Wars2', 'ArenaNet')
$credentialAttemptCount = 0
$maxCredentialAttempts = 10
$credentialsSubmitted = $false
$emailTabCount = -1
$tabProfiles = @(14, 6, 2, 1)
$tabProfileIndex = 0
$resolvedWindowHandle = [IntPtr]::Zero
$launcherWindowHandle = [IntPtr]::Zero
$lineageProcessIds = [System.Collections.Generic.HashSet[int]]::new()
$lineageRootPid = 0
$lineageLastRefreshAt = [DateTime]::MinValue
$lineageRefreshIntervalMs = 1500
$credentialsSubmittedAt = [DateTime]::MinValue
$lastCredentialAttemptAt = [DateTime]::MinValue
$playAttemptCount = 0
$maxPlayAttempts = 60
$playAttemptIntervalMs = 1000
$lastPlayAttemptAt = [DateTime]::MinValue
$activationThrottleMs = 1200
$lastActivationAt = [DateTime]::MinValue
$playXPercent = [double]::NaN
$playYPercent = [double]::NaN
$parsedPercent = 0.0
if ([double]::TryParse($env:GW2_PLAY_X_PERCENT, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsedPercent)) {
  if ($parsedPercent -ge 0.0 -and $parsedPercent -le 1.0) {
    $playXPercent = $parsedPercent
  }
}
$parsedPercent = 0.0
if ([double]::TryParse($env:GW2_PLAY_Y_PERCENT, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsedPercent)) {
  if ($parsedPercent -ge 0.0 -and $parsedPercent -le 1.0) {
    $playYPercent = $parsedPercent
  }
}
$hasCustomPlayCoordinate = (-not [double]::IsNaN($playXPercent)) -and (-not [double]::IsNaN($playYPercent))

function Log-Automation([string]$message) {
  [Console]::Out.WriteLine("[gw2am-automation] $message")
}
Log-Automation "script-start pid=$pidValue version=${WINDOWS_AUTOMATION_SCRIPT_VERSION}"
Log-Automation "mode=deterministic-launcher-flow"
if ($hasCustomPlayCoordinate) {
  Log-Automation "play-coordinate custom x=$playXPercent y=$playYPercent"
}
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Windows.Forms
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
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
  public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  public static uint SendKeyUp(ushort vk) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = 1u;
    inputs[0].U.ki.wVk = vk;
    inputs[0].U.ki.wScan = 0;
    inputs[0].U.ki.dwFlags = 0x0002u;
    return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint ReleaseStandardModifiers() {
    uint sent = 0u;
    sent += SendKeyUp(0x10); // SHIFT
    sent += SendKeyUp(0xA0); // LSHIFT
    sent += SendKeyUp(0xA1); // RSHIFT
    sent += SendKeyUp(0x11); // CONTROL
    sent += SendKeyUp(0xA2); // LCONTROL
    sent += SendKeyUp(0xA3); // RCONTROL
    sent += SendKeyUp(0x12); // ALT
    sent += SendKeyUp(0xA4); // LALT
    sent += SendKeyUp(0xA5); // RALT
    return sent;
  }
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
  public static uint SendEnter() {
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = 1u;
    inputs[0].U.ki.wVk = 0x0D;
    inputs[0].U.ki.wScan = 0;
    inputs[0].U.ki.dwFlags = 0u;
    inputs[1].type = 1u;
    inputs[1].U.ki.wVk = 0x0D;
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

function Is-UsableWindowHandle([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) {
    return $false
  }
  try {
    if (-not [GW2AMInput]::IsWindow($handle)) {
      return $false
    }
    if (-not [GW2AMInput]::IsWindowVisible($handle)) {
      return $false
    }
    $rect = New-Object GW2AMInput+RECT
    return [GW2AMInput]::GetClientRect($handle, [ref]$rect)
  } catch {
    return $false
  }
}

function Get-WindowProcessId([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) {
    return 0
  }
  try {
    $pidRef = [uint32]0
    [void][GW2AMInput]::GetWindowThreadProcessId($handle, [ref]$pidRef)
    return [int]$pidRef
  } catch {
    return 0
  }
}

function Refresh-PreferredPidLineage([int]$preferredPid, [bool]$force = $false) {
  if ($preferredPid -le 0) {
    return
  }
  $now = Get-Date
  if (
    -not $force -and
    $lineageRootPid -eq $preferredPid -and
    $lineageLastRefreshAt -ne [DateTime]::MinValue -and
    (($now - $lineageLastRefreshAt).TotalMilliseconds -lt $lineageRefreshIntervalMs)
  ) {
    return
  }

  $newSet = [System.Collections.Generic.HashSet[int]]::new()
  [void]$newSet.Add($preferredPid)
  try {
    $procRows = Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId -ErrorAction Stop
    $childrenByParent = @{}
    foreach ($row in $procRows) {
      $parentPid = [int]$row.ParentProcessId
      $childPid = [int]$row.ProcessId
      if (-not $childrenByParent.ContainsKey($parentPid)) {
        $childrenByParent[$parentPid] = New-Object 'System.Collections.Generic.List[int]'
      }
      [void]$childrenByParent[$parentPid].Add($childPid)
    }

    $queue = New-Object 'System.Collections.Generic.Queue[int]'
    $queue.Enqueue($preferredPid)
    while ($queue.Count -gt 0) {
      $currentPid = $queue.Dequeue()
      if (-not $childrenByParent.ContainsKey($currentPid)) {
        continue
      }
      foreach ($childPid in $childrenByParent[$currentPid]) {
        if ($newSet.Add($childPid)) {
          $queue.Enqueue($childPid)
        }
      }
    }
  } catch {}

  $script:lineageProcessIds = $newSet
  $script:lineageRootPid = $preferredPid
  $script:lineageLastRefreshAt = $now
}

function Is-PidInPreferredLineage([int]$pid, [int]$preferredPid) {
  if ($preferredPid -le 0 -or $pid -le 0) {
    return $false
  }
  if ($pid -eq $preferredPid) {
    return $true
  }
  Refresh-PreferredPidLineage -preferredPid $preferredPid
  if ($lineageProcessIds.Contains($pid)) {
    return $true
  }
  Refresh-PreferredPidLineage -preferredPid $preferredPid -force $true
  return $lineageProcessIds.Contains($pid)
}

function Is-HandleInPreferredLineage([IntPtr]$handle, [int]$preferredPid) {
  if ($handle -eq [IntPtr]::Zero) {
    return $false
  }
  if ($preferredPid -le 0) {
    return $true
  }
  $ownerPid = Get-WindowProcessId -handle $handle
  return Is-PidInPreferredLineage -pid $ownerPid -preferredPid $preferredPid
}

function Find-LauncherHandleByTitle([string[]]$titles, [int]$preferredPid = 0) {
  try {
    $processes = Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.MainWindowHandle -and $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle)
    }
    $gw2Processes = $processes | Where-Object {
      $name = [string]$_.ProcessName
      $name.Equals('Gw2-64', [System.StringComparison]::OrdinalIgnoreCase) -or
      $name.Equals('Gw2', [System.StringComparison]::OrdinalIgnoreCase)
    }

    if ($preferredPid -gt 0) {
      $lineageMatches = $gw2Processes | Where-Object {
        Is-PidInPreferredLineage -pid ([int]$_.Id) -preferredPid $preferredPid
      }
      if (-not $lineageMatches -or $lineageMatches.Count -lt 1) {
        return [IntPtr]::Zero
      }
      $gw2Processes = $lineageMatches
    }

    $orderedCandidates = @()
    if ($preferredPid -gt 0) {
      $orderedCandidates += ($gw2Processes | Where-Object { [int]$_.Id -eq $preferredPid })
      $orderedCandidates += ($gw2Processes | Where-Object { [int]$_.Id -ne $preferredPid })
    } else {
      $orderedCandidates = $gw2Processes
    }

    foreach ($candidate in $orderedCandidates) {
      $h = [IntPtr]::new([int64]$candidate.MainWindowHandle)
      if ((Is-LauncherWindowHandle -handle $h) -and (Is-HandleInPreferredLineage -handle $h -preferredPid $preferredPid)) {
        return $h
      }
    }

    foreach ($title in $titles) {
      $match = $orderedCandidates | Where-Object { $_.MainWindowTitle.IndexOf($title, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1
      if ($match -and $match.MainWindowHandle -and $match.MainWindowHandle -ne 0) {
        $h = [IntPtr]::new([int64]$match.MainWindowHandle)
        if ((Is-LauncherWindowHandle -handle $h) -and (Is-HandleInPreferredLineage -handle $h -preferredPid $preferredPid)) {
          return $h
        }
      }
    }
  } catch {}
  return [IntPtr]::Zero
}

function Focus-GW2Window([int]$preferredPid, [string[]]$titles, [bool]$force = $false) {
  $handle = Get-MainWindowHandle -preferredPid $preferredPid
  if ($handle -ne [IntPtr]::Zero) {
    $foreground = [GW2AMInput]::GetForegroundWindow()
    if ($foreground -eq $handle) {
      return $true
    }
  }

  if (-not $force) {
    $now = Get-Date
    if ($lastActivationAt -ne [DateTime]::MinValue -and (($now - $lastActivationAt).TotalMilliseconds -lt $activationThrottleMs)) {
      return $false
    }
  }

  $activationPid = 0
  if ($handle -ne [IntPtr]::Zero) {
    $activationPid = Get-WindowProcessId -handle $handle
  }
  if ($activationPid -le 0) {
    $activationPid = $preferredPid
  }

  if ($activationPid -gt 0 -and $wshell.AppActivate($activationPid)) {
    $script:resolvedWindowHandle = [IntPtr]::Zero
    $script:lastActivationAt = Get-Date
    Start-Sleep -Milliseconds 90
    $activatedHandle = Get-MainWindowHandle -preferredPid $preferredPid
    if ((Is-LauncherWindowHandle -handle $activatedHandle) -and (Is-HandleInPreferredLineage -handle $activatedHandle -preferredPid $preferredPid)) {
      return $true
    }
  }
  return $false
}

function Get-MainWindowHandle([int]$preferredPid) {
  if (
    (Is-UsableWindowHandle $resolvedWindowHandle) -and
    (Is-LauncherWindowHandle -handle $resolvedWindowHandle) -and
    (Is-HandleInPreferredLineage -handle $resolvedWindowHandle -preferredPid $preferredPid)
  ) {
    return $resolvedWindowHandle
  }
  $script:resolvedWindowHandle = [IntPtr]::Zero

  if ($preferredPid -le 0) {
    $preferredPid = 0
  } else {
    Refresh-PreferredPidLineage -preferredPid $preferredPid
  }

  try {
    if ($preferredPid -gt 0) {
      $p = Get-Process -Id $preferredPid -ErrorAction SilentlyContinue
      if ($p -and $p.MainWindowHandle -and $p.MainWindowHandle -ne 0) {
        $h = [IntPtr]::new([int64]$p.MainWindowHandle)
        if (
          (Is-UsableWindowHandle $h) -and
          (Is-LauncherWindowHandle -handle $h) -and
          (Is-HandleInPreferredLineage -handle $h -preferredPid $preferredPid)
        ) {
          $script:resolvedWindowHandle = $h
          return $h
        }
      }
    }
  } catch {}

  $titleHandle = Find-LauncherHandleByTitle -titles $windowTitles -preferredPid $preferredPid
  if (
    (Is-UsableWindowHandle $titleHandle) -and
    (Is-LauncherWindowHandle -handle $titleHandle) -and
    (Is-HandleInPreferredLineage -handle $titleHandle -preferredPid $preferredPid)
  ) {
    $script:resolvedWindowHandle = $titleHandle
    return $titleHandle
  }

  return [IntPtr]::Zero
}

function Get-WindowClassName([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) {
    return ''
  }
  try {
    $capacity = 256
    $sb = New-Object System.Text.StringBuilder $capacity
    $len = [GW2AMInput]::GetClassName($handle, $sb, $capacity)
    if ($len -le 0) {
      return ''
    }
    return $sb.ToString()
  } catch {
    return ''
  }
}

function Is-LauncherWindowHandle([IntPtr]$handle) {
  $className = Get-WindowClassName -handle $handle
  if ([string]::IsNullOrWhiteSpace($className)) {
    return $false
  }
  return (
    $className.Equals('ArenaNet', [System.StringComparison]::OrdinalIgnoreCase) -or
    $className.Equals('ArenaNet_Gr_Window_Class', [System.StringComparison]::OrdinalIgnoreCase)
  )
}

function Is-LikelyFullscreenWindow([IntPtr]$hWnd) {
  if ($hWnd -eq [IntPtr]::Zero) {
    return $false
  }
  try {
    $windowRect = New-Object GW2AMInput+RECT
    if (-not [GW2AMInput]::GetWindowRect($hWnd, [ref]$windowRect)) {
      return $false
    }
    $windowWidth = [Math]::Max(0, $windowRect.Right - $windowRect.Left)
    $windowHeight = [Math]::Max(0, $windowRect.Bottom - $windowRect.Top)
    if ($windowWidth -lt 200 -or $windowHeight -lt 200) {
      return $false
    }
    $screen = [System.Windows.Forms.Screen]::FromHandle($hWnd)
    if (-not $screen) {
      return $false
    }
    $bounds = $screen.Bounds
    $deltaWidth = [Math]::Abs($windowWidth - $bounds.Width)
    $deltaHeight = [Math]::Abs($windowHeight - $bounds.Height)
    return ($deltaWidth -le 8 -and $deltaHeight -le 8)
  } catch {
    return $false
  }
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

function Get-LauncherEmptyCoordinate([int]$preferredPid) {
  $h = Get-MainWindowHandle -preferredPid $preferredPid
  if ($h -eq [IntPtr]::Zero) {
    return $null
  }
  try {
    $windowRect = New-Object GW2AMInput+RECT
    if (-not [GW2AMInput]::GetWindowRect($h, [ref]$windowRect)) {
      return $null
    }
    $width = [Math]::Max(0, $windowRect.Right - $windowRect.Left)
    $height = [Math]::Max(0, $windowRect.Bottom - $windowRect.Top)
    if ($width -lt 200 -or $height -lt 200) {
      return $null
    }
    $x = [int]($width * 4 / 5)
    $y = [int]($height / 2)
    while ($x -gt 50) {
      $screenLp = [GW2AMInput]::MakeLParam($windowRect.Left + $x, $windowRect.Top + $y)
      $hit = [GW2AMInput]::SendMessage($h, 0x0084, [IntPtr]::Zero, $screenLp) # WM_NCHITTEST
      if ($hit -eq [IntPtr]1) { # HTCLIENT
        return [PSCustomObject]@{
          Handle = $h
          X = $x
          Y = $y
        }
      }
      $x -= 50
    }
  } catch {}
  return $null
}

function Click-LauncherCoordinate([IntPtr]$handle, [int]$x, [int]$y) {
  if ($handle -eq [IntPtr]::Zero) {
    return $false
  }
  try {
    $lp = [GW2AMInput]::MakeLParam($x, $y)
    [void][GW2AMInput]::SendMessage($handle, 0x0201, [IntPtr]1, $lp) # WM_LBUTTONDOWN
    [void][GW2AMInput]::SendMessage($handle, 0x0202, [IntPtr]0, $lp) # WM_LBUTTONUP
    Start-Sleep -Milliseconds 90
    return $true
  } catch {
    return $false
  }
}

function Click-ClientPercent([int]$preferredPid, [double]$xPercent, [double]$yPercent, [string]$tag = '') {
  $h = Get-MainWindowHandle -preferredPid $preferredPid
  if ($h -eq [IntPtr]::Zero) {
    return $false
  }
  try {
    $rect = New-Object GW2AMInput+RECT
    if (-not [GW2AMInput]::GetClientRect($h, [ref]$rect)) {
      return $false
    }
    $width = [Math]::Max(0, $rect.Right - $rect.Left)
    $height = [Math]::Max(0, $rect.Bottom - $rect.Top)
    if ($width -lt 100 -or $height -lt 100) {
      return $false
    }
    $x = [int][Math]::Round($width * [Math]::Max(0.0, [Math]::Min(1.0, $xPercent)))
    $y = [int][Math]::Round($height * [Math]::Max(0.0, [Math]::Min(1.0, $yPercent)))
    $x = [Math]::Max(10, [Math]::Min($width - 10, $x))
    $y = [Math]::Max(10, [Math]::Min($height - 10, $y))
    $lp = [GW2AMInput]::MakeLParam($x, $y)
    [void][GW2AMInput]::SendMessage($h, 0x0200, [IntPtr]0, $lp) # WM_MOUSEMOVE
    [void][GW2AMInput]::SendMessage($h, 0x0201, [IntPtr]1, $lp) # WM_LBUTTONDOWN
    [void][GW2AMInput]::SendMessage($h, 0x0202, [IntPtr]0, $lp) # WM_LBUTTONUP
    Start-Sleep -Milliseconds 110
    if (-not [string]::IsNullOrWhiteSpace($tag)) {
      Log-Automation "anchor-click tag=$tag x=$x y=$y"
    }
    return $true
  } catch {
    return $false
  }
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
    [void][GW2AMInput]::SendMessage($h, 0x0101, [IntPtr]0x09, [IntPtr]($lParamBase -bor 0xC0000000)) # WM_KEYUP Tab
  }
  Start-Sleep -Milliseconds 110
  return $true
}

function Press-TabKey([int]$preferredPid) {
  $sent = [GW2AMInput]::SendTab()
  if ($sent -lt 2) {
    $wshell.SendKeys('{TAB}')
  }
  Start-Sleep -Milliseconds 110
}

function Press-EnterKey([int]$preferredPid) {
  $sent = [GW2AMInput]::SendEnter()
  if ($sent -lt 2) {
    $wshell.SendKeys('{ENTER}')
  }
  Start-Sleep -Milliseconds 110
}

function Clear-FocusedInput() {
  # Keep this conservative and deterministic.
  $wshell.SendKeys('^a')
  Start-Sleep -Milliseconds 70
  $wshell.SendKeys('{DELETE}')
  Start-Sleep -Milliseconds 80
}

function Try-TypeIntoFocusedField([string]$text) {
  if ([string]::IsNullOrEmpty($text)) {
    return $false
  }
  Clear-FocusedInput
  [void][GW2AMInput]::ReleaseStandardModifiers()
  $ok = Type-IntoFocusedInput $text
  if (-not $ok) {
    $ok = Paste-IntoFocusedInput $text
  }
  return $ok
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

function Wait-ForModifierRelease([int]$timeoutMs = 5000) {
  $startedAt = Get-Date
  $releasedOnce = $false
  while ($true) {
    try {
      if (-not $releasedOnce) {
        [void][GW2AMInput]::ReleaseStandardModifiers()
        $releasedOnce = $true
        Start-Sleep -Milliseconds 30
      }
      $mods = [System.Windows.Forms.Control]::ModifierKeys
      $hasShift = (($mods -band [System.Windows.Forms.Keys]::Shift) -ne 0)
      $hasControl = (($mods -band [System.Windows.Forms.Keys]::Control) -ne 0)
      $hasAlt = (($mods -band [System.Windows.Forms.Keys]::Alt) -ne 0)
      if (-not $hasShift -and -not $hasControl -and -not $hasAlt) {
        return $true
      }
    } catch {
      return $true
    }
    if (((Get-Date) - $startedAt).TotalMilliseconds -gt $timeoutMs) {
      Log-Automation "modifier-release-timeout timeoutMs=$timeoutMs"
      [void][GW2AMInput]::ReleaseStandardModifiers()
      return $true
    }
    Start-Sleep -Milliseconds 90
  }
}

function Get-PreferredEmailTabCount() {
  if ($script:emailTabCount -gt 0) {
    return $script:emailTabCount
  }
  if ($script:tabProfileIndex -lt 0 -or $script:tabProfileIndex -ge $script:tabProfiles.Count) {
    $script:tabProfileIndex = 0
  }
  return [int]$script:tabProfiles[$script:tabProfileIndex]
}

function Advance-TabProfile() {
  if ($script:tabProfiles.Count -lt 1) {
    return
  }
  $script:tabProfileIndex = ($script:tabProfileIndex + 1) % $script:tabProfiles.Count
  $script:emailTabCount = -1
  Log-Automation "tab-profile-advanced index=$($script:tabProfileIndex) tabs=$([int]$script:tabProfiles[$script:tabProfileIndex])"
}

function Try-FocusEmailField([int]$preferredPid, [string]$emailText) {
  $tabsToUse = Get-PreferredEmailTabCount

  if (-not (Focus-ByTabCount -preferredPid $preferredPid -tabCount $tabsToUse)) {
    return $false
  }
  $script:emailTabCount = $tabsToUse
  Log-Automation "email-anchor tabs=$tabsToUse"
  return $true
}

function Focus-ByTabCount([int]$preferredPid, [int]$tabCount) {
  if (-not (Focus-GW2Window -preferredPid $preferredPid -titles $windowTitles)) {
    return $false
  }
  [void][GW2AMInput]::ReleaseStandardModifiers()
  $clicked = Click-LauncherBackground -preferredPid $preferredPid
  if (-not $clicked) {
    Log-Automation "background-click-fallback tabs=$tabCount"
  }
  for ($n = 0; $n -lt $tabCount; $n++) {
    Press-TabKey -preferredPid $preferredPid
  }
  Start-Sleep -Milliseconds 90
  return $true
}

function Focus-PasswordFromEmailAnchor([int]$preferredPid, [int]$emailTabs, [string]$emailText, [bool]$allowNonCopyableAnchor = $false) {
  if ($emailTabs -lt 1) {
    return $false
  }
  if (-not (Focus-ByTabCount -preferredPid $preferredPid -tabCount $emailTabs)) {
    return $false
  }
  Press-TabKey -preferredPid $preferredPid
  Start-Sleep -Milliseconds 70
  Log-Automation "password-anchor tabs=$emailTabs"
  return $true
}

function Test-EmailAlreadyPresent([string]$emailText) {
  $probe = Read-FocusedInputText
  if ([string]::IsNullOrEmpty($probe) -or $probe -eq '__GW2AM_NO_COPY__') {
    return $false
  }
  $normalizedProbe = $probe.Trim().ToLowerInvariant()
  $normalizedExpected = $emailText.Trim().ToLowerInvariant()
  return -not [string]::IsNullOrWhiteSpace($normalizedExpected) -and $normalizedProbe -eq $normalizedExpected
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

function Test-ExactEmailMatch([string]$probeText, [string]$emailText) {
  if ([string]::IsNullOrWhiteSpace($probeText) -or [string]::IsNullOrWhiteSpace($emailText)) {
    return $false
  }
  return $probeText.Trim().ToLowerInvariant() -eq $emailText.Trim().ToLowerInvariant()
}

function Get-FocusedElementInfo() {
  $result = [ordered]@{
    usable = $false
    isEdit = $false
    isPassword = $false
    value = ''
    name = ''
    className = ''
  }
  try {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if (-not $focused) {
      return [PSCustomObject]$result
    }
    $result.usable = $true
    try {
      $controlType = $focused.Current.ControlType
      if ($controlType -eq [System.Windows.Automation.ControlType]::Edit) {
        $result.isEdit = $true
      }
    } catch {}
    try { $result.isPassword = [bool]$focused.Current.IsPassword } catch {}
    try { $result.name = [string]$focused.Current.Name } catch {}
    try { $result.className = [string]$focused.Current.ClassName } catch {}
    $valuePatternObj = $null
    if ($focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePatternObj)) {
      $valuePattern = [System.Windows.Automation.ValuePattern]$valuePatternObj
      try { $result.value = [string]$valuePattern.Current.Value } catch {}
    }
  } catch {}
  return [PSCustomObject]$result
}

function Try-SetEmailViaUIA([int]$preferredPid, [string]$emailText) {
  try {
    $mainHandle = Get-MainWindowHandle -preferredPid $preferredPid
    if ($mainHandle -eq [IntPtr]::Zero) { return $false }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($mainHandle)
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
      if ($isPassword) { continue }

      $valuePatternObj = $null
      if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePatternObj)) {
        $valuePattern = [System.Windows.Automation.ValuePattern]$valuePatternObj
        try {
          $valuePattern.SetValue($emailText)
          Log-Automation "uia-email-set idx=$idx"
          return $true
        } catch {}
      }

      try { $edit.SetFocus() } catch {}
      Start-Sleep -Milliseconds 90
      if (Paste-IntoFocusedInput $emailText) {
        Log-Automation "uia-email-focus-paste idx=$idx"
        return $true
      }
    }
    return $false
  } catch {
    Log-Automation "uia-email-set-exception"
    return $false
  }
}

function Try-FocusPasswordViaUIA([int]$preferredPid) {
  try {
    $mainHandle = Get-MainWindowHandle -preferredPid $preferredPid
    if ($mainHandle -eq [IntPtr]::Zero) { return $false }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($mainHandle)
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
    $mainHandle = Get-MainWindowHandle -preferredPid $preferredPid
    if ($mainHandle -eq [IntPtr]::Zero) { return $false }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($mainHandle)
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

function Try-FillCredentialsViaAnchors([int]$preferredPid, [string]$emailText, [string]$passwordText) {
  if (-not (Focus-GW2Window -preferredPid $preferredPid -titles $windowTitles)) {
    return $false
  }
  $anchorProfiles = @(
    [PSCustomObject]@{ emailX = 0.34; emailY = 0.29; passwordX = 0.34; passwordY = 0.44; id = 'a' },
    [PSCustomObject]@{ emailX = 0.28; emailY = 0.30; passwordX = 0.28; passwordY = 0.45; id = 'b' },
    [PSCustomObject]@{ emailX = 0.40; emailY = 0.31; passwordX = 0.40; passwordY = 0.46; id = 'c' }
  )

  foreach ($profile in $anchorProfiles) {
    if (-not (Click-ClientPercent -preferredPid $preferredPid -xPercent $profile.emailX -yPercent $profile.emailY -tag "email-$($profile.id)")) {
      continue
    }
    if (-not (Try-TypeIntoFocusedField -text $emailText)) {
      continue
    }
    Start-Sleep -Milliseconds 80

    if (-not (Click-ClientPercent -preferredPid $preferredPid -xPercent $profile.passwordX -yPercent $profile.passwordY -tag "password-$($profile.id)")) {
      continue
    }
    if (-not (Try-TypeIntoFocusedField -text $passwordText)) {
      continue
    }
    Start-Sleep -Milliseconds 80
    [void][GW2AMInput]::ReleaseStandardModifiers()
    Press-EnterKey -preferredPid $preferredPid
    Log-Automation "fast-anchor-submit profile=$($profile.id)"
    return $true
  }

  return $false
}

function Try-LoginViaHardenedPath([int]$preferredPid, [string]$emailText, [string]$passwordText, [int]$emailTabs = 14) {
  if (-not (Focus-GW2Window -preferredPid $preferredPid -titles $windowTitles)) {
    return $false
  }
  if (-not (Wait-ForModifierRelease -timeoutMs 5000)) {
    return $false
  }
  $anchor = Get-LauncherEmptyCoordinate -preferredPid $preferredPid
  if (-not $anchor) {
    Log-Automation "hardened-path-no-empty-coordinate"
    return $false
  }
  $handle = [IntPtr]$anchor.Handle
  if (-not (Is-LauncherWindowHandle -handle $handle)) {
    Log-Automation "login-flow-invalid-handle reason=non-launcher-window"
    return $false
  }
  $x = [int]$anchor.X
  $y = [int]$anchor.Y

  $gwlStyle = -16
  $wsDisabled = 0x08000000
  $originalStyle = [GW2AMInput]::GetWindowLongPtr($handle, $gwlStyle)
  $disabledStyle = [IntPtr]([int64]$originalStyle -bor $wsDisabled)
  [void][GW2AMInput]::SetWindowLongPtr($handle, $gwlStyle, $disabledStyle)

  try {
    if (-not (Click-LauncherCoordinate -handle $handle -x $x -y $y)) {
      return $false
    }

    if (-not (Send-TabCountToWindow -preferredPid $preferredPid -count $emailTabs)) {
      for ($n = 0; $n -lt $emailTabs; $n++) {
        Press-TabKey -preferredPid $preferredPid
      }
    }
    Start-Sleep -Milliseconds 80

    $emailSet = Type-IntoWindowViaPostMessage -preferredPid $preferredPid -text $emailText
    if (-not $emailSet) {
      $emailSet = Try-SetEmailViaUIA -preferredPid $preferredPid -emailText $emailText
    }
    if (-not $emailSet) {
      Log-Automation "hardened-path-email-type-failed"
      return $false
    }

    if (-not (Send-KeyToWindow -preferredPid $preferredPid -virtualKey 0x09)) {
      Press-TabKey -preferredPid $preferredPid
    }
    Start-Sleep -Milliseconds 80

    $passwordSet = Type-IntoWindowViaPostMessage -preferredPid $preferredPid -text $passwordText
    if (-not $passwordSet) {
      $passwordSet = Try-SetPasswordViaUIA -preferredPid $preferredPid -passwordText $passwordText
    }
    if (-not $passwordSet) {
      Log-Automation "hardened-path-password-type-failed"
      return $false
    }
    [void][GW2AMInput]::ReleaseStandardModifiers()
    if (-not (Send-KeyToWindow -preferredPid $preferredPid -virtualKey 0x0D)) {
      Press-EnterKey -preferredPid $preferredPid
    }
    Log-Automation "hardened-path-submit tabs=$emailTabs"
    return $true
  } finally {
    [void][GW2AMInput]::SetWindowLongPtr($handle, $gwlStyle, $originalStyle)
  }
}

function Verify-EmailFieldPassive([int]$preferredPid, [string]$emailText) {
  $focusInfo = Get-FocusedElementInfo
  if ($focusInfo.usable -and $focusInfo.isEdit -and -not $focusInfo.isPassword) {
    if (Test-ExactEmailMatch -probeText $focusInfo.value -emailText $emailText) {
      return $true
    }
    if ([string]::IsNullOrWhiteSpace($focusInfo.value)) {
      Log-Automation "login-flow-verify-inconclusive mode=passive-empty-focused-edit"
      return $true
    }
    Log-Automation "login-flow-verify-mismatch mode=passive-focused-edit"
    return $false
  }
  try {
    $mainHandle = Get-MainWindowHandle -preferredPid $preferredPid
    if ($mainHandle -ne [IntPtr]::Zero) {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($mainHandle)
      if ($root) {
        $editCondition = New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::Edit
        )
        $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
        if ($edits -and $edits.Count -gt 0) {
          $sawReadableValue = $false
          for ($idx = 0; $idx -lt $edits.Count; $idx++) {
            $edit = $edits.Item($idx)
            $isPassword = $false
            try { $isPassword = [bool]$edit.Current.IsPassword } catch {}
            if ($isPassword) {
              continue
            }
            $valuePatternObj = $null
            if (-not $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePatternObj)) {
              continue
            }
            $valuePattern = [System.Windows.Automation.ValuePattern]$valuePatternObj
            $value = ''
            try { $value = [string]$valuePattern.Current.Value } catch {}
            $sawReadableValue = $true
            if (Test-ExactEmailMatch -probeText $value -emailText $emailText) {
              return $true
            }
          }
          if ($sawReadableValue) {
            Log-Automation "login-flow-verify-mismatch mode=passive-uia-email-scan"
            return $false
          }
        }
      }
    }
  } catch {}
  Log-Automation "login-flow-verify-inconclusive mode=passive-no-focused-email"
  return $true
}

function Click-PlayButtonLauncherFlow([int]$preferredPid) {
  $h = [IntPtr]::Zero
  if (
    (Is-UsableWindowHandle $launcherWindowHandle) -and
    (Is-LauncherWindowHandle -handle $launcherWindowHandle) -and
    (Is-HandleInPreferredLineage -handle $launcherWindowHandle -preferredPid $preferredPid)
  ) {
    $h = $launcherWindowHandle
    $script:resolvedWindowHandle = $h
  } else {
    $h = Get-MainWindowHandle -preferredPid $preferredPid
    if ($h -ne [IntPtr]::Zero) {
      $script:launcherWindowHandle = $h
    }
  }
  if (-not (Is-LauncherWindowHandle -handle $h)) {
    return $false
  }
  if ($hasCustomPlayCoordinate) {
    if (Click-ClientPercent -preferredPid $preferredPid -xPercent $playXPercent -yPercent $playYPercent -tag 'play-custom') {
      return $true
    }
  }
  if (Click-ClientPercent -preferredPid $preferredPid -xPercent 0.738 -yPercent 0.725 -tag 'play-us') {
    return $true
  }
  if (Click-ClientPercent -preferredPid $preferredPid -xPercent 0.905 -yPercent 0.766 -tag 'play-cn') {
    return $true
  }
  return $false
}

function Try-EnterCredentialsLauncherFlow([int]$preferredPid, [string]$emailText, [string]$passwordText) {
  if (-not (Focus-GW2Window -preferredPid $preferredPid -titles $windowTitles -force $true)) {
    Log-Automation "login-flow-focus-failed"
    return $false
  }
  if (-not (Wait-ForModifierRelease -timeoutMs 5000)) {
    Log-Automation "login-flow-modifier-timeout"
    return $false
  }

  $emailTabs = Get-PreferredEmailTabCount
  $anchor = Get-LauncherEmptyCoordinate -preferredPid $preferredPid
  if (-not $anchor) {
    Log-Automation "login-flow-no-empty-coordinate"
    return $false
  }

  $handle = [IntPtr]$anchor.Handle
  $x = [int]$anchor.X
  $y = [int]$anchor.Y

  $gwlStyle = -16
  $wsDisabled = 0x08000000
  $originalStyle = [GW2AMInput]::GetWindowLongPtr($handle, $gwlStyle)
  $disabledStyle = [IntPtr]([int64]$originalStyle -bor $wsDisabled)
  [void][GW2AMInput]::SetWindowLongPtr($handle, $gwlStyle, $disabledStyle)

  try {
    if (-not (Click-LauncherCoordinate -handle $handle -x $x -y $y)) {
      return $false
    }

    if (-not (Send-TabCountToWindow -preferredPid $preferredPid -count $emailTabs)) {
      for ($n = 0; $n -lt $emailTabs; $n++) {
        Press-TabKey -preferredPid $preferredPid
      }
    }
    Start-Sleep -Milliseconds 90

    $focusAfterEmailTabs = Get-FocusedElementInfo
    $emailStageSkipped = $false
    if ($focusAfterEmailTabs.usable -and $focusAfterEmailTabs.isEdit -and $focusAfterEmailTabs.isPassword) {
      $emailStageSkipped = $true
      Log-Automation "login-flow-email-skipped reason=password-field-focused tabs=$emailTabs"
    }

    if (-not $emailStageSkipped) {
      [void][GW2AMInput]::ReleaseStandardModifiers()
      $emailSet = Try-TypeIntoFocusedField -text $emailText
      if (-not $emailSet) {
        $emailSet = Try-SetEmailViaUIA -preferredPid $preferredPid -emailText $emailText
      }
      if (-not $emailSet) {
        $emailSet = Type-IntoWindowViaPostMessage -preferredPid $preferredPid -text $emailText
      }
      if (-not $emailSet) {
        Log-Automation "login-flow-email-failed tabs=$emailTabs"
        return $false
      }
    }

    if (-not $emailStageSkipped) {
      if (-not (Send-KeyToWindow -preferredPid $preferredPid -virtualKey 0x09)) {
        Press-TabKey -preferredPid $preferredPid
      }
      Start-Sleep -Milliseconds 90
    }

    $focusBeforePassword = Get-FocusedElementInfo
    if (-not ($focusBeforePassword.usable -and $focusBeforePassword.isEdit -and $focusBeforePassword.isPassword)) {
      [void](Try-FocusPasswordViaUIA -preferredPid $preferredPid)
    }

    [void][GW2AMInput]::ReleaseStandardModifiers()
    $passwordSet = Try-TypeIntoFocusedField -text $passwordText
    if (-not $passwordSet) {
      $passwordSet = Try-SetPasswordViaUIA -preferredPid $preferredPid -passwordText $passwordText
    }
    if (-not $passwordSet) {
      $passwordSet = Type-IntoWindowViaPostMessage -preferredPid $preferredPid -text $passwordText
    }
    if (-not $passwordSet) {
      Log-Automation "login-flow-password-failed tabs=$emailTabs"
      return $false
    }

    if (-not $emailStageSkipped) {
      $emailVerified = Verify-EmailFieldPassive -preferredPid $preferredPid -emailText $emailText
      if (-not $emailVerified) {
        Log-Automation "login-flow-verify-failed tabs=$emailTabs"
        return $false
      }
    }

    $focusBeforeSubmit = Get-FocusedElementInfo
    if ($focusBeforeSubmit.usable -and $focusBeforeSubmit.isEdit -and -not $focusBeforeSubmit.isPassword) {
      Log-Automation "login-flow-submit-blocked reason=non-password-edit-focused"
      return $false
    }

    [void][GW2AMInput]::ReleaseStandardModifiers()
    $submitViaWindowMessage = Send-KeyToWindow -preferredPid $preferredPid -virtualKey 0x0D
    $submitUsedGlobalFallback = $false
    if (-not $submitViaWindowMessage) {
      if (Focus-GW2Window -preferredPid $preferredPid -titles $windowTitles -force $true) {
        Press-EnterKey -preferredPid $preferredPid
        $submitUsedGlobalFallback = $true
      }
    }
    $script:emailTabCount = $emailTabs
    $script:launcherWindowHandle = $handle
    Log-Automation "login-flow-submitted tabs=$emailTabs enterWindowMessage=$submitViaWindowMessage enterGlobalFallback=$submitUsedGlobalFallback"
    return $true
  } finally {
    [void][GW2AMInput]::SetWindowLongPtr($handle, $gwlStyle, $originalStyle)
  }
}

for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep -Milliseconds 400
  $now = Get-Date

  if (-not $credentialsSubmitted) {
    if (($now - $lastCredentialAttemptAt).TotalMilliseconds -lt 900) {
      continue
    }
    $lastCredentialAttemptAt = $now

    $loginOk = Try-EnterCredentialsLauncherFlow -preferredPid $pidValue -emailText $emailValue -passwordText $passwordValue
    if ($loginOk) {
      $credentialsSubmitted = $true
      $credentialAttemptCount++
      $credentialsSubmittedAt = Get-Date
      Log-Automation "credentials-submitted attempt=$credentialAttemptCount mode=launcher-flow"
      continue
    }

    $credentialAttemptCount++
    if ($credentialAttemptCount -ge $maxCredentialAttempts) {
      Log-Automation "credentials-aborted reason=entry-failed attempts=$credentialAttemptCount"
      break
    }
    Log-Automation "credentials-retry reason=entry-failed attempts=$credentialAttemptCount"
    Advance-TabProfile
    continue
  }

  if (($now - $credentialsSubmittedAt).TotalMilliseconds -lt 1200) {
    continue
  }

  if (($now - $lastPlayAttemptAt).TotalMilliseconds -lt $playAttemptIntervalMs) {
    continue
  }

  $playWindow = Get-MainWindowHandle -preferredPid $pidValue
  $playWindowClass = Get-WindowClassName -handle $playWindow
  if (-not (Is-LauncherWindowHandle -handle $playWindow)) {
    Log-Automation "play-loop-stopped reason=non-launcher-window class=$playWindowClass"
    break
  }
  if (Is-LikelyFullscreenWindow -hWnd $playWindow) {
    Log-Automation "play-detected-fullscreen-before-attempt"
    break
  }

  $clickedPlay = Click-PlayButtonLauncherFlow -preferredPid $pidValue
  $playAttemptCount++
  $lastPlayAttemptAt = $now
  Log-Automation "play-attempt attempt=$playAttemptCount clicked=$clickedPlay"
  Start-Sleep -Milliseconds 350
  $playWindowAfterEnter = Get-MainWindowHandle -preferredPid $pidValue
  if (Is-LikelyFullscreenWindow -hWnd $playWindowAfterEnter) {
    Log-Automation "play-detected-fullscreen-after-attempt"
    break
  }

  if ($playAttemptCount -ge $maxPlayAttempts) {
    Log-Automation 'script-finished max-play-attempts reached'
    break
  }
}
Log-Automation "script-finished timeout-or-loop-end credentialAttempts=$credentialAttemptCount playAttempts=$playAttemptCount"
`;

  try {
    const automationDir = path.join(app.getPath('temp'), 'gw2am-automation');
    fs.mkdirSync(automationDir, { recursive: true });
    const automationScriptPath = path.join(automationDir, `win-autologin-${accountId}-${Date.now()}.ps1`);
    fs.writeFileSync(automationScriptPath, automationScript, 'utf8');

    const powerShellExecutable = resolveWindowsPowerShellPath();
    deps.logMain('automation', `Windows automation using powershell path=${powerShellExecutable}`);
    const automationProcess = spawn(
      powerShellExecutable,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', automationScriptPath],
      {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GW2_PID: String(pid),
          GW2_EMAIL: email,
          GW2_PASSWORD: password,
          GW2_PLAY_X_PERCENT: typeof normalizedPlayClickXPercent === 'number' ? String(normalizedPlayClickXPercent) : '',
          GW2_PLAY_Y_PERCENT: typeof normalizedPlayClickYPercent === 'number' ? String(normalizedPlayClickYPercent) : '',
        },
      },
    );
    automationProcess.stdout?.on('data', (buf) => {
      deps.logMain('automation', `Windows automation stdout account=${accountId}: ${String(buf).trim()}`);
    });
    automationProcess.stderr?.on('data', (buf) => {
      deps.logMainWarn('automation', `Windows automation stderr account=${accountId}: ${String(buf).trim()}`);
    });
    automationProcess.on('error', (error) => {
      deps.logMainError('automation', `Windows automation error account=${accountId}: ${error.message}`);
    });
    automationProcess.on('exit', (code, signal) => {
      try {
        if (fs.existsSync(automationScriptPath)) {
          fs.unlinkSync(automationScriptPath);
        }
      } catch {
        // ignore temp cleanup failures
      }
      deps.logMain('automation', `Windows automation exit account=${accountId}: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    });
    deps.trackAutomationProcess(accountId, automationProcess.pid);
    deps.logMain('automation', `Windows automation spawned account=${accountId} pid=${automationProcess.pid ?? 'unknown'}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logMainError('automation', `Windows automation spawn setup failed account=${accountId}: ${message}`);
  }
}
