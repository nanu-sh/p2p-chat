// P2P Chat App - Room-based with Peer Discovery
class P2PChat {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection
        this.peerNames = new Map(); // peerId -> username
        this.peerFingerprints = new Map(); // peerId -> fingerprint
        this.verifiedPeers = new Set(JSON.parse(localStorage.getItem('verified_peers') || '[]'));
        this.currentRoom = null;
        this.mySlot = null; // Our slot number in the room (0-9)
        this.messages = [];
        this.username = localStorage.getItem('p2p_username') || '';
        this.typingPeers = new Set();
        this.typingTimeout = null;
        this.localStream = null;
        this.calls = new Map();
        this.pendingCall = null;
        this.discoveryInterval = null;

        this.init();
    }

    async init() {
        // Wait for crypto to be ready
        await window.e2eCrypto.init();

        // Generate our fingerprint
        this.myFingerprint = await this.generateFingerprint();

        this.setupUI();
        this.promptForUsername();

        // Show fingerprint
        document.getElementById('myFingerprint').textContent = this.myFingerprint;
        document.getElementById('securitySection').style.display = 'block';

        // Check for room in URL - will create peer when joining room
        this.checkUrlRoom();
    }

    // Create peer with room-based ID for discovery
    async createPeerForRoom(roomId) {
        return new Promise((resolve, reject) => {
            // Try slots 0-9 for this room
            this.tryNextSlot(roomId, 0, resolve, reject);
        });
    }

    tryNextSlot(roomId, slot, resolve, reject) {
        if (slot >= 10) {
            reject(new Error('Room is full (max 10 peers)'));
            return;
        }

        const peerId = `${roomId}_${slot}`;
        console.log(`Trying slot ${slot}: ${peerId}`);

        const peer = new Peer(peerId, {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
                    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
                ]
            }
        });

        peer.on('open', (id) => {
            console.log('Got slot:', slot);
            this.peer = peer;
            this.mySlot = slot;

            document.getElementById('connectionStatus').textContent = '🟢 Connected';
            document.getElementById('connectionStatus').classList.add('connected');

            // Set up event handlers
            peer.on('connection', (conn) => this.handleIncomingConnection(conn));
            peer.on('call', (call) => this.handleIncomingCall(call));
            peer.on('error', (err) => {
                if (err.type !== 'unavailable-id') {
                    console.error('Peer error:', err);
                }
            });

            resolve(peer);
        });

        peer.on('error', (err) => {
            if (err.type === 'unavailable-id') {
                // This slot is taken, try next
                peer.destroy();
                this.tryNextSlot(roomId, slot + 1, resolve, reject);
            } else {
                console.error('Peer error:', err);
                peer.destroy();
                this.tryNextSlot(roomId, slot + 1, resolve, reject);
            }
        });
    }

    // Discover and connect to other peers in the room
    discoverPeers() {
        if (!this.currentRoom || !this.peer) return;

        for (let slot = 0; slot < 10; slot++) {
            if (slot === this.mySlot) continue; // Skip self

            const peerId = `${this.currentRoom}_${slot}`;
            if (this.connections.has(peerId)) continue; // Already connected

            // Try to connect
            console.log('Attempting to connect to:', peerId);
            const conn = this.peer.connect(peerId, { reliable: true });

            conn.on('open', () => {
                console.log('Connected to peer at slot:', slot);
                this.setupConnection(conn);
            });

            conn.on('error', () => {
                // Peer doesn't exist at this slot, ignore
            });
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
    }

    editUsername() {
        const name = prompt('Enter new display name:', this.username);
        if (name && name.trim()) {
            this.username = name.trim().slice(0, 20);
            localStorage.setItem('p2p_username', this.username);
            document.getElementById('myUsername').textContent = this.username;
            this.broadcast({ type: 'username', name: this.username });
            this.showToast('Username updated!');
        }
    }

    setupUI() {
        // Sidebar toggle for mobile
        document.getElementById('sidebarToggle').onclick = () => {
            document.getElementById('sidebar').classList.toggle('collapsed');
        };

        // Username edit
        document.getElementById('btnEditUsername').onclick = () => this.editUsername();

        // Room controls
        document.getElementById('btnJoinRoom').onclick = () => this.joinRoom();
        document.getElementById('btnCreateRoom').onclick = () => this.createRoom();
        document.getElementById('btnLeaveRoom').onclick = () => this.leaveRoom();
        document.getElementById('btnCopyRoomLink').onclick = () => this.copyRoomLink();

        document.getElementById('roomInput').onkeypress = (e) => {
            if (e.key === 'Enter') this.joinRoom();
        };

        // Messaging
        document.getElementById('btnSend').onclick = () => this.sendMessage();
        document.getElementById('messageInput').onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        };
        document.getElementById('messageInput').oninput = () => this.sendTypingIndicator();

        // Voice call
        document.getElementById('btnVoiceCall').onclick = () => this.startGroupCall();
        document.getElementById('btnEndCall').onclick = () => this.endCall();
        document.getElementById('btnAcceptCall').onclick = () => this.acceptCall();

        // Show peers panel
        document.getElementById('btnShowPeers').onclick = () => {
            document.getElementById('sidebar').classList.remove('collapsed');
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

        // Mobile audio fix
        document.body.addEventListener('click', () => {
            const audio = document.getElementById('remoteAudio');
            audio.play().catch(() => { });
        }, { once: true });
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
        if (this.currentRoom === roomId) {
            this.showToast('Already in this room');
            return;
        }

        // Leave current room if any
        if (this.currentRoom) {
            this.leaveRoom(false);
        }

        this.showToast('Joining room...');

        try {
            // Create peer with room-based ID
            await this.createPeerForRoom(roomId);

            this.currentRoom = roomId;
            this.messages = [];

            // Update URL
            history.replaceState(null, '', `#${roomId}`);

            // Update UI
            document.getElementById('roomSection').style.display = 'block';
            document.getElementById('currentRoomName').textContent = roomId;
            document.getElementById('emptyState').style.display = 'none';
            document.getElementById('chatView').style.display = 'flex';
            document.getElementById('chatRoomName').textContent = 'Room: ' + roomId.slice(0, 12);
            document.getElementById('roomInput').value = '';

            // On mobile, collapse sidebar
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.add('collapsed');
            }

            // Start peer discovery
            this.discoverPeers();

            // Keep discovering periodically for latecomers
            this.discoveryInterval = setInterval(() => this.discoverPeers(), 3000);

            this.showToast('Joined! Share the link to invite others.');
            this.updatePeersList();
            this.renderMessages();

        } catch (err) {
            console.error('Failed to join room:', err);
            this.showToast('Failed to join: ' + err.message);
        }
    }

    leaveRoom(showEmpty = true) {
        // Stop discovery
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = null;
        }

        // Disconnect all peers
        this.connections.forEach((conn) => conn.close());
        this.connections.clear();
        this.peerNames.clear();
        this.peerFingerprints.clear();

        // Destroy peer
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }

        this.currentRoom = null;
        this.mySlot = null;
        this.messages = [];

        // Update URL
        history.replaceState(null, '', window.location.pathname);

        // Update UI
        document.getElementById('roomSection').style.display = 'none';
        document.getElementById('connectionStatus').textContent = '⏳ Not connected';
        document.getElementById('connectionStatus').classList.remove('connected');

        if (showEmpty) {
            document.getElementById('emptyState').style.display = 'flex';
            document.getElementById('chatView').style.display = 'none';
        }

        this.updatePeersList();
        this.showToast('Left the room');
    }

    copyRoomLink() {
        const url = `${window.location.origin}${window.location.pathname}#${this.currentRoom}`;
        navigator.clipboard.writeText(url);
        this.showToast('Room link copied! Share it with friends.');
    }

    checkUrlRoom() {
        const hash = window.location.hash.slice(1);
        if (hash && hash.length >= 8) {
            // Auto-join if room in URL
            this.joinRoomById(hash);
        }
    }

    // Connection Handling
    handleIncomingConnection(conn) {
        console.log('Incoming connection from:', conn.peer);
        this.setupConnection(conn);
    }

    async setupConnection(conn) {
        if (this.connections.has(conn.peer)) return; // Already connected

        this.connections.set(conn.peer, conn);

        conn.on('open', async () => {
            console.log('Connection opened with:', conn.peer);

            // Exchange info
            const myPublicKey = await window.e2eCrypto.getPublicKeyString();
            conn.send({
                type: 'handshake',
                name: this.username,
                publicKey: myPublicKey,
                fingerprint: this.myFingerprint
            });

            this.updatePeersList();
        });

        conn.on('data', (data) => this.handleData(conn.peer, data));

        conn.on('close', () => {
            const name = this.peerNames.get(conn.peer) || 'Someone';
            this.connections.delete(conn.peer);
            this.peerNames.delete(conn.peer);
            this.peerFingerprints.delete(conn.peer);
            this.updatePeersList();
            this.addSystemMessage(`${name} left the room`);
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            this.connections.delete(conn.peer);
        });
    }

    async handleData(peerId, data) {
        switch (data.type) {
            case 'handshake':
                this.peerNames.set(peerId, data.name);
                this.peerFingerprints.set(peerId, data.fingerprint);

                await window.e2eCrypto.importPeerPublicKey(peerId, data.publicKey);

                this.updatePeersList();
                this.addSystemMessage(`${data.name} joined the room`);
                break;

            case 'message':
                const decrypted = await window.e2eCrypto.decrypt(data.content, peerId);
                this.receiveMessage(peerId, decrypted, data.timestamp);
                break;

            case 'media':
                this.receiveMedia(peerId, data);
                break;

            case 'username':
                this.peerNames.set(peerId, data.name);
                this.updatePeersList();
                break;

            case 'typing':
                this.handleTypingIndicator(peerId, data.isTyping);
                break;

            case 'voice-key':
                await window.voiceCrypto.importKey(new Uint8Array(data.key));
                break;
        }
    }

    broadcast(data, excludePeerId = null) {
        this.connections.forEach((conn, peerId) => {
            if (peerId !== excludePeerId && conn.open) {
                conn.send(data);
            }
        });
    }

    // Messaging
    async sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();

        if (!text || !this.currentRoom) return;

        const timestamp = Date.now();

        // Encrypt and send to all peers
        for (const [peerId, conn] of this.connections) {
            if (conn.open) {
                try {
                    const encrypted = await window.e2eCrypto.encrypt(text, peerId);
                    conn.send({ type: 'message', content: encrypted, timestamp });
                } catch (e) {
                    console.error('Failed to encrypt for', peerId, e);
                }
            }
        }

        this.addMessage(null, text, timestamp, true);
        input.value = '';
    }

    receiveMessage(peerId, text, timestamp) {
        this.addMessage(peerId, text, timestamp, false);
        this.playNotificationSound();
    }

    addMessage(peerId, text, timestamp, sent) {
        const senderName = sent ? this.username : (this.peerNames.get(peerId) || 'Unknown');

        this.messages.push({ peerId, senderName, text, timestamp, sent });
        this.renderMessages();
    }

    addSystemMessage(text) {
        this.messages.push({ system: true, text, timestamp: Date.now() });
        this.renderMessages();
    }

    renderMessages() {
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';

        this.messages.forEach(msg => {
            const div = document.createElement('div');

            if (msg.system) {
                div.className = 'system-message';
                div.innerHTML = `<span>${msg.text}</span>`;
                div.style.cssText = 'text-align: center; padding: 8px; font-size: 12px; color: var(--text-muted);';
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
                    }
                } else {
                    content = `<div class="message-text">${this.escapeHtml(msg.text)}</div>`;
                }

                div.innerHTML = `
                    <div class="message-content">
                        <div class="message-avatar">${initial}</div>
                        <div class="message-bubble">
                            <div class="message-sender">${this.escapeHtml(msg.senderName)}</div>
                            ${content}
                            <div class="message-time">${time}</div>
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
        if (!this.currentRoom) return;
        this.broadcast({ type: 'typing', isTyping: true });

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.broadcast({ type: 'typing', isTyping: false });
        }, 2000);
    }

    handleTypingIndicator(peerId, isTyping) {
        const name = this.peerNames.get(peerId) || 'Someone';

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
        const name = this.peerNames.get(peerId) || peerId.slice(0, 12);
        const fingerprint = this.peerFingerprints.get(peerId) || 'Unknown';

        document.getElementById('verifyPeerName').textContent = name;
        document.getElementById('verifyFingerprint').textContent = fingerprint;
        document.getElementById('verifyModal').style.display = 'flex';
        document.getElementById('verifyModal').dataset.peerId = peerId;
    }

    confirmVerification() {
        const peerId = document.getElementById('verifyModal').dataset.peerId;
        this.verifiedPeers.add(peerId);
        localStorage.setItem('verified_peers', JSON.stringify([...this.verifiedPeers]));
        document.getElementById('verifyModal').style.display = 'none';
        this.updatePeersList();
        this.showToast('Peer verified! ✓');
    }

    updatePeersList() {
        const list = document.getElementById('peersList');
        const count = this.connections.size;

        document.getElementById('peerCount').textContent = count;
        document.getElementById('peerCountBadge').textContent = `${count} peer${count !== 1 ? 's' : ''}`;

        if (count === 0) {
            list.innerHTML = '<p class="no-peers">Waiting for peers to join...</p>';
            return;
        }

        list.innerHTML = '';
        this.connections.forEach((conn, peerId) => {
            const name = this.peerNames.get(peerId) || 'Connecting...';
            const isVerified = this.verifiedPeers.has(peerId);
            const initial = name.charAt(0).toUpperCase();

            const div = document.createElement('div');
            div.className = 'peer-item';
            div.innerHTML = `
                <div class="peer-avatar">${initial}</div>
                <div class="peer-info">
                    <div class="peer-name">${this.escapeHtml(name)}</div>
                    <div class="peer-status ${isVerified ? '' : 'unverified'}">
                        ${isVerified ? '✓ Verified' : '⚠ Unverified'}
                    </div>
                </div>
                ${!isVerified ? '<button class="btn-verify">Verify</button>' : ''}
            `;

            const verifyBtn = div.querySelector('.btn-verify');
            if (verifyBtn) {
                verifyBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.showVerifyModal(peerId);
                };
            }

            list.appendChild(div);
        });
    }

    // Voice Calls
    async startGroupCall() {
        if (this.connections.size === 0) {
            this.showToast('No peers to call');
            return;
        }

        try {
            const rawKey = await window.voiceCrypto.generateKey();
            this.broadcast({ type: 'voice-key', key: Array.from(new Uint8Array(rawKey)) });

            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this.connections.forEach((conn, peerId) => {
                const call = this.peer.call(peerId, this.localStream);
                this.handleOutgoingCall(call);
            });

            document.getElementById('callOverlay').classList.add('active');
            document.getElementById('callPeerName').textContent = 'Group Call';
            document.getElementById('callStatus').textContent = 'Connecting...';
            document.getElementById('btnAcceptCall').style.display = 'none';
        } catch (err) {
            console.error('Call error:', err);
            this.showToast('Could not access microphone');
        }
    }

    handleOutgoingCall(call) {
        this.calls.set(call.peer, call);

        call.on('stream', (remoteStream) => {
            document.getElementById('remoteAudio').srcObject = remoteStream;
            document.getElementById('callStatus').textContent = 'Connected';
        });

        call.on('close', () => {
            this.calls.delete(call.peer);
            if (this.calls.size === 0) this.endCall();
        });
    }

    handleIncomingCall(call) {
        if (!this.connections.has(call.peer)) {
            call.close();
            return;
        }

        this.pendingCall = call;
        const name = this.peerNames.get(call.peer) || 'Someone';

        document.getElementById('callOverlay').classList.add('active');
        document.getElementById('callPeerName').textContent = name;
        document.getElementById('callStatus').textContent = 'Incoming call...';
        document.getElementById('btnAcceptCall').style.display = 'flex';
    }

    async acceptCall() {
        if (!this.pendingCall) return;

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this.pendingCall.on('stream', (remoteStream) => {
                document.getElementById('remoteAudio').srcObject = remoteStream;
                document.getElementById('callStatus').textContent = 'Connected';
            });

            this.pendingCall.answer(this.localStream);
            this.calls.set(this.pendingCall.peer, this.pendingCall);
            document.getElementById('btnAcceptCall').style.display = 'none';
            this.pendingCall = null;
        } catch (err) {
            console.error('Accept call error:', err);
            this.showToast('Could not access microphone');
        }
    }

    endCall() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }

        this.calls.forEach(call => call.close());
        this.calls.clear();

        if (this.pendingCall) {
            this.pendingCall.close();
            this.pendingCall = null;
        }

        document.getElementById('remoteAudio').srcObject = null;
        document.getElementById('callOverlay').classList.remove('active');
    }

    // Media Sharing
    async handleMediaSelect(e) {
        const file = e.target.files[0];
        if (!file || !this.currentRoom) return;

        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            this.showToast('File too large (max 10MB)');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const mediaType = file.type.startsWith('image') ? 'image'
                : file.type.startsWith('video') ? 'video' : 'audio';

            const mediaData = {
                type: 'media',
                mediaType,
                content: reader.result,
                fileName: file.name,
                timestamp: Date.now()
            };

            this.broadcast(mediaData);
            this.addMedia(null, mediaData, true);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    }

    addMedia(peerId, data, sent) {
        const senderName = sent ? this.username : (this.peerNames.get(peerId) || 'Unknown');

        this.messages.push({
            peerId,
            senderName,
            isMedia: true,
            mediaType: data.mediaType,
            content: data.content,
            timestamp: data.timestamp,
            sent
        });

        this.renderMessages();
    }

    receiveMedia(peerId, data) {
        this.addMedia(peerId, data, false);
        this.playNotificationSound();
    }

    // Audio Recording
    async toggleAudioRecording() {
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
                            type: 'media',
                            mediaType: 'audio',
                            content: reader.result,
                            fileName: `voice_${Date.now()}.webm`,
                            timestamp: Date.now()
                        };
                        this.broadcast(mediaData);
                        this.addMedia(null, mediaData, true);
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
