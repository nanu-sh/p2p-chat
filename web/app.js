// P2P Chat - Full Application with E2E Encryption

const App = {
    // My identity
    me: null, // { id, name, publicKey, privateKey, publicKeyJwk }

    // Data
    contacts: new Map(),  // sessionId -> { name, publicKeyJwk, online }
    groups: new Map(),    // groupId -> { name, members: [sessionId] }
    peers: new Map(),     // sessionId -> RTCPeer
    sharedKeys: new Map(), // sessionId -> CryptoKey (derived AES key)

    // Current state
    activeChat: null,     // { type: 'dm'|'group', id }

    // Messages per chat (stored in memory, ephemeral)
    chatMessages: new Map(), // chatKey -> [{ sender, text, sent, time }]

    // File transfer buffers
    fileRx: new Map(), // fileId -> { name, mime, chunks: [], size, receivedBytes }

    // Services
    ws: null,

    async init() {
        try {
            await Storage.init();
            this.cacheDom();
            this.bindEvents();

            const saved = await Storage.getIdentity();
            if (saved) {
                await this.loadIdentity(saved);
                this.showMain();
            } else {
                this.showSetup();
            }
        } catch (err) {
            console.error('Init error:', err);
            alert('Failed to initialize: ' + err.message);
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
            mySessionId: document.getElementById('my-session-id'),
            contactsList: document.getElementById('contacts-list'),
            groupsList: document.getElementById('groups-list'),
            tabs: document.querySelectorAll('.tab'),
            noChat: document.getElementById('no-chat'),
            activeChat: document.getElementById('active-chat'),
            chatAvatar: document.getElementById('chat-avatar'),
            chatName: document.getElementById('chat-name'),
            chatStatus: document.getElementById('chat-status'),
            groupMembersPanel: document.getElementById('group-members-panel'),
            groupMembersContent: document.getElementById('group-members-content'),
            messages: document.getElementById('messages'),
            msgInput: document.getElementById('msg-input'),
            btnSend: document.getElementById('btn-send'),
            btnAttach: document.getElementById('btn-attach'),
            fileInput: document.getElementById('file-input'),
            btnCall: document.getElementById('btn-call'),
            // Modals
            modalAddContact: document.getElementById('modal-add-contact'),
            contactSessionId: document.getElementById('contact-session-id'),
            contactName: document.getElementById('contact-name'),
            btnCancelContact: document.getElementById('btn-cancel-contact'),
            btnSaveContact: document.getElementById('btn-save-contact'),
            modalCreateGroup: document.getElementById('modal-create-group'),
            groupName: document.getElementById('group-name'),
            groupMembersList: document.getElementById('group-members-list'),
            btnCancelGroup: document.getElementById('btn-cancel-group'),
            btnSaveGroup: document.getElementById('btn-save-group'),
            btnAddContact: document.getElementById('btn-add-contact'),
            btnCreateGroup: document.getElementById('btn-create-group'),
            btnDeleteChat: document.getElementById('btn-delete-chat'),
            // Call
            modalCall: document.getElementById('modal-call'),
            callAvatar: document.getElementById('call-avatar'),
            callName: document.getElementById('call-name'),
            callStatus: document.getElementById('call-status'),
            remoteAudio: document.getElementById('remote-audio'),
            btnEndCall: document.getElementById('btn-end-call'),
        };
    },

    bindEvents() {
        // Setup
        this.$.btnSetup.addEventListener('click', () => this.setup());
        this.$.setupName.addEventListener('keydown', (e) => e.key === 'Enter' && this.setup());

        // Session ID copy
        this.$.mySessionId.addEventListener('click', () => this.copyId());

        // Tabs
        this.$.tabs.forEach(t => t.addEventListener('click', () => this.switchTab(t.dataset.tab)));

        // Add contact
        this.$.btnAddContact.addEventListener('click', () => this.showModal('add-contact'));
        this.$.btnCancelContact.addEventListener('click', () => this.hideModal('add-contact'));
        this.$.btnSaveContact.addEventListener('click', () => this.addContact());

        // Create group
        this.$.btnCreateGroup.addEventListener('click', () => this.showModal('create-group'));
        this.$.btnCancelGroup.addEventListener('click', () => this.hideModal('create-group'));
        this.$.btnSaveGroup.addEventListener('click', () => this.createGroup());

        // Messaging
        this.$.msgInput.addEventListener('input', () => {
            this.$.btnSend.disabled = !this.$.msgInput.value.trim();
        });
        this.$.msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        this.$.btnSend.addEventListener('click', () => this.sendMessage());

        // File
        this.$.btnAttach.addEventListener('click', () => this.$.fileInput.click());
        this.$.fileInput.addEventListener('change', () => this.sendFile());

        // Call
        this.$.btnCall.addEventListener('click', () => this.startCall());
        this.$.btnEndCall.addEventListener('click', () => this.endCall());

        // Delete
        this.$.btnDeleteChat.addEventListener('click', () => this.deleteCurrentChat());
    },

    // --- Setup ---
    async setup() {
        const name = this.$.setupName.value.trim();
        if (!name) return alert('Enter a name');

        try {
            const keys = await Crypto.generateKeyPair();
            const id = await Crypto.generateSessionId(keys.publicKey);
            const publicKeyJwk = await Crypto.exportKey(keys.publicKey);
            const privateKeyJwk = await Crypto.exportKey(keys.privateKey);

            await Storage.saveIdentity({ id, name, publicKeyJwk, privateKeyJwk });

            this.me = { id, name, publicKey: keys.publicKey, privateKey: keys.privateKey, publicKeyJwk };
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
        const contacts = await Storage.getAllContacts();
        for (const c of contacts) {
            this.contacts.set(c.sessionId, {
                name: c.name,
                publicKeyJwk: c.publicKeyJwk,
                online: false
            });
        }

        // Load groups
        const groups = await Storage.getAllGroups();
        for (const g of groups) {
            this.groups.set(g.id, { name: g.name, members: g.memberSessionIds });
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
        this.$.mySessionId.textContent = this.me.id.slice(0, 12) + '...';
        this.$.mySessionId.title = 'Click to copy: ' + this.me.id;

        this.renderContacts();
        this.renderGroups();
        this.connect();
    },

    copyId() {
        navigator.clipboard.writeText(this.me.id);
        alert('Session ID copied!\n' + this.me.id);
    },

    switchTab(tab) {
        this.$.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        this.$.contactsList.classList.toggle('hidden', tab !== 'contacts');
        this.$.groupsList.classList.toggle('hidden', tab !== 'groups');
    },

    // --- Modals ---
    showModal(type) {
        if (type === 'add-contact') {
            this.$.contactSessionId.value = '';
            this.$.contactName.value = '';
            this.$.modalAddContact.classList.remove('hidden');
            this.$.contactSessionId.focus();
        } else if (type === 'create-group') {
            this.$.groupName.value = '';
            this.renderGroupMembers();
            this.$.modalCreateGroup.classList.remove('hidden');
        }
    },

    hideModal(type) {
        document.getElementById(`modal-${type}`)?.classList.add('hidden');
    },

    // --- Contacts ---
    async addContact() {
        const sessionId = this.$.contactSessionId.value.trim();
        const name = this.$.contactName.value.trim();
        if (!sessionId || !name) return alert('Fill both fields');
        if (sessionId === this.me.id) return alert('Cannot add yourself');
        if (this.contacts.has(sessionId)) return alert('Contact exists');

        await Storage.saveContact({ sessionId, name, publicKeyJwk: null });
        this.contacts.set(sessionId, { name, publicKeyJwk: null, online: false });

        this.renderContacts();
        this.hideModal('add-contact');

        // Join room with this contact
        await this.joinContactRoom(sessionId);
    },

    renderContacts() {
        const list = this.$.contactsList;
        list.innerHTML = '';

        if (this.contacts.size === 0) {
            list.innerHTML = '<div class="empty-list">No contacts. Click ➕ to add friends!</div>';
            return;
        }

        for (const [id, c] of this.contacts) {
            const div = document.createElement('div');
            div.className = 'list-item' + (this.activeChat?.type === 'dm' && this.activeChat?.id === id ? ' active' : '');
            div.innerHTML = `
                <div class="avatar">${c.name[0].toUpperCase()}${c.online ? '<span class="online-dot"></span>' : ''}</div>
                <div class="item-info">
                    <div class="item-name">${this.escapeHtml(c.name)}</div>
                    <div class="item-status">${c.online ? 'Online' : 'Offline'}</div>
                </div>
            `;
            div.addEventListener('click', () => this.openChat('dm', id));
            list.appendChild(div);
        }
    },

    // --- Groups ---
    renderGroupMembers() {
        const list = this.$.groupMembersList;
        list.innerHTML = '';
        if (this.contacts.size === 0) {
            list.innerHTML = '<div class="empty-list">Add contacts first</div>';
            return;
        }
        for (const [id, c] of this.contacts) {
            const div = document.createElement('div');
            div.className = 'member-option';
            div.innerHTML = `<input type="checkbox" value="${id}" id="mb-${id}"><label for="mb-${id}">${this.escapeHtml(c.name)}</label>`;
            list.appendChild(div);
        }
    },

    async createGroup() {
        const name = this.$.groupName.value.trim();
        if (!name) return alert('Enter group name');

        const checked = this.$.groupMembersList.querySelectorAll('input:checked');
        const members = Array.from(checked).map(c => c.value);
        if (members.length === 0) return alert('Select members');

        const id = crypto.randomUUID();
        // Include ourselves in the member list for the invite
        const allMembers = [...members, this.me.id];

        console.log('[Group] Creating group:', { id, name, members, allMembers });

        await Storage.saveGroup({ id, name, memberSessionIds: members });
        this.groups.set(id, { name, members });

        // Send group invite to all members
        const invite = {
            type: 'groupInvite',
            groupId: id,
            groupName: name,
            members: allMembers,
            createdBy: this.me.id,
            createdByName: this.me.name
        };

        for (const memberId of members) {
            console.log(`[Group] Sending invite to ${memberId}, peer connected:`, this.peers.get(memberId)?.connected);
            const sent = await this.sendEncrypted(memberId, invite);
            console.log(`[Group] Invite sent to ${memberId}: ${sent}`);
        }

        this.renderGroups();
        this.hideModal('create-group');
    },

    renderGroups() {
        const list = this.$.groupsList;
        list.innerHTML = '';

        if (this.groups.size === 0) {
            list.innerHTML = '<div class="empty-list">No groups. Click 👥 to create one!</div>';
            return;
        }

        for (const [id, g] of this.groups) {
            const online = g.members.filter(m => this.contacts.get(m)?.online).length;
            const div = document.createElement('div');
            div.className = 'list-item' + (this.activeChat?.type === 'group' && this.activeChat?.id === id ? ' active' : '');
            div.innerHTML = `
                <div class="avatar">👥</div>
                <div class="item-info">
                    <div class="item-name">${this.escapeHtml(g.name)}</div>
                    <div class="item-status">${online}/${g.members.length} online</div>
                </div>
            `;
            div.addEventListener('click', () => this.openChat('group', id));
            list.appendChild(div);
        }
    },

    // --- Chat ---
    getChatKey(type, id) {
        return `${type}:${id}`;
    },

    openChat(type, id) {
        this.activeChat = { type, id };
        this.$.noChat.classList.add('hidden');
        this.$.activeChat.classList.remove('hidden');
        this.$.msgInput.value = '';
        this.$.btnSend.disabled = true;
        this.$.msgInput.focus();

        if (type === 'dm') {
            const c = this.contacts.get(id);
            this.$.chatAvatar.textContent = c.name[0].toUpperCase();
            this.$.chatName.textContent = c.name;
            this.$.chatStatus.textContent = c.online ? 'Online' : 'Offline';
            this.$.chatStatus.className = c.online ? 'online' : '';
            this.$.btnCall.style.display = '';
            this.$.groupMembersPanel.classList.add('hidden');
        } else {
            const g = this.groups.get(id);
            this.$.chatAvatar.textContent = '👥';
            this.$.chatName.textContent = g.name;

            const onlineCount = g.members.filter(m => this.contacts.get(m)?.online).length;
            this.$.chatStatus.textContent = `${onlineCount}/${g.members.length} online`;
            this.$.chatStatus.className = '';
            this.$.btnCall.style.display = 'none';

            // Render member chips
            this.$.groupMembersContent.innerHTML = '';
            for (const memberId of g.members) {
                const contact = this.contacts.get(memberId);
                const name = contact?.name || 'Unknown';
                const online = contact?.online || false;

                const chip = document.createElement('div');
                chip.className = `member-chip ${online ? 'online' : 'offline'}`;
                chip.innerHTML = `<span class="dot"></span>${this.escapeHtml(name)}`;
                this.$.groupMembersContent.appendChild(chip);
            }
            this.$.groupMembersPanel.classList.remove('hidden');
        }

        // Render stored messages for this chat
        this.renderChatMessages();

        this.renderContacts();
        this.renderGroups();
    },

    renderChatMessages() {
        this.$.messages.innerHTML = '';
        if (!this.activeChat) return;

        const key = this.getChatKey(this.activeChat.type, this.activeChat.id);
        const messages = this.chatMessages.get(key) || [];

        for (const msg of messages) {
            this.renderMessage(msg);
        }
    },

    renderMessage(msg) {
        const div = document.createElement('div');
        div.className = `message ${msg.sent ? 'sent' : 'received'}`;
        div.innerHTML = `
            ${!msg.sent ? `<div class="sender">${this.escapeHtml(msg.sender)}</div>` : ''}
            <div class="text">${msg.isFile ? msg.text : this.escapeHtml(msg.text)}</div>
            <div class="time">${new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        `;
        this.$.messages.appendChild(div);
        this.$.messages.scrollTop = this.$.messages.scrollHeight;
    },

    // --- Signaling & WebRTC ---
    connect() {
        this.ws = new SignalingClient(Config.SIGNALING_URL);

        this.ws.on('open', async () => {
            console.log('[App] WS connected, joining contact rooms...');
            for (const contactId of this.contacts.keys()) {
                await this.joinContactRoom(contactId);
            }
        });

        this.ws.on('peers', (msg) => {
            console.log(`[Room ${msg.room}] Existing peers:`, msg.peers);
            for (const peerId of msg.peers) {
                if (this.contacts.has(peerId) && !this.peers.has(peerId)) {
                    // Lower ID initiates - consistent rule
                    const initiator = this.me.id < peerId;
                    console.log(`[Peers] Connecting to ${peerId}, initiator: ${initiator}`);
                    this.connectToPeer(peerId, msg.room, initiator);
                }
            }
        });

        this.ws.on('join', (msg) => {
            console.log(`[Room ${msg.room}] Peer joined:`, msg.id);
            if (this.contacts.has(msg.id) && !this.peers.has(msg.id)) {
                // Lower ID initiates - consistent rule
                const initiator = this.me.id < msg.id;
                console.log(`[Join] Connecting to ${msg.id}, initiator: ${initiator}`);
                this.connectToPeer(msg.id, msg.room, initiator);
            }
        });

        this.ws.on('leave', (msg) => {
            console.log(`Peer left:`, msg.id);
            this.handlePeerDisconnect(msg.id);
        });

        this.ws.on('signal', (msg) => {
            const peer = this.peers.get(msg.from);
            if (peer) {
                peer.handleSignal(msg.data);
            } else if (this.contacts.has(msg.from) && !this.peers.has(msg.from)) {
                // Responder - create peer on incoming signal (we are NOT initiator)
                console.log(`[Signal] Creating responder peer for ${msg.from}`);
                this.connectToPeer(msg.from, msg.room, false);
                // Handle the signal immediately after creating peer
                const p = this.peers.get(msg.from);
                if (p) p.handleSignal(msg.data);
            }
        });

        this.ws.connect(this.me.id);
    },

    async getRoomId(contactId) {
        // Deterministic collision-resistant room ID
        const pair = [this.me.id, contactId].sort().join('|');
        const bytes = new TextEncoder().encode(pair);
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
        return hex.slice(0, 32);
    },

    async joinContactRoom(contactId) {
        const room = await this.getRoomId(contactId);
        console.log(`Joining room for ${contactId}: ${room}`);
        this.ws.join(room);
    },

    connectToPeer(peerId, room, initiator) {
        if (this.peers.has(peerId)) return;

        console.log(`Connecting to ${peerId} (initiator: ${initiator})`);

        const peer = new RTCPeer(
            Config.RTC_CONFIG,
            peerId,
            initiator,
            (signal) => this.ws.send(room, peerId, signal),
            () => this.handlePeerConnect(peerId),
            (data) => this.handlePeerData(peerId, data),
            () => this.handlePeerDisconnect(peerId)
        );

        this.peers.set(peerId, peer);
    },

    async handlePeerConnect(peerId) {
        console.log(`Connected to ${peerId}`);
        const contact = this.contacts.get(peerId);
        if (contact) {
            contact.online = true;
            this.renderContacts();
            this.renderGroups();

            // Send our identity (includes public key for E2E)
            const peer = this.peers.get(peerId);
            if (peer) {
                peer.send(JSON.stringify({
                    type: 'identity',
                    name: this.me.name,
                    publicKeyJwk: this.me.publicKeyJwk
                }));
            }

            if (this.activeChat?.type === 'dm' && this.activeChat?.id === peerId) {
                this.$.chatStatus.textContent = 'Online';
                this.$.chatStatus.className = 'online';
            }
        }
    },

    handlePeerDisconnect(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.close();
            this.peers.delete(peerId);
        }
        this.sharedKeys.delete(peerId);

        const contact = this.contacts.get(peerId);
        if (contact) {
            contact.online = false;
            this.renderContacts();
            this.renderGroups();

            if (this.activeChat?.type === 'dm' && this.activeChat?.id === peerId) {
                this.$.chatStatus.textContent = 'Offline';
                this.$.chatStatus.className = '';
            }
        }
    },

    // --- Crypto helpers ---
    async ensureSharedKey(peerId) {
        if (this.sharedKeys.has(peerId)) return this.sharedKeys.get(peerId);

        const contact = this.contacts.get(peerId);
        if (!contact?.publicKeyJwk) return null;

        try {
            const peerPub = await Crypto.importPublicKey(contact.publicKeyJwk);
            const key = await Crypto.deriveSharedKey(this.me.privateKey, peerPub);
            this.sharedKeys.set(peerId, key);
            return key;
        } catch (err) {
            console.error('Failed to derive key for', peerId, err);
            return null;
        }
    },

    async sendEncrypted(peerId, payloadObj) {
        const peer = this.peers.get(peerId);
        if (!peer?.connected) return false;

        const key = await this.ensureSharedKey(peerId);
        if (!key) {
            // Fall back to plaintext if no key yet
            console.warn('No shared key yet for', peerId, '- sending plaintext');
            return peer.send(JSON.stringify(payloadObj));
        }

        const plaintext = JSON.stringify(payloadObj);
        const envelope = await Crypto.encrypt(key, plaintext);

        return peer.send(JSON.stringify({
            type: 'e2e',
            iv: envelope.iv,
            data: envelope.data
        }));
    },

    async handlePeerData(peerId, rawData) {
        try {
            const msg = JSON.parse(rawData);

            if (msg.type === 'identity') {
                // Received peer's identity - save their public key and derive shared key
                const contact = this.contacts.get(peerId);
                if (contact && msg.publicKeyJwk) {
                    contact.publicKeyJwk = msg.publicKeyJwk;
                    await Storage.saveContact({
                        sessionId: peerId,
                        name: contact.name,
                        publicKeyJwk: msg.publicKeyJwk
                    });
                    // Derive shared key now
                    await this.ensureSharedKey(peerId);
                }
            } else if (msg.type === 'e2e') {
                // Encrypted message
                const key = await this.ensureSharedKey(peerId);
                if (!key) return;

                const plaintext = await Crypto.decrypt(key, { iv: msg.iv, data: msg.data });
                const inner = JSON.parse(plaintext);

                if (inner.type === 'text') {
                    this.receiveMessage(peerId, inner);
                } else if (inner.type === 'fileStart' || inner.type === 'fileChunk' || inner.type === 'fileEnd') {
                    this.receiveFileChunk(peerId, inner);
                } else if (inner.type === 'groupInvite') {
                    await this.handleGroupInvite(peerId, inner);
                }
            } else if (msg.type === 'text') {
                // Plaintext fallback (before keys exchanged)
                this.receiveMessage(peerId, msg);
            } else if (msg.type === 'fileStart' || msg.type === 'fileChunk' || msg.type === 'fileEnd') {
                this.receiveFileChunk(peerId, msg);
            }
        } catch (e) {
            console.error('Failed to handle peer data:', e);
        }
    },

    // --- Messaging ---
    async sendMessage() {
        const text = this.$.msgInput.value.trim();
        if (!text || !this.activeChat) return;

        const inner = { type: 'text', text, sender: this.me.name, time: Date.now() };

        if (this.activeChat.type === 'dm') {
            await this.sendEncrypted(this.activeChat.id, inner);
        } else {
            const group = this.groups.get(this.activeChat.id);
            inner.groupId = this.activeChat.id;
            for (const memberId of group.members) {
                await this.sendEncrypted(memberId, inner);
            }
        }

        // Store and display the sent message
        this.storeMessage(this.activeChat.type, this.activeChat.id, {
            sender: 'Me',
            text: text,
            sent: true,
            time: Date.now()
        });

        this.$.msgInput.value = '';
        this.$.btnSend.disabled = true;
        this.$.msgInput.focus();
    },

    receiveMessage(peerId, msg) {
        const contact = this.contacts.get(peerId);
        const sender = contact?.name || msg.sender || 'Unknown';

        // Determine chat type and id
        let chatType, chatId;
        if (msg.groupId) {
            chatType = 'group';
            chatId = msg.groupId;
        } else {
            chatType = 'dm';
            chatId = peerId;
        }

        // Store the message
        this.storeMessage(chatType, chatId, {
            sender: sender,
            text: msg.text,
            sent: false,
            time: msg.time || Date.now()
        });
    },

    storeMessage(chatType, chatId, msg) {
        const key = this.getChatKey(chatType, chatId);
        if (!this.chatMessages.has(key)) {
            this.chatMessages.set(key, []);
        }
        this.chatMessages.get(key).push(msg);

        // If this is the active chat, render immediately
        if (this.activeChat?.type === chatType && this.activeChat?.id === chatId) {
            this.renderMessage(msg);
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // --- File Transfer (chunked) ---
    async sendFile() {
        const file = this.$.fileInput.files[0];
        if (!file || !this.activeChat) return;

        if (file.size > Config.MAX_FILE_SIZE) {
            alert(`File too large (max ${Config.MAX_FILE_SIZE / 1024 / 1024}MB)`);
            return;
        }

        const fileId = crypto.randomUUID();
        const arrayBuf = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);

        const startMsg = {
            type: 'fileStart',
            fileId,
            name: file.name,
            mime: file.type || 'application/octet-stream',
            size: file.size
        };

        if (this.activeChat.type === 'group') startMsg.groupId = this.activeChat.id;

        const targets = this.activeChat.type === 'dm'
            ? [this.activeChat.id]
            : this.groups.get(this.activeChat.id).members;

        // Send start
        for (const peerId of targets) await this.sendEncrypted(peerId, startMsg);

        // Send chunks
        const chunkSize = Config.CHUNK_SIZE;
        let idx = 0;

        for (let off = 0; off < bytes.length; off += chunkSize) {
            const chunk = bytes.slice(off, off + chunkSize);

            // Basic backpressure
            for (const peerId of targets) {
                const peer = this.peers.get(peerId);
                if (!peer?.dc) continue;
                while (peer.dc.bufferedAmount > 2_000_000) {
                    await new Promise(r => setTimeout(r, 20));
                }
            }

            const chunkMsg = {
                type: 'fileChunk',
                fileId,
                idx,
                data: btoa(String.fromCharCode(...chunk))
            };

            if (this.activeChat.type === 'group') chunkMsg.groupId = this.activeChat.id;

            for (const peerId of targets) await this.sendEncrypted(peerId, chunkMsg);
            idx++;
        }

        // Send end
        const endMsg = { type: 'fileEnd', fileId };
        if (this.activeChat.type === 'group') endMsg.groupId = this.activeChat.id;
        for (const peerId of targets) await this.sendEncrypted(peerId, endMsg);

        // Store file message
        this.storeMessage(this.activeChat.type, this.activeChat.id, {
            sender: 'Me',
            text: `📎 ${file.name}`,
            sent: true,
            time: Date.now(),
            isFile: true
        });
        this.$.fileInput.value = '';
    },

    receiveFileChunk(peerId, msg) {
        // Determine chat type and id for storing
        const chatType = msg.groupId ? 'group' : 'dm';
        const chatId = msg.groupId || peerId;

        if (msg.type === 'fileStart') {
            this.fileRx.set(msg.fileId, {
                name: msg.name,
                mime: msg.mime,
                size: msg.size,
                chunks: [],
                receivedBytes: 0,
                peerId,
                groupId: msg.groupId || null
            });
            return;
        }

        const rx = this.fileRx.get(msg.fileId);
        if (!rx) return;

        if (msg.type === 'fileChunk') {
            const bin = atob(msg.data);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            rx.chunks[msg.idx] = arr;
            rx.receivedBytes += arr.length;
            return;
        }

        if (msg.type === 'fileEnd') {
            const blob = new Blob(rx.chunks, { type: rx.mime });
            this.fileRx.delete(msg.fileId);

            const url = URL.createObjectURL(blob);
            const contact = this.contacts.get(peerId);
            const sender = contact?.name || 'Unknown';

            // Store file message (works even if chat not active)
            this.storeMessage(chatType, chatId, {
                sender: sender,
                text: `📎 <a href="${url}" download="${this.escapeHtml(rx.name)}">${this.escapeHtml(rx.name)}</a>`,
                sent: false,
                time: Date.now(),
                isFile: true
            });
        }
    },

    // --- Group Invites ---
    async handleGroupInvite(peerId, invite) {
        console.log('Received group invite:', invite);

        // Check if we already have this group
        if (this.groups.has(invite.groupId)) {
            console.log('Already have this group');
            return;
        }

        // Filter members to only include our contacts (excluding ourselves)
        const memberIds = invite.members.filter(m => m !== this.me.id);

        // Save the group
        await Storage.saveGroup({
            id: invite.groupId,
            name: invite.groupName,
            memberSessionIds: memberIds
        });

        this.groups.set(invite.groupId, {
            name: invite.groupName,
            members: memberIds
        });

        this.renderGroups();

        // Show notification
        console.log(`Added to group "${invite.groupName}" by ${invite.createdByName}`);
    },

    // --- Delete Contact/Group ---
    async deleteCurrentChat() {
        if (!this.activeChat) return;

        const { type, id } = this.activeChat;

        if (type === 'dm') {
            const contact = this.contacts.get(id);
            if (!confirm(`Delete contact "${contact?.name}"?`)) return;

            await Storage.deleteContact(id);
            this.contacts.delete(id);
            this.handlePeerDisconnect(id);
        } else {
            const group = this.groups.get(id);
            if (!confirm(`Leave group "${group?.name}"?`)) return;

            await Storage.deleteGroup(id);
            this.groups.delete(id);
        }

        // Close chat
        this.activeChat = null;
        this.$.activeChat.classList.add('hidden');
        this.$.noChat.classList.remove('hidden');

        this.renderContacts();
        this.renderGroups();
    },

    // --- Voice Calls (basic) ---
    currentCall: null,

    async startCall() {
        if (this.activeChat?.type !== 'dm') return;

        const peerId = this.activeChat.id;
        const contact = this.contacts.get(peerId);
        if (!contact?.online) {
            alert('Contact is offline');
            return;
        }

        // TODO: Implement call peer with separate RTCPeerConnection
        alert('Voice calls coming soon!');
    },

    endCall() {
        // TODO: Implement
        this.$.modalCall?.classList.add('hidden');
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
