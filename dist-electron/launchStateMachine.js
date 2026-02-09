export class LaunchStateMachine {
    states = new Map();
    setState(accountId, phase, certainty, note) {
        this.states.set(accountId, {
            accountId,
            phase,
            certainty,
            updatedAt: Date.now(),
            note: note?.trim() || undefined,
        });
    }
    getState(accountId) {
        return this.states.get(accountId);
    }
    getAllStates() {
        return Array.from(this.states.values());
    }
    clearState(accountId) {
        this.states.delete(accountId);
    }
    clearAll() {
        this.states.clear();
    }
    prune(accountIds) {
        const allowed = new Set(accountIds);
        Array.from(this.states.keys()).forEach((id) => {
            if (!allowed.has(id)) {
                this.states.delete(id);
            }
        });
    }
}
