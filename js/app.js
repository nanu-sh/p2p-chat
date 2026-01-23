// P2P Chat - Main App
import { joinRoom, selfId } from 'https://esm.run/trystero/nostr';
import Storage from './storage.js';
import Crypto from './crypto.js';

const APP_ID = 'p2p-chat-v1-secure';

const App = {
    // Identity
    me: null, // { id, name, publicKey, privateKey, publicKeyJwk }

    // Data
    contacts: {}, // sessionId -> { name, publicKey, online }
    rooms: new Map(), // sessionId -> Trystero room
    sharedKeys: new Map(), // sessionId -> AES key
    pendingMessages: new Map(), // sessionId -> [messages to send when online]

    // State
    activeContact: null,

    // File transfer
    pendingFiles: new Map(), // fileId -> { chunks: [], metadata }
    CHUNK_SIZE: 16384, // 16KB chunks

    // Voice recording
    mediaRecorder: null,
    audioChunks: [],
    recordingStartTime: null,
    recordingInterval: null,

    // Typing indicators
    typingTimeouts: new Map(), // contactId -> timeout
    isTyping: false,
    typingTimeout: null,

    // DOM cache
    $: {},

    async init() {
        this.cacheDom();
        this.bindEvents();

        const saved = Storage.getIdentity();
        if (saved) {
            await this.loadIdentity(saved);
            this.showMain();
        } else {
            this.showSetup();
        }
    },

    cacheDom() {
        this.$ = {
            setupScreen: document.getElementById('setup-screen'),
            mainScreen: document.getElementById('main-screen'),
            setupName: document.getElementById('setup-name'),
            btnSetup: document.getElementById('btn-setup'),
            myAvatar: document.getElementById('my-avatar'),
            myName: document.getElementById('my-name'),
            myId: document.getElementById('my-id'),
            btnAdd: document.getElementById('btn-add'),
            contactsList: document.getElementById('contacts-list'),
            emptyChat: document.getElementById('empty-chat'),
            activeChat: document.getElementById('active-chat'),
            chatAvatar: document.getElementById('chat-avatar'),
            chatName: document.getElementById('chat-name'),
            chatStatus: document.getElementById('chat-status'),
            btnCall: document.getElementById('btn-call'),
            btnDelete: document.getElementById('btn-delete'),
            messages: document.getElementById('messages'),
            msgInput: document.getElementById('msg-input'),
            btnSend: document.getElementById('btn-send'),
            // Modals
            modalAdd: document.getElementById('modal-add'),
            contactId: document.getElementById('contact-id'),
            contactName: document.getElementById('contact-name'),
            btnCancel: document.getElementById('btn-cancel'),
            btnSave: document.getElementById('btn-save'),
            modalCall: document.getElementById('modal-call'),
            callAvatar: document.getElementById('call-avatar'),
            callName: document.getElementById('call-name'),
            callStatus: document.getElementById('call-status'),
            callTimer: document.getElementById('call-timer'),
            remoteAudio: document.getElementById('remote-audio'),
            btnEndCall: document.getElementById('btn-end-call'),
            btnAcceptCall: document.getElementById('btn-accept-call'),
            btnDeclineCall: document.getElementById('btn-decline-call'),
            btnMute: document.getElementById('btn-mute'),
            btnBack: document.getElementById('btn-back'),
            btnAttach: document.getElementById('btn-attach'),
            fileInput: document.getElementById('file-input'),
            btnVoice: document.getElementById('btn-voice'),
            btnDisconnect: document.getElementById('btn-disconnect'),
            chatInputFooter: document.querySelector('.chat-input'),
            chatHeader: document.querySelector('.chat-header'),
            // Trust UI
            trustBadge: document.getElementById('trust-badge'),
            keyChangedBanner: document.getElementById('key-changed-banner'),
            btnRejectKey: document.getElementById('btn-reject-key'),
            btnAcceptKey: document.getElementById('btn-accept-key'),
            // Fingerprint modal
            modalFingerprint: document.getElementById('modal-fingerprint'),
            fingerprintDisplay: document.getElementById('fingerprint-display'),
            myFingerprint: document.getElementById('my-fingerprint'),
            theirFingerprint: document.getElementById('their-fingerprint'),
            btnCopyFingerprint: document.getElementById('btn-copy-fingerprint'),
            btnVerifyContact: document.getElementById('btn-verify-contact'),
            btnCloseFingerprint: document.getElementById('btn-close-fingerprint'),
        };
    },

    bindEvents() {
        // Setup
        this.$.btnSetup.onclick = () => this.setup();
        this.$.setupName.onkeydown = (e) => {
            if (e.key === 'Enter') this.setup();
        };

        // Back button (mobile)
        this.$.btnBack.onclick = () => this.closeChat();

        // Copy ID
        this.$.myId.onclick = () => this.copyId();

        // Add contact
        this.$.btnAdd.onclick = () => this.showModal('add');
        this.$.btnCancel.onclick = () => this.hideModal('add');
        this.$.btnSave.onclick = () => this.addContact();

        // Messaging
        this.$.msgInput.oninput = () => {
            this.$.btnSend.disabled = !this.$.msgInput.value.trim();

            // Send typing indicator
            if (this.activeContact && this.$.msgInput.value.trim()) {
                this.sendTypingSignal();
            }
        };
        this.$.msgInput.onkeydown = e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        };
        this.$.btnSend.onclick = () => this.sendMessage();

        // Call
        this.$.btnCall.onclick = () => this.startCall();
        this.$.btnEndCall.onclick = () => this.endCall();
        this.$.btnAcceptCall.onclick = () => this.acceptCall();
        this.$.btnDeclineCall.onclick = () => this.declineCall();
        this.$.btnMute.onclick = () => this.toggleMute();

        // Delete
        this.$.btnDelete.onclick = () => this.deleteContact();

        // File attachment
        this.$.btnAttach.onclick = () => this.$.fileInput.click();
        this.$.fileInput.onchange = (e) => this.handleFileSelect(e);

        // Voice note
        this.$.btnVoice.onclick = () => this.toggleVoiceRecording();

        // Disconnect
        this.$.btnDisconnect.onclick = () => this.disconnectPeer();

        // ESC to close modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideModal('add');
                this.hideModal('call');
            }
        });

        // Click outside modal to close
        this.$.modalAdd.onclick = (e) => {
            if (e.target === this.$.modalAdd) this.hideModal('add');
        };

        // Trust UI events
        this.$.trustBadge.onclick = () => this.showFingerprintModal();
        this.$.btnRejectKey.onclick = () => this.rejectNewKey();
        this.$.btnAcceptKey.onclick = () => this.acceptNewKey();
        this.$.btnCloseFingerprint.onclick = () => this.hideModal('fingerprint');
        this.$.btnCopyFingerprint.onclick = () => this.copyFingerprint();
        this.$.btnVerifyContact.onclick = () => this.verifyContact();
        this.$.modalFingerprint.onclick = (e) => {
            if (e.target === this.$.modalFingerprint) this.hideModal('fingerprint');
        };
    },

    // --- Setup ---
    async setup() {
        const name = this.$.setupName.value.trim();
        if (!name) return alert('Enter your name');

        try {
            const keys = await Crypto.generateKeyPair();
            const id = await Crypto.generateSessionId(keys.publicKey);
            const publicKeyJwk = await Crypto.exportKey(keys.publicKey);
            const privateKeyJwk = await Crypto.exportKey(keys.privateKey);

            Storage.saveIdentity({ id, name, publicKeyJwk, privateKeyJwk });

            this.me = {
                id, name,
                publicKey: keys.publicKey,
                privateKey: keys.privateKey,
                publicKeyJwk
            };

            this.showMain();
        } catch (err) {
            console.error('Setup error:', err);
            alert('Failed to create identity');
        }
    },

    async loadIdentity(saved) {
        this.me = {
            id: saved.id,
            name: saved.name,
            publicKey: await Crypto.importPublicKey(saved.publicKeyJwk),
            privateKey: await Crypto.importPrivateKey(saved.privateKeyJwk),
            publicKeyJwk: saved.publicKeyJwk
        };

        // Load contacts
        const contacts = Storage.getContacts();
        for (const [id, data] of Object.entries(contacts)) {
            this.contacts[id] = { ...data, online: false };
        }
    },

    showSetup() {
        this.$.setupScreen.classList.remove('hidden');
        this.$.mainScreen.classList.add('hidden');
    },

    showMain() {
        this.$.setupScreen.classList.add('hidden');
        this.$.mainScreen.classList.remove('hidden');

        this.$.myAvatar.textContent = this.me.name[0].toUpperCase();
        this.$.myName.textContent = this.me.name;
        this.$.myId.textContent = this.me.id.slice(0, 16) + '...';
        this.$.myId.title = 'Click to copy: ' + this.me.id;

        this.renderContacts();
        this.connectToContacts();
    },

    copyId() {
        navigator.clipboard.writeText(this.me.id).then(() => {
            const original = this.$.myId.textContent;
            this.$.myId.textContent = 'Copied!';
            this.$.myId.style.color = 'var(--accent)';
            setTimeout(() => {
                this.$.myId.textContent = original;
                this.$.myId.style.color = '';
            }, 1500);
        });
    },

    // --- Modals ---
    showModal(type) {
        if (type === 'add') {
            this.$.contactId.value = '';
            this.$.contactName.value = '';
            this.$.modalAdd.classList.remove('hidden');
            this.$.contactId.focus();
        }
    },

    hideModal(type) {
        document.getElementById(`modal-${type}`)?.classList.add('hidden');
    },

    // --- Contacts ---
    addContact() {
        const id = this.$.contactId.value.trim();
        const name = this.$.contactName.value.trim();

        if (!id || !name) return alert('Fill both fields');
        if (id === this.me.id) return alert("Can't add yourself");
        if (this.contacts[id]) return alert('Contact exists');

        Storage.addContact(id, name);
        this.contacts[id] = { name, publicKey: null, online: false };

        this.renderContacts();
        this.hideModal('add');
        this.joinRoom(id);
    },

    renderContacts() {
        const list = this.$.contactsList;
        list.innerHTML = '';

        const entries = Object.entries(this.contacts);
        if (entries.length === 0) {
            list.innerHTML = '<div class="empty-contacts">No contacts yet.<br>Click + to add someone.</div>';
            return;
        }

        for (const [id, c] of entries) {
            const msgs = Storage.getMessages(id);
            const lastMsg = msgs[msgs.length - 1];

            const div = document.createElement('div');
            div.className = 'contact-item' + (this.activeContact === id ? ' active' : '');

            let statusText = 'No messages yet';
            if (c.typing) {
                statusText = 'typing...';
            } else if (lastMsg) {
                statusText = this.escapeHtml(lastMsg.text || lastMsg.filename || 'File').slice(0, 30);
            }

            div.innerHTML = `
                <div class="avatar">
                    ${c.name[0].toUpperCase()}
                    ${c.online ? '<span class="online-dot"></span>' : ''}
                </div>
                <div class="contact-info">
                    <span class="name">${this.escapeHtml(c.name)}</span>
                    <span class="last-msg ${c.typing ? 'typing' : ''}">${statusText}</span>
                </div>
            `;
            div.onclick = () => this.openChat(id);
            list.appendChild(div);
        }
    },

    deleteContact() {
        if (!this.activeContact) return;
        const c = this.contacts[this.activeContact];
        if (!confirm(`Delete ${c.name}?`)) return;

        // Leave room
        const room = this.rooms.get(this.activeContact);
        if (room) room.leave();
        this.rooms.delete(this.activeContact);
        this.sharedKeys.delete(this.activeContact);

        Storage.deleteContact(this.activeContact);
        delete this.contacts[this.activeContact];

        this.activeContact = null;
        this.$.activeChat.classList.add('hidden');
        this.$.emptyChat.classList.remove('hidden');
        this.$.mainScreen.classList.remove('chat-open');

        this.renderContacts();
    },

    // --- Chat ---
    openChat(contactId) {
        this.activeContact = contactId;
        const c = this.contacts[contactId];

        this.$.emptyChat.classList.add('hidden');
        this.$.activeChat.classList.remove('hidden');
        this.$.mainScreen.classList.add('chat-open');

        this.$.chatAvatar.textContent = c.name[0].toUpperCase();
        this.$.chatName.textContent = c.name;
        this.updateChatStatus();
        this.updateTrustUI();

        // Auto-reconnect if disconnected
        if (!c.online && !this.rooms.has(contactId)) {
            this.joinRoom(contactId);
        }

        this.renderMessages();
        this.renderContacts();
        this.$.msgInput.focus();

        // Send read receipts for unread messages
        this.sendReadReceipts(contactId);
    },

    closeChat() {
        this.activeContact = null;
        this.$.activeChat.classList.add('hidden');
        this.$.emptyChat.classList.remove('hidden');
        this.$.mainScreen.classList.remove('chat-open');
        this.renderContacts();
    },

    renderMessages() {
        this.$.messages.innerHTML = '';
        if (!this.activeContact) return;

        const msgs = Storage.getMessages(this.activeContact);
        for (let i = 0; i < msgs.length; i++) {
            this.renderMessage(msgs[i], i);
        }
    },

    renderMessage(msg, index) {
        const div = document.createElement('div');
        div.className = `message ${msg.sent ? 'sent' : 'received'}${msg.pending ? ' pending' : ''}`;
        div.dataset.index = index !== undefined ? index : '';
        if (msg.id) div.dataset.msgId = msg.id;

        let content = '';
        if (msg.type === 'file') {
            content = this.renderFileMessage(msg);
        } else if (msg.type === 'voice') {
            content = this.renderVoiceMessage(msg);
        } else {
            content = `<div class="text">${this.escapeHtml(msg.text)}</div>`;
        }

        // Tick states: sent → delivered (✓✓ gray) → read (✓✓ blue)
        let tickClass = 'tick';
        if (msg.read) tickClass += ' read';
        else if (msg.delivered) tickClass += ' delivered';
        const tickHtml = msg.sent ? `<span class="${tickClass}"></span>` : '';

        div.innerHTML = `
            ${content}
            <div class="meta">
                <span class="time">${new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                ${tickHtml}
            </div>
            <button class="delete-btn" title="Delete message" aria-label="Delete this message">🗑️</button>
        `;

        // Bind delete button
        const deleteBtn = div.querySelector('.delete-btn');
        deleteBtn.onclick = () => this.deleteMessage(index);

        this.$.messages.appendChild(div);
        this.$.messages.scrollTop = this.$.messages.scrollHeight;
    },

    renderFileMessage(msg) {
        const isImage = msg.mimeType?.startsWith('image/');
        const icon = this.getFileIcon(msg.mimeType);
        const sizeStr = this.formatFileSize(msg.size);

        if (isImage && msg.blobUrl) {
            return `
                <div class="file-msg image-msg">
                    <img src="${msg.blobUrl}" alt="${this.escapeHtml(msg.filename)}" onclick="window.open('${msg.blobUrl}')">
                </div>
            `;
        }

        return `
            <div class="file-msg" onclick="${msg.blobUrl ? `window.open('${msg.blobUrl}')` : ''}">
                <span class="file-icon">${icon}</span>
                <div class="file-info">
                    <span class="file-name">${this.escapeHtml(msg.filename)}</span>
                    <span class="file-size">${sizeStr}</span>
                </div>
            </div>
        `;
    },

    renderVoiceMessage(msg) {
        const duration = msg.duration || 0;
        const mins = Math.floor(duration / 60);
        const secs = Math.floor(duration % 60).toString().padStart(2, '0');

        return `
            <div class="voice-note">
                <button onclick="this.parentElement.querySelector('audio').play()" class="play-btn">▶</button>
                <div class="waveform"><div class="progress"></div></div>
                <span class="duration">${mins}:${secs}</span>
                <audio src="${msg.blobUrl}" preload="metadata"></audio>
            </div>
        `;
    },

    getFileIcon(mimeType) {
        if (!mimeType) return '📎';
        if (mimeType.startsWith('image/')) return '🖼️';
        if (mimeType.startsWith('video/')) return '🎬';
        if (mimeType.startsWith('audio/')) return '🎵';
        if (mimeType.includes('pdf')) return '📄';
        if (mimeType.includes('zip') || mimeType.includes('rar')) return '📦';
        return '📎';
    },

    formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    // --- P2P Connection ---
    connectToContacts() {
        for (const id of Object.keys(this.contacts)) {
            this.joinRoom(id);
        }
    },

    async getRoomId(contactId) {
        // Deterministic room from both session IDs
        const pair = [this.me.id, contactId].sort().join('|');
        const bytes = new TextEncoder().encode(pair);
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
    },

    async joinRoom(contactId) {
        if (this.rooms.has(contactId)) return;

        const roomId = await this.getRoomId(contactId);
        console.log(`[Room] Joining ${roomId} for contact ${contactId}`);

        const room = joinRoom({ appId: APP_ID }, roomId);
        this.rooms.set(contactId, room);

        // Actions
        const [sendMsg, onMsg] = room.makeAction('msg');
        const [sendId, onId] = room.makeAction('id');
        const [sendCallEnd, onCallEnd] = room.makeAction('callEnd');
        const [sendFile, onFile] = room.makeAction('file');
        const [sendTyping, onTyping] = room.makeAction('typing');
        const [sendAck, onAck] = room.makeAction('ack');
        const [sendRead, onRead] = room.makeAction('read');

        room._send = sendMsg;
        room._sendId = sendId;
        room._sendCallEnd = sendCallEnd;
        room._sendFile = sendFile;
        room._sendTyping = sendTyping;
        room._sendAck = sendAck;
        room._sendRead = sendRead;

        // Handle message ACK (delivery confirmation)
        onAck((data, peerId) => {
            this.handleAck(contactId, data.id);
        });

        // Handle read receipts
        onRead((data, peerId) => {
            this.handleRead(contactId, data.ids);
        });

        // Handle typing indicator
        onTyping((data, peerId) => {
            this.handleTypingSignal(contactId, data.typing);
        });

        // Handle incoming file chunks
        onFile(async (data, peerId) => {
            await this.receiveFileChunk(contactId, data);
        });

        // Handle call end from peer
        onCallEnd((data, peerId) => {
            console.log('[Call] Peer ended the call');
            if (this.currentCall === contactId || this.pendingContactId === contactId) {
                this.endCall(true); // true = don't send signal back
            }
        });

        // Handle incoming audio streams (for receiving calls)
        room.onPeerStream((stream, peerId) => {
            console.log('[Call] Incoming stream from peer');

            // Ignore if we're already in a call or just ended one (cooldown)
            if (this.currentCall || this.pendingContactId) {
                console.log('[Call] Ignoring stream - already in call');
                return;
            }
            if (this.callEndCooldown && Date.now() - this.callEndCooldown < 2000) {
                console.log('[Call] Ignoring stream - cooldown active');
                return;
            }

            // Show incoming call UI with Accept/Decline buttons
            this.showIncomingCall(contactId, stream);
        });

        // Peer events
        room.onPeerJoin(peerId => {
            console.log(`[Room ${roomId}] Peer joined:`, peerId);
            this.handlePeerConnect(contactId);
            // Send our identity
            sendId({ id: this.me.id, name: this.me.name, publicKey: this.me.publicKeyJwk });
        });

        room.onPeerLeave(peerId => {
            console.log(`[Room ${roomId}] Peer left:`, peerId);
            this.handlePeerDisconnect(contactId);
        });

        // Receive identity - TOFU key-change detection
        onId(async (data, peerId) => {
            console.log('[Room] Got identity:', data);
            if (data.id === contactId && data.publicKey) {
                const stored = this.contacts[contactId];

                try {
                    const peerPub = await Crypto.importPublicKey(data.publicKey);
                    const fingerprint = await Crypto.generateFingerprint(peerPub);

                    // Check for key change
                    if (stored.keyFingerprint && stored.keyFingerprint !== fingerprint) {
                        // KEY CHANGED - do NOT auto-replace, block until user decides
                        console.warn('[Security] Key changed for', contactId);
                        stored.keyChanged = true;
                        stored.verified = false;
                        stored.pendingNewKey = data.publicKey;
                        stored.pendingFingerprint = fingerprint;

                        Storage.updateContact(contactId, {
                            keyChanged: true,
                            verified: false
                        });

                        if (this.activeContact === contactId) {
                            this.updateTrustUI();
                        }
                        this.renderContacts();
                        return; // Don't update key or derive shared key
                    }

                    // First connect - TOFU pin the fingerprint
                    if (!stored.keyFingerprint) {
                        console.log('[Security] TOFU: Pinning fingerprint for', contactId);
                        stored.keyFingerprint = fingerprint;
                    }

                    // Update contact
                    stored.publicKey = data.publicKey;
                    stored.lastSeen = Date.now();
                    stored.keyChanged = false;

                    Storage.updateContact(contactId, {
                        publicKey: data.publicKey,
                        keyFingerprint: stored.keyFingerprint,
                        lastSeen: stored.lastSeen,
                        keyChanged: false
                    });

                    await this.ensureSharedKey(contactId);

                    if (this.activeContact === contactId) {
                        this.updateTrustUI();
                    }
                } catch (err) {
                    console.error('[Security] Key processing error:', err);
                }
            }
        });

        // Receive message
        onMsg(async (data, peerId) => {
            console.log('[Room] Got message:', data);
            await this.receiveMessage(contactId, data);
        });
    },

    async answerCall(contactId) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const room = this.rooms.get(contactId);
            if (room) {
                room.addStream(this.localStream);
                this.$.callStatus.textContent = 'Connected';
            }
        } catch (err) {
            console.error('Failed to answer call:', err);
            this.$.callStatus.textContent = 'Mic access denied';
        }
    },

    handlePeerConnect(contactId) {
        this.contacts[contactId].online = true;
        this.renderContacts();

        if (this.activeContact === contactId) {
            this.updateChatStatus();
        }

        // Flush pending messages for this contact
        this.flushPendingMessages(contactId);
    },

    handlePeerDisconnect(contactId) {
        this.contacts[contactId].online = false;
        this.contacts[contactId].typing = false;
        this.sharedKeys.delete(contactId);
        this.renderContacts();

        if (this.activeContact === contactId) {
            this.updateChatStatus();
        }
    },

    async ensureSharedKey(contactId) {
        if (this.sharedKeys.has(contactId)) return this.sharedKeys.get(contactId);

        const contact = this.contacts[contactId];
        if (!contact?.publicKey) return null;

        try {
            const peerPub = await Crypto.importPublicKey(contact.publicKey);
            const key = await Crypto.deriveSharedKey(this.me.privateKey, peerPub);
            this.sharedKeys.set(contactId, key);
            return key;
        } catch (err) {
            console.error('Key derivation failed:', err);
            return null;
        }
    },

    // --- Messaging ---
    async sendMessage() {
        const text = this.$.msgInput.value.trim();
        if (!text || !this.activeContact) return;

        const contact = this.contacts[this.activeContact];
        const room = this.rooms.get(this.activeContact);
        const isOnline = contact?.online && room?._send;

        // Generate unique message ID for delivery tracking
        const msgId = crypto.randomUUID();
        const msg = { id: msgId, text, time: Date.now() };

        // Save and display immediately
        const stored = { ...msg, sent: true, pending: !isOnline, delivered: false };
        Storage.saveMessage(this.activeContact, stored);

        const msgs = Storage.getMessages(this.activeContact);
        this.renderMessage(stored, msgs.length - 1);

        this.$.msgInput.value = '';
        this.$.btnSend.disabled = true;
        this.renderContacts();

        // If peer is online, send now
        if (isOnline) {
            const key = await this.ensureSharedKey(this.activeContact);
            if (key) {
                const encrypted = await Crypto.encrypt(key, JSON.stringify(msg));
                room._send({ encrypted: true, ...encrypted });
            } else {
                room._send({ encrypted: false, ...msg });
            }
        } else {
            // Queue for later
            this.queueMessage(this.activeContact, msg);
            console.log('[Queue] Message queued for offline peer');
        }
    },

    queueMessage(contactId, msg) {
        if (!this.pendingMessages.has(contactId)) {
            this.pendingMessages.set(contactId, []);
        }
        this.pendingMessages.get(contactId).push(msg);
    },

    async flushPendingMessages(contactId) {
        const pending = this.pendingMessages.get(contactId) || [];
        if (pending.length === 0) return;

        console.log(`[Queue] Flushing ${pending.length} pending messages`);

        const room = this.rooms.get(contactId);
        if (!room?._send) return;

        // Wait for connection to stabilize
        await this.delay(500);

        const key = await this.ensureSharedKey(contactId);

        for (const msg of pending) {
            try {
                if (key) {
                    const encrypted = await Crypto.encrypt(key, JSON.stringify(msg));
                    room._send({ encrypted: true, ...encrypted });
                } else {
                    room._send({ encrypted: false, ...msg });
                }
                console.log('[Queue] Sent:', msg.text?.slice(0, 20));
                await this.delay(100);
            } catch (err) {
                console.error('[Queue] Failed:', err);
            }
        }

        // Clear queue and update message status
        this.pendingMessages.delete(contactId);
        this.markMessagesAsSent(contactId);
    },

    markMessagesAsSent(contactId) {
        const all = localStorage.getItem('p2p_messages');
        const allMsgs = all ? JSON.parse(all) : {};
        if (!allMsgs[contactId]) return;

        let updated = false;
        for (const msg of allMsgs[contactId]) {
            if (msg.pending) {
                delete msg.pending;
                updated = true;
            }
        }

        if (updated) {
            localStorage.setItem('p2p_messages', JSON.stringify(allMsgs));
            if (this.activeContact === contactId) {
                this.renderMessages();
            }
        }
    },

    async receiveMessage(contactId, data) {
        let msg;

        if (data.encrypted) {
            const key = await this.ensureSharedKey(contactId);
            if (!key) {
                console.warn('Cannot decrypt - no key');
                return;
            }
            const decrypted = await Crypto.decrypt(key, { iv: data.iv, data: data.data });
            msg = JSON.parse(decrypted);
        } else {
            msg = { id: data.id, text: data.text, time: data.time };
        }

        const stored = { ...msg, sent: false };
        Storage.saveMessage(contactId, stored);

        // Send ACK back to sender
        const room = this.rooms.get(contactId);
        if (room?._sendAck && msg.id) {
            room._sendAck({ id: msg.id });
            console.log('[ACK] Sent for message', msg.id);
        }

        if (this.activeContact === contactId) {
            const msgs = Storage.getMessages(contactId);
            this.renderMessage(stored, msgs.length - 1);
        }
        this.renderContacts();
    },

    handleAck(contactId, msgId) {
        const all = localStorage.getItem('p2p_messages');
        const allMsgs = all ? JSON.parse(all) : {};
        if (!allMsgs[contactId]) return;

        let updated = false;
        for (const msg of allMsgs[contactId]) {
            if (msg.id === msgId && !msg.delivered) {
                msg.delivered = true;
                updated = true;
                console.log('[ACK] Message delivered:', msgId);
                break;
            }
        }

        if (updated) {
            localStorage.setItem('p2p_messages', JSON.stringify(allMsgs));
            if (this.activeContact === contactId) {
                this.renderMessages();
            }
        }
    },

    handleRead(contactId, msgIds) {
        const all = localStorage.getItem('p2p_messages');
        const allMsgs = all ? JSON.parse(all) : {};
        if (!allMsgs[contactId]) return;

        let updated = false;
        for (const msg of allMsgs[contactId]) {
            if (msgIds.includes(msg.id) && !msg.read) {
                msg.read = true;
                msg.delivered = true; // Also mark as delivered
                updated = true;
            }
        }

        if (updated) {
            localStorage.setItem('p2p_messages', JSON.stringify(allMsgs));
            console.log('[Read] Marked as read:', msgIds.length, 'messages');
            if (this.activeContact === contactId) {
                this.renderMessages();
            }
        }
    },

    sendReadReceipts(contactId) {
        const room = this.rooms.get(contactId);
        if (!room?._sendRead) return;

        // Get all received messages that haven't been read-receipted yet
        const msgs = Storage.getMessages(contactId);
        const unreadIds = msgs
            .filter(m => !m.sent && m.id) // Only received messages with IDs
            .map(m => m.id);

        if (unreadIds.length === 0) return;

        // Send read receipt for all unread messages
        room._sendRead({ ids: unreadIds });
        console.log('[Read] Sent read receipts for', unreadIds.length, 'messages');
    },

    // --- Voice Call ---
    currentCall: null,
    localStream: null,
    pendingStream: null, // Stream waiting to be answered
    pendingContactId: null,
    callStartTime: null,
    callTimerInterval: null,
    isMuted: false,

    async startCall() {
        if (!this.activeContact) return;
        const c = this.contacts[this.activeContact];

        if (!c.online) {
            alert('Contact is offline');
            return;
        }

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.currentCall = this.activeContact;

            this.$.callAvatar.textContent = c.name[0].toUpperCase();
            this.$.callName.textContent = c.name;
            this.$.callStatus.textContent = 'Calling...';
            this.$.callTimer.textContent = '';
            this.$.modalCall.classList.remove('hidden');

            // Hide accept/decline (we're calling), show mute
            this.$.btnAcceptCall.classList.add('hidden');
            this.$.btnDeclineCall.classList.add('hidden');
            this.$.btnMute.classList.remove('hidden');
            this.$.btnEndCall.classList.remove('hidden');
            this.isMuted = false;
            this.$.btnMute.classList.remove('muted');

            // Log call in chat
            const callMsg = { text: '📞 Voice call started', time: Date.now(), sent: true, isSystem: true };
            Storage.saveMessage(this.activeContact, callMsg);
            this.renderMessage(callMsg);

            const room = this.rooms.get(this.activeContact);
            if (room) {
                room.addStream(this.localStream);

                // Listen for peer's stream (when they answer)
                room.onPeerStream((stream, peerId) => {
                    console.log('[Call] Peer answered - got their stream');
                    this.$.remoteAudio.srcObject = stream;
                    this.$.callStatus.textContent = 'Connected';
                    this.startCallTimer();
                });
            }
        } catch (err) {
            console.error('Call error:', err);
            alert('Could not access microphone');
        }
    },

    showIncomingCall(contactId, stream) {
        const c = this.contacts[contactId];
        this.pendingStream = stream;
        this.pendingContactId = contactId;

        this.$.callAvatar.textContent = c?.name[0]?.toUpperCase() || '?';
        this.$.callName.textContent = c?.name || 'Unknown';
        this.$.callStatus.textContent = 'Incoming call...';
        this.$.callTimer.textContent = '';
        this.$.modalCall.classList.remove('hidden');

        // Show accept/decline for incoming
        this.$.btnAcceptCall.classList.remove('hidden');
        this.$.btnDeclineCall.classList.remove('hidden');
        this.$.btnMute.classList.add('hidden');
        this.$.btnEndCall.classList.add('hidden');

        // Log incoming call
        const callMsg = { text: '📞 Incoming voice call', time: Date.now(), sent: false, isSystem: true };
        Storage.saveMessage(contactId, callMsg);
        if (this.activeContact === contactId) this.renderMessage(callMsg);
    },

    async acceptCall() {
        if (!this.pendingContactId) return;

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.currentCall = this.pendingContactId;

            const room = this.rooms.get(this.pendingContactId);
            if (room) {
                room.addStream(this.localStream);
            }

            // Play incoming audio
            this.$.remoteAudio.srcObject = this.pendingStream;

            // Update UI
            this.$.callStatus.textContent = 'Connected';
            this.$.btnAcceptCall.classList.add('hidden');
            this.$.btnDeclineCall.classList.add('hidden');
            this.$.btnMute.classList.remove('hidden');
            this.$.btnEndCall.classList.remove('hidden');
            this.isMuted = false;
            this.$.btnMute.classList.remove('muted');

            // Start timer
            this.startCallTimer();

            this.pendingStream = null;
            this.pendingContactId = null;
        } catch (err) {
            console.error('Accept call error:', err);
            alert('Could not access microphone');
        }
    },

    declineCall() {
        this.pendingStream = null;
        this.pendingContactId = null;
        this.$.modalCall.classList.add('hidden');
    },

    toggleMute() {
        if (!this.localStream) return;

        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMuted;
        });

        this.$.btnMute.classList.toggle('muted', this.isMuted);
        this.$.btnMute.querySelector('.mute-icon').textContent = this.isMuted ? '🔇' : '🎤';
    },

    startCallTimer() {
        this.callStartTime = Date.now();
        this.callTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
            const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const secs = (elapsed % 60).toString().padStart(2, '0');
            this.$.callTimer.textContent = `${mins}:${secs}`;
        }, 1000);
    },

    endCall(peerEnded = false) {
        // Set cooldown to ignore stale streams
        this.callEndCooldown = Date.now();

        // Notify peer that call ended (unless they ended it)
        if (!peerEnded) {
            const contactId = this.currentCall || this.pendingContactId;
            if (contactId) {
                const room = this.rooms.get(contactId);
                if (room?._sendCallEnd) {
                    room._sendCallEnd({ ended: true });
                }
            }
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }

        if (this.callTimerInterval) {
            clearInterval(this.callTimerInterval);
            this.callTimerInterval = null;
        }

        this.currentCall = null;
        this.pendingStream = null;
        this.pendingContactId = null;

        this.$.remoteAudio.srcObject = null;
        this.$.modalCall.classList.add('hidden');
    },

    // --- Typing Indicators ---
    sendTypingSignal() {
        if (!this.activeContact) return;

        const room = this.rooms.get(this.activeContact);
        if (!room?._sendTyping) return;

        // Send typing=true
        room._sendTyping({ typing: true });

        // Clear previous timeout
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }

        // Auto-stop after 3 seconds
        this.typingTimeout = setTimeout(() => {
            room._sendTyping({ typing: false });
        }, 3000);
    },

    handleTypingSignal(contactId, isTyping) {
        this.contacts[contactId].typing = isTyping;

        // Clear timeout for this contact
        const timeout = this.typingTimeouts.get(contactId);
        if (timeout) clearTimeout(timeout);

        if (isTyping) {
            // Auto-clear after 4 seconds
            this.typingTimeouts.set(contactId, setTimeout(() => {
                this.contacts[contactId].typing = false;
                if (this.activeContact === contactId) {
                    this.updateChatStatus();
                }
                this.renderContacts();
            }, 4000));
        }

        if (this.activeContact === contactId) {
            this.updateChatStatus();
        }
        this.renderContacts();
    },

    updateChatStatus() {
        if (!this.activeContact) return;
        const c = this.contacts[this.activeContact];

        if (c.typing) {
            this.$.chatStatus.textContent = 'typing...';
            this.$.chatStatus.className = 'status typing';
        } else if (c.online) {
            this.$.chatStatus.textContent = 'Online';
            this.$.chatStatus.className = 'status online';
        } else {
            this.$.chatStatus.textContent = 'Offline';
            this.$.chatStatus.className = 'status';
        }
    },

    // --- Disconnect/Reconnect ---
    disconnectPeer() {
        if (!this.activeContact) return;

        const room = this.rooms.get(this.activeContact);
        if (room) {
            room.leave();
            this.rooms.delete(this.activeContact);
            this.sharedKeys.delete(this.activeContact);
        }

        this.contacts[this.activeContact].online = false;
        this.$.chatStatus.textContent = 'Disconnected';
        this.$.chatStatus.className = 'status';
        this.renderContacts();

        console.log(`[Disconnect] Disconnected from ${this.activeContact}`);
    },

    // --- Message Deletion ---
    deleteMessage(index) {
        if (!this.activeContact) return;

        const success = Storage.deleteMessageByIndex(this.activeContact, index);
        if (success) {
            this.renderMessages();
            this.renderContacts(); // Update last message preview
            console.log(`[Delete] Removed message at index ${index}`);
        }
    },

    // --- File Transfer ---
    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file || !this.activeContact) return;
        e.target.value = ''; // Reset input

        await this.sendFile(file);
    },

    async sendFile(file, isVoice = false) {
        const room = this.rooms.get(this.activeContact);
        if (!room?._sendFile) {
            alert('Not connected to peer');
            return;
        }

        const contact = this.contacts[this.activeContact];
        if (!contact?.online) {
            alert('Contact is offline');
            return;
        }

        const fileId = crypto.randomUUID();
        const arrayBuffer = await file.arrayBuffer();
        const CHUNK_SIZE = 8192; // 8KB chunks (smaller for reliability)
        const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);

        console.log(`[File] Sending: ${file.name} (${totalChunks} chunks, ${file.size} bytes)`);

        // Send metadata first
        room._sendFile({
            type: 'meta',
            fileId,
            filename: file.name,
            size: file.size,
            mimeType: file.type,
            totalChunks,
            isVoice
        });

        // Small delay to ensure metadata arrives first
        await this.delay(100);

        // Send chunks with backpressure
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);
            const chunk = arrayBuffer.slice(start, end);

            // Convert to base64 for reliable transfer
            const base64 = this.arrayBufferToBase64(chunk);

            // Backpressure: wait if buffer is too full
            const dc = room._channel;
            if (dc && dc.bufferedAmount > 65536) {
                await new Promise(resolve => {
                    const check = () => {
                        if (!dc || dc.bufferedAmount < 32768) resolve();
                        else setTimeout(check, 50);
                    };
                    check();
                });
            }

            room._sendFile({
                type: 'chunk',
                fileId,
                index: i,
                data: base64
            });

            // Small delay between chunks
            if (i < totalChunks - 1) {
                await this.delay(20);
            }
        }

        // Delay before sending complete signal
        await this.delay(100);
        room._sendFile({ type: 'complete', fileId });

        // Create local blob URL and save message
        const blobUrl = URL.createObjectURL(file);
        const msg = {
            type: isVoice ? 'voice' : 'file',
            filename: file.name,
            size: file.size,
            mimeType: file.type,
            blobUrl,
            time: Date.now(),
            sent: true,
            duration: isVoice ? this.lastRecordingDuration : undefined
        };

        Storage.saveMessage(this.activeContact, msg);
        this.renderMessage(msg);
        this.renderContacts();
        console.log(`[File] Sent: ${file.name}`);
    },

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const buffer = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            buffer[i] = binary.charCodeAt(i);
        }
        return buffer;
    },

    async receiveFileChunk(contactId, data) {
        if (data.type === 'meta') {
            // Initialize file reception
            this.pendingFiles.set(data.fileId, {
                chunks: new Array(data.totalChunks),
                received: 0,
                metadata: data
            });
            console.log(`[File] Receiving: ${data.filename} (${data.totalChunks} chunks)`);
        } else if (data.type === 'chunk') {
            const pending = this.pendingFiles.get(data.fileId);
            if (!pending) return;

            // Decode base64 chunk
            pending.chunks[data.index] = this.base64ToArrayBuffer(data.data);
            pending.received++;
            console.log(`[File] Chunk ${data.index + 1}/${pending.metadata.totalChunks} received`);
        } else if (data.type === 'complete') {
            const pending = this.pendingFiles.get(data.fileId);
            if (!pending) return;

            // Reassemble file
            const totalLength = pending.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of pending.chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
            }

            const blob = new Blob([combined], { type: pending.metadata.mimeType });
            const blobUrl = URL.createObjectURL(blob);

            const msg = {
                type: pending.metadata.isVoice ? 'voice' : 'file',
                filename: pending.metadata.filename,
                size: pending.metadata.size,
                mimeType: pending.metadata.mimeType,
                blobUrl,
                time: Date.now(),
                sent: false
            };

            Storage.saveMessage(contactId, msg);
            if (this.activeContact === contactId) {
                this.renderMessage(msg);
            }
            this.renderContacts();

            this.pendingFiles.delete(data.fileId);
            console.log(`[File] Complete: ${pending.metadata.filename}`);
        }
    },

    // --- Voice Notes ---
    lastRecordingDuration: 0,

    async toggleVoiceRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.stopVoiceRecording();
        } else {
            await this.startVoiceRecording();
        }
    },

    async startVoiceRecording() {
        if (!this.activeContact) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.audioChunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                const file = new File([audioBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
                await this.sendFile(file, true);

                // Cleanup
                stream.getTracks().forEach(t => t.stop());
                this.$.chatInputFooter.classList.remove('recording');
                clearInterval(this.recordingInterval);
            };

            this.mediaRecorder.start();
            this.recordingStartTime = Date.now();
            this.$.chatInputFooter.classList.add('recording');

            // Update timer
            this.recordingInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
                this.lastRecordingDuration = elapsed;
            }, 100);

        } catch (err) {
            console.error('Voice recording error:', err);
            alert('Could not access microphone');
        }
    },

    stopVoiceRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
    },

    // --- Helpers ---
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // --- Trust UI ---
    updateTrustUI() {
        if (!this.activeContact) return;
        const contact = this.contacts[this.activeContact];

        // Update trust badge
        this.$.trustBadge.className = 'trust-badge';
        if (contact.keyChanged) {
            this.$.trustBadge.classList.add('key-changed');
        } else if (contact.verified) {
            this.$.trustBadge.classList.add('verified');
        } else {
            this.$.trustBadge.classList.add('unverified');
        }

        // Show/hide key changed banner
        if (contact.keyChanged) {
            this.$.keyChangedBanner.classList.remove('hidden');
            this.$.chatInputFooter.classList.add('blocked');
            this.$.chatHeader.classList.add('blocked');
        } else {
            this.$.keyChangedBanner.classList.add('hidden');
            this.$.chatInputFooter.classList.remove('blocked');
            this.$.chatHeader.classList.remove('blocked');
        }
    },

    async showFingerprintModal() {
        if (!this.activeContact) return;
        const contact = this.contacts[this.activeContact];

        // Get my fingerprint
        const myFingerprint = await Crypto.generateFingerprint(this.me.publicKey);
        this.$.myFingerprint.textContent = myFingerprint;

        // Get their fingerprint (use pending if key changed)
        const theirFingerprint = contact.pendingFingerprint || contact.keyFingerprint || 'Not available';
        this.$.theirFingerprint.textContent = theirFingerprint;

        // Combined display
        this.$.fingerprintDisplay.textContent = theirFingerprint;

        // Update verify button state
        this.$.btnVerifyContact.disabled = contact.keyChanged || contact.verified;
        if (contact.verified) {
            this.$.btnVerifyContact.textContent = 'Already Verified ✓';
        } else if (contact.keyChanged) {
            this.$.btnVerifyContact.textContent = 'Resolve key change first';
        } else {
            this.$.btnVerifyContact.textContent = 'Mark as Verified ✓';
        }

        this.$.modalFingerprint.classList.remove('hidden');
    },

    async acceptNewKey() {
        if (!this.activeContact) return;
        const contact = this.contacts[this.activeContact];
        if (!contact.pendingNewKey) return;

        // Require confirmation
        if (!confirm('Are you sure you want to accept the new security key?\n\nOnly do this if you know this person changed devices.')) {
            return;
        }

        console.log('[Security] User accepted new key for', this.activeContact);

        // Update to new key
        contact.publicKey = contact.pendingNewKey;
        contact.keyFingerprint = contact.pendingFingerprint;
        contact.keyChanged = false;
        contact.verified = false; // Must re-verify
        delete contact.pendingNewKey;
        delete contact.pendingFingerprint;

        Storage.updateContact(this.activeContact, {
            publicKey: contact.publicKey,
            keyFingerprint: contact.keyFingerprint,
            keyChanged: false,
            verified: false
        });

        // Re-derive shared key
        this.sharedKeys.delete(this.activeContact);
        await this.ensureSharedKey(this.activeContact);

        this.updateTrustUI();
        this.renderContacts();
    },

    rejectNewKey() {
        if (!this.activeContact) return;

        console.log('[Security] User rejected new key - disconnecting');
        this.disconnectPeer();

        // Clear pending key data
        const contact = this.contacts[this.activeContact];
        delete contact.pendingNewKey;
        delete contact.pendingFingerprint;
    },

    verifyContact() {
        if (!this.activeContact) return;
        const contact = this.contacts[this.activeContact];

        if (contact.keyChanged) {
            alert('Please resolve the key change first.');
            return;
        }

        contact.verified = true;
        Storage.updateContact(this.activeContact, { verified: true });

        this.updateTrustUI();
        this.hideModal('fingerprint');
        this.renderContacts();
    },

    copyFingerprint() {
        const text = this.$.fingerprintDisplay.textContent;
        navigator.clipboard.writeText(text).then(() => {
            const btn = this.$.btnCopyFingerprint;
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = original, 1500);
        });
    },

    // --- Clean Reconnect ---
    async reconnectPeer() {
        if (!this.activeContact) return;
        const contactId = this.activeContact;

        console.log('[Reconnect] Starting clean reconnect for', contactId);

        // 1. Leave room completely
        const room = this.rooms.get(contactId);
        if (room) {
            room.leave();
            this.rooms.delete(contactId);
        }

        // 2. Clear derived key
        this.sharedKeys.delete(contactId);

        // 3. Reset transient UI state
        this.contacts[contactId].online = false;
        this.contacts[contactId].typing = false;

        // 4. Clear typing timeouts
        const timeout = this.typingTimeouts.get(contactId);
        if (timeout) {
            clearTimeout(timeout);
            this.typingTimeouts.delete(contactId);
        }

        // 5. Clear pending file transfers for this contact
        for (const [fileId, pending] of this.pendingFiles) {
            this.pendingFiles.delete(fileId);
        }

        // 6. Update UI
        this.updateChatStatus();
        this.renderContacts();

        // 7. Wait and rejoin fresh
        await this.delay(500);
        await this.joinRoom(contactId);

        console.log('[Reconnect] Rejoined room for', contactId);
    }
};

// Start
document.addEventListener('DOMContentLoaded', () => App.init());
