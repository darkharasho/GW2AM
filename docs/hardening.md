# Hardening Recommendations

Prioritized plan for keeping existing functionality while hardening against failure modes on both Linux and Windows.

---

## Tier 1 — Critical (data loss / security)

### 1. Store backup & corruption recovery

`electron/main.ts` uses `electron-store` with no backup. A single corrupt write (power loss, crash mid-save) loses all account data.

- Write a backup copy of the store file before each save, rotating the last N backups
- On load failure, detect corruption and offer to restore from the most recent good backup
- Applies to both platforms equally

### 2. IPC timeout + error handling in renderer

`src/App.tsx` has many `void window.api.foo()` calls and `.then()` without `.catch()`. If the main process hangs or throws, the renderer silently breaks.

- Wrap every IPC call in a helper that enforces a timeout (e.g. 10s) and surfaces errors to the UI
- Add try/catch to `handleStop` (currently has none — a failure leaves the UI stuck in "stopping" forever)
- Show toast/banner on IPC failures instead of silent swallowing

### 3. Master key disk caching

`electron/main.ts` writes `cachedMasterKey` as hex to the unencrypted electron-store JSON. If the disk is compromised, all credentials are exposed.

- Consider using OS keychain (`keytar` / `libsecret` on Linux, Credential Manager on Windows) instead of plaintext JSON
- If keeping the current approach, at minimum encrypt the cached key with a machine-specific secret (DPAPI on Windows, `secret-tool` on Linux)

---

## Tier 2 — High (automation reliability)

### 4. Shell-escape credentials in the Linux bash script

`xdotool type` receives email/password via env vars, which are visible in `/proc/<pid>/environ` to same-user processes for the lifetime of the automation script.

- **Note:** Stdin pipe approach was attempted but has a race condition with `detached: true` child processes — `stdin.end()` flushes asynchronously and bash `read` can fail. Reverted to env vars which are reliable.
- Credentials are properly double-quoted (`"$GW2_EMAIL"`) in the script, so shell metacharacters are safe
- Remaining risk is limited: only same-user processes can read `/proc/environ`, and the automation process is short-lived (~72s max)
- Future improvement: consider writing credentials to a tmpfs-backed temp file (deleted immediately after read) to avoid `/proc/environ` exposure entirely

### 5. Automation process timeout & cleanup

The Linux automation loop runs up to 180 iterations with no hard timeout. If the game never appears, the script runs for 70+ seconds silently.

- Add an absolute timeout (e.g. `timeout 90s` wrapping the bash script, or `setTimeout` + `process.kill()` on the Node side)
- On app quit (`before-quit`), kill all tracked automation child processes to prevent orphans
- Track PIDs in a `Set<number>` and clean up on exit

### 6. Surface xdotool / tool availability to the user

`electron/main.ts` checks `which xdotool` but returns silently on failure. The user has no idea why automation didn't work.

- If `xdotool` is missing, send an IPC message back to the renderer with a specific error: "xdotool not found — install it with `sudo dnf install xdotool`"
- Same for Wayland permission issues: surface the warning to the UI, not just `console.warn`

### 7. Windows SendKeys robustness

The special character escaping for `SendKeys` is incomplete, and non-ASCII passwords may fail due to UTF-16LE encoding edge cases.

- Switch from `WScript.Shell.SendKeys` to `System.Windows.Forms.SendKeys` or use clipboard-paste (`SetClipboard` + `Ctrl+V`) which handles all characters reliably
- Add a post-activation verification (check window title after `AppActivate`) to confirm the correct window received focus

### 8. Validate state transitions in LaunchStateMachine

`electron/launchStateMachine.ts` accepts any state from any state with no validation.

- Define a `VALID_TRANSITIONS` map and reject illegal transitions with a logged warning
- Add a per-state timeout (e.g. `launching` → auto-transition to `errored` after 120s if no progress)

---

## Tier 3 — Medium (edge cases & UX)

### 9. Window bounds validation on restore

`electron/main.ts` restores window position from store without checking if the saved coordinates are on-screen (monitor removed, resolution changed).

- Use `screen.getDisplayMatching(bounds)` to verify the saved rect overlaps a visible display; fall back to center of primary display if not

### 10. GW2 path validation

`electron/main.ts` only checks `fs.existsSync()` for the GW2 executable path.

- On Linux: also check the file is executable (`fs.accessSync(path, fs.constants.X_OK)`)
- On Windows: verify the extension is `.exe`
- Reject paths with `..` segments to prevent traversal

### 11. GitHub API fetch timeout

Release notes fetch has no timeout — a network hang blocks the app.

- Add `AbortController` with a 10s timeout
- Gracefully degrade: show "Release notes unavailable" instead of hanging

### 12. Interval stacking guard

If `isUnlocked` toggles rapidly in `src/App.tsx`, multiple `setInterval` timers for `refreshActiveProcesses` could stack.

- Store the interval ID in a ref and always `clearInterval` before creating a new one
- Or use a single interval that checks the unlock state internally

### 13. Add structured logging for all error paths

Currently errors are scattered across `console.log`, `console.error`, and `console.warn` with no structure.

- Use a lightweight logger (e.g. `electron-log`) that writes to a rotating log file
- Include timestamps, severity levels, and subsystem tags
- This makes debugging user-reported issues dramatically easier on both platforms

---

## Summary

| Priority | Item | Platform | Effort |
|----------|------|----------|--------|
| Critical | Store backup/recovery | Both | Medium |
| Critical | IPC timeout + error handling | Both | Medium |
| Critical | Master key disk storage | Both | High |
| High | Shell-escape credentials | Linux | Low |
| High | Automation timeout + cleanup | Both | Low |
| High | Surface tool availability errors | Linux | Low |
| High | SendKeys robustness | Windows | Medium |
| High | State machine validation | Both | Low |
| Medium | Window bounds validation | Both | Low |
| Medium | GW2 path validation | Both | Low |
| Medium | Fetch timeout | Both | Low |
| Medium | Interval stacking guard | Both | Low |
| Medium | Structured logging | Both | Medium |
