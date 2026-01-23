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

    // State
    activeContact: null,

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
            chatInputFooter: document.querySelector('.chat-input'),
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
            div.innerHTML = `
                <div class="avatar">
                    ${c.name[0].toUpperCase()}
                    ${c.online ? '<span class="online-dot"></span>' : ''}
                </div>
                <div class="contact-info">
                    <span class="name">${this.escapeHtml(c.name)}</span>
                    <span class="last-msg">${lastMsg ? this.escapeHtml(lastMsg.text).slice(0, 30) : 'No messages yet'}</span>
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
        this.$.chatStatus.textContent = c.online ? 'Online' : 'Offline';
        this.$.chatStatus.className = 'status' + (c.online ? ' online' : '');

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

    renderMessages() {
        this.$.messages.innerHTML = '';
        if (!this.activeContact) return;

        const msgs = Storage.getMessages(this.activeContact);
        for (const msg of msgs) {
            this.renderMessage(msg);
        }
    },

    renderMessage(msg) {
        const div = document.createElement('div');
        div.className = `message ${msg.sent ? 'sent' : 'received'}`;
        div.innerHTML = `
            <div class="text">${this.escapeHtml(msg.text)}</div>
            <div class="meta">
                <span class="time">${new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        `;
        this.$.messages.appendChild(div);
        this.$.messages.scrollTop = this.$.messages.scrollHeight;
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

        room._send = sendMsg;
        room._sendId = sendId;
        room._sendCallEnd = sendCallEnd;

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

        // Receive identity
        onId(async (data, peerId) => {
            console.log('[Room] Got identity:', data);
            if (data.id === contactId && data.publicKey) {
                this.contacts[contactId].publicKey = data.publicKey;
                Storage.updateContact(contactId, { publicKey: data.publicKey });
                await this.ensureSharedKey(contactId);
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
            this.$.chatStatus.textContent = 'Online';
            this.$.chatStatus.className = 'status online';
        }
    },

    handlePeerDisconnect(contactId) {
        this.contacts[contactId].online = false;
        this.sharedKeys.delete(contactId);
        this.renderContacts();

        if (this.activeContact === contactId) {
            this.$.chatStatus.textContent = 'Offline';
            this.$.chatStatus.className = 'status';
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

        const room = this.rooms.get(this.activeContact);
        if (!room?._send) return;

        const msg = { text, time: Date.now() };

        // Try to encrypt
        const key = await this.ensureSharedKey(this.activeContact);
        if (key) {
            const encrypted = await Crypto.encrypt(key, JSON.stringify(msg));
            room._send({ encrypted: true, ...encrypted });
        } else {
            room._send({ encrypted: false, ...msg });
        }

        // Save and display
        const stored = { ...msg, sent: true };
        Storage.saveMessage(this.activeContact, stored);
        this.renderMessage(stored);

        this.$.msgInput.value = '';
        this.$.btnSend.disabled = true;
        this.renderContacts();
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

    // --- Helpers ---
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Start
document.addEventListener('DOMContentLoaded', () => App.init());
