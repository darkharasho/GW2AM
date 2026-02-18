import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
export const WINDOWS_AUTOMATION_SCRIPT_VERSION = 'win-autologin-v6';
export type AutomationDeps = {
  logMain: (scope: string, message: string) => void;
  logMainWarn: (scope: string, message: string) => void;
  logMainError: (scope: string, message: string) => void;
  trackAutomationProcess: (accountId: string, pid?: number) => void;
};
export function startWindowsCredentialAutomation(
  accountId: string,
  pid: number,
  email: string,
  password: string,
  _playClickXPercent?: number,
  _playClickYPercent?: number,
  deps?: AutomationDeps,
): void {
  if (!deps) return;
  if (process.platform !== 'win32') return;
  deps.logMain('automation', `Windows automation start account=${accountId} pid=${pid} emailLen=${email.length} script=${WINDOWS_AUTOMATION_SCRIPT_VERSION}`);

  const automationScript = `
$ProgressPreference = 'SilentlyContinue'
$wshell = New-Object -ComObject WScript.Shell
$pidValue = [int]$env:GW2_PID
$emailValue = $env:GW2_EMAIL
$passwordValue = $env:GW2_PASSWORD
$windowTitles = @('Guild Wars 2', 'Guild Wars2', 'ArenaNet')
$credentialAttemptCount = 0
$maxCredentialAttempts = 2
$emailSubmitted = $false
$passwordSubmitted = $false
$passwordSubmitAttempted = $false
$passwordFocusLocked = $false
$emailTabCount = -1
$tabProfiles = @(14, 1, 6, 2)
$tabProfileIndex = 0
$emailSubmittedAt = [DateTime]::MinValue
$lastStageAdvanceAt = [DateTime]::MinValue
$resolvedWindowHandle = [IntPtr]::Zero
$credentialsSubmittedAt = [DateTime]::MinValue
$playAttemptCount = 0
$maxPlayAttempts = 3
$playAttemptIntervalMs = 4000
$lastPlayAttemptAt = [DateTime]::MinValue

function Log-Automation([string]$message) {
  [Console]::Out.WriteLine("[gw2am-automation] $message")
}
Log-Automation "script-start pid=$pidValue version=${WINDOWS_AUTOMATION_SCRIPT_VERSION}"
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
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
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
  if (-not (Send-TabCountToWindow -preferredPid $preferredPid -count $tabCount)) {
    for ($n = 0; $n -lt $tabCount; $n++) {
      Press-TabKey -preferredPid $preferredPid
    }
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
        if (-not (Wait-ForModifierRelease -timeoutMs 5000)) {
          Log-Automation "email-stage-blocked-by-modifier loop=$i"
          continue
        }

        if (-not (Try-FocusEmailField -preferredPid $pidValue -emailText $emailValue)) {
          Log-Automation "email-focus-failed loop=$i"
          continue
        }

        Start-Sleep -Milliseconds 220
        $emailAlreadyPresent = Test-EmailAlreadyPresent -emailText $emailValue
        if ($emailAlreadyPresent) {
          Log-Automation "email-prefilled-detected loop=$i"
          $emailSet = $true
        } else {
          Clear-FocusedInput
          [void][GW2AMInput]::ReleaseStandardModifiers()
          $emailSet = (Type-IntoFocusedInput $emailValue)
          if (-not $emailSet) {
            $emailSet = (Paste-IntoFocusedInput $emailValue)
          }
        }
        if (-not $emailSet) {
          Log-Automation "email-entry-failed loop=$i"
          Advance-TabProfile
          continue
        }

        # Only submit when we can confirm the focused field contains the target email.
        $emailVerified = $false
        $emailProbe = Read-FocusedInputText
        if ($emailProbe -eq '__GW2AM_NO_COPY__') {
          # Non-copyable controls exist in some launcher states; allow a cautious submit path.
          $emailVerified = $true
          Log-Automation "email-verify-skipped reason=noncopyable loop=$i"
        } else {
          $emailVerified = Test-ExactEmailMatch -probeText $emailProbe -emailText $emailValue
          Log-Automation "email-verify loop=$i probeLen=$($emailProbe.Length) verified=$emailVerified looksEmail=$(Test-LooksLikeEmailField -probeText $emailProbe -emailText $emailValue)"
        }
        if (-not $emailVerified) {
          Log-Automation "email-verify-failed loop=$i"
          Advance-TabProfile
          Start-Sleep -Milliseconds 150
          continue
        }

        Start-Sleep -Milliseconds 60
        [void][GW2AMInput]::ReleaseStandardModifiers()
        Press-EnterKey -preferredPid $pidValue
        $emailSubmitted = $true
        $passwordSubmitAttempted = $false
        $passwordFocusLocked = $false
        $emailSubmittedAt = Get-Date
        Log-Automation "email-submitted loop=$i"
        continue
      }

      if (-not $passwordSubmitted) {
        # Wait for launcher transition from email stage to password stage.
        $elapsedMs = [int](($now - $emailSubmittedAt).TotalMilliseconds)
        if ($elapsedMs -lt 650) {
          Log-Automation "waiting-password-stage loop=$i elapsedMs=$([int](($now - $emailSubmittedAt).TotalMilliseconds))"
          continue
        }
        if ($passwordSubmitAttempted) {
          continue
        }
        $passwordSubmitAttempted = $true

        if (-not (Wait-ForModifierRelease -timeoutMs 5000)) {
          Log-Automation "password-stage-blocked-by-modifier loop=$i"
          $passwordSubmitAttempted = $false
          continue
        }

        $tabsForPassword = Get-PreferredEmailTabCount
        $passwordFocusLocked = Focus-PasswordFromEmailAnchor -preferredPid $pidValue -emailTabs $tabsForPassword -emailText $emailValue -allowNonCopyableAnchor $true
        if (-not $passwordFocusLocked) {
          $passwordFocusLocked = Try-FocusPasswordViaUIA -preferredPid $pidValue
        }
        Log-Automation "password-focus-lock loop=$i locked=$passwordFocusLocked tabs=$tabsForPassword"

        $passwordSet = $false
        if ($passwordFocusLocked) {
          Clear-FocusedInput
          [void][GW2AMInput]::ReleaseStandardModifiers()
          $passwordSet = Type-IntoFocusedInput $passwordValue
          if (-not $passwordSet) {
            $passwordSet = Paste-IntoFocusedInput $passwordValue
          }
        }
        if (-not $passwordSet) {
          $passwordSet = Try-SetPasswordViaUIA -preferredPid $pidValue -passwordText $passwordValue
        }
        if (-not $passwordSet) {
          $passwordSet = Type-IntoWindowViaPostMessage -preferredPid $pidValue -text $passwordValue
        }
        Log-Automation "password-write-attempt loop=$i success=$passwordSet"
        if (-not $passwordSet) {
          $credentialAttemptCount++
          if ($credentialAttemptCount -ge $maxCredentialAttempts) {
            Log-Automation "credentials-aborted reason=password-write-failed attempts=$credentialAttemptCount"
            break
          }
          Log-Automation "credentials-retry reason=password-write-failed attempts=$credentialAttemptCount"
          $emailSubmitted = $false
          $passwordSubmitAttempted = $false
          $passwordFocusLocked = $false
          $emailSubmittedAt = [DateTime]::MinValue
          Advance-TabProfile
          Start-Sleep -Milliseconds 240
          continue
        }
        Start-Sleep -Milliseconds 120
        [void][GW2AMInput]::ReleaseStandardModifiers()
        Press-EnterKey -preferredPid $pidValue
        $passwordSubmitted = $true
        $credentialAttemptCount++
        $credentialsSubmittedAt = Get-Date
        Log-Automation "credentials-submitted attempt=$credentialAttemptCount mode=anchored"
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

    $playWindow = Get-MainWindowHandle -preferredPid $pidValue
    if (Is-LikelyFullscreenWindow -hWnd $playWindow) {
      Log-Automation "play-detected-fullscreen-before-attempt"
      break
    }

    Press-EnterKey -preferredPid $pidValue
    $playAttemptCount++
    $lastPlayAttemptAt = $now
    Log-Automation "play-enter attempt=$playAttemptCount"
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
