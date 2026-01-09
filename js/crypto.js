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

window.e2eCrypto = new E2ECrypto();
window.voiceCrypto = new VoiceCrypto();
