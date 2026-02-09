import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
function summarizeStderr(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text)
        return '';
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}
function hasBinary(name) {
    const result = spawnSync('which', [name], { encoding: 'utf8' });
    return result.status === 0;
}
export function canUseVisionStateDetector() {
    if (process.platform !== 'linux')
        return false;
    if (!process.env.WAYLAND_DISPLAY)
        return false;
    return hasBinary('grim') && hasBinary('tesseract');
}
export function detectVisionState() {
    if (!canUseVisionStateDetector()) {
        return {
            supported: false,
            launcherVisible: false,
            loginVisible: false,
            playVisible: false,
            evidence: 'none',
            note: 'Vision detector unavailable (requires Wayland + grim + tesseract).',
        };
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2am-vision-'));
    const screenshotPath = path.join(tmpDir, 'screen.png');
    try {
        const screenshotResult = spawnSync('grim', [screenshotPath], { encoding: 'utf8', timeout: 5000 });
        if (screenshotResult.status !== 0) {
            const stderr = summarizeStderr(screenshotResult.stderr);
            return {
                supported: true,
                launcherVisible: false,
                loginVisible: false,
                playVisible: false,
                evidence: 'none',
                note: `Failed to capture screenshot.${stderr ? ` stderr=${stderr}` : ''}`,
            };
        }
        const ocrResult = spawnSync('tesseract', [screenshotPath, 'stdout', '--psm', '6'], {
            encoding: 'utf8',
            timeout: 7000,
        });
        if (ocrResult.status !== 0 || !ocrResult.stdout) {
            const stderr = summarizeStderr(ocrResult.stderr);
            return {
                supported: true,
                launcherVisible: false,
                loginVisible: false,
                playVisible: false,
                evidence: 'none',
                note: `OCR failed.${stderr ? ` stderr=${stderr}` : ''}`,
            };
        }
        const text = String(ocrResult.stdout || '').toUpperCase();
        const launcherVisible = /(GUILD\s*WARS\s*2|ARENANET|LATEST\s*NEWS|PLAYABLE)/.test(text);
        const loginVisible = /(EMAIL|PASSWORD|LOG.?IN|LOGIN|ACCOUNT)/.test(text);
        const playVisible = /\bPLAY\b/.test(text);
        return {
            supported: true,
            launcherVisible: launcherVisible || loginVisible || playVisible,
            loginVisible,
            playVisible,
            evidence: 'ocr',
            note: `OCR detected: launcher=${launcherVisible}, login=${loginVisible}, play=${playVisible}`,
        };
    }
    catch (error) {
        return {
            supported: true,
            launcherVisible: false,
            loginVisible: false,
            playVisible: false,
            evidence: 'none',
            note: `Vision detector error: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    finally {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch {
            // ignore cleanup issues
        }
    }
}
