// P2P Chat App - Using Trystero for reliable P2P (like Chitchatter)
// Trystero uses BitTorrent trackers for signaling - much more reliable than PeerJS cloud
// Multi-room support enabled

import { joinRoom } from 'https://esm.sh/trystero/torrent';

class P2PChat {
    constructor() {
        // Multi-room data structure: roomId -> room data
        this.rooms = new Map();
        this.activeRoomId = null;

        this.username = localStorage.getItem('p2p_username') || '';
        this.typingPeers = new Set();
        this.typingTimeout = null;
        this.localStream = null;
        this.myFingerprint = null;
        this.verifiedPeers = new Set(JSON.parse(localStorage.getItem('verified_peers') || '[]'));
        this.roomNames = JSON.parse(localStorage.getItem('p2p_room_names') || '{}'); // roomId -> custom name
        this.activeTab = 'chats';
        this.joiningRooms = new Set();
        this.roomBroadcasts = new Map(); // roomId -> BroadcastChannel

        // Voice call state
        this.callState = null; // null, 'calling', 'incoming', 'connected'
        this.callPeerId = null;
        this.callPeerName = null;
        this.peerConnections = new Map(); // peerId -> RTCPeerConnection
        this.remoteStreams = new Map(); // peerId -> MediaStream
        this.callStartTime = null;
        this.callTimerInterval = null;
        this.isMuted = false;
        this.isSpeakerOn = true;
        this.callEncryptionKey = null;

        this.init();
    }

    // Get current active room data
    get currentRoom() {
        return this.rooms.get(this.activeRoomId);
    }

    async init() {
        // Wait for crypto to be ready
        await window.e2eCrypto.init();

        // Generate fingerprint
        this.myFingerprint = await this.generateFingerprint();

        this.setupUI();
        this.promptForUsername();

        // Request notification permission
        this.requestNotificationPermission();

        // Show fingerprint
        document.getElementById('myFingerprint').textContent = this.myFingerprint;

        // Update status
        document.getElementById('connectionStatus').textContent = '⚪ Ready';

        // Check for room in URL
        this.checkUrlRoom();
    }

    async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            try {
                await Notification.requestPermission();
            } catch (e) {
                console.log('Notification permission denied');
            }
        }
    }

    async generateFingerprint() {
        const publicKey = await window.e2eCrypto.getPublicKeyString();
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(publicKey));
        const bytes = new Uint8Array(hash);
        let fp = '';
        for (let i = 0; i < 8; i++) {
            if (i > 0) fp += ' ';
            fp += bytes[i].toString(16).padStart(2, '0').toUpperCase();
            fp += bytes[i + 8].toString(16).padStart(2, '0').toUpperCase();
        }
        return fp;
    }

    promptForUsername() {
        if (!this.username) {
            const name = prompt('Enter your display name:', 'User' + Math.floor(Math.random() * 1000));
            if (name) {
                this.username = name.trim().slice(0, 20);
                localStorage.setItem('p2p_username', this.username);
            } else {
                this.username = 'Anonymous';
            }
        }
        document.getElementById('myUsername').textContent = this.username;
        this.updateProfileAvatar();
    }

    updateProfileAvatar() {
        const initial = this.username.charAt(0).toUpperCase();
        document.getElementById('myAvatar').textContent = initial;
    }

    editUsername() {
        const name = prompt('Enter new display name:', this.username);
        if (name && name.trim()) {
            this.username = name.trim().slice(0, 20);
            localStorage.setItem('p2p_username', this.username);
            document.getElementById('myUsername').textContent = this.username;
            this.updateProfileAvatar();

            // Broadcast to all peers in all rooms
            this.rooms.forEach((roomData) => {
                if (roomData.sendUsername) {
                    roomData.sendUsername({ name: this.username });
                }
            });
            this.showToast('Username updated!');
        }
    }

    editRoomName() {
        if (!this.activeRoomId) return;

        const currentName = this.roomNames[this.activeRoomId] || this.activeRoomId;
        const newName = prompt('Enter room name:', currentName);

        if (newName !== null) {
            const trimmedName = newName.trim().slice(0, 30);
            if (trimmedName) {
                this.roomNames[this.activeRoomId] = trimmedName;
            } else {
                // If empty, remove custom name and use room ID
                delete this.roomNames[this.activeRoomId];
            }
            localStorage.setItem('p2p_room_names', JSON.stringify(this.roomNames));
            this.updateRoomNameDisplay();
            this.updateRoomsList();
            this.showToast('Room name updated!');
        }
    }

    updateRoomNameDisplay() {
        if (!this.activeRoomId) return;
        const displayName = this.roomNames[this.activeRoomId] || this.activeRoomId;
        document.getElementById('chatRoomName').textContent = displayName;
    }

    openMobileSidebar() {
        document.getElementById('sidebar').classList.add('mobile-open');
    }

    closeMobileSidebar() {
        document.getElementById('sidebar').classList.remove('mobile-open');
    }

    switchTab(tabName) {
        this.activeTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update tab content
        document.getElementById('chatsTabContent').classList.toggle('active', tabName === 'chats');
        document.getElementById('statusTabContent').classList.toggle('active', tabName === 'status');
    }

    setupUI() {
        // Tab switching
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.onclick = () => this.switchTab(tab.dataset.tab);
        });

        // Header buttons
        document.getElementById('btnNewRoom').onclick = () => this.createRoom();
        document.getElementById('btnSettings').onclick = () => this.switchTab('status');

        // Mobile menu buttons
        document.getElementById('btnMobileMenu').onclick = () => this.openMobileSidebar();
        document.getElementById('btnMobileMenuEmpty').onclick = () => this.openMobileSidebar();

        // Username edit
        document.getElementById('btnEditUsername').onclick = () => this.editUsername();

        // Room controls
        document.getElementById('btnJoinRoom').onclick = () => this.joinRoom();
        document.getElementById('btnCreateRoom').onclick = () => this.createRoom();
        document.getElementById('btnCreateRoomSidebar').onclick = () => this.createRoom();
        document.getElementById('btnLeaveRoom').onclick = () => this.leaveCurrentRoom();
        document.getElementById('btnCopyRoomLink').onclick = () => this.copyRoomLink();
        document.getElementById('btnEditRoomNameHeader').onclick = () => this.editRoomName();

        document.getElementById('roomInput').onkeypress = (e) => {
            if (e.key === 'Enter') this.joinRoom();
        };

        // Clear data
        document.getElementById('btnClearData').onclick = () => this.clearAllData();

        // Messaging
        document.getElementById('btnSend').onclick = () => this.sendChatMessage();
        document.getElementById('messageInput').onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        };
        document.getElementById('messageInput').oninput = () => this.sendTypingIndicator();

        // Voice call
        // Voice call
        document.getElementById('btnVoiceCall').onclick = () => this.startGroupCall();
        document.getElementById('btnEndCall').onclick = () => this.endCall();
        document.getElementById('btnAcceptCall').onclick = () => this.acceptCall();
        document.getElementById('btnMuteCall').onclick = () => this.toggleMute();
        document.getElementById('btnSpeakerCall').onclick = () => this.toggleSpeaker();

        // Minimize Call Overlay
        document.getElementById('btnMinimizeCall').onclick = (e) => {
            e.stopPropagation();
            this.toggleMinimizeCall();
        };
        document.getElementById('callOverlay').onclick = (e) => {
            const overlay = document.getElementById('callOverlay');
            if (overlay.classList.contains('minimized')) {
                if (!e.target.closest('.btn-call-control')) {
                    this.toggleMinimizeCall();
                }
            }
        };

        // Show peers drawer
        document.getElementById('btnShowPeers').onclick = () => this.showPeersDrawer();
        document.getElementById('btnCloseDrawer').onclick = () => this.closePeersDrawer();
        document.getElementById('peersDrawer').onclick = (e) => {
            if (e.target.id === 'peersDrawer') this.closePeersDrawer();
        };

        // Media
        document.getElementById('btnAttach').onclick = () => document.getElementById('mediaFileInput').click();
        document.getElementById('mediaFileInput').onchange = (e) => this.handleMediaSelect(e);
        document.getElementById('btnRecordAudio').onclick = () => this.toggleAudioRecording();

        // Verification modal
        document.getElementById('btnCancelVerify').onclick = () => {
            document.getElementById('verifyModal').style.display = 'none';
        };
        document.getElementById('btnConfirmVerify').onclick = () => this.confirmVerification();
    }

    showPeersDrawer() {
        const drawer = document.getElementById('peersDrawer');
        const content = document.getElementById('drawerPeersList');

        if (!this.activeRoomId) {
            content.innerHTML = '<p class="hint" style="padding: 20px; text-align: center;">No active room</p>';
            drawer.style.display = 'block';
            return;
        }

        const roomData = this.rooms.get(this.activeRoomId);
        if (!roomData) return;

        const peerCount = roomData.peers.size;
        let html = `<div class="section-header"><span>Peers</span><span class="peer-count-badge">${peerCount}</span></div>`;

        if (peerCount === 0) {
            html += `
                <div class="empty-peers">
                    <span class="empty-icon-small">👥</span>
                    <p>Waiting for peers...</p>
                    <p class="hint">Share the room link to connect with others</p>
                </div>
            `;
        } else {
            roomData.peers.forEach((peer, peerId) => {
                const name = peer.name || 'Connecting...';
                const isVerified = this.verifiedPeers.has(peerId);
                const initial = name.charAt(0).toUpperCase();

                html += `
                    <div class="peer-item" data-peer-id="${peerId}">
                        <div class="peer-avatar">${initial}</div>
                        <div class="peer-info">
                            <div class="peer-name">${this.escapeHtml(name)}</div>
                            <div class="peer-status ${isVerified ? '' : 'unverified'}">
                                ${isVerified ? '✓ Verified' : '⚠ Unverified'}
                            </div>
                        </div>
                        ${!isVerified ? '<button class="btn-verify">Verify</button>' : ''}
                    </div>
                `;
            });
        }

        content.innerHTML = html;

        // Add click handlers for verify buttons
        content.querySelectorAll('.btn-verify').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const peerId = btn.closest('.peer-item').dataset.peerId;
                this.showVerifyModal(peerId);
            };
        });

        drawer.style.display = 'block';
    }

    closePeersDrawer() {
        document.getElementById('peersDrawer').style.display = 'none';
    }

    clearAllData() {
        if (confirm('This will clear all saved data including username and verified peers. Continue?')) {
            // Leave all rooms
            this.rooms.forEach((roomData, roomId) => {
                if (roomData.room) {
                    roomData.room.leave();
                }
            });
            this.rooms.clear();

            localStorage.clear();
            location.reload();
        }
    }

    // Room Management
    createRoom() {
        const roomId = this.generateRoomId();
        this.joinRoomById(roomId);
    }

    joinRoom() {
        const input = document.getElementById('roomInput').value.trim();
        const roomId = input || this.generateRoomId();
        this.joinRoomById(roomId);
    }

    generateRoomId() {
        return 'xxxxxxxx'.replace(/[x]/g, () => {
            return Math.floor(Math.random() * 16).toString(16);
        });
    }

    async joinRoomById(roomId) {
        // Check if already in this room
        if (this.rooms.has(roomId)) {
            // Just switch to it
            this.switchToRoom(roomId);
            this.showToast('Switched to room');
            return;
        }

        // Anti-duplication
        if (this.joiningRooms.has(roomId)) return;
        this.joiningRooms.add(roomId);

        // Check if room is open in another tab
        const bc = new BroadcastChannel('p2p_room_' + roomId);
        const isDupe = await new Promise(resolve => {
            const timer = setTimeout(() => resolve(false), 200);
            bc.onmessage = (e) => {
                if (e.data === 'presence') {
                    clearTimeout(timer);
                    resolve(true);
                }
            };
            bc.postMessage('ping');
        });

        if (isDupe) {
            this.showToast('Already joined in another tab');
            this.joiningRooms.delete(roomId);
            bc.close();
            return;
        }

        this.showToast('Connecting to room...');
        document.getElementById('connectionStatus').textContent = '🟡 Connecting...';
        document.getElementById('connectionStatus').classList.remove('connected');

        try {
            // Using Trystero with BitTorrent trackers (like Chitchatter)
            const config = {
                appId: 'p2p-chat-' + roomId // Each room is a unique app
            };

            const room = joinRoom(config, roomId);

            // Create room data structure
            const roomData = {
                room: room,
                roomId: roomId,
                peers: new Map(), // peerId -> peer data
                messages: [],
                messageIndex: new Map(), // msgId -> message index for status updates
                sendMessage: null,
                sendTyping: null,
                sendUsername: null,
                sendMedia: null,
                sendHandshake: null,
                sendReceipt: null,
                unreadCount: 0,
                lastActivity: Date.now()
            };

            // Set up Trystero actions for sending/receiving
            const [sendMessage, getMessage] = room.makeAction('message');
            const [sendTyping, getTyping] = room.makeAction('typing');
            const [sendUsername, getUsername] = room.makeAction('username');
            const [sendMedia, getMedia] = room.makeAction('media');
            const [sendHandshake, getHandshake] = room.makeAction('handshake');
            const [sendReceipt, getReceipt] = room.makeAction('receipt');
            const [sendCallSignal, getCallSignal] = room.makeAction('callSignal');

            roomData.sendMessage = sendMessage;
            roomData.sendTyping = sendTyping;
            roomData.sendUsername = sendUsername;
            roomData.sendMedia = sendMedia;
            roomData.sendHandshake = sendHandshake;
            roomData.sendReceipt = sendReceipt;
            roomData.sendCallSignal = sendCallSignal;

            // Handle incoming messages
            getMessage(async (data, peerId) => {
                const decrypted = await window.e2eCrypto.decrypt(data.content, peerId);
                this.receiveMessage(roomId, peerId, decrypted, data.timestamp, data.msgId);

                // Send delivery receipt
                sendReceipt({ msgId: data.msgId, status: 'delivered' }, peerId);

                // Send seen receipt if this room is active and visible
                if (!document.hidden && this.activeRoomId === roomId) {
                    sendReceipt({ msgId: data.msgId, status: 'seen' }, peerId);
                }
            });

            // Handle receipts (delivered/seen)
            getReceipt((data, peerId) => {
                this.updateMessageStatus(roomId, data.msgId, data.status);
            });

            // Handle call signaling (WebRTC negotiation)
            getCallSignal((data, peerId) => {
                this.handleCallSignal(roomId, peerId, data);
            });

            getTyping((data, peerId) => {
                if (this.activeRoomId === roomId) {
                    this.handleTypingIndicator(peerId, data.isTyping, roomData);
                }
            });

            getUsername((data, peerId) => {
                roomData.peers.set(peerId, { ...roomData.peers.get(peerId), name: data.name });
                if (this.activeRoomId === roomId) {
                    this.updatePeersList();
                }
                this.updateRoomsList();
            });

            getMedia((data, peerId) => {
                this.receiveMedia(roomId, peerId, data);
            });

            getHandshake(async (data, peerId) => {
                // Import peer's public key
                await window.e2eCrypto.importPeerPublicKey(peerId, data.publicKey);
                roomData.peers.set(peerId, {
                    name: data.name,
                    fingerprint: data.fingerprint
                });
                if (this.activeRoomId === roomId) {
                    this.updatePeersList();
                }
                this.updateRoomsList();
                this.addSystemMessage(roomId, `${data.name} joined the room`);
            });

            // Handle peer join
            room.onPeerJoin(async (peerId) => {
                console.log('Peer joined:', peerId, 'in room:', roomId);

                // Send our handshake
                const myPublicKey = await window.e2eCrypto.getPublicKeyString();
                sendHandshake({
                    name: this.username,
                    publicKey: myPublicKey,
                    fingerprint: this.myFingerprint
                });

                if (this.activeRoomId === roomId) {
                    this.updatePeersList();
                }
                this.updateRoomsList();
            });

            // Handle peer leave
            room.onPeerLeave((peerId) => {
                const name = roomData.peers.get(peerId)?.name || 'Someone';
                roomData.peers.delete(peerId);
                if (this.activeRoomId === roomId) {
                    this.updatePeersList();
                }
                this.updateRoomsList();
                this.addSystemMessage(roomId, `${name} left the room`);
            });

            // Store room data
            this.rooms.set(roomId, roomData);

            // Setup Broadcast Presence (Responder)
            bc.onmessage = (e) => {
                if (e.data === 'ping') bc.postMessage('presence');
            };
            this.roomBroadcasts.set(roomId, bc);

            // Switch to this room
            this.switchToRoom(roomId);

            // Update URL
            history.replaceState(null, '', `#${roomId}`);

            this.showToast('Connected! Share the link to invite others.');
            this.joiningRooms.delete(roomId);

        } catch (err) {
            console.error('Failed to join room:', err);
            this.showToast('Failed to join room');
            this.joiningRooms.delete(roomId);
            bc.close();
        }

    }

    switchToRoom(roomId) {
        if (!this.rooms.has(roomId)) return;

        this.activeRoomId = roomId;
        const roomData = this.rooms.get(roomId);

        // Reset unread count for this room
        roomData.unreadCount = 0;

        // Update URL
        history.replaceState(null, '', `#${roomId}`);

        // Update UI
        document.getElementById('connectionStatus').textContent = '🟢 Connected';
        document.getElementById('connectionStatus').classList.add('connected');
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('chatView').style.display = 'flex';
        document.getElementById('roomInput').value = '';

        // Display custom room name or room ID
        this.updateRoomNameDisplay();

        // Switch to chats tab and close sidebar on mobile
        this.switchTab('chats');
        if (window.innerWidth <= 768) {
            this.closeMobileSidebar();
        }

        this.updateRoomsList();
        this.renderMessages();
    }

    leaveCurrentRoom() {
        if (!this.activeRoomId) return;
        this.leaveRoom(this.activeRoomId);
    }

    leaveRoom(roomId) {
        const roomData = this.rooms.get(roomId);
        if (roomData && roomData.room) {
            roomData.room.leave();
        }

        this.rooms.delete(roomId);

        // If we left the active room, switch to another or show empty state
        if (this.activeRoomId === roomId) {
            this.activeRoomId = null;

            if (this.rooms.size > 0) {
                // Switch to the first available room
                const firstRoomId = this.rooms.keys().next().value;
                this.switchToRoom(firstRoomId);
            } else {
                // No rooms left, show empty state
                history.replaceState(null, '', window.location.pathname);
                document.getElementById('connectionStatus').textContent = '⚪ Ready';
                document.getElementById('connectionStatus').classList.remove('connected');
                document.getElementById('emptyState').style.display = 'flex';
                document.getElementById('chatView').style.display = 'none';
            }
        }

        this.updateRoomsList();
        this.showToast('Left the room');
    }

    updateRoomsList() {
        const list = document.getElementById('roomsList');
        const roomCount = this.rooms.size;

        if (this.activeRoomId) {
            const activeRoom = this.rooms.get(this.activeRoomId);
            const peerCount = activeRoom ? activeRoom.peers.size : 0;
            document.getElementById('peerCountBadgeHeader').textContent = `${peerCount} peer${peerCount !== 1 ? 's' : ''}`;
        }

        // Build rooms list
        let html = '';

        if (roomCount === 0) {
            html = `
                <div class="empty-rooms">
                    <span class="empty-icon-small">💬</span>
                    <p>No rooms yet</p>
                    <p class="hint">Create or join a room to start chatting</p>
                </div>
            `;
        } else {
            this.rooms.forEach((roomData, roomId) => {
                const displayName = this.roomNames[roomId] || roomId;
                const peerCount = roomData.peers.size;
                const isActive = roomId === this.activeRoomId;
                const unread = roomData.unreadCount > 0 ? `<span class="unread-badge">${roomData.unreadCount}</span>` : '';
                const lastMsg = roomData.messages.length > 0
                    ? roomData.messages[roomData.messages.length - 1]
                    : null;
                const preview = lastMsg
                    ? (lastMsg.system ? lastMsg.text : (lastMsg.isMedia ? '📎 Media' : lastMsg.text)).slice(0, 35)
                    : 'No messages yet';

                html += `
                    <div class="room-item ${isActive ? 'active' : ''}" data-room-id="${roomId}">
                        <div class="room-item-avatar">💬</div>
                        <div class="room-item-info">
                            <div class="room-item-name">${this.escapeHtml(displayName)}</div>
                            <div class="room-item-preview">${this.escapeHtml(preview)}</div>
                        </div>
                        <div class="room-item-meta">
                            <span class="room-item-peers">${peerCount} 👥</span>
                            ${unread}
                        </div>
                    </div>
                `;
            });
        }

        list.innerHTML = html;

        // Add click handlers for room items
        list.querySelectorAll('.room-item').forEach(item => {
            item.onclick = () => {
                const roomId = item.dataset.roomId;
                this.switchToRoom(roomId);
            };
        });
    }

    copyRoomLink() {
        if (!this.activeRoomId) return;
        const url = `${window.location.origin}${window.location.pathname}#${this.activeRoomId}`;
        navigator.clipboard.writeText(url);
        this.showToast('Room link copied!');
    }

    checkUrlRoom() {
        const hash = window.location.hash.slice(1);
        if (hash && hash.length >= 8) {
            this.joinRoomById(hash);
        }
    }

    // Messaging
    async sendChatMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();

        if (!text || !this.activeRoomId) return;

        const roomData = this.rooms.get(this.activeRoomId);
        if (!roomData) return;

        const timestamp = Date.now();
        const msgId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Encrypt and send to all peers in the active room
        for (const [peerId] of roomData.peers) {
            try {
                const encrypted = await window.e2eCrypto.encrypt(text, peerId);
                roomData.sendMessage({ content: encrypted, timestamp, msgId }, peerId);
            } catch (e) {
                console.error('Failed to encrypt for', peerId, e);
            }
        }

        this.addMessage(this.activeRoomId, null, text, timestamp, true, msgId);
        input.value = '';
    }

    receiveMessage(roomId, peerId, text, timestamp, msgId) {
        this.addMessage(roomId, peerId, text, timestamp, false, msgId);

        // Increment unread if not the active room
        const roomData = this.rooms.get(roomId);
        if (roomId !== this.activeRoomId && roomData) {
            roomData.unreadCount++;
            this.updateRoomsList();
        }

        this.playNotificationSound();
        this.showBrowserNotification(roomId, peerId, text);
    }

    showBrowserNotification(roomId, peerId, text) {
        // Only show if page is not visible and permission granted
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            const roomData = this.rooms.get(roomId);
            const senderName = roomData?.peers.get(peerId)?.name || 'Someone';
            const roomName = this.roomNames[roomId] || roomId;
            const notification = new Notification(`${senderName} in ${roomName}`, {
                body: text.slice(0, 100),
                icon: '💬',
                tag: 'p2p-chat-message',
                requireInteraction: false
            });

            notification.onclick = () => {
                window.focus();
                this.switchToRoom(roomId);
                notification.close();
            };

            // Auto-close after 5 seconds
            setTimeout(() => notification.close(), 5000);
        }
    }

    addMessage(roomId, peerId, text, timestamp, sent, msgId = null) {
        const roomData = this.rooms.get(roomId);
        if (!roomData) return;

        const senderName = sent ? this.username : (roomData.peers.get(peerId)?.name || 'Unknown');
        // Status: 'sent' -> 'delivered' -> 'seen' (only for sent messages)
        const status = sent ? 'sent' : null;
        const msgIndex = roomData.messages.length;

        roomData.messages.push({ peerId, senderName, text, timestamp, sent, msgId, status });
        roomData.lastActivity = timestamp;

        if (msgId && sent) {
            roomData.messageIndex.set(msgId, msgIndex);
        }

        if (roomId === this.activeRoomId) {
            this.renderMessages();
        }
    }

    updateMessageStatus(roomId, msgId, status) {
        const roomData = this.rooms.get(roomId);
        if (!roomData) return;

        const index = roomData.messageIndex.get(msgId);
        if (index !== undefined && roomData.messages[index]) {
            const currentStatus = roomData.messages[index].status;
            // Only upgrade status: sent -> delivered -> seen
            if (currentStatus === 'sent' || (currentStatus === 'delivered' && status === 'seen')) {
                roomData.messages[index].status = status;
                if (roomId === this.activeRoomId) {
                    this.renderMessages();
                }
            }
        }
    }

    addSystemMessage(roomId, text) {
        const roomData = this.rooms.get(roomId);
        if (!roomData) return;

        roomData.messages.push({ system: true, text, timestamp: Date.now() });
        roomData.lastActivity = Date.now();

        if (roomId === this.activeRoomId) {
            this.renderMessages();
        }
        this.updateRoomsList();
    }

    renderMessages() {
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';

        if (!this.activeRoomId) return;

        const roomData = this.rooms.get(this.activeRoomId);
        if (!roomData) return;

        roomData.messages.forEach(msg => {
            const div = document.createElement('div');

            if (msg.system) {
                div.className = 'system-message';
                div.innerHTML = `<span>${msg.text}</span>`;
            } else {
                div.className = 'message' + (msg.sent ? ' sent' : '');
                const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const initial = msg.senderName.charAt(0).toUpperCase();

                let content = '';
                if (msg.isMedia) {
                    if (msg.mediaType === 'image') {
                        content = `<img src="${msg.content}" class="media-image" alt="Image">`;
                    } else if (msg.mediaType === 'video') {
                        content = `<video src="${msg.content}" class="media-video" controls></video>`;
                    } else if (msg.mediaType === 'audio') {
                        content = `<audio src="${msg.content}" class="media-audio" controls></audio>`;
                    } else if (msg.mediaType === 'file') {
                        const fileSize = msg.fileSize ? this.formatFileSize(msg.fileSize) : '';
                        content = `<div class="file-attachment">
                            <span class="file-icon">📄</span>
                            <div class="file-info">
                                <span class="file-name">${this.escapeHtml(msg.fileName || 'File')}</span>
                                <span class="file-size">${fileSize}</span>
                            </div>
                            <a href="${msg.content}" download="${this.escapeHtml(msg.fileName || 'file')}" class="file-download">⬇️</a>
                        </div>`;
                    }
                } else {
                    content = `<div class="message-text">${this.escapeHtml(msg.text)}</div>`;
                }

                // Status indicator for sent messages
                let statusIcon = '';
                if (msg.sent && msg.status) {
                    if (msg.status === 'seen') {
                        statusIcon = '<span class="msg-status seen">✓✓</span>';
                    } else if (msg.status === 'delivered') {
                        statusIcon = '<span class="msg-status delivered">✓✓</span>';
                    } else {
                        statusIcon = '<span class="msg-status sent">✓</span>';
                    }
                }

                div.innerHTML = `
                    <div class="message-content">
                        <div class="message-avatar">${initial}</div>
                        <div class="message-bubble">
                            <div class="message-sender">${this.escapeHtml(msg.senderName)}</div>
                            ${content}
                            <div class="message-meta">
                                <span class="message-time">${time}</span>
                                ${statusIcon}
                            </div>
                        </div>
                    </div>
                `;
            }

            container.appendChild(div);
        });

        container.scrollTop = container.scrollHeight;
    }

    // Typing Indicator
    sendTypingIndicator() {
        if (!this.activeRoomId) return;
        const roomData = this.rooms.get(this.activeRoomId);
        if (!roomData) return;

        roomData.sendTyping({ isTyping: true });

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            roomData.sendTyping({ isTyping: false });
        }, 2000);
    }

    handleTypingIndicator(peerId, isTyping, roomData) {
        const name = roomData.peers.get(peerId)?.name || 'Someone';

        if (isTyping) {
            this.typingPeers.add(name);
        } else {
            this.typingPeers.delete(name);
        }

        const bar = document.getElementById('typingBar');
        if (this.typingPeers.size > 0) {
            const names = Array.from(this.typingPeers);
            const text = names.length === 1
                ? `${names[0]} is typing...`
                : `${names.slice(0, 2).join(', ')} are typing...`;
            document.getElementById('typingText').textContent = text;
            bar.style.display = 'block';
        } else {
            bar.style.display = 'none';
        }
    }

    // Peer Verification
    showVerifyModal(peerId) {
        if (!this.activeRoomId) return;
        const roomData = this.rooms.get(this.activeRoomId);
        if (!roomData) return;

        const peer = roomData.peers.get(peerId);
        if (!peer) return;

        document.getElementById('verifyPeerName').textContent = peer.name || peerId.slice(0, 12);
        document.getElementById('verifyFingerprint').textContent = peer.fingerprint || 'Unknown';
        document.getElementById('verifyModal').style.display = 'flex';
        document.getElementById('verifyModal').dataset.peerId = peerId;
    }

    confirmVerification() {
        const peerId = document.getElementById('verifyModal').dataset.peerId;
        this.verifiedPeers.add(peerId);
        localStorage.setItem('verified_peers', JSON.stringify([...this.verifiedPeers]));
        document.getElementById('verifyModal').style.display = 'none';
        this.updateRoomsList();
        this.showToast('Peer verified! ✓');
    }

    updatePeersList() {
        // This now just calls updateRoomsList which handles both
        this.updateRoomsList();
    }

    // Voice Calls Implementation
    async handleCallSignal(roomId, peerId, data) {
        // Decrypt signaling payload
        let payload;
        try {
            const decryptedJson = await window.e2eCrypto.decrypt(data.content, peerId);
            payload = JSON.parse(decryptedJson);
        } catch (e) {
            console.error('Failed to decrypt call signal:', e);
            return;
        }

        if (payload.type === 'offer') {
            if (this.callState === 'calling' || this.callState === 'connected') {
                // Busy - could send busy signal? For now just ignore or auto-reject
                return;
            }

            this.callState = 'incoming';
            this.callPeerId = peerId;
            // Get sender name
            const roomData = this.rooms.get(roomId);
            this.callPeerName = roomData?.peers.get(peerId)?.name || 'Unknown Peer';

            // Show incoming call UI
            this.addSystemMessage(roomId, `📞 Incoming Call from ${this.callPeerName}`);
            this.playNotificationSound(); // Adding sound while I'm here
            document.getElementById('callOverlay').classList.add('active');
            document.getElementById('callOverlay').classList.add('incoming'); // Add pulse animation
            document.getElementById('callPeerName').textContent = this.callPeerName;
            document.getElementById('callStatus').textContent = 'Incoming Encrypted Call...';
            document.getElementById('callAvatarIcon').textContent = '📞';

            // Show accept button
            document.getElementById('btnAcceptCall').style.display = 'flex';
            document.getElementById('btnMuteCall').style.display = 'none';
            document.getElementById('btnSpeakerCall').style.display = 'none';
            document.getElementById('callTimer').style.display = 'none';

            // Extract encryption key if provided
            if (payload.key) {
                const keyBytes = new Uint8Array(payload.key);
                await window.voiceCrypto.importKey(keyBytes);
            }

            // Create PC and store offer
            const pc = await this.createPeerConnection(peerId, false);
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

            // Process queue candidates
            if (this.pendingCandidates && this.pendingCandidates.has(peerId)) {
                const queue = this.pendingCandidates.get(peerId);
                while (queue.length) {
                    await pc.addIceCandidate(queue.shift());
                }
            }

        } else if (payload.type === 'answer') {
            const pc = this.peerConnections.get(peerId);
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            }

        } else if (payload.type === 'candidate') {
            const pc = this.peerConnections.get(peerId);
            if (pc && pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } else {
                // Queue candidate
                if (!this.pendingCandidates) this.pendingCandidates = new Map();
                if (!this.pendingCandidates.has(peerId)) this.pendingCandidates.set(peerId, []);
                this.pendingCandidates.get(peerId).push(new RTCIceCandidate(payload.candidate));
            }

        } else if (payload.type === 'bye') {
            this.closePeerConnection(peerId);
            // If no more peers, end call
            if (this.peerConnections.size === 0) {
                this.endCall();
            }
        }
    }

    toggleMinimizeCall() {
        const overlay = document.getElementById('callOverlay');
        const btn = document.getElementById('btnMinimizeCall');
        overlay.classList.toggle('minimized');
        btn.textContent = overlay.classList.contains('minimized') ? '🔼' : '🔽';
    }

    async startGroupCall() {
        if (this.callState) {
            this.showToast('You are already in a call');
            return;
        }

        if (!this.activeRoomId) return;
        const roomData = this.rooms.get(this.activeRoomId);
        if (!roomData || roomData.peers.size === 0) {
            this.showToast('No peers in this room to call');
            return;
        }

        this.callState = 'calling';
        this.callStartTime = null;

        this.addSystemMessage(this.activeRoomId, '📞 Outgoing Call');
        document.getElementById('callOverlay').classList.add('active');
        document.getElementById('callOverlay').classList.remove('incoming');
        document.getElementById('callPeerName').textContent = 'Calling Group...';
        document.getElementById('callStatus').textContent = 'Connecting...';
        document.getElementById('btnAcceptCall').style.display = 'none';
        document.getElementById('btnMuteCall').style.display = 'flex';
        document.getElementById('btnSpeakerCall').style.display = 'flex';
        document.getElementById('callTimer').style.display = 'none';

        // Start local stream
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    latencyHint: 'interactive'
                },
                video: false
            });
        } catch (e) {
            console.error('Microphone error:', e);
            this.showToast('Could not access microphone');
            this.endCall();
            return;
        }

        // Generate call encryption key
        const keyRaw = await window.voiceCrypto.generateKey();
        this.callEncryptionKey = Array.from(new Uint8Array(keyRaw)); // Store as array for JSON

        // Iterate peers and call them
        for (const [peerId, peer] of roomData.peers) {
            document.getElementById('callPeerName').textContent = 'Calling ' + peer.name + '...';
            await this.createPeerConnection(peerId, true);
        }
    }

    async acceptCall() {
        if (this.callState !== 'incoming') return;
        this.callState = 'connected';

        document.getElementById('callOverlay').classList.remove('incoming');
        document.getElementById('btnAcceptCall').style.display = 'none';
        document.getElementById('btnMuteCall').style.display = 'flex';
        document.getElementById('btnSpeakerCall').style.display = 'flex';
        document.getElementById('callStatus').textContent = 'Connected';
        document.getElementById('callTimer').style.display = 'block';

        this.callStartTime = Date.now();
        this.callTimerInterval = setInterval(() => this.updateCallTimer(), 1000);

        // Get User Media
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    latencyHint: 'interactive'
                },
                video: false
            });
        } catch (e) {
            this.showToast('Microphone access denied');
            this.endCall();
            return;
        }

        // Add tracks to existing PC (created in handleCallSignal type='offer')
        const pc = this.peerConnections.get(this.callPeerId);
        if (pc) {
            this.localStream.getTracks().forEach(track => {
                const sender = pc.addTrack(track, this.localStream);
                // Apply encryption to sender
                window.voiceCrypto.applyToSender(sender);
            });

            // Create Answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this.sendCallSignal(this.callPeerId, {
                type: 'answer',
                sdp: answer
            });
        }
    }

    endCall() {
        this.callState = null;

        // Log call duration
        if (this.callStartTime && this.activeRoomId) {
            const diff = Math.floor((Date.now() - this.callStartTime) / 1000);
            const mins = Math.floor(diff / 60).toString().padStart(2, '0');
            const secs = (diff % 60).toString().padStart(2, '0');
            this.addSystemMessage(this.activeRoomId, `📞 Call ended • ${mins}:${secs}`);
        }

        // Stop UI
        document.getElementById('callOverlay').classList.remove('active');
        document.getElementById('callOverlay').classList.remove('incoming');
        document.getElementById('callOverlay').classList.remove('minimized');
        document.getElementById('btnMinimizeCall').textContent = '🔽';
        clearInterval(this.callTimerInterval);

        // Send bye to all
        for (const [peerId] of this.peerConnections) {
            this.sendCallSignal(peerId, { type: 'bye' });
            this.closePeerConnection(peerId);
        }

        // Stop local
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }

        // Cleanup audio
        this.remoteStreams.forEach((stream, id) => {
            const el = document.getElementById('audio-' + id);
            if (el) el.remove();
        });
        this.remoteStreams.clear();
        this.peerConnections.clear();
    }

    async createPeerConnection(peerId, initiator) {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        };

        const pc = new RTCPeerConnection(config);
        this.peerConnections.set(peerId, pc);

        // Add local tracks if stream exists
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                const sender = pc.addTrack(track, this.localStream);
                window.voiceCrypto.applyToSender(sender);
            });
        }

        // Handle candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendCallSignal(peerId, {
                    type: 'candidate',
                    candidate: event.candidate
                });
            }
        };

        // Handle track
        pc.ontrack = (event) => {
            console.log('Got remote track from', peerId);
            const receiver = event.receiver;
            // Apply decryption
            window.voiceCrypto.applyToReceiver(receiver);

            // Play audio
            let audio = document.getElementById('audio-' + peerId);
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = 'audio-' + peerId;
                audio.autoplay = true;
                // audio.controls = true; // Debug
                audio.style.display = 'none';
                document.body.appendChild(audio);
            }
            audio.srcObject = event.streams[0];
            this.remoteStreams.set(peerId, event.streams[0]);

            // If call was just connecting, set connected
            if (this.callState === 'calling') {
                this.callState = 'connected';
                document.getElementById('callStatus').textContent = 'Connected';
                document.getElementById('callTimer').style.display = 'block';
                this.callStartTime = Date.now();
                if (!this.callTimerInterval) {
                    this.callTimerInterval = setInterval(() => this.updateCallTimer(), 1000);
                }
            }
        };

        if (initiator) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // Send offer with key
            this.sendCallSignal(peerId, {
                type: 'offer',
                sdp: offer,
                key: this.callEncryptionKey
            });
        }

        return pc;
    }

    closePeerConnection(peerId) {
        const pc = this.peerConnections.get(peerId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(peerId);
        }
        const audio = document.getElementById('audio-' + peerId);
        if (audio) audio.remove();
        this.remoteStreams.delete(peerId);
    }

    async sendCallSignal(peerId, payload) {
        if (!this.activeRoomId) return;
        const roomData = this.rooms.get(this.activeRoomId);
        if (!roomData) return;

        // Encrypt the signaling payload
        try {
            const jsonText = JSON.stringify(payload);
            const encrypted = await window.e2eCrypto.encrypt(jsonText, peerId);
            roomData.sendCallSignal({ content: encrypted }, peerId);
        } catch (e) {
            console.error('Failed to send signal:', e);
        }
    }

    toggleMute() {
        if (!this.localStream) return;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);

        const btn = document.getElementById('btnMuteCall');
        btn.classList.toggle('active', this.isMuted);
        btn.querySelector('.mute-icon').textContent = this.isMuted ? '🔇' : '🎤';
    }

    toggleSpeaker() {
        this.isSpeakerOn = !this.isSpeakerOn;
        // Toggle muted state of all remote audio elements
        this.remoteStreams.forEach((stream, pid) => {
            const audio = document.getElementById('audio-' + pid);
            if (audio) audio.muted = !this.isSpeakerOn;
        });

        const btn = document.getElementById('btnSpeakerCall');
        btn.classList.toggle('active', !this.isSpeakerOn); // Active means "Muted" (speaker off)? No, active means Speaker ON usually.
        // Wait, UI button is 'btnSpeakerCall'. Logic: Active = Speaker ON. Inactive = Speaker OFF (Silent? or Earpiece?)
        // Assuming "Speaker" means "Hear Audio".
        // My code: isSpeakerOn defaults true.
        // If !isSpeakerOn -> audio.muted = true (Silent).
        // UI: Active class usually implies "On".
        btn.classList.toggle('active', this.isSpeakerOn);
        btn.querySelector('.speaker-icon').textContent = this.isSpeakerOn ? '🔊' : '🔇';
    }

    updateCallTimer() {
        if (!this.callStartTime) return;
        const diff = Math.floor((Date.now() - this.callStartTime) / 1000);
        const mins = Math.floor(diff / 60).toString().padStart(2, '0');
        const secs = (diff % 60).toString().padStart(2, '0');
        document.getElementById('callTimer').textContent = `${mins}:${secs}`;
    }

    // Media Sharing
    async handleMediaSelect(e) {
        const file = e.target.files[0];
        if (!file || !this.activeRoomId) return;

        const roomData = this.rooms.get(this.activeRoomId);
        if (!roomData) return;

        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            this.showToast('File too large (max 5MB)');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            let mediaType;
            if (file.type.startsWith('image')) {
                mediaType = 'image';
            } else if (file.type.startsWith('video')) {
                mediaType = 'video';
            } else if (file.type.startsWith('audio')) {
                mediaType = 'audio';
            } else {
                mediaType = 'file'; // PDF, documents, etc.
            }

            const mediaData = {
                mediaType,
                content: reader.result,
                fileName: file.name,
                fileSize: file.size,
                timestamp: Date.now()
            };

            roomData.sendMedia(mediaData);
            this.addMedia(this.activeRoomId, null, mediaData, true);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    }

    addMedia(roomId, peerId, data, sent) {
        const roomData = this.rooms.get(roomId);
        if (!roomData) return;

        const senderName = sent ? this.username : (roomData.peers.get(peerId)?.name || 'Unknown');

        roomData.messages.push({
            peerId,
            senderName,
            isMedia: true,
            mediaType: data.mediaType,
            content: data.content,
            fileName: data.fileName,
            fileSize: data.fileSize,
            timestamp: data.timestamp,
            sent
        });

        roomData.lastActivity = data.timestamp;

        if (roomId === this.activeRoomId) {
            this.renderMessages();
        }
        this.updateRoomsList();
    }

    receiveMedia(roomId, peerId, data) {
        this.addMedia(roomId, peerId, data, false);

        // Increment unread if not the active room
        const roomData = this.rooms.get(roomId);
        if (roomId !== this.activeRoomId && roomData) {
            roomData.unreadCount++;
            this.updateRoomsList();
        }

        this.playNotificationSound();
    }

    // Audio Recording
    async toggleAudioRecording() {
        if (!this.activeRoomId) return;
        const roomData = this.rooms.get(this.activeRoomId);
        if (!roomData) return;

        const btn = document.getElementById('btnRecordAudio');

        if (this.mediaRecorder?.state === 'recording') {
            this.mediaRecorder.stop();
            btn.textContent = '🎙️';
            btn.classList.remove('recording');
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.audioChunks = [];
                this.mediaRecorder = new MediaRecorder(stream);

                this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);

                this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    stream.getTracks().forEach(t => t.stop());

                    const reader = new FileReader();
                    reader.onload = () => {
                        const mediaData = {
                            mediaType: 'audio',
                            content: reader.result,
                            fileName: `voice_${Date.now()}.webm`,
                            timestamp: Date.now()
                        };
                        roomData.sendMedia(mediaData);
                        this.addMedia(this.activeRoomId, null, mediaData, true);
                    };
                    reader.readAsDataURL(blob);
                };

                this.mediaRecorder.start();
                btn.textContent = '⏹️';
                btn.classList.add('recording');
                this.showToast('Recording...');
            } catch (err) {
                this.showToast('Could not access microphone');
            }
        }
    }

    // Utilities
    playNotificationSound() {
        if (document.hidden) {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2Onrq8vLy8vLy4p5R0W1RcdIecsNHcvLy8vLy0p4x0YGNwiZuqu8na3Ly8vLi0p4x0YGRyipyqu8na1Ly8vLi0p4x0YGNyipyru8na1Ly8vLi0p4x0YGNyipyru8rZ1Ly8vLi0p4x0YGNwiZuruszZ1Ly8vLiwo4hxX2BvhpequszZ1Ly8vLiroYZvXl9vhpequczZ1Ly8u7WpnIFsYGJ0');
            audio.volume = 0.3;
            audio.play().catch(() => { });
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    showToast(message) {
        let toast = document.querySelector('.toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add('show');

        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

// Start the app
new P2PChat();
