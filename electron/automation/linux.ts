import { spawn, spawnSync } from 'node:child_process';
import type { AutomationDeps } from './windows.js';

export const LINUX_AUTOMATION_SCRIPT_VERSION = 'linux-autologin-v4';

export function startLinuxCredentialAutomation(
  accountId: string,
  pid: number,
  email: string,
  password: string,
  bypassPortalPrompt = false,
  playClickXPercent?: number,
  playClickYPercent?: number,
  deps?: AutomationDeps,
): void {
  if (!deps) return;
  if (process.platform !== 'linux') return;
  const normalizedPlayClickXPercent = Number.isFinite(playClickXPercent)
    ? Math.max(0, Math.min(1, Number(playClickXPercent)))
    : undefined;
  const normalizedPlayClickYPercent = Number.isFinite(playClickYPercent)
    ? Math.max(0, Math.min(1, Number(playClickYPercent)))
    : undefined;
  const hasCustomPlayClick = typeof normalizedPlayClickXPercent === 'number' && typeof normalizedPlayClickYPercent === 'number';
  deps.logMain(
    'automation',
    `Linux automation start account=${accountId} pid=${pid} emailLen=${email.length} script=${LINUX_AUTOMATION_SCRIPT_VERSION} customPlayClick=${hasCustomPlayClick ? `${normalizedPlayClickXPercent},${normalizedPlayClickYPercent}` : 'none'}`,
  );

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
log_automation "mode=deterministic-launcher-flow"

credential_delay_after_window_detect_ms=700
window_detected_ms=0
credentials_submitted_ms=0
play_click_not_before_ms=0
play_attempt_count=0
max_play_attempts=20
last_play_attempt_ms=0
seen_window=0
hardened_attempted=0
credential_submitted=0
tab_profiles="14 1 6 2"
activation_throttle_ms=1200
last_activation_ms=0
launcher_window_class=""
launcher_window_name=""
play_attempt_interval_ms=1000
has_custom_play_click=0
if [ -n "\${GW2_PLAY_X_PERCENT:-}" ] && [ -n "\${GW2_PLAY_Y_PERCENT:-}" ]; then
  has_custom_play_click=1
  log_automation "play-coordinate custom x=$GW2_PLAY_X_PERCENT y=$GW2_PLAY_Y_PERCENT"
fi

release_modifiers() {
  xdotool keyup Shift_L Shift_R Control_L Control_R Alt_L Alt_R Super_L Super_R 2>/dev/null || true
}

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

activate_launcher_window() {
  local now_ms="$1"
  if [ "$now_ms" -gt 0 ] 2>/dev/null && [ "$last_activation_ms" -gt 0 ] 2>/dev/null; then
    if [ $((now_ms - last_activation_ms)) -lt "$activation_throttle_ms" ]; then
      return 0
    fi
  fi
  xdotool windowraise "$win_id" 2>/dev/null || true
  xdotool windowactivate --sync "$win_id" 2>/dev/null || return 1
  xdotool windowfocus --sync "$win_id" 2>/dev/null || true
  local active_id
  active_id="$(xdotool getactivewindow 2>/dev/null || true)"
  last_activation_ms="\${now_ms:-0}"
  [ "$active_id" = "$win_id" ]
}

get_window_name() {
  xdotool getwindowname "$win_id" 2>/dev/null || true
}

get_window_class() {
  xdotool getwindowclassname "$win_id" 2>/dev/null || true
}

is_launcher_identity() {
  local current_class current_name
  current_class="$(get_window_class)"
  current_name="$(get_window_name)"

  if [ -n "$launcher_window_class" ] && [ -n "$current_class" ] && [ "$current_class" != "$launcher_window_class" ]; then
    return 1
  fi

  case "$current_name" in
    *Guild\ Wars*|*ArenaNet*)
      return 0
      ;;
  esac

  if [ -n "$launcher_window_name" ] && [ "$current_name" = "$launcher_window_name" ]; then
    return 0
  fi
  return 1
}

get_window_geometry() {
  eval "$(xdotool getwindowgeometry --shell "$win_id" 2>/dev/null)" || return 1
  if [ -z "$WIDTH" ] || [ -z "$HEIGHT" ]; then
    return 1
  fi
  if [ "$WIDTH" -lt 120 ] || [ "$HEIGHT" -lt 120 ]; then
    return 1
  fi
  return 0
}

click_client_point() {
  local x="$1"
  local y="$2"
  xdotool mousemove --window "$win_id" "$x" "$y" 2>/dev/null || return 1
  xdotool click --window "$win_id" 1 2>/dev/null || xdotool click 1 2>/dev/null || return 1
  sleep 0.07
  return 0
}

send_tab_count() {
  local count="$1"
  if [ -z "$count" ] || [ "$count" -le 0 ] 2>/dev/null; then
    return 0
  fi
  for _ in $(seq 1 "$count"); do
    xdotool key --clearmodifiers --window "$win_id" Tab || return 1
  done
  return 0
}

type_into_focused() {
  local value="$1"
  xdotool key --clearmodifiers --window "$win_id" ctrl+a || return 1
  sleep 0.04
  xdotool key --clearmodifiers --window "$win_id" Delete || return 1
  sleep 0.06
  xdotool type --clearmodifiers --window "$win_id" --delay 1 "$value" || return 1
  return 0
}

submit_hardened_once() {
  local tabs="$1"
  release_modifiers
  activate_launcher_window "$(date +%s%3N)" || return 1
  get_window_geometry || return 1

  local cx cy
  cx=$((WIDTH * 4 / 5))
  cy=$((HEIGHT / 2))
  if [ "$cx" -lt 20 ]; then cx=20; fi
  if [ "$cy" -lt 20 ]; then cy=20; fi

  click_client_point "$cx" "$cy" || return 1
  send_tab_count "$tabs" || return 1
  sleep 0.06
  type_into_focused "$GW2_EMAIL" || return 1
  sleep 0.07
  xdotool key --clearmodifiers --window "$win_id" Tab || return 1
  sleep 0.06
  type_into_focused "$GW2_PASSWORD" || return 1
  sleep 0.08
  xdotool key --clearmodifiers --window "$win_id" Return || return 1
  log_automation "hardened-path-submit tabs=$tabs"
  return 0
}

click_play_button() {
  local attempt="$1"
  get_window_geometry || return 1
  local cx cy

  if [ "$has_custom_play_click" -eq 1 ]; then
    cx="$(awk -v w="$WIDTH" -v p="$GW2_PLAY_X_PERCENT" 'BEGIN { printf("%d", w * p) }')"
    cy="$(awk -v h="$HEIGHT" -v p="$GW2_PLAY_Y_PERCENT" 'BEGIN { printf("%d", h * p) }')"
    if [ "$cx" -lt 20 ]; then cx=20; fi
    if [ "$cy" -lt 20 ]; then cy=20; fi
    if [ "$cx" -gt $((WIDTH - 20)) ]; then cx=$((WIDTH - 20)); fi
    if [ "$cy" -gt $((HEIGHT - 20)) ]; then cy=$((HEIGHT - 20)); fi
    if click_client_point "$cx" "$cy"; then
      log_automation "play-click profile=custom x=$cx y=$cy win_w=$WIDTH win_h=$HEIGHT attempt=$attempt"
      return 0
    fi
  fi

  cx="$(awk -v w="$WIDTH" 'BEGIN { printf("%d", w * 0.738) }')"
  cy="$(awk -v h="$HEIGHT" 'BEGIN { printf("%d", h * 0.725) }')"
  if click_client_point "$cx" "$cy"; then
    log_automation "play-click profile=us x=$cx y=$cy win_w=$WIDTH win_h=$HEIGHT attempt=$attempt"
    return 0
  fi

  cx="$(awk -v w="$WIDTH" 'BEGIN { printf("%d", w * 0.905) }')"
  cy="$(awk -v h="$HEIGHT" 'BEGIN { printf("%d", h * 0.766) }')"
  if click_client_point "$cx" "$cy"; then
    log_automation "play-click profile=cn x=$cx y=$cy win_w=$WIDTH win_h=$HEIGHT attempt=$attempt"
    return 0
  fi

  return 1
}

for i in $(seq 1 220); do
  sleep 0.25

  if is_blocking_prompt_visible; then
    log_automation "waiting-for-blocking-prompt"
    sleep 1.0
    continue
  fi

  win_id="$(find_launcher_window)"
  if [ -z "$win_id" ] || ! [ "$win_id" -gt 0 ] 2>/dev/null; then
    continue
  fi

  now_epoch_ms="$(date +%s%3N)"
  if [ "$seen_window" -eq 0 ]; then
    seen_window=1
    window_detected_ms="$now_epoch_ms"
    log_automation "window-detected id=$win_id"
    launcher_window_class="$(get_window_class)"
    launcher_window_name="$(get_window_name)"
    log_automation "window-identity class=\${launcher_window_class:-unknown} name=\${launcher_window_name:-unknown}"
    if get_window_geometry; then
      log_automation "window-geometry x=$X y=$Y width=$WIDTH height=$HEIGHT"
    fi
    log_automation "credentials-delay-start wait_ms=$credential_delay_after_window_detect_ms"
  fi

  if [ "$credential_submitted" -eq 0 ]; then
    if ! activate_launcher_window "$now_epoch_ms"; then
      continue
    fi
    elapsed_ms=$((now_epoch_ms - window_detected_ms))
    if [ "$elapsed_ms" -lt "$credential_delay_after_window_detect_ms" ]; then
      continue
    fi

    if [ "$hardened_attempted" -eq 0 ]; then
      hardened_attempted=1
      for tabs in $tab_profiles; do
        if submit_hardened_once "$tabs"; then
          credential_submitted=1
          credentials_submitted_ms="$(date +%s%3N)"
          play_click_not_before_ms=$((credentials_submitted_ms + 1200))
          log_automation "credentials-submitted mode=hardened-path tabs=$tabs"
          break
        fi
        log_automation "hardened-path-profile-failed tabs=$tabs"
      done
      if [ "$credential_submitted" -eq 0 ]; then
        log_automation "credentials-aborted reason=hardened-path-failed"
        exit 1
      fi
      continue
    fi
  fi

  if [ "$credential_submitted" -eq 0 ]; then
    continue
  fi
  if [ "$now_epoch_ms" -lt "$play_click_not_before_ms" ]; then
    continue
  fi
  if [ $((now_epoch_ms - last_play_attempt_ms)) -lt "$play_attempt_interval_ms" ]; then
    continue
  fi

  if ! is_launcher_identity; then
    log_automation "play-loop-stopped reason=non-launcher-window class=$(get_window_class) name=$(get_window_name)"
    exit 0
  fi

  click_play_button "$play_attempt_count" || true
  play_attempt_count=$((play_attempt_count + 1))
  last_play_attempt_ms="$now_epoch_ms"
  log_automation "play-attempt attempt=$play_attempt_count"
  if [ "$play_attempt_count" -ge "$max_play_attempts" ]; then
    log_automation "script-finished max-play-attempts reached"
    exit 0
  fi
done

log_automation "script-finished timeout waiting for launcher interaction"
exit 1
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
        GW2_PLAY_X_PERCENT: typeof normalizedPlayClickXPercent === 'number' ? String(normalizedPlayClickXPercent) : '',
        GW2_PLAY_Y_PERCENT: typeof normalizedPlayClickYPercent === 'number' ? String(normalizedPlayClickYPercent) : '',
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
