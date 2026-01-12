const DB_NAME = 'P2P_Whatsapp_Clone_V2';
const STORES = {
    IDENTITY: 'identity', // key: 'self'
    PEERS: 'peers',       // key: peerId
    MESSAGES: 'messages'  // key: msgId, idx: chatId
};

const Storage = {
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORES.IDENTITY)) db.createObjectStore(STORES.IDENTITY, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(STORES.PEERS)) db.createObjectStore(STORES.PEERS, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
                    const store = db.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
                    store.createIndex('chatId', 'chatId', { unique: false });
                }
            };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            req.onerror = reject;
        });
    },

    // --- Ops ---
    async _put(store, val) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([store], 'readwrite');
            tx.objectStore(store).put(val).onsuccess = resolve;
            tx.onerror = reject;
        });
    },
    async _get(store, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([store], 'readonly');
            tx.objectStore(store).get(key).onsuccess = (e) => resolve(e.target.result);
            tx.onerror = reject;
        });
    },

    // --- API ---
    async saveIdentity(data) { return this._put(STORES.IDENTITY, { id: 'self', ...data }); },
    async getIdentity() { return this._get(STORES.IDENTITY, 'self'); },

    async savePeer(peer) { return this._put(STORES.PEERS, peer); },
    async getPeers() {
        return new Promise(resolve => {
            const tx = this.db.transaction([STORES.PEERS], 'readonly');
            tx.objectStore(STORES.PEERS).getAll().onsuccess = e => resolve(e.target.result);
        });
    },
    async getPeer(id) { return this._get(STORES.PEERS, id); },

    async saveMessage(msg) { return this._put(STORES.MESSAGES, msg); },
    async getMessages(chatId) {
        return new Promise(resolve => {
            const tx = this.db.transaction([STORES.MESSAGES], 'readonly');
            const idx = tx.objectStore(STORES.MESSAGES).index('chatId');
            idx.getAll(chatId).onsuccess = e => resolve(e.target.result); // Sort? usually insert order is mostly fine for now
        });
    },
    async clearMessages(chatId) {
        // Inefficient for large updates but fine for this scope
        const msgs = await this.getMessages(chatId);
        const tx = this.db.transaction([STORES.MESSAGES], 'readwrite');
        const store = tx.objectStore(STORES.MESSAGES);
        msgs.forEach(m => store.delete(m.id));
        return new Promise(resolve => tx.oncomplete = resolve);
    }
};
