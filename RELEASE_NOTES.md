# Release Notes

Version v0.3.0 — February 10, 2026

## 🌟 Highlights
- OS-specific credential automation flows for Windows and Linux.
- Auto-login now uses a wait period after the launcher appears to boost reliability.

## 🛠️ Improvements
- Launch automation is now split per OS, with OS-specific handling.
- Reduced retry attempts for login when the game is fullscreen to avoid extra spins.

## 🧯 Fixes
- Linux: improved launch reliability and popup suppression during auto-login.
- Windows: credential automation now performs a single-pass login after focusing the password field.

## ⚠️ Breaking Changes
- Linux automation now requires xdotool; install it to enable auto-login.
