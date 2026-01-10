// E2E Encryption using RSA-OAEP (asymmetric) + AES-GCM (hybrid for large messages)
// Inspired by Chitchatter's approach

class E2ECrypto {
    constructor() {
        this.myKeyPair = null;
        this.peerPublicKeys = new Map(); // peerId -> CryptoKey
    }

    // Generate our keypair on init
    async init() {
        this.myKeyPair = await crypto.subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 2048,
                publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
                hash: 'SHA-256'
            },
            true,
            ['encrypt', 'decrypt']
        );
        console.log('✓ RSA keypair generated');
        return this;
    }

    // Export our public key as Base64 string to share with peers
    async getPublicKeyString() {
        if (!this.myKeyPair) await this.init();
        const exported = await crypto.subtle.exportKey('spki', this.myKeyPair.publicKey);
        return this.arrayBufferToBase64(exported);
    }

    // Import a peer's public key from Base64 string
    async importPeerPublicKey(peerId, publicKeyString) {
        const keyBuffer = this.base64ToArrayBuffer(publicKeyString);
        const publicKey = await crypto.subtle.importKey(
            'spki',
            keyBuffer,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['encrypt']
        );
        this.peerPublicKeys.set(peerId, publicKey);
        console.log('✓ Imported public key for peer:', peerId.slice(0, 8));
        return publicKey;
    }

    // Check if we have a peer's public key
    hasPeerKey(peerId) {
        return this.peerPublicKeys.has(peerId);
    }

    // Hybrid encryption: Use AES for data, RSA for AES key
    async encrypt(message, peerId) {
        const peerPublicKey = this.peerPublicKeys.get(peerId);

        if (!peerPublicKey) {
            console.warn('No public key for peer, sending unencrypted marker');
            // Return plaintext with marker (fallback - should exchange keys first)
            return { encrypted: false, data: message };
        }

        try {
            // Generate random AES key for this message
            const aesKey = await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );

            // Encrypt the message with AES
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encoded = new TextEncoder().encode(message);
            const encryptedContent = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                aesKey,
                encoded
            );

            // Export and encrypt the AES key with RSA
            const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);
            const encryptedAesKey = await crypto.subtle.encrypt(
                { name: 'RSA-OAEP' },
                peerPublicKey,
                rawAesKey
            );

            return {
                encrypted: true,
                iv: Array.from(iv),
                key: Array.from(new Uint8Array(encryptedAesKey)),
                data: Array.from(new Uint8Array(encryptedContent))
            };
        } catch (e) {
            console.error('Encryption failed:', e);
            return { encrypted: false, data: message };
        }
    }

    async decrypt(payload, peerId) {
        if (!payload.encrypted) {
            return payload.data; // Unencrypted fallback
        }

        if (!this.myKeyPair) {
            console.error('No keypair available for decryption');
            return '[Decryption failed - no keys]';
        }

        try {
            // Decrypt the AES key with our private RSA key
            const encryptedAesKey = new Uint8Array(payload.key);
            const rawAesKey = await crypto.subtle.decrypt(
                { name: 'RSA-OAEP' },
                this.myKeyPair.privateKey,
                encryptedAesKey
            );

            // Import the AES key
            const aesKey = await crypto.subtle.importKey(
                'raw',
                rawAesKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['decrypt']
            );

            // Decrypt the message
            const iv = new Uint8Array(payload.iv);
            const encryptedContent = new Uint8Array(payload.data);
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                aesKey,
                encryptedContent
            );

            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error('Decryption failed:', e);
            return '[Decryption failed]';
        }
    }

    // Helper functions
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
}

// Voice E2E Encryption using WebRTC Insertable Streams
class VoiceCrypto {
    constructor() {
        this.key = null;
        this.supported = typeof RTCRtpScriptTransform !== 'undefined' ||
            (typeof RTCRtpSender !== 'undefined' &&
                typeof RTCRtpSender.prototype.createEncodedStreams === 'function');
    }

    async generateKey() {
        this.key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
        return await crypto.subtle.exportKey('raw', this.key);
    }

    async importKey(rawKey) {
        this.key = await crypto.subtle.importKey(
            'raw',
            rawKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    createEncryptTransform() {
        const key = this.key;
        return new TransformStream({
            async transform(encodedFrame, controller) {
                if (!key) {
                    controller.enqueue(encodedFrame);
                    return;
                }
                try {
                    const iv = crypto.getRandomValues(new Uint8Array(12));
                    const encrypted = await crypto.subtle.encrypt(
                        { name: 'AES-GCM', iv },
                        key,
                        encodedFrame.data
                    );
                    const combined = new ArrayBuffer(iv.byteLength + encrypted.byteLength);
                    new Uint8Array(combined).set(iv);
                    new Uint8Array(combined).set(new Uint8Array(encrypted), iv.byteLength);
                    encodedFrame.data = combined;
                    controller.enqueue(encodedFrame);
                } catch (e) {
                    controller.enqueue(encodedFrame);
                }
            }
        });
    }

    createDecryptTransform() {
        const key = this.key;
        return new TransformStream({
            async transform(encodedFrame, controller) {
                if (!key) {
                    controller.enqueue(encodedFrame);
                    return;
                }
                try {
                    const data = new Uint8Array(encodedFrame.data);
                    const iv = data.slice(0, 12);
                    const encrypted = data.slice(12);
                    const decrypted = await crypto.subtle.decrypt(
                        { name: 'AES-GCM', iv },
                        key,
                        encrypted
                    );
                    encodedFrame.data = decrypted;
                    controller.enqueue(encodedFrame);
                } catch (e) {
                    controller.enqueue(encodedFrame);
                }
            }
        });
    }

    applyToSender(sender) {
        if (!this.supported || !this.key) return false;
        try {
            const streams = sender.createEncodedStreams();
            const transform = this.createEncryptTransform();
            streams.readable.pipeThrough(transform).pipeTo(streams.writable);
            console.log('✓ Voice E2E encryption applied to sender');
            return true;
        } catch (e) {
            console.warn('Voice encryption not applied:', e.message);
            return false;
        }
    }

    applyToReceiver(receiver) {
        if (!this.supported || !this.key) return false;
        try {
            const streams = receiver.createEncodedStreams();
            const transform = this.createDecryptTransform();
            streams.readable.pipeThrough(transform).pipeTo(streams.writable);
            console.log('✓ Voice E2E decryption applied to receiver');
            return true;
        } catch (e) {
            console.warn('Voice decryption not applied:', e.message);
            return false;
        }
    }
}

// Initialize crypto on load
window.e2eCrypto = new E2ECrypto();
window.voiceCrypto = new VoiceCrypto();

// Auto-init the keypair
window.e2eCrypto.init().catch(e => console.error('Crypto init failed:', e));
