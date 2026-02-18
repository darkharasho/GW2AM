import { spawn, spawnSync } from 'node:child_process';
import type { AutomationDeps } from './windows.js';

export const LINUX_AUTOMATION_SCRIPT_VERSION = 'linux-autologin-v2';

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
  deps.logMain('automation', `Linux automation start account=${accountId} pid=${pid} emailLen=${email.length} script=${LINUX_AUTOMATION_SCRIPT_VERSION}`);

  const xdotoolCheck = spawnSync('which', ['xdotool'], { encoding: 'utf8' });
  if (xdotoolCheck.status !== 0) {
    deps.logMainError('automation', 'Credential automation on Linux requires xdotool to be installed.');
    return;
  }

  const automationScript = `
log_automation() {
  printf '[gw2am-automation] %s\\n' "$1" >&2
}

log_automation "script-start pid=$GW2_PID version=${LINUX_AUTOMATION_SCRIPT_VERSION}"
credential_attempt_count=0
max_credential_attempts=2
credential_delay_after_window_detect_ms=1200
window_detected_ms=0
last_credential_wait_log_ms=0
credentials_submitted_ms=0
play_click_not_before_ms=0
play_attempt_count=0
max_play_attempts=1
last_play_attempt_ms=0
seen_window=0
post_login_geometry_logged=0
tab_profiles="14 1 6 2"
tab_profile_index=0
email_tab_count=14

is_blocking_prompt_visible() {
  if [ "\${GW2_BYPASS_PORTAL_PROMPT:-0}" = "1" ]; then
    return 1
  fi
  if xdotool search --onlyvisible --name "Legacy X11 App Support" 2>/dev/null >/dev/null; then
    return 0
  fi
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
  sleep 0.05
  xdotool key --clearmodifiers --window "$win_id" Delete
  sleep 0.07
}

get_profile_tab_count() {
  local idx="$1"
  local current=0
  for value in $tab_profiles; do
    if [ "$current" -eq "$idx" ]; then
      echo "$value"
      return
    fi
    current=$((current + 1))
  done
  echo "14"
}

advance_tab_profile() {
  tab_profile_index=$((tab_profile_index + 1))
  if [ "$tab_profile_index" -ge 4 ]; then
    tab_profile_index=0
  fi
  email_tab_count="$(get_profile_tab_count "$tab_profile_index")"
  log_automation "tab-profile-advanced index=$tab_profile_index tabs=$email_tab_count"
}

send_tab_count() {
  local count="$1"
  if [ -z "$count" ] || [ "$count" -le 0 ] 2>/dev/null; then
    return 0
  fi
  for _ in $(seq 1 "$count"); do
    xdotool key --clearmodifiers --window "$win_id" Tab
  done
}

focus_email_anchor() {
  local tabs="$1"
  eval "$(xdotool getwindowgeometry --shell "$win_id" 2>/dev/null)" || return 1
  local cx cy
  cx=$((WIDTH - 24))
  cy=$((HEIGHT / 2))
  if [ "$cx" -lt 20 ]; then cx=20; fi
  if [ "$cy" -lt 20 ]; then cy=20; fi
  xdotool mousemove --window "$win_id" "$cx" "$cy" click 1 2>/dev/null || true
  sleep 0.05
  send_tab_count "$tabs"
  sleep 0.06
  log_automation "email-anchor tabs=$tabs"
  return 0
}

submit_credentials_once() {
  local tabs="$1"
  focus_email_anchor "$tabs" || return 1
  clear_focused_input
  xdotool type --clearmodifiers --window "$win_id" --delay 1 "$GW2_EMAIL"
  sleep 0.08
  xdotool key --clearmodifiers --window "$win_id" Tab
  sleep 0.06
  log_automation "password-anchor tabs=$tabs"
  clear_focused_input
  xdotool type --clearmodifiers --window "$win_id" --delay 1 "$GW2_PASSWORD"
  sleep 0.10
  xdotool key --clearmodifiers --window "$win_id" Return
  log_automation "credentials-submitted tabs=$tabs"
  return 0
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
  if [ -z "$win_id" ] || ! [ "$win_id" -gt 0 ] 2>/dev/null; then
    continue
  fi

  if [ "$seen_window" -eq 0 ]; then
    log_automation "window-detected id=$win_id"
    if eval "$(xdotool getwindowgeometry --shell "$win_id" 2>/dev/null)"; then
      log_automation "window-geometry x=$X y=$Y width=$WIDTH height=$HEIGHT"
    fi
    seen_window=1
    window_detected_ms="$(date +%s%3N)"
    log_automation "credentials-delay-start wait_ms=$credential_delay_after_window_detect_ms"
  fi
  now_epoch_ms="$(date +%s%3N)"

  xdotool windowraise "$win_id" 2>/dev/null || true
  xdotool windowactivate --sync "$win_id"
  xdotool windowfocus --sync "$win_id" 2>/dev/null || true
  active_id="$(xdotool getactivewindow 2>/dev/null || true)"
  if [ "$active_id" != "$win_id" ]; then
    continue
  fi

  if [ "$credential_attempt_count" -lt "$max_credential_attempts" ]; then
    if [ "$window_detected_ms" -eq 0 ]; then
      continue
    fi
    credentials_wait_elapsed_ms=$((now_epoch_ms - window_detected_ms))
    if [ "$credentials_wait_elapsed_ms" -lt "$credential_delay_after_window_detect_ms" ]; then
      if [ $((now_epoch_ms - last_credential_wait_log_ms)) -ge 2000 ]; then
        log_automation "waiting-before-credentials elapsed_ms=$credentials_wait_elapsed_ms target_ms=$credential_delay_after_window_detect_ms"
        last_credential_wait_log_ms="$now_epoch_ms"
      fi
      continue
    fi

    email_tab_count="$(get_profile_tab_count "$tab_profile_index")"
    if ! submit_credentials_once "$email_tab_count"; then
      credential_attempt_count=$((credential_attempt_count + 1))
      if [ "$credential_attempt_count" -lt "$max_credential_attempts" ]; then
        log_automation "credentials-retry reason=submit-failed attempt=$credential_attempt_count"
        advance_tab_profile
        continue
      fi
      log_automation "credentials-aborted reason=submit-failed attempts=$credential_attempt_count"
      exit 1
    fi

    sleep 1.8
    credential_attempt_count=$((credential_attempt_count + 1))
    credentials_submitted_ms="$(date +%s%3N)"
    play_click_not_before_ms=$((credentials_submitted_ms + 1200))
    continue
  fi

  if [ "$credential_attempt_count" -eq 0 ]; then
    continue
  fi
  if [ "$now_epoch_ms" -lt "$play_click_not_before_ms" ]; then
    continue
  fi
  if [ $((now_epoch_ms - last_play_attempt_ms)) -lt 4000 ]; then
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
  last_play_attempt_ms="$now_epoch_ms"
  log_automation "play-click attempt=$play_attempt_count"
  if [ "$play_attempt_count" -ge "$max_play_attempts" ]; then
    log_automation "script-finished max-play-attempts reached"
    exit 0
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
