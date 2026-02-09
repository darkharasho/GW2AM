import { useEffect, useRef, useState } from 'react';
import { Account } from './types.js';
import AccountCard from './components/AccountCard.tsx';
import AddAccountModal from './components/AddAccountModal.tsx';
import MasterPasswordModal from './components/MasterPasswordModal.tsx';
import SettingsModal from './components/SettingsModal.tsx';
import { applyTheme } from './themes/applyTheme';
import { Plus, Settings, Minus, Square, X, RefreshCw } from 'lucide-react';

type LaunchPhase = 'idle' | 'launch_requested' | 'launcher_started' | 'credentials_waiting' | 'credentials_submitted' | 'process_detected' | 'running' | 'stopping' | 'stopped' | 'errored';
type LaunchCertainty = 'verified' | 'inferred';
type LaunchStateInfo = { accountId: string; phase: LaunchPhase; certainty: LaunchCertainty; updatedAt: number; note?: string };

function App() {
    const ACTIVE_PROCESS_MISS_THRESHOLD = 3;
    const appVersion = __APP_VERSION__;
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [activeAccountIds, setActiveAccountIds] = useState<string[]>([]);
    const [accountApiNames, setAccountApiNames] = useState<Record<string, string>>({});
    const [accountApiCreatedAt, setAccountApiCreatedAt] = useState<Record<string, string>>({});
    const [accountStatuses, setAccountStatuses] = useState<Record<string, 'idle' | 'launching' | 'running' | 'stopping' | 'errored'>>({});
    const [accountStatusCertainty, setAccountStatusCertainty] = useState<Record<string, LaunchCertainty>>({});
    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [masterPasswordMode, setMasterPasswordMode] = useState<'set' | 'verify'>('verify');
    const [masterPasswordError, setMasterPasswordError] = useState('');

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<Account | undefined>(undefined);

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [updatePhase, setUpdatePhase] = useState<'idle' | 'checking' | 'downloading' | 'ready' | 'error'>('idle');
    const [updateLabel, setUpdateLabel] = useState('');
    const [updateProgress, setUpdateProgress] = useState<number | null>(null);
    const processMissCountsRef = useRef<Record<string, number>>({});

    useEffect(() => {
        if (!window.api) {
            alert("FATAL: window.api is missing! IPC broken.");
            return;
        }
        window.api.getSettings().then((settings) => {
            applyTheme(settings?.themeId || 'blood_legion');
        });
        checkMasterPassword().finally(() => setIsAuthChecking(false));
    }, []);

    const checkMasterPassword = async () => {
        const hasPassword = await window.api.hasMasterPassword();
        if (hasPassword) {
            const shouldPrompt = await window.api.shouldPromptMasterPassword();
            if (shouldPrompt) {
                setMasterPasswordMode('verify');
            } else {
                setIsUnlocked(true);
                await loadAccounts();
            }
        } else {
            setMasterPasswordMode('set');
        }
    };

    const handleMasterPasswordSubmit = async (password: string) => {
        setMasterPasswordError('');
        if (masterPasswordMode === 'set') {
            await window.api.setMasterPassword(password);
            setIsUnlocked(true);
            loadAccounts();
        } else {
            const isValid = await window.api.verifyMasterPassword(password);
            if (isValid) {
                setIsUnlocked(true);
                loadAccounts();
            } else {
                setMasterPasswordError('Invalid password');
            }
        }
    };

    const loadAccounts = async () => {
        const loadedAccounts = await window.api.getAccounts();
        setAccounts(loadedAccounts);
    };

    const refreshActiveProcesses = async () => {
        const [active, launchStates] = await Promise.all([
            window.api.getActiveAccountProcesses(),
            window.api.getLaunchStates() as Promise<LaunchStateInfo[]>,
        ]);
        const rawActiveIds = active.map((processInfo) => processInfo.accountId);
        const rawActiveSet = new Set(rawActiveIds);
        const launchStateMap = new Map(launchStates.map((state) => [state.accountId, state] as const));

        setActiveAccountIds((previous) => {
            const previousSet = new Set(previous);
            const nextSet = new Set(rawActiveIds);
            const allTrackedIds = new Set([...previousSet, ...rawActiveSet]);

            allTrackedIds.forEach((id) => {
                if (rawActiveSet.has(id)) {
                    processMissCountsRef.current[id] = 0;
                    nextSet.add(id);
                    return;
                }
                const nextMisses = (processMissCountsRef.current[id] || 0) + 1;
                processMissCountsRef.current[id] = nextMisses;
                if (previousSet.has(id) && nextMisses < ACTIVE_PROCESS_MISS_THRESHOLD) {
                    nextSet.add(id);
                }
            });

            const stabilizedActiveIds = Array.from(nextSet);
            const stabilizedSet = new Set(stabilizedActiveIds);
            setAccountStatuses((previousStatuses) => {
                const nextStatuses = { ...previousStatuses };
                Object.keys(nextStatuses).forEach((id) => {
                    if (stabilizedSet.has(id)) {
                        nextStatuses[id] = 'running';
                    } else if (nextStatuses[id] === 'running' || nextStatuses[id] === 'stopping') {
                        nextStatuses[id] = 'idle';
                    }
                });
                launchStateMap.forEach((launchState, id) => {
                    const mapped = mapLaunchPhaseToStatus(launchState.phase);
                    if (!mapped) return;
                    if (!stabilizedSet.has(id) && (launchState.phase === 'running' || launchState.phase === 'process_detected' || launchState.phase === 'stopping')) {
                        nextStatuses[id] = 'idle';
                        return;
                    }
                    nextStatuses[id] = mapped;
                });
                return nextStatuses;
            });
            setAccountStatusCertainty(() => {
                const next: Record<string, LaunchCertainty> = {};
                launchStateMap.forEach((launchState, id) => {
                    next[id] = launchState.certainty;
                });
                return next;
            });

            return stabilizedActiveIds;
        });
    };

    const handleSaveAccount = async (accountData: Omit<Account, 'id'>) => {
        if (editingAccount) {
            await window.api.updateAccount(editingAccount.id, accountData);
        } else {
            await window.api.saveAccount(accountData);
        }
        loadAccounts();
        setEditingAccount(undefined);
    };

    const handleDeleteAccount = async (id: string) => {
        await window.api.deleteAccount(id);
        loadAccounts();
        setAccountStatuses((previous) => {
            const next = { ...previous };
            delete next[id];
            return next;
        });
    };

    const handleEditAccount = (account: Account) => {
        setEditingAccount(account);
        setIsAddModalOpen(true);
    };

    const handleLaunch = async (id: string) => {
        processMissCountsRef.current[id] = 0;
        setAccountStatuses((previous) => ({ ...previous, [id]: 'launching' }));
        try {
            const launched = await window.api.launchAccount(id);
            if (!launched) {
                setAccountStatuses((previous) => ({ ...previous, [id]: 'errored' }));
                alert('GW2 did not report as launched for this account. Check Steam and launcher state.');
            } else {
                setAccountStatuses((previous) => ({ ...previous, [id]: 'running' }));
            }
        } catch {
            setAccountStatuses((previous) => ({ ...previous, [id]: 'errored' }));
            alert('Failed to launch GW2 for this account.');
        }
        setTimeout(() => {
            refreshActiveProcesses();
        }, 600);
    };

    const handleStop = async (id: string) => {
        processMissCountsRef.current[id] = 0;
        setAccountStatuses((previous) => ({ ...previous, [id]: 'stopping' }));
        const stopped = await window.api.stopAccountProcess(id);
        if (!stopped) {
            setAccountStatuses((previous) => ({ ...previous, [id]: 'errored' }));
        }
        setTimeout(() => {
            refreshActiveProcesses();
        }, 300);
    };

    useEffect(() => {
        setAccountStatuses((previous) => {
            const next: Record<string, 'idle' | 'launching' | 'running' | 'stopping' | 'errored'> = {};
            accounts.forEach((account) => {
                next[account.id] = previous[account.id] ?? 'idle';
            });
            return next;
        });
        const validIds = new Set(accounts.map((account) => account.id));
        Object.keys(processMissCountsRef.current).forEach((id) => {
            if (!validIds.has(id)) {
                delete processMissCountsRef.current[id];
            }
        });
    }, [accounts]);

    useEffect(() => {
        let cancelled = false;
        const cached: Record<string, string> = {};
        const cachedCreatedAt: Record<string, string> = {};
        accounts.forEach((account) => {
            const cachedName = (account.apiAccountName || '').trim();
            if (cachedName) {
                cached[account.id] = cachedName;
            }
            const createdAt = (account.apiCreatedAt || '').trim();
            if (createdAt) {
                cachedCreatedAt[account.id] = createdAt;
            }
        });
        setAccountApiNames(cached);
        setAccountApiCreatedAt(cachedCreatedAt);

        const accountsWithApiKey = accounts.filter((account) => {
            const key = (account.apiKey || '').trim();
            const cachedName = (account.apiAccountName || '').trim();
            const createdAt = (account.apiCreatedAt || '').trim();
            return key.length > 0 && (cachedName.length === 0 || createdAt.length === 0);
        });

        if (accountsWithApiKey.length === 0) {
            return () => {
                cancelled = true;
            };
        }

        const loadApiNames = async () => {
            const resolvedEntries = await Promise.all(accountsWithApiKey.map(async (account) => {
                try {
                    const token = (account.apiKey || '').trim();
                    const profile = await window.api.resolveAccountProfile(token);
                    return [account.id, profile.name, profile.created] as const;
                } catch {
                    return [account.id, '', ''] as const;
                }
            }));

            if (cancelled) return;

            resolvedEntries.forEach(([id, name, created]) => {
                if (name || created) {
                    void window.api.setAccountApiProfile(id, { name, created });
                }
            });
            setAccountApiNames((previous) => {
                const next = { ...previous };
                resolvedEntries.forEach(([id, name]) => {
                    if (name) next[id] = name;
                });
                return next;
            });
            setAccountApiCreatedAt((previous) => {
                const next = { ...previous };
                resolvedEntries.forEach(([id, _name, created]) => {
                    if (created) next[id] = created;
                });
                return next;
            });
        };

        loadApiNames();

        return () => {
            cancelled = true;
        };
    }, [accounts]);

    useEffect(() => {
        if (!isUnlocked) return;
        refreshActiveProcesses();
        const timer = window.setInterval(() => {
            refreshActiveProcesses();
        }, 2000);
        return () => {
            window.clearInterval(timer);
        };
    }, [isUnlocked]);

    useEffect(() => {
        if (!window.api) return;

        const removeListeners: Array<() => void> = [
            window.api.onUpdateMessage((value) => {
                const message = String(value || '').trim() || 'Checking for updates...';
                setUpdatePhase('checking');
                setUpdateLabel(message);
                setUpdateProgress(null);
            }),
            window.api.onUpdateAvailable(() => {
                setUpdatePhase('downloading');
                setUpdateLabel('Downloading update...');
            }),
            window.api.onDownloadProgress((value) => {
                const percentRaw = Number((value as { percent?: number } | null)?.percent);
                const percent = Number.isFinite(percentRaw) ? Math.max(0, Math.min(100, percentRaw)) : null;
                setUpdatePhase('downloading');
                setUpdateProgress(percent);
                setUpdateLabel(percent === null ? 'Downloading update...' : `Downloading update... ${Math.round(percent)}%`);
            }),
            window.api.onUpdateDownloaded(() => {
                setUpdatePhase('ready');
                setUpdateLabel('Restart to update');
                setUpdateProgress(100);
            }),
            window.api.onUpdateNotAvailable(() => {
                setUpdatePhase('idle');
                setUpdateLabel('');
                setUpdateProgress(null);
            }),
            window.api.onUpdateError((value) => {
                const message = typeof value === 'string'
                    ? value
                    : String(value?.message || 'Update check failed');
                setUpdatePhase('error');
                setUpdateLabel(message);
                setUpdateProgress(null);
            }),
        ];

        return () => {
            removeListeners.forEach((remove) => remove());
        };
    }, []);

    const showUpdateIndicator = updatePhase !== 'idle';
    const updateIndicatorText = updateLabel
        || (updatePhase === 'checking' ? 'Checking for updates...' : updatePhase === 'downloading' ? 'Downloading update...' : updatePhase === 'ready' ? 'Restart to apply update' : 'Update error');
    const updateShortLabel = updatePhase === 'checking'
        ? 'Checking'
        : updatePhase === 'downloading'
            ? (updateProgress !== null ? `${Math.round(updateProgress)}%` : 'Downloading')
            : updatePhase === 'ready'
                ? 'Restart'
                : 'Error';
    const updateIndicatorClass = `update-indicator ${updatePhase === 'error'
        ? 'update-indicator--error'
        : updatePhase === 'ready'
            ? 'update-indicator--ready'
            : ''}`;

    const renderUpdateIndicator = () => {
        if (!showUpdateIndicator) return null;
        const progressWidth = updateProgress === null ? 28 : Math.max(8, Math.min(100, Math.round(updateProgress)));
        const content = (
            <>
                {(updatePhase === 'checking' || updatePhase === 'downloading') && (
                    <span className="update-indicator__state update-indicator__state--checking" aria-hidden="true">
                        <span className="update-indicator__ring" />
                        <RefreshCw size={10} className="update-indicator__spinner animate-spin" />
                    </span>
                )}
                {updatePhase === 'ready' && <span className="update-indicator__state bg-emerald-300" aria-hidden="true" />}
                {updatePhase === 'error' && <span className="update-indicator__state bg-rose-300" aria-hidden="true" />}
                <span>{updateShortLabel}</span>
                {updatePhase === 'downloading' && (
                    <span className="update-indicator__progress" aria-hidden="true">
                        <span className="update-indicator__progress-fill" style={{ width: `${progressWidth}%` }} />
                        <span className="update-indicator__progress-shimmer" />
                    </span>
                )}
            </>
        );

        if (updatePhase === 'ready') {
            return (
                <button
                    type="button"
                    className={`${updateIndicatorClass} cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98]`}
                    title={updateIndicatorText}
                    style={{ WebkitAppRegion: 'no-drag' } as any}
                    onClick={() => window.api?.restartApp()}
                >
                    {content}
                </button>
            );
        }

        return (
            <span className={updateIndicatorClass} title={updateIndicatorText}>
                {content}
            </span>
        );
    };

    // Window controls
    const minimize = () => {
        console.log('Minimize clicked');
        if (window.api) window.api.minimizeWindow();
        else console.error('window.api is missing');
    };
    const maximize = () => {
        console.log('Maximize clicked');
        if (window.api) window.api.maximizeWindow();
        else console.error('window.api is missing');
    };
    const close = () => {
        console.log('Close clicked');
        if (window.api) window.api.closeWindow();
        else console.error('window.api is missing');
    };

    if (isAuthChecking) {
        return (
            <div className="h-screen w-screen text-white flex flex-col">
                <div className="h-8 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] flex justify-between items-center px-2 select-none" style={{ WebkitAppRegion: 'drag' } as any}>
                    <span className="text-xs font-bold ml-2 flex items-center gap-2">
                        <img src="img/GW2AM.png" alt="GW2AM" className="w-4 h-4 object-contain" />
                        GW2 AM
                        <span className="text-[10px] font-normal text-[var(--theme-text-dim)]">v{appVersion}</span>
                        {renderUpdateIndicator()}
                    </span>
                    <div className="flex space-x-2 relative z-50" style={{ WebkitAppRegion: 'no-drag' } as any}>
                        <button onClick={close} className="p-1 hover:bg-[var(--theme-accent)] rounded transition-colors"><X size={12} /></button>
                    </div>
                </div>
            </div>
        );
    }

    if (!isUnlocked) {
        return (
            <div className="h-screen w-screen text-white flex flex-col">
                {/* Custom Title Bar */}
                <div className="h-8 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] flex justify-between items-center px-2 select-none" style={{ WebkitAppRegion: 'drag' } as any}>
                    <span className="text-xs font-bold ml-2 flex items-center gap-2">
                        <img src="img/GW2AM.png" alt="GW2AM" className="w-4 h-4 object-contain" />
                        GW2 AM
                        <span className="text-[10px] font-normal text-[var(--theme-text-dim)]">v{appVersion}</span>
                        {renderUpdateIndicator()}
                    </span>
                    <div className="flex space-x-2 relative z-50" style={{ WebkitAppRegion: 'no-drag' } as any}>
                        <button onClick={close} className="p-1 hover:bg-[var(--theme-accent)] rounded transition-colors"><X size={12} /></button>
                    </div>
                </div>
                <MasterPasswordModal
                    mode={masterPasswordMode}
                    onSubmit={handleMasterPasswordSubmit}
                    error={masterPasswordError}
                />
            </div>
        );
    }

    return (
        <div className="h-screen w-screen text-white flex flex-col overflow-hidden border border-[var(--theme-border)] relative">
            <div className="gw2am-mark" aria-hidden="true" />
            {/* Custom Title Bar */}
            <div className="h-9 bg-[var(--theme-surface)] flex justify-between items-center px-3 select-none border-b border-[var(--theme-border)] relative z-10" style={{ WebkitAppRegion: 'drag' } as any}>
                <span className="text-sm font-bold text-[var(--theme-title)] flex items-center gap-2">
                    <img src="img/GW2AM.png" alt="GW2AM" className="w-5 h-5 object-contain" />
                    GW2 AM
                    <span className="text-[11px] font-normal text-[var(--theme-text-dim)]">v{appVersion}</span>
                    {renderUpdateIndicator()}
                </span>
                <div className="flex space-x-1 relative z-50" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <button onClick={minimize} className="p-1 hover:bg-[var(--theme-control-bg)] rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"><Minus size={14} /></button>
                    <button onClick={maximize} className="p-1 hover:bg-[var(--theme-control-bg)] rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"><Square size={12} /></button>
                    <button onClick={close} className="p-1 hover:bg-[var(--theme-accent)] rounded text-[var(--theme-text-muted)] hover:text-white transition-colors"><X size={14} /></button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 relative z-10">
                {accounts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-[var(--theme-text-dim)]">
                        <p>No accounts added yet.</p>
                        <button
                            onClick={() => { setEditingAccount(undefined); setIsAddModalOpen(true); }}
                            className="mt-4 px-4 py-2 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-lg transition-colors flex items-center"
                        >
                            <Plus size={18} className="mr-2" /> Add Account
                        </button>
                    </div>
                ) : (
                    accounts.map(account => (
                        <AccountCard
                            key={account.id}
                            account={account}
                            onLaunch={handleLaunch}
                            onStop={handleStop}
                            isActiveProcess={activeAccountIds.includes(account.id)}
                            status={accountStatuses[account.id] ?? 'idle'}
                            statusCertainty={accountStatusCertainty[account.id]}
                            accountApiName={accountApiNames[account.id] || ''}
                            isBirthday={isBirthday(accountApiCreatedAt[account.id])}
                            onEdit={handleEditAccount}
                        />
                    ))
                )}
            </div>

            <div className="p-4 bg-[var(--theme-surface)] border-t border-[var(--theme-border)] flex justify-between items-center relative">
                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-2 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-bg)] rounded-lg transition-colors"
                    title="Settings"
                >
                    <Settings size={20} />
                </button>

                {accounts.length > 0 && (
                    <button
                        onClick={() => { setEditingAccount(undefined); setIsAddModalOpen(true); }}
                        className="p-3 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-full shadow-lg transition-all transform hover:scale-105"
                        title="Add Account"
                    >
                        <Plus size={24} />
                    </button>
                )}
            </div>

            <AddAccountModal
                isOpen={isAddModalOpen}
                onClose={() => {
                    setIsAddModalOpen(false);
                    loadAccounts();
                }}
                onSave={handleSaveAccount}
                onDelete={handleDeleteAccount}
                initialData={editingAccount}
            />

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />
        </div>
    );
}

function isBirthday(createdAt?: string): boolean {
    if (import.meta.env.VITE_FORCE_BIRTHDAY === '1') return true;
    if (!createdAt) return false;
    const createdDate = new Date(createdAt);
    if (Number.isNaN(createdDate.getTime())) return false;
    const today = new Date();
    return createdDate.getMonth() === today.getMonth() && createdDate.getDate() === today.getDate();
}

function mapLaunchPhaseToStatus(phase: LaunchPhase): 'idle' | 'launching' | 'running' | 'stopping' | 'errored' | null {
    if (phase === 'launch_requested' || phase === 'launcher_started' || phase === 'credentials_waiting' || phase === 'credentials_submitted') {
        return 'launching';
    }
    if (phase === 'process_detected' || phase === 'running') return 'running';
    if (phase === 'stopping') return 'stopping';
    if (phase === 'errored') return 'errored';
    if (phase === 'stopped' || phase === 'idle') return 'idle';
    return null;
}

export default App;
