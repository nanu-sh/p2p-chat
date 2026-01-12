const Crypto = {
    // --- Identity ---
    async generateIdentity() {
        return window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true, ["deriveKey", "deriveBits"]
        );
    },

    async exportKey(key) {
        return window.crypto.subtle.exportKey("jwk", key);
    },

    async importKey(jwk, type) {
        return window.crypto.subtle.importKey(
            "jwk", jwk,
            { name: "ECDH", namedCurve: "P-256" },
            true, type === 'public' ? [] : ["deriveKey", "deriveBits"]
        );
    },

    // --- Key Exchange ---
    async deriveSharedKey(localPrivateKey, remotePublicKey) {
        // 1. ECDH Shared Secret
        const sharedBits = await window.crypto.subtle.deriveBits(
            { name: "ECDH", public: remotePublicKey },
            localPrivateKey, 256
        );

        // 2. HKDF to AES Key
        const hkdfKey = await window.crypto.subtle.importKey(
            "raw", sharedBits, { name: "HKDF" }, false, ["deriveKey"]
        );

        return window.crypto.subtle.deriveKey(
            { name: "HKDF", salt: new Uint8Array(), info: new TextEncoder().encode("P2P-Chat-V2"), hash: "SHA-256" },
            hkdfKey,
            { name: "AES-GCM", length: 256 },
            true, ["encrypt", "decrypt"]
        );
    },

    // --- Encryption ---
    async encrypt(key, text) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const ciphertext = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key, encoded
        );
        return {
            iv: this.ab2base64(iv),
            ciphertext: this.ab2base64(ciphertext)
        };
    },

    async decrypt(key, envelope) {
        const iv = this.base642ab(envelope.iv);
        const ciphertext = this.base642ab(envelope.ciphertext);
        try {
            const result = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key, ciphertext
            );
            return new TextDecoder().decode(result);
        } catch (e) {
            console.error("Decrypt failed", e);
            throw e;
        }
    },

    // --- Utils ---
    ab2base64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); },
    base642ab(base64) {
        const binary_string = atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary_string.charCodeAt(i);
        return bytes.buffer;
    }
};
