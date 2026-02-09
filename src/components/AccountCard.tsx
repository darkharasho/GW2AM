import React from 'react';
import { Account } from '../types';
import { Play, Settings, Trash2 } from 'lucide-react';

interface AccountCardProps {
    account: Account;
    onLaunch: (id: string) => void;
    onEdit: (account: Account) => void;
    onDelete: (id: string) => void;
}

const AccountCard: React.FC<AccountCardProps> = ({ account, onLaunch, onEdit, onDelete }) => {
    return (
        <div className="bg-gray-800 rounded-lg p-4 flex items-center justify-between hover:bg-gray-750 transition-colors border border-gray-700">
            <div className="flex flex-col overflow-hidden">
                <span className="font-bold text-lg text-white truncate" title={account.nickname}>{account.nickname}</span>
                <span className="text-sm text-gray-400 truncate" title={account.email}>{account.email}</span>
            </div>

            <div className="flex items-center space-x-2 ml-4">
                <button
                    onClick={() => onLaunch(account.id)}
                    className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
                    title="Launch Game"
                >
                    <Play size={20} fill="currentColor" />
                </button>
                <button
                    onClick={() => onEdit(account)}
                    className="p-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md transition-colors"
                    title="Edit Account"
                >
                    <Settings size={18} />
                </button>
                <button
                    onClick={() => onDelete(account.id)}
                    className="p-2 bg-gray-700 hover:bg-red-900/50 text-red-400 hover:text-red-300 rounded-md transition-colors"
                    title="Delete Account"
                >
                    <Trash2 size={18} />
                </button>
            </div>
        </div>
    );
};

export default AccountCard;
