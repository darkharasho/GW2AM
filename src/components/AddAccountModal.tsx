import React, { useState, useEffect } from 'react';
import { Account } from '../types';
import { X } from 'lucide-react';

interface AddAccountModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (account: Omit<Account, 'id'>) => void;
    onDelete: (id: string) => Promise<void>;
    initialData?: Account;
}

const AddAccountModal: React.FC<AddAccountModalProps> = ({ isOpen, onClose, onSave, onDelete, initialData }) => {
    const [nickname, setNickname] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [launchArguments, setLaunchArguments] = useState('');
    const [apiKey, setApiKey] = useState('');


    const sanitizeLaunchArguments = (raw: string): string => {
        if (!raw) return '';
        const tokens = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        const valueTakingFlags = new Set(['--mumble', '-mumble', '-email', '--email', '-password', '--password', '-provider', '--provider']);
        const standaloneFlags = new Set(['-autologin', '--autologin']);
        const cleaned: string[] = [];

        for (let i = 0; i < tokens.length; i += 1) {
            const token = tokens[i];
            const lower = token.toLowerCase();

            if (valueTakingFlags.has(lower)) {
                i += 1;
                continue;
            }
            if (
                lower.startsWith('--mumble=') ||
                lower.startsWith('-mumble=') ||
                lower.startsWith('--email=') ||
                lower.startsWith('-email=') ||
                lower.startsWith('--password=') ||
                lower.startsWith('-password=') ||
                lower.startsWith('--provider=') ||
                lower.startsWith('-provider=')
            ) {
                continue;
            }
            if (standaloneFlags.has(lower)) {
                continue;
            }

            cleaned.push(token);
        }

        return cleaned.join(' ').trim();
    };

    useEffect(() => {
        if (isOpen && initialData) {
            setNickname(initialData.nickname);
            setEmail(initialData.email);
            setPassword(''); // Don't show existing password for security? Or show placeholder
            setLaunchArguments(sanitizeLaunchArguments(initialData.launchArguments || ''));
            setApiKey(initialData.apiKey || '');
            setApiKey('');
        }
    }, [isOpen, initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            nickname,
            email,
            passwordEncrypted: password, // Send raw, backend will encrypt. Variable name matches backend expectation.
            launchArguments: sanitizeLaunchArguments(launchArguments),
            apiKey: apiKey.trim(),

        });
        onClose();
    };



    const handleDelete = async () => {
        if (!initialData) return;
        if (!confirm(`Delete account "${initialData.nickname}"? This cannot be undone.`)) {
            return;
        }
        await onDelete(initialData.id);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-[var(--theme-overlay)] backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-white">{initialData ? 'Edit Account' : 'Add Account'}</h2>
                    <button onClick={onClose} className="text-[var(--theme-text-muted)] hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Nickname</label>
                        <input
                            type="text"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors"
                            placeholder="Main Account"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors"
                            placeholder="example@arena.net"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors"
                            placeholder={initialData ? 'Unchanged' : 'Password'}
                            required={!initialData}
                        />
                        {initialData && <p className="text-xs text-[var(--theme-text-dim)] mt-1">Leave empty to keep existing password.</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Additional Launch Arguments</label>
                        <input
                            type="text"
                            value={launchArguments}
                            onChange={(e) => setLaunchArguments(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors text-sm"
                            placeholder="-shareArchive -windowed -mapLoadinfo"
                        />
                        <p className="text-xs text-[var(--theme-text-dim)] mt-1">Internal args like autologin/mumble/credentials are managed by the app.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">GW2 API Key (Optional)</label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors text-sm"
                            placeholder="Used to resolve account name"
                        />
                    </div>



                    {initialData ? (
                        <div className="flex justify-between items-center mt-6">
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="px-4 py-2 rounded-lg bg-[var(--theme-danger-soft)] text-[var(--theme-danger-text)] hover:text-[var(--theme-danger-text-hover)] hover:bg-[color-mix(in_srgb,var(--theme-danger-soft)_75%,transparent)] transition-colors"
                            >
                                Delete
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-lg transition-colors font-medium"
                            >
                                Save
                            </button>
                        </div>
                    ) : (
                        <div className="flex justify-end space-x-3 mt-6">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg text-[var(--theme-text)] hover:bg-[var(--theme-control-bg)] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-lg transition-colors font-medium"
                            >
                                Save
                            </button>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
};

export default AddAccountModal;
