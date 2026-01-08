// Simple E2E encryption using Web Crypto API
class E2ECrypto {
    constructor() {
        this.keys = new Map(); // peerId -> AES key
    }

    // Generate a shared secret from peer ID (simplified)
    async getKeyForPeer(peerId) {
        if (this.keys.has(peerId)) {
            return this.keys.get(peerId);
        }

        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(peerId + '_p2p_chat_shared_secret'),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: encoder.encode('p2p_chat_salt_v1'),
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );

        this.keys.set(peerId, key);
        return key;
    }

    async encrypt(message, peerId) {
        const key = await this.getKeyForPeer(peerId);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(message);

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoded
        );

        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);

        return btoa(String.fromCharCode(...combined));
    }

    async decrypt(encryptedData, peerId) {
        try {
            const key = await this.getKeyForPeer(peerId);
            const binary = atob(encryptedData);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            const iv = bytes.slice(0, 12);
            const ciphertext = bytes.slice(12);

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                ciphertext
            );

            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error('Decryption failed:', e);
            return '[Encrypted message]';
        }
    }
}

window.e2eCrypto = new E2ECrypto();
