// MediaStore - IndexedDB-based file storage for persistent media
// Stores file blobs so they survive page refreshes

const MediaStore = {
    DB_NAME: 'p2p-chat-media',
    STORE_NAME: 'files',
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, 1);

            request.onerror = () => reject(request.error);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('[MediaStore] Initialized');
                resolve();
            };
        });
    },

    // Store a file blob
    async saveFile(fileId, blob, metadata = {}) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);

            const record = {
                id: fileId,
                blob: blob,
                mimeType: metadata.mimeType || blob.type,
                filename: metadata.filename || 'file',
                size: blob.size,
                savedAt: Date.now()
            };

            const request = store.put(record);
            request.onsuccess = () => {
                console.log('[MediaStore] Saved file:', fileId);
                resolve(fileId);
            };
            request.onerror = () => reject(request.error);
        });
    },

    // Get a file blob and create a new blob URL
    async getFile(fileId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);

            const request = store.get(fileId);
            request.onsuccess = () => {
                const record = request.result;
                if (record && record.blob) {
                    const blobUrl = URL.createObjectURL(record.blob);
                    resolve({ blobUrl, ...record });
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    },

    // Delete a file
    async deleteFile(fileId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);

            const request = store.delete(fileId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    // Generate a unique file ID
    generateId() {
        return `file_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }
};

export default MediaStore;
