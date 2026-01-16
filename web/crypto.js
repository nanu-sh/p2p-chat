// Crypto utilities - ECDH key exchange + AES-GCM encryption

const Crypto = {
    // Generate a new identity keypair
    async generateKeyPair() {
        return crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey', 'deriveBits']
        );
    },

    // Export key to JWK format (for storage)
    async exportKey(key) {
        return crypto.subtle.exportKey('jwk', key);
    },

    // Import key from JWK format
    async importPublicKey(jwk) {
        return crypto.subtle.importKey(
            'jwk', jwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            []
        );
    },

    async importPrivateKey(jwk) {
        return crypto.subtle.importKey(
            'jwk', jwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey', 'deriveBits']
        );
    },

    // Generate Session ID from public key (first 16 bytes of SHA-256 hash, as hex)
    async generateSessionId(publicKey) {
        const raw = await crypto.subtle.exportKey('raw', publicKey);
        const hash = await crypto.subtle.digest('SHA-256', raw);
        const bytes = new Uint8Array(hash.slice(0, 16));
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    // Derive shared secret from your private key and peer's public key
    async deriveSharedKey(privateKey, publicKey) {
        const sharedBits = await crypto.subtle.deriveBits(
            { name: 'ECDH', public: publicKey },
            privateKey,
            256
        );

        // Use HKDF to derive AES key
        const hkdfKey = await crypto.subtle.importKey(
            'raw', sharedBits,
            { name: 'HKDF' },
            false,
            ['deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                salt: new Uint8Array(0),
                info: new TextEncoder().encode('P2P-Chat-E2E'),
                hash: 'SHA-256'
            },
            hkdfKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    // Encrypt text message
    async encrypt(sharedKey, plaintext) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plaintext);
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            sharedKey,
            encoded
        );
        return {
            iv: this._arrayToBase64(iv),
            data: this._arrayToBase64(new Uint8Array(ciphertext))
        };
    },

    // Decrypt text message
    async decrypt(sharedKey, envelope) {
        const iv = this._base64ToArray(envelope.iv);
        const ciphertext = this._base64ToArray(envelope.data);
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            sharedKey,
            ciphertext
        );
        return new TextDecoder().decode(decrypted);
    },

    // Encrypt file (ArrayBuffer)
    async encryptFile(sharedKey, data) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            sharedKey,
            data
        );
        return {
            iv: this._arrayToBase64(iv),
            data: this._arrayToBase64(new Uint8Array(ciphertext))
        };
    },

    // Decrypt file
    async decryptFile(sharedKey, envelope) {
        const iv = this._base64ToArray(envelope.iv);
        const ciphertext = this._base64ToArray(envelope.data);
        return crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            sharedKey,
            ciphertext
        );
    },

    // Helpers
    _arrayToBase64(arr) {
        return btoa(String.fromCharCode(...arr));
    },

    _base64ToArray(base64) {
        const binary = atob(base64);
        const arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            arr[i] = binary.charCodeAt(i);
        }
        return arr;
    }
};
