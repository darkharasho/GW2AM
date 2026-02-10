import { spawn, spawnSync } from 'node:child_process';
import type { AutomationDeps } from './windows.js';
export function startLinuxCredentialAutomation(
  accountId: string,
  pid: number,
  email: string,
  password: string,
  bypassPortalPrompt = false,
  deps?: AutomationDeps,
): void {
  if (!deps) return;
  if (process.platform !== 'linux') return;
  deps.logMain('automation', `Linux automation start account=${accountId} pid=${pid} emailLen=${email.length}`);

  const xdotoolCheck = spawnSync('which', ['xdotool'], { encoding: 'utf8' });
  if (xdotoolCheck.status !== 0) {
    deps.logMainError('automation', 'Credential automation on Linux requires xdotool to be installed.');
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
    deps.logMain('automation', `Linux automation stdout account=${accountId}: ${String(buf).trim()}`);
  });
  automationProcess.stderr?.on('data', (buf) => {
    const output = String(buf).trim();
    deps.logMainWarn('automation', `Linux automation stderr account=${accountId}: ${output}`);
  });
  automationProcess.on('error', (error) => {
    deps.logMainError('automation', `Linux automation error account=${accountId}: ${error.message}`);
  });
  automationProcess.on('exit', (code, signal) => {
    deps.logMain('automation', `Linux automation exit account=${accountId}: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });
  deps.trackAutomationProcess(accountId, automationProcess.pid);
  deps.logMain('automation', `Linux automation spawned account=${accountId} pid=${automationProcess.pid ?? 'unknown'}`);
  automationProcess.unref();
}
