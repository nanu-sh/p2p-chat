// P2P Chat - Main App (PeerJS signaling)
import Storage from './storage.js';
import Crypto from './crypto.js';
import MediaStore from './mediaStore.js';

const APP_ID = 'p2p-chat-v1';

// Server URL for signaling (e.g., localhost:3000)
let serverUrl = localStorage.getItem('p2p_server_url') || '';

const App = {
    // Identity
    me: null, // { id, name, publicKey, privateKey, publicKeyJwk }

    // PeerJS instance
    peer: null,
    connections: new Map(), // contactId -> PeerJS DataConnection

    // Data
    contacts: {}, // contactId -> { name, publicKey, online }
    sharedKeys: new Map(), // contactId -> AES key
    pendingMessages: new Map(), // contactId -> [messages to send when online]

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

    // Context menu
    contextTarget: null, // { index, message, element }
    longPressTimer: null,
    longPressTriggered: false,

    // Replay protection
    seenNonces: new Map(), // contactId -> Set of nonces
    MAX_NONCE_AGE: 5 * 60 * 1000, // 5 minutes - reject messages older than this

    // DOM cache
    $: {},

    async init() {
        try {
            this.cacheDom();
            this.bindEvents();
            this.initContextMenu();
            await MediaStore.init();

            // Check for invite links (e.g., ?peer=XYZ)
            const params = new URLSearchParams(window.location.search);
            const inviteId = params.get('peer');
            if (inviteId) {
                this.pendingInviteId = inviteId.trim();
                // Optional: Clean URL so it doesn't stay there forever
                window.history.replaceState({}, document.title, window.location.pathname);
                console.log('[Initialize] Detected invite link for peer:', this.pendingInviteId);
            }

            const saved = Storage.getIdentity();
            if (saved) {
                await this.loadIdentity(saved);
                this.showMain();
            } else {
                this.showSetup();
            }
        } catch (err) {
            console.error('[Init] Fatal error:', err);
            document.body.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#020617;color:#fff;font-family:sans-serif;text-align:center;padding:20px;">
                    <div>
                        <h1 style="font-size:48px;margin-bottom:16px;">⚠️</h1>
                        <h2>Failed to Initialize</h2>
                        <p style="color:#94a3b8;margin-top:8px;">${err.message || 'Unknown error'}</p>
                        <p style="color:#64748b;margin-top:16px;font-size:14px;">Try clearing your browser cache or using a different browser.</p>
                        <button onclick="location.reload()" style="margin-top:20px;padding:10px 24px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:16px;">Reload</button>
                    </div>
                </div>
            `;
        }
    },

    cacheDom() {
        this.$ = {
            setupScreen: document.getElementById('setup-screen'),
            mainScreen: document.getElementById('main-screen'),
            setupName: document.getElementById('setup-name'),
            btnSetup: document.getElementById('btn-setup'),
            btnClearCache: document.getElementById('btn-clear-cache'),
            myAvatar: document.getElementById('my-avatar'),
            myName: document.getElementById('my-name'),
            myId: document.getElementById('my-id'),
            btnShareLink: document.getElementById('btn-share-link'),
            btnAdd: document.getElementById('btn-add'),
            contactsList: document.getElementById('contacts-list'),
            emptyChat: document.getElementById('empty-chat'),
            activeChat: document.getElementById('active-chat'),
            chatAvatar: document.getElementById('chat-avatar'),
            chatName: document.getElementById('chat-name'),
            chatStatus: document.getElementById('chat-status'),
            btnCall: document.getElementById('btn-call'),
            btnVerify: document.getElementById('btn-verify'),
            btnDisconnect: document.getElementById('btn-disconnect'),
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
            chatInputFooter: document.querySelector('.chat-input'),
            // Context menu
            contextMenu: document.getElementById('context-menu'),
            // Server URL
            serverUrlInput: document.getElementById('server-url'),
            // Toast
            toastContainer: document.getElementById('toast-container'),
            // Global Clear Cache
            btnClearCacheMain: document.getElementById('btn-clear-cache-main'),
        };
    },

    bindEvents() {
        // Setup
        this.$.btnSetup.onclick = () => this.setup();
        if (this.$.btnClearCache) {
            this.$.btnClearCache.onclick = () => this.clearCache();
        }
        if (this.$.btnClearCacheMain) {
            this.$.btnClearCacheMain.onclick = () => this.clearCache();
        }
        this.$.setupName.onkeydown = (e) => {
            if (e.key === 'Enter') this.setup();
        };

        // Back button (mobile)
        this.$.btnBack.onclick = () => this.closeChat();

        // Copy ID
        this.$.myId.onclick = () => this.copyId();

        // Share Invite Link
        if (this.$.btnShareLink) {
            this.$.btnShareLink.onclick = () => this.copyInviteLink();
        }

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

        // Verify identity
        if (this.$.btnVerify) {
            this.$.btnVerify.onclick = () => this.showSafetyNumber();
        }

        // File attachment
        this.$.btnAttach.onclick = () => this.$.fileInput.click();
        this.$.fileInput.onchange = (e) => this.handleFileSelect(e);

        // Voice note
        this.$.btnVoice.onclick = () => this.toggleVoiceRecording();

        // Disconnect
        this.$.btnDisconnect.onclick = () => this.disconnectPeer();
    },

    // --- Setup ---
    async setup() {
        const name = this.$.setupName.value.trim();
        if (!name) return this.showToast('Enter your name', 'error');

        // Get server URL details
        let urlStr = this.$.serverUrlInput?.value.trim() || '';

        if (urlStr) {
            // Ensure it has a protocol to parse it easily
            if (!urlStr.startsWith('http') && !urlStr.startsWith('ws')) {
                urlStr = (urlStr.includes('localhost') || urlStr.match(/^\d+\.\d+\.\d+\.\d+/))
                    ? 'http://' + urlStr
                    : 'https://' + urlStr;
            }

            try {
                new URL(urlStr); // Validates
                serverUrl = urlStr;
                localStorage.setItem('p2p_server_url', serverUrl);
            } catch (e) {
                return this.showToast('Invalid URL format', 'error');
            }
        } else {
            serverUrl = '';
            localStorage.removeItem('p2p_server_url');
        }

        try {
            const keys = await Crypto.generateKeyPair();
            const id = await Crypto.generateSessionId();

            // Retry with a new ID if there's a collision on PeerJS
            this.pendingSetupId = id;
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
            this.showToast('Failed to create identity', 'error');
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
        this.$.mainScreen.classList.add('hidden');
        this.$.setupScreen.classList.remove('hidden');
        this.$.setupScreen.classList.remove('fade-out');
        this.$.setupScreen.classList.add('fade-in');
    },

    showMain() {
        // Fade out setup screen
        this.$.setupScreen.classList.add('fade-out');
        setTimeout(() => {
            this.$.setupScreen.classList.add('hidden');
            this.$.setupScreen.classList.remove('fade-out');
        }, 400);

        // Fade in main screen
        this.$.mainScreen.classList.remove('hidden');
        this.$.mainScreen.classList.add('fade-in');

        this.$.myAvatar.textContent = this.me.name[0].toUpperCase();
        this.$.myName.textContent = this.me.name;
        this.$.myId.textContent = this.me.id;
        this.$.myId.title = 'Click to copy: ' + this.me.id;

        this.renderContacts();
        this.initPeerJS();

        // Process any pending invite link right after loading main screen
        this.processPendingInvite();
    },

    processPendingInvite() {
        if (!this.pendingInviteId) return;

        const inviteId = this.pendingInviteId;
        this.pendingInviteId = null; // Clear it

        if (inviteId === this.me.id) {
            this.showToast("You can't connect to your own invite link.", 'error');
            return;
        }

        if (this.contacts[inviteId]) {
            console.log('[Invite] Contact already exists, opening chat.');
            this.openChat(inviteId);
            return;
        }

        console.log('[Invite] Processing new peer connection', inviteId);

        // Populate the add modal to let them verify and name the person
        this.$.contactId.value = inviteId;
        this.$.contactName.value = 'Invited Peer';
        this.showModal('add');
        this.$.contactName.select(); // Highlight the temp name so they can efficiently change it
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

    copyInviteLink() {
        if (!this.me?.id) return;
        const link = `${window.location.origin}${window.location.pathname}?peer=${this.me.id}`;

        navigator.clipboard.writeText(link).then(() => {
            this.showToast('Invite link copied!', 'success');
        });
    },

    // --- Cache Management ---
    async clearCache() {
        if (!confirm('Warning: This will delete your identity, all saved contacts, messages, and files. Are you sure you want to completely reset the app?')) {
            return;
        }

        console.log('[Cache] Clearing application data...');

        // 1. Clear LocalStorage
        localStorage.clear();

        // 2. Clear IndexedDB (MediaStore)
        try {
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
                if (db.name) {
                    window.indexedDB.deleteDatabase(db.name);
                    console.log(`[Cache] Deleted IndexedDB: ${db.name}`);
                }
            }
        } catch (e) {
            console.warn('[Cache] Could not enumerate IndexedDBs', e);
            // Fallback to known DB name
            window.indexedDB.deleteDatabase('p2p-chat-media');
        }

        // 3. Unregister Service Workers
        if ('serviceWorker' in navigator) {
            try {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const registration of registrations) {
                    await registration.unregister();
                    console.log('[Cache] Unregistered Service Worker');
                }
            } catch (err) {
                console.error('[Cache] Error unregistering SW', err);
            }
        }

        // 4. Reload page
        this.showToast('Cache cleared! Reloading...', 'info');
        window.location.reload(true);
    },

    // --- Modals ---
    _lastModalTrigger: null,

    showModal(type) {
        this._lastModalTrigger = document.activeElement;
        if (type === 'add') {
            this.$.contactId.value = '';
            this.$.contactName.value = '';
            this.$.modalAdd.classList.remove('modal-hidden');
            // Focus trap: focus the first input after transition
            setTimeout(() => this.$.contactId.focus(), 100);
        }
    },

    hideModal(type) {
        const modal = document.getElementById(`modal-${type}`);
        if (modal) modal.classList.add('modal-hidden');
        // Restore focus to triggering element
        if (this._lastModalTrigger) {
            this._lastModalTrigger.focus();
            this._lastModalTrigger = null;
        }
    },

    // --- Contacts ---
    addContact() {
        const id = this.$.contactId.value.trim();
        const name = this.$.contactName.value.trim();

        if (!id || !name) return this.showToast('Fill both fields', 'error');
        if (id === this.me.id) return this.showToast("Can't add yourself", 'error');
        if (this.contacts[id]) return this.showToast('Contact already exists', 'error');

        Storage.addContact(id, name);
        this.contacts[id] = { name, publicKey: null, online: false };

        this.renderContacts();
        this.hideModal('add');
        this.connectToPeer(id);
    },

    renderContacts() {
        const list = this.$.contactsList;
        const entries = Object.entries(this.contacts);

        if (entries.length === 0) {
            list.innerHTML = '<div class="empty-contacts" role="listitem">No contacts yet.<br>Click + to add someone.</div>';
            return;
        }

        // Smart diff: update existing items instead of full wipe
        const existingItems = list.querySelectorAll('.contact-item');
        const existingIds = new Set();
        existingItems.forEach(el => existingIds.add(el.dataset.contactId));

        const newIds = new Set(entries.map(([id]) => id));

        // Remove items no longer in contacts
        existingItems.forEach(el => {
            if (!newIds.has(el.dataset.contactId)) {
                el.style.opacity = '0';
                el.style.transform = 'translateX(-20px)';
                setTimeout(() => el.remove(), 200);
            }
        });

        // Remove empty-contacts placeholder if it exists
        const emptyPlaceholder = list.querySelector('.empty-contacts');
        if (emptyPlaceholder) emptyPlaceholder.remove();

        for (const [id, c] of entries) {
            const msgs = Storage.getMessages(id);
            const lastMsg = msgs[msgs.length - 1];

            let statusText = 'No messages yet';
            if (c.typing) {
                statusText = 'typing...';
            } else if (lastMsg) {
                statusText = this.escapeHtml(lastMsg.text || lastMsg.filename || 'File').slice(0, 30);
            }

            // Try to update existing item
            let div = list.querySelector(`.contact-item[data-contact-id="${id}"]`);
            if (div) {
                // Update in-place
                div.className = 'contact-item' + (this.activeContact === id ? ' active' : '');
                const nameEl = div.querySelector('.name');
                const lastMsgEl = div.querySelector('.last-msg');
                const avatarEl = div.querySelector('.avatar');
                if (nameEl) nameEl.textContent = c.name;
                if (lastMsgEl) {
                    lastMsgEl.textContent = statusText;
                    lastMsgEl.className = 'last-msg' + (c.typing ? ' typing' : '');
                }
                if (avatarEl) {
                    const hasDot = avatarEl.querySelector('.online-dot');
                    if (c.online && !hasDot) {
                        const dot = document.createElement('span');
                        dot.className = 'online-dot';
                        avatarEl.appendChild(dot);
                    } else if (!c.online && hasDot) {
                        hasDot.remove();
                    }
                }
            } else {
                // Create new item
                div = document.createElement('div');
                div.className = 'contact-item' + (this.activeContact === id ? ' active' : '');
                div.dataset.contactId = id;
                div.setAttribute('role', 'listitem');
                div.setAttribute('tabindex', '0');
                div.setAttribute('aria-label', `Chat with ${this.escapeHtml(c.name)}${c.online ? ', online' : ', offline'}`);
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
                div.onkeydown = (e) => { if (e.key === 'Enter') this.openChat(id); };
                list.appendChild(div);
            }
        }
    },

    deleteContact() {
        if (!this.activeContact) return;
        const c = this.contacts[this.activeContact];
        if (!confirm(`Delete ${c.name}?`)) return;

        // Leave connection
        const conn = this.connections.get(this.activeContact);
        if (conn) conn.close();
        this.connections.delete(this.activeContact);
        this.sharedKeys.delete(this.activeContact);

        Storage.deleteContact(this.activeContact);
        delete this.contacts[this.activeContact];

        this.activeContact = null;
        this.$.activeChat.classList.add('hidden');
        this.$.emptyChat.classList.remove('hidden');
        this.$.mainScreen.classList.remove('chat-open');

        this.renderContacts();
    },

    // --- Safety Number Verification ---
    async showSafetyNumber() {
        if (!this.activeContact) return;

        const contact = this.contacts[this.activeContact];
        if (!contact?.publicKey) {
            this.showToast('Cannot verify: no public key exchanged yet. Send a message first.', 'error');
            return;
        }

        try {
            const theirPub = await Crypto.importPublicKey(contact.publicKey);
            const safetyNumber = await Crypto.generateSafetyNumber(this.me.publicKey, theirPub);

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);';
            overlay.innerHTML = `
                <div style="background:#1e293b;border:1px solid rgba(99,102,241,0.3);border-radius:16px;padding:32px;max-width:340px;text-align:center;color:#fff;font-family:system-ui;">
                    <div style="font-size:32px;margin-bottom:8px;">🛡️</div>
                    <h3 style="margin:0 0 4px;">Safety Number</h3>
                    <p style="color:#94a3b8;font-size:13px;margin:0 0 16px;">Compare this with <b>${this.escapeHtml(contact.name)}</b> in person or over a trusted channel. If they match, the connection is secure.</p>
                    <div style="font-family:'Courier New',monospace;font-size:18px;letter-spacing:2px;line-height:2;color:#a5b4fc;background:#0f172a;border-radius:8px;padding:16px;word-break:break-all;">${safetyNumber}</div>
                    <button style="margin-top:20px;padding:10px 32px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:15px;" onclick="this.closest('div[style]').remove()">Done</button>
                </div>
            `;
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
            document.body.appendChild(overlay);
        } catch (err) {
            console.error('[Verify] Failed:', err);
            this.showToast('Could not generate safety number.', 'error');
        }
    },
    openChat(contactId) {
        this.activeContact = contactId;
        const c = this.contacts[contactId];

        this.$.emptyChat.classList.add('hidden');
        this.$.activeChat.classList.remove('hidden');
        this.$.mainScreen.classList.add('chat-open');

        this.$.chatAvatar.textContent = c.name[0].toUpperCase();
        this.$.chatName.textContent = c.name;
        this.updateChatStatus();

        // Auto-reconnect if disconnected
        if (!c.online && !this.connections.has(contactId)) {
            this.connectToPeer(contactId);
        }

        this.renderMessages();
        this.renderContacts();
        this.$.msgInput.focus();
    },

    closeChat() {
        this.activeContact = null;
        this.$.activeChat.classList.add('hidden');
        this.$.emptyChat.classList.remove('hidden');
        this.$.mainScreen.classList.remove('chat-open');
        this.renderContacts();
    },

    async renderMessages() {
        this.$.messages.innerHTML = '';
        if (!this.activeContact) return;

        const msgs = Storage.getMessages(this.activeContact);
        for (let i = 0; i < msgs.length; i++) {
            const msg = msgs[i];

            // Restore blob URL from IndexedDB if missing
            if (msg.mediaId && !msg.blobUrl) {
                try {
                    const file = await MediaStore.getFile(msg.mediaId);
                    if (file) {
                        msg.blobUrl = file.blobUrl;
                    }
                } catch (err) {
                    console.warn('[Media] Could not restore file:', msg.mediaId);
                }
            }

            this.renderMessage(msg, i, true);
        }
        // Scroll to bottom after batch render
        requestAnimationFrame(() => {
            this.$.messages.scrollTop = this.$.messages.scrollHeight;
        });
    },

    renderMessage(msg, index, isBatch = false) {
        const div = document.createElement('div');
        div.className = `message ${msg.sent ? 'sent' : 'received'}${msg.pending ? ' pending' : ''}`;
        div.dataset.index = index !== undefined ? index : '';

        // Stagger animation for batch renders (only last 6 visible)
        if (isBatch) {
            const msgs = Storage.getMessages(this.activeContact) || [];
            const totalMsgs = msgs.length;
            const distFromEnd = totalMsgs - (index || 0) - 1;
            if (distFromEnd < 6) {
                div.classList.add(`stagger-${distFromEnd}`);
            } else {
                div.classList.add('no-animate');
            }
        }

        let content = '';
        if (msg.type === 'file') {
            content = this.renderFileMessage(msg);
        } else if (msg.type === 'voice') {
            content = this.renderVoiceMessage(msg);
        } else {
            content = `<div class="text">${this.escapeHtml(msg.text)}</div>`;
        }

        div.innerHTML = `
            ${content}
            <div class="meta">
                <span class="time">${new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <button class="delete-btn" title="Delete" aria-label="Delete message" onclick="App.deleteMessage(${index})">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
            </button>
        `;

        // Setup context menu (right-click / long-press)
        this.setupMessageContextMenu(div, index, msg);

        this.$.messages.appendChild(div);
        // Smooth scroll for individual messages, instant for batch
        if (!isBatch) {
            requestAnimationFrame(() => {
                this.$.messages.scrollTo({
                    top: this.$.messages.scrollHeight,
                    behavior: 'smooth'
                });
            });
        }
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

    // --- P2P Connection (PeerJS) ---
    async initPeerJS() {
        let peerConfig = {
            debug: 2,
            config: {
                iceServers: [
                    // STUN servers (discover public IP)
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    { urls: 'stun:stun.cloudflare.com:3478' },
                    // TURN servers (relay for symmetric NAT / carrier-grade NAT)
                    {
                        urls: "turn:openrelay.metered.ca:80",
                        username: "openrelayproject",
                        credential: "openrelayproject"
                    },
                    {
                        urls: "turn:openrelay.metered.ca:80?transport=tcp",
                        username: "openrelayproject",
                        credential: "openrelayproject"
                    },
                    {
                        urls: "turn:openrelay.metered.ca:443",
                        username: "openrelayproject",
                        credential: "openrelayproject"
                    },
                    {
                        urls: "turns:openrelay.metered.ca:443?transport=tcp",
                        username: "openrelayproject",
                        credential: "openrelayproject"
                    }
                ]
            }
        };

        if (serverUrl) {
            let parsed;
            try {
                parsed = new URL(serverUrl);
            } catch (e) {
                console.error('[P2P] Invalid server URL', serverUrl);
                return;
            }

            const secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
            const host = parsed.hostname;
            const port = parsed.port ? parseInt(parsed.port, 10) : (secure ? 443 : 80);

            console.log(`[P2P] Connecting to custom PeerServer at ${host}:${port} (secure: ${secure})`);
            peerConfig.host = host;
            peerConfig.port = port;
            peerConfig.path = '/peerjs/p2p';
            peerConfig.secure = secure;
        } else {
            console.log(`[P2P] Connecting to default public PeerJS Cloud`);
        }

        // Initialize PeerJS with our fixed session ID
        this.peer = new Peer(this.me.id, peerConfig);

        this.peer.on('open', (id) => {
            console.log('[P2P] Connected to server with ID:', id);
            // Connect to all existing contacts
            this.connectToContacts();
        });

        this.peer.on('error', async (err) => {
            console.error('[P2P] Error:', err);
            if (err.type === 'unavailable-id') {
                // ID collision - generate a new one and retry
                this._idRetries = (this._idRetries || 0) + 1;
                if (this._idRetries > 3) {
                    this.showToast('Could not find a unique ID after 3 attempts.', 'error');
                    return;
                }
                console.warn(`[P2P] ID collision, regenerating (attempt ${this._idRetries})...`);
                const newId = await Crypto.generateSessionId();
                this.me.id = newId;
                Storage.saveIdentity({ id: newId, name: this.me.name, publicKeyJwk: this.me.publicKeyJwk, privateKeyJwk: await Crypto.exportKey(this.me.privateKey) });
                this.$.myId.textContent = newId;
                this.$.myId.title = 'Click to copy: ' + newId;
                this.peer.destroy();
                this.initPeerJS();
            } else if (err.type === 'peer-unavailable') {
                console.warn('[P2P] Peer is offline:', err.message);
            }
        });

        // Handle incoming data connections
        this.peer.on('connection', (conn) => {
            console.log(`[P2P] Incoming connection from ${conn.peer}`);
            this.setupConnection(conn);
        });

        // Handle incoming media calls
        this.peer.on('call', (call) => {
            console.log(`[Call] Incoming call from ${call.peer}`);

            // Ignore if we're already in a call or just ended one (cooldown)
            if (this.currentCall || this.pendingContactId) {
                console.log('[Call] Ignoring stream - already in call');
                return;
            }
            if (this.callEndCooldown && Date.now() - this.callEndCooldown < 2000) {
                console.log('[Call] Ignoring stream - cooldown active');
                return;
            }

            // We must answer the call to get the stream (we wait for user accept to add audio)
            this.pendingCall = call;

            call.on('stream', (remoteStream) => {
                this.showIncomingCall(call.peer, remoteStream);
            });

            call.on('close', () => {
                console.log('[Call] Peer ended the call');
                if (this.currentCall === call.peer || this.pendingContactId === call.peer) {
                    this.endCall(true);
                }
            });
        });
    },

    connectToContacts() {
        if (!this.peer) return;

        for (const contactId of Object.keys(this.contacts)) {
            this.connectToPeer(contactId);
        }
    },

    connectToPeer(contactId) {
        if (!this.peer || this.connections.has(contactId)) return;

        console.log(`[P2P] Attempting to connect to ${contactId}...`);
        const conn = this.peer.connect(contactId, {
            reliable: true
        });

        this.setupConnection(conn);
    },

    setupConnection(conn) {
        const retryDelays = [5000, 15000, 30000]; // Retry after 5s, 15s, 30s

        conn.on('open', () => {
            console.log(`[P2P] Connection established with ${conn.peer}`);
            this.connections.set(conn.peer, conn);
            this.handlePeerConnect(conn.peer);
            // Reset retry counter on successful connection
            delete this._retryCount;

            // Send our identity to verify
            conn.send({
                action: 'id',
                payload: { id: this.me.id, name: this.me.name, publicKey: this.me.publicKeyJwk }
            });
        });

        conn.on('data', (data) => {
            this.handleDataMessage(conn.peer, data);
        });

        conn.on('close', () => {
            console.log(`[P2P] Connection closed with ${conn.peer}`);
            this.connections.delete(conn.peer);
            this.handlePeerDisconnect(conn.peer);
            // Auto-retry if peer is still in contacts
            this._scheduleReconnect(conn.peer, retryDelays);
        });

        conn.on('error', (err) => {
            console.error(`[P2P] Connection error with ${conn.peer}:`, err);
            this.connections.delete(conn.peer);
            this.handlePeerDisconnect(conn.peer);
            // Auto-retry on error
            this._scheduleReconnect(conn.peer, retryDelays);
        });
    },

    _scheduleReconnect(peerId, delays) {
        if (!this.contacts[peerId]) return; // Contact was deleted

        if (!this._retryCount) this._retryCount = {};
        const attempt = this._retryCount[peerId] || 0;

        if (attempt >= delays.length) {
            console.log(`[P2P] Max retries reached for ${peerId}`);
            return;
        }

        const delay = delays[attempt];
        this._retryCount[peerId] = attempt + 1;
        console.log(`[P2P] Scheduling reconnect to ${peerId} in ${delay / 1000}s (attempt ${attempt + 1}/${delays.length})`);

        setTimeout(() => {
            if (this.contacts[peerId] && !this.connections.has(peerId) && this.peer && !this.peer.destroyed) {
                console.log(`[P2P] Retrying connection to ${peerId}...`);
                this.connectToPeer(peerId);
            }
        }, delay);
    },

    handleDataMessage(peerId, data) {
        if (!data || !data.action) return;

        const payload = data.payload;
        console.log(`[P2P] Received action: ${data.action} from ${peerId}`);

        switch (data.action) {
            case 'id':
                if (payload.id === peerId && payload.publicKey) {
                    // Update contact info
                    if (!this.contacts[peerId]) {
                        this.contacts[peerId] = { name: payload.name || 'Unknown', online: true };
                    }
                    this.contacts[peerId].publicKey = payload.publicKey;
                    if (payload.name) {
                        this.contacts[peerId].name = payload.name;
                    }
                    Storage.updateContact(peerId, {
                        publicKey: payload.publicKey,
                        name: payload.name || this.contacts[peerId].name
                    });
                    this.ensureSharedKey(peerId);

                    this.renderContacts();
                    if (this.activeContact === peerId) {
                        this.$.chatName.textContent = payload.name || this.contacts[peerId].name;
                    }
                }
                break;

            case 'msg':
                this.receiveMessage(peerId, payload);
                break;

            case 'typing':
                this.handleTypingSignal(peerId, payload.typing);
                break;

            case 'file':
                this.receiveFileChunk(peerId, payload);
                break;

            case 'callEnd':
                console.log('[Call] Peer sent callEnd signal');
                if (this.currentCall === peerId || this.pendingContactId === peerId) {
                    this.endCall(true);
                }
                break;
        }
    },

    async answerCall(contactId) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (this.pendingCall && this.pendingCall.peer === contactId) {
                this.pendingCall.answer(this.localStream);
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
        const conn = this.connections.get(this.activeContact);
        const isOnline = contact?.online && conn && conn.open;

        const msg = { text, time: Date.now() };

        // Save and display immediately
        const stored = { ...msg, sent: true, pending: !isOnline };
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
                // Add nonce for replay protection
                const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                const encrypted = await Crypto.encrypt(key, JSON.stringify({ ...msg, nonce }));
                conn.send({ action: 'msg', payload: { encrypted: true, ...encrypted } });
            } else {
                conn.send({ action: 'msg', payload: { encrypted: false, ...msg } });
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

        const conn = this.connections.get(contactId);
        if (!conn || !conn.open) return;

        // Wait for connection to stabilize
        await this.delay(500);

        const key = await this.ensureSharedKey(contactId);

        for (const msg of pending) {
            try {
                if (key) {
                    const encrypted = await Crypto.encrypt(key, JSON.stringify(msg));
                    conn.send({ action: 'msg', payload: { encrypted: true, ...encrypted } });
                } else {
                    conn.send({ action: 'msg', payload: { encrypted: false, ...msg } });
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

            // Replay protection: check nonce
            if (msg.nonce) {
                if (!this.seenNonces.has(contactId)) {
                    this.seenNonces.set(contactId, new Set());
                }
                const nonces = this.seenNonces.get(contactId);
                if (nonces.has(msg.nonce)) {
                    console.warn('[Security] Replay detected, dropping message');
                    return;
                }
                nonces.add(msg.nonce);

                // Prune old nonces to prevent memory leak
                if (nonces.size > 500) {
                    const arr = Array.from(nonces);
                    arr.splice(0, arr.length - 200);
                    this.seenNonces.set(contactId, new Set(arr));
                }

                // Remove nonce before storing (not needed in history)
                delete msg.nonce;
            }
        } else {
            msg = { text: data.text, time: data.time };
        }

        const stored = { ...msg, sent: false };
        Storage.saveMessage(contactId, stored);

        if (this.activeContact === contactId) {
            this.renderMessage(stored);
        }
        this.renderContacts();
    },

    // --- Voice Call ---
    currentCall: null,
    localStream: null,
    pendingStream: null, // Stream waiting to be answered
    pendingContactId: null,
    callStartTime: null,
    callTimerInterval: null,
    isMuted: false,
    currentPeerCall: null, // PeerJS Call object

    async startCall() {
        const contactId = this.activeContact;
        if (!contactId || !this.contacts[contactId]?.online) {
            return this.showToast('Contact is offline', 'error');
        }

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this.$.callAvatar.textContent = this.contacts[contactId].name[0].toUpperCase();
            this.$.callName.textContent = this.contacts[contactId].name;
            this.$.callStatus.textContent = 'Calling...';
            this.$.callTimer.textContent = '00:00';

            this.showCallUI(true); // isInitiator

            console.log(`[Call] Making call to ${contactId}`);
            const call = this.peer.call(contactId, this.localStream);
            this.currentCall = contactId;
            this.currentPeerCall = call;

            call.on('stream', (remoteStream) => {
                console.log('[Call] Peer answered with stream');
                this.$.callStatus.textContent = 'Connected';
                this.$.remoteAudio.srcObject = remoteStream;
                this.startCallTimer();
            });

            call.on('close', () => {
                console.log('[Call] Call closed');
                this.endCall(true);
            });

            call.on('error', (err) => {
                console.error('[Call] Error:', err);
                this.$.callStatus.textContent = 'Error connecting';
                setTimeout(() => this.endCall(true), 2000);
            });

            // Log call in chat
            const callMsg = { text: '📞 Voice call started', time: Date.now(), sent: true, isSystem: true };
            Storage.saveMessage(this.activeContact, callMsg);
            this.renderMessage(callMsg);

        } catch (err) {
            console.error('Failed to get mic:', err);
            this.showToast('Could not access microphone', 'error');
            this.endCall(true); // cleanup
        }
    },

    showIncomingCall(contactId, call) {
        const c = this.contacts[contactId];
        this.pendingCall = call; // Store the PeerJS call object
        this.pendingContactId = contactId;

        this.$.callAvatar.textContent = c?.name[0]?.toUpperCase() || '?';
        this.$.callName.textContent = c?.name || 'Unknown';
        this.$.callStatus.textContent = 'Incoming call...';
        this.$.callTimer.textContent = '';
        this.$.modalCall.classList.remove('modal-hidden');

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

    showCallUI(isInitiator) {
        this.$.modalCall.classList.remove('modal-hidden');
        this.$.btnAcceptCall.classList.toggle('hidden', isInitiator);
        this.$.btnDeclineCall.classList.toggle('hidden', isInitiator);
        this.$.btnMute.classList.toggle('hidden', !isInitiator);
        this.$.btnEndCall.classList.remove('hidden');
        this.isMuted = false;
        this.$.btnMute.classList.remove('muted');
    },

    async acceptCall() {
        if (!this.pendingContactId || !this.pendingCall) return;

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.currentCall = this.pendingContactId;
            this.currentPeerCall = this.pendingCall;

            this.pendingCall.answer(this.localStream);

            this.pendingCall.on('stream', (remoteStream) => {
                console.log('[Call] Accepted - got remote stream');
                this.$.remoteAudio.srcObject = remoteStream;
                this.$.callStatus.textContent = 'Connected';
                this.startCallTimer();
            });

            this.pendingCall.on('close', () => {
                console.log('[Call] Call closed after accept');
                this.endCall(true);
            });

            this.pendingCall.on('error', (err) => {
                console.error('[Call] Error after accept:', err);
                this.$.callStatus.textContent = 'Error connecting';
                setTimeout(() => this.endCall(true), 2000);
            });

            // Update UI
            this.$.callStatus.textContent = 'Connecting...';
            this.showCallUI(false); // Not initiator

            // Start timer will be called on 'stream' event
            this.pendingCall = null;
            this.pendingContactId = null;
        } catch (err) {
            console.error('Accept call error:', err);
            this.showToast('Could not access microphone', 'error');
            this.endCall(true); // cleanup
        }
    },

    declineCall() {
        if (this.pendingCall) {
            this.pendingCall.close();
        }
        this.pendingCall = null;
        this.pendingContactId = null;
        this.$.modalCall.classList.add('modal-hidden');
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

    endCall(skipSignal = false) {
        if (!this.currentCall && !this.pendingContactId && !this.currentPeerCall) return;

        console.log('[Call] Ending call...');

        // Notify peer if we initiated the end
        if (!skipSignal) {
            const targetId = this.currentCall || this.pendingContactId;
            if (targetId) {
                const conn = this.connections.get(targetId);
                if (conn && conn.open) {
                    conn.send({ action: 'callEnd', payload: {} });
                }
            }
        }

        if (this.currentPeerCall) {
            this.currentPeerCall.close();
            this.currentPeerCall = null;
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
        this.pendingCall = null; // Clear pending PeerJS call

        this.$.remoteAudio.srcObject = null;
        this.$.modalCall.classList.add('modal-hidden');
    },

    // --- Typing Indicators ---
    sendTypingSignal() {
        if (!this.activeContact) return;
        const conn = this.connections.get(this.activeContact);
        if (!conn || !conn.open) return;

        if (!this.isTyping) {
            this.isTyping = true;
            conn.send({ action: 'typing', payload: { typing: true } });
        }

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.isTyping = false;
            conn.send({ action: 'typing', payload: { typing: false } });
        }, 3000); // Stop typing after 3s of inactivity
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

        const conn = this.connections.get(this.activeContact);
        if (conn) {
            conn.close();
            this.connections.delete(this.activeContact);
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
        const conn = this.connections.get(this.activeContact);
        if (!conn || !conn.open) {
            this.showToast('Not connected to peer', 'error');
            return;
        }

        const contact = this.contacts[this.activeContact];
        if (!contact?.online) {
            this.showToast('Contact is offline', 'error');
            return;
        }

        const fileId = crypto.randomUUID();
        const arrayBuffer = await file.arrayBuffer();
        const CHUNK_SIZE = 8192; // 8KB chunks (smaller for reliability)
        const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);

        // Get encryption key if available
        const key = await this.ensureSharedKey(this.activeContact);
        const isEncrypted = !!key;

        console.log(`[File] Sending: ${file.name} (${totalChunks} chunks, ${file.size} bytes, encrypted: ${isEncrypted})`);

        // Send metadata first (encrypt filename/size/type for privacy)
        const metaPayload = {
            type: 'meta',
            fileId,
            filename: file.name,
            size: file.size,
            mimeType: file.type,
            totalChunks,
            isVoice,
            encrypted: isEncrypted
        };

        if (isEncrypted) {
            const encMeta = await Crypto.encrypt(key, JSON.stringify(metaPayload));
            conn.send({ action: 'file', payload: { type: 'meta-enc', ...encMeta } });
        } else {
            conn.send({ action: 'file', payload: metaPayload });
        }

        // Small delay to ensure metadata arrives first
        await this.delay(100);

        // Send chunks with delays
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);
            const chunk = arrayBuffer.slice(start, end);

            // Convert to base64 for reliable transfer
            const base64 = this.arrayBufferToBase64(chunk);

            if (isEncrypted) {
                const encChunk = await Crypto.encrypt(key, base64);
                conn.send({
                    action: 'file',
                    payload: {
                        type: 'chunk-enc',
                        fileId,
                        index: i,
                        ...encChunk
                    }
                });
            } else {
                conn.send({
                    action: 'file',
                    payload: {
                        type: 'chunk',
                        fileId,
                        index: i,
                        data: base64
                    }
                });
            }

            // Small delay between chunks to prevent overwhelming the channel
            if (i < totalChunks - 1) {
                await this.delay(50);
            }
        }

        // Delay before sending complete signal
        await this.delay(100);
        conn.send({ action: 'file', payload: { type: 'complete', fileId } });

        // Save file to IndexedDB for persistence
        await MediaStore.saveFile(fileId, file);

        // Display immediately in UI
        const msg = {
            type: isVoice ? 'voice' : 'file',
            filename: file.name,
            size: file.size,
            mimeType: file.type,
            mediaId: fileId, // Store mediaId for persistence
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

    // --- File Handling (Receiving) ---
    async receiveFileChunk(contactId, data) {
        // Handle encrypted metadata
        if (data.type === 'meta-enc') {
            try {
                const key = await this.ensureSharedKey(contactId);
                if (!key) {
                    console.error('[File] Cannot decrypt file metadata - no shared key');
                    return;
                }
                const decrypted = await Crypto.decrypt(key, { iv: data.iv, data: data.data });
                const meta = JSON.parse(decrypted);
                console.log(`[File] Incoming (encrypted): ${meta.filename} (${meta.totalChunks} chunks, ${meta.size} bytes)`);
                this.pendingFiles.set(meta.fileId, {
                    chunks: new Array(meta.totalChunks),
                    received: 0,
                    encrypted: true,
                    ...meta
                });
            } catch (err) {
                console.error('[File] Failed to decrypt file metadata:', err);
            }
            return;
        }

        if (data.type === 'meta') {
            console.log(`[File] Incoming: ${data.filename} (${data.totalChunks} chunks, ${data.size} bytes)`);
            this.pendingFiles.set(data.fileId, {
                chunks: new Array(data.totalChunks),
                received: 0,
                encrypted: false,
                ...data
            });
            return;
        }

        // Handle encrypted chunks
        if (data.type === 'chunk-enc') {
            const fileData = this.pendingFiles.get(data.fileId);
            if (!fileData) return;

            try {
                const key = await this.ensureSharedKey(contactId);
                if (!key) {
                    console.error('[File] Cannot decrypt chunk - no key');
                    return;
                }
                const decryptedBase64 = await Crypto.decrypt(key, { iv: data.iv, data: data.data });
                const arrayBuffer = this.base64ToArrayBuffer(decryptedBase64);
                fileData.chunks[data.index] = arrayBuffer;
                fileData.received++;

                if (fileData.received % 10 === 0) {
                    console.log(`[File] Received ${fileData.received}/${fileData.totalChunks} encrypted chunks`);
                }
            } catch (err) {
                console.error('[File] Failed to decrypt chunk:', data.index, err);
            }
            return;
        }

        if (data.type === 'chunk') {
            const fileData = this.pendingFiles.get(data.fileId);
            if (!fileData) return;

            // Convert base64 back to array buffer
            const arrayBuffer = this.base64ToArrayBuffer(data.data);
            fileData.chunks[data.index] = arrayBuffer;
            fileData.received++;

            if (fileData.received % 10 === 0) {
                console.log(`[File] Received ${fileData.received}/${fileData.totalChunks} chunks`);
            }
            return;
        }

        if (data.type === 'complete') {
            const fileData = this.pendingFiles.get(data.fileId);
            if (!fileData || fileData.received !== fileData.totalChunks) {
                console.error('[File] Complete signal but missing chunks!', fileData);
                return;
            }

            console.log(`[File] Assembly complete: ${fileData.filename} (encrypted: ${fileData.encrypted})`);
            const blob = new Blob(fileData.chunks, { type: fileData.mimeType });

            // Ensure media is saved and indexed properly
            await MediaStore.saveFile(data.fileId, blob);

            const msg = {
                type: fileData.isVoice ? 'voice' : 'file',
                filename: fileData.filename,
                size: fileData.size,
                mimeType: fileData.mimeType,
                mediaId: data.fileId,
                time: Date.now(),
                sent: false,
                isVoice: fileData.isVoice
            };

            const stored = { ...msg, sent: false };
            Storage.saveMessage(contactId, stored);

            if (this.activeContact === contactId) {
                this.renderMessage(stored);
            }
            this.renderContacts();

            // Clean up memory
            this.pendingFiles.delete(data.fileId);
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
            this.showToast('Could not access microphone', 'error');
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

    // --- Context Menu ---
    initContextMenu() {
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.$.contextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });

        // Close on scroll
        this.$.messages?.addEventListener('scroll', () => this.hideContextMenu());

        // Close on ESC (context menu + modals)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideContextMenu();
                // Close any open modals
                if (!this.$.modalAdd.classList.contains('modal-hidden')) {
                    this.hideModal('add');
                }
                if (!this.$.modalCall.classList.contains('modal-hidden')) {
                    this.endCall();
                }
            }
        });

        // Handle menu item clicks
        this.$.contextMenu.querySelectorAll('.context-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                this.handleContextAction(action);
            });
        });
    },

    setupMessageContextMenu(msgElement, index, msg) {
        // Right-click (desktop)
        msgElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e.clientX, e.clientY, index, msg, msgElement);
        });

        // Long-press (mobile)
        msgElement.addEventListener('touchstart', (e) => {
            this.longPressTriggered = false;
            this.longPressTimer = setTimeout(() => {
                this.longPressTriggered = true;
                const touch = e.touches[0];
                this.showContextMenu(touch.clientX, touch.clientY, index, msg, msgElement);
                // Vibrate on mobile if supported
                if (navigator.vibrate) navigator.vibrate(50);
            }, 500);
        });

        msgElement.addEventListener('touchend', () => {
            clearTimeout(this.longPressTimer);
        });

        msgElement.addEventListener('touchmove', () => {
            clearTimeout(this.longPressTimer);
        });
    },

    showContextMenu(x, y, index, msg, element) {
        this.contextTarget = { index, message: msg, element };

        // Highlight message
        document.querySelectorAll('.message.context-active').forEach(el => el.classList.remove('context-active'));
        element.classList.add('context-active');

        // Position menu
        const menu = this.$.contextMenu;
        menu.classList.remove('hidden');

        // Adjust position to stay on screen
        const menuRect = menu.getBoundingClientRect();
        let posX = x;
        let posY = y;

        if (x + menuRect.width > window.innerWidth) {
            posX = window.innerWidth - menuRect.width - 10;
        }
        if (y + menuRect.height > window.innerHeight) {
            posY = window.innerHeight - menuRect.height - 10;
        }

        menu.style.left = posX + 'px';
        menu.style.top = posY + 'px';
    },

    hideContextMenu() {
        this.$.contextMenu?.classList.add('hidden');
        document.querySelectorAll('.message.context-active').forEach(el => el.classList.remove('context-active'));
        this.contextTarget = null;
    },

    handleContextAction(action) {
        if (!this.contextTarget) return;

        const { index, message } = this.contextTarget;

        switch (action) {
            case 'copy':
                const text = message.text || message.filename || '';
                navigator.clipboard.writeText(text).then(() => {
                    // Brief feedback
                    console.log('Copied to clipboard');
                });
                break;

            case 'reply':
                // Future: implement reply feature
                this.$.msgInput.value = `> ${message.text || ''}\n`;
                this.$.msgInput.focus();
                break;

            case 'delete':
                if (confirm('Delete this message?')) {
                    Storage.deleteMessageByIndex(this.activeContact, index);
                    this.renderMessages();
                }
                break;
        }

        this.hideContextMenu();
    },

    // --- Toast Notifications ---
    showToast(message, type = 'info') {
        const container = this.$.toastContainer;
        if (!container) return;

        const icons = {
            success: '✓',
            error: '✗',
            info: 'ℹ'
        };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span>${this.escapeHtml(message)}</span>
        `;

        container.appendChild(toast);

        // Auto-dismiss after 3s
        setTimeout(() => {
            toast.classList.add('toast-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    }
};

// Start
document.addEventListener('DOMContentLoaded', () => {
    window.App = App;
    App.init();
});
