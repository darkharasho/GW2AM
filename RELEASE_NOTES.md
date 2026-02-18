# Release Notes

Version v0.4.7 — February 18, 2026

## 🌟 Highlights
- Windows automation script updated to v24 for GW2 Account Manager.

## 🛠️ Improvements
- Window handling now prioritizes the launcher and main GW2 window using the process lineage, improving reliability.
- Launcher selection respects a preferred process and refreshes the lineage only when needed to stay responsive.

## 🧯 Fixes
- Validates that windows are real and visible before interacting to prevent misfires.
- Improves main window detection to avoid using non-usable or unrelated windows.

## ⚠️ Breaking Changes
- None.
