// Storage - IndexedDB for persistent data (contacts, groups, identity)
// Messages are ephemeral (memory only)

const DB_NAME = 'P2PChat';
const DB_VERSION = 1;

const Storage = {
    db: null,

    async init() {
        console.log('[Storage] Initializing IndexedDB...');
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = (e) => {
                console.log('[Storage] Upgrade needed, creating stores...');
                const db = e.target.result;

                // Identity store - your keypair and info
                if (!db.objectStoreNames.contains('identity')) {
                    db.createObjectStore('identity', { keyPath: 'key' });
                }

                // Contacts store - friends you've added
                if (!db.objectStoreNames.contains('contacts')) {
                    db.createObjectStore('contacts', { keyPath: 'sessionId' });
                }

                // Groups store - groups you've created/joined
                if (!db.objectStoreNames.contains('groups')) {
                    db.createObjectStore('groups', { keyPath: 'id' });
                }
            };

            req.onsuccess = (e) => {
                console.log('[Storage] IndexedDB opened successfully');
                this.db = e.target.result;
                resolve();
            };

            req.onerror = (e) => {
                console.error('[Storage] IndexedDB error:', e.target.error);
                reject(e.target.error);
            };
        });
    },

    // --- Identity ---
    async saveIdentity(identity) {
        // identity: { name, sessionId, publicKeyJwk, privateKeyJwk }
        return this._put('identity', { key: 'self', ...identity });
    },

    async getIdentity() {
        return this._get('identity', 'self');
    },

    // --- Contacts ---
    async saveContact(contact) {
        // contact: { sessionId, name, publicKeyJwk }
        return this._put('contacts', contact);
    },

    async getContact(sessionId) {
        return this._get('contacts', sessionId);
    },

    async getAllContacts() {
        return this._getAll('contacts');
    },

    async deleteContact(sessionId) {
        return this._delete('contacts', sessionId);
    },

    // --- Groups ---
    async saveGroup(group) {
        // group: { id, name, memberSessionIds: [] }
        return this._put('groups', group);
    },

    async getGroup(id) {
        return this._get('groups', id);
    },

    async getAllGroups() {
        return this._getAll('groups');
    },

    async deleteGroup(id) {
        return this._delete('groups', id);
    },

    // --- Internal helpers ---
    _put(store, value) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([store], 'readwrite');
            const req = tx.objectStore(store).put(value);
            req.onsuccess = () => {
                console.log(`[Storage] Saved to ${store}:`, value);
                resolve();
            };
            req.onerror = (e) => {
                console.error(`[Storage] Error saving to ${store}:`, e.target.error);
                reject(e.target.error);
            };
        });
    },

    _get(store, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([store], 'readonly');
            const req = tx.objectStore(store).get(key);
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    _getAll(store) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([store], 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = (e) => resolve(e.target.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    _delete(store, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([store], 'readwrite');
            const req = tx.objectStore(store).delete(key);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    },

    // Clear all data (for debugging/reset)
    async clearAll() {
        const stores = ['identity', 'contacts', 'groups'];
        for (const store of stores) {
            await new Promise((resolve) => {
                const tx = this.db.transaction([store], 'readwrite');
                tx.objectStore(store).clear();
                tx.oncomplete = resolve;
            });
        }
    }
};
