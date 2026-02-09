import React, { useState } from 'react';
import { Lock } from 'lucide-react';

interface MasterPasswordModalProps {
    mode: 'set' | 'verify';
    onSubmit: (password: string) => void;
    error?: string;
}

const MasterPasswordModal: React.FC<MasterPasswordModalProps> = ({ mode, onSubmit, error }) => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (mode === 'set' && password !== confirmPassword) {
            alert("Passwords do not match!");
            return;
        }
        onSubmit(password);
    };

    return (
        <div className="flex flex-col items-center justify-center h-full p-4">
            <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl p-8 w-full max-w-sm shadow-2xl flex flex-col items-center">
                <div className="bg-[var(--theme-accent-soft)] p-4 rounded-full mb-6">
                    <Lock size={32} className="text-[var(--theme-gold-strong)]" />
                </div>

                <h2 className="text-2xl font-bold text-white mb-2">
                    {mode === 'set' ? 'Setup Master Password' : 'Welcome Back'}
                </h2>

                <p className="text-[var(--theme-text-muted)] text-center mb-6 text-sm">
                    {mode === 'set'
                        ? 'Welcome! Please create a secure master password to encrypt your account data. If you lose this, your data cannot be recovered.'
                        : 'Enter your master password to unlock your accounts.'}
                </p>

                <form onSubmit={handleSubmit} className="w-full space-y-4">
                    <div>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors text-center text-lg tracking-widest"
                            placeholder="Master Password"
                            required
                        />
                    </div>

                    {mode === 'set' && (
                        <div>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors text-center text-lg tracking-widest mt-2"
                                placeholder="Confirm Password"
                                required
                            />
                        </div>
                    )}

                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}

                    <button
                        type="submit"
                        className="w-full py-3 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-lg transition-colors font-bold mt-4"
                    >
                        {mode === 'set' ? 'Create Vault' : 'Unlock Vault'}
                    </button>

                    {mode === 'verify' && (
                        <button
                            type="button"
                            onClick={() => window.api.resetApp()}
                            className="w-full py-2 bg-red-900/50 hover:bg-red-800 text-red-200 rounded-lg transition-colors text-xs mt-2"
                        >
                            Hard Reset (Clear Data)
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
};

export default MasterPasswordModal;
