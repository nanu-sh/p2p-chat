// Crypto utilities - ECDH key exchange + AES-GCM encryption

const Crypto = {
    // Generate ECDH keypair
    async generateKeyPair() {
        return crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey', 'deriveBits']
        );
    },

    // Export key to JWK
    async exportKey(key) {
        return crypto.subtle.exportKey('jwk', key);
    },

    // Import public key from JWK
    async importPublicKey(jwk) {
        return crypto.subtle.importKey(
            'jwk', jwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            []
        );
    },

    // Import private key from JWK
    async importPrivateKey(jwk) {
        return crypto.subtle.importKey(
            'jwk', jwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey', 'deriveBits']
        );
    },

    // Generate random 6-character Session ID
    async generateSessionId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
        const randomValues = new Uint32Array(6);
        crypto.getRandomValues(randomValues);

        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars[randomValues[i] % chars.length];
        }
        return result;
    },

    // Derive shared AES key from ECDH
    async deriveSharedKey(privateKey, publicKey) {
        const sharedBits = await crypto.subtle.deriveBits(
            { name: 'ECDH', public: publicKey },
            privateKey,
            256
        );

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
                info: new TextEncoder().encode('P2P-Chat'),
                hash: 'SHA-256'
            },
            hkdfKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    // Encrypt message
    async encrypt(key, plaintext) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plaintext);
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoded
        );
        return {
            iv: this._arrayToBase64(iv),
            data: this._arrayToBase64(new Uint8Array(ciphertext))
        };
    },

    // Decrypt message
    async decrypt(key, envelope) {
        const iv = this._base64ToArray(envelope.iv);
        const ciphertext = this._base64ToArray(envelope.data);
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );
        return new TextDecoder().decode(decrypted);
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

export default Crypto;
