# GW2 Account Manager

A desktop account launcher for Guild Wars 2 focused on speed, security, and clean multi-account workflow.

## User Features
- **Secure account vault**: credentials are encrypted locally with a master password.
- **Multi-account management**: add, edit, and organize as many accounts as you need.
- **One-click launch flow**: launch accounts through Steam integration with managed arguments.
- **Per-account launch options**: keep custom launch args without manually retyping each session.
- **Start/stop visibility**: clear running/launching/stopping status per account.
- **Auto-updater UX**: animated update indicator, in-app restart when update is ready.
- **What’s New screen**: first launch after update can show release notes in-app.
- **Theme support**: switch visual themes from settings.
- **GW2 API key support (optional)**: resolve account profile metadata in the UI.
- **Built-in links**: quick access to project Discord and GitHub from settings.

## Quick Start
### Install
```bash
npm install
```

### Run in development
```bash
npm run dev
```

### Test update/What’s New flow locally
```bash
npm run dev:update
```

### Build desktop release locally
```bash
npm run electron:build
```
Artifacts are generated in `dist_out`.

## Release Workflow
### Build and publish GitHub release
Set `GITHUB_TOKEN` (or `GH_TOKEN`) and `OPENAI_API_KEY`:
```bash
npm run build:github
```

### Bump version + publish (patch/minor/major)
```bash
npm run build:github -- patch
```
This flow bumps version, updates lockfile, generates AI release notes, commits release files, builds artifacts, and publishes release assets.

### Non-interactive release notes approval
```bash
RELEASE_NOTES_AUTO_APPROVE=1
```

## Configuration
- **Master Password**: set on first launch. If forgotten, resetting app data resets stored accounts.
- **GW2 Path**: set path to `Gw2-64.exe` (Linux can use a wrapper script).
- **Prompt cadence**: choose when the master password is required again.

## Project Links
- Discord: `https://discord.gg/UjzMXMGXEg`
- GitHub: `https://github.com/darkharasho/GW2AM`
