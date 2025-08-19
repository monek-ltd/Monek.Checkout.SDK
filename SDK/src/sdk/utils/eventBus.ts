export class EventBus<T extends Record<string, any>> {
    private map = new Map<keyof T, Set<(p: any) => void>>();

    on<K extends keyof T>(event: K, fn: (payload: T[K]) => void) {
        if (!this.map.has(event)) {
            this.map.set(event, new Set());
        }

        this.map.get(event)!.add(fn);
        return () => this.map.get(event)!.delete(fn);
    }

    emit<K extends keyof T>(event: K, payload: T[K]) {
        this.map.get(event)?.forEach(fn => fn(payload));
    }
}