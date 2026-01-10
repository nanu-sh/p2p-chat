// P2P Chat App using PeerJS
class P2PChat {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection
        this.calls = new Map(); // peerId -> MediaConnection
        this.peerNames = new Map(); // peerId -> username
        this.pendingConnections = new Map(); // peerId -> {conn, name}
        this.currentPeer = null;
        this.messages = {};
        this.localStream = null;
        this.username = localStorage.getItem('p2p_username') || '';
        this.typingTimeout = null;
        this.approvedPeers = new Set(JSON.parse(localStorage.getItem('p2p_approved') || '[]'));

        this.init();
    }

    init() {
        // Create peer with TURN servers for cross-network connectivity
        this.peer = new Peer(null, {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
                    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
                ]
            }
        });

        this.peer.on('open', (id) => {
            document.getElementById('myPeerId').textContent = id;
            document.getElementById('connectionStatus').textContent = '🟢 Connected to network';
            document.getElementById('connectionStatus').classList.add('connected');
            localStorage.setItem('myPeerId', id);

            // Update share URL with peer ID
            const shareUrl = `${window.location.origin}${window.location.pathname}#${id}`;
            document.getElementById('shareLink').href = shareUrl;
            document.getElementById('shareLink').textContent = 'Share Link';

            // Check if someone shared their ID in the URL
            this.checkUrlInvite();

            // Start heartbeat for mobile keep-alive
            this.startHeartbeat();
        });

        this.peer.on('connection', (conn) => {
            this.handleConnection(conn);
        });

        this.peer.on('call', (call) => {
            this.handleIncomingCall(call);
        });

        this.peer.on('error', (err) => {
            console.error('Peer error:', err);
            document.getElementById('connectionStatus').textContent = '🔴 Error: ' + err.type;
        });

        this.setupUI();
        this.loadSavedMessages();
        this.loadPeerNames();
        this.promptForUsername();
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
            // Notify all connected peers of name change
            this.connections.forEach(conn => {
                conn.send({ type: 'username', name: this.username });
            });
            this.showToast('Username updated!');
        }
    }

    setupUI() {
        // Copy ID
        document.getElementById('btnCopyId').onclick = () => {
            const id = document.getElementById('myPeerId').textContent;
            navigator.clipboard.writeText(id);
            this.showToast('Peer ID copied!');
        };

        // Connect to peer
        document.getElementById('btnConnect').onclick = () => {
            const friendId = document.getElementById('friendIdInput').value.trim();
            if (friendId) {
                this.connectToPeer(friendId);
                document.getElementById('friendIdInput').value = '';
            }
        };

        document.getElementById('friendIdInput').onkeypress = (e) => {
            if (e.key === 'Enter') {
                document.getElementById('btnConnect').click();
            }
        };

        // Send message
        document.getElementById('btnSend').onclick = () => this.sendMessage();
        document.getElementById('messageInput').onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        };

        // Voice call
        document.getElementById('btnVoiceCall').onclick = () => this.startCall();
        document.getElementById('btnEndCall').onclick = () => this.endCall();
        document.getElementById('btnAcceptCall').onclick = () => this.acceptCall();

        // Clear all data
        document.getElementById('btnClearData').onclick = () => this.clearAllData();

        // Media sharing
        document.getElementById('btnAttach').onclick = () => this.showMediaOptions();
        document.getElementById('mediaFileInput').onchange = (e) => this.handleMediaSelect(e);
        document.getElementById('btnRecordAudio').onclick = () => this.toggleAudioRecording();

        // Delete individual chat
        document.getElementById('btnDeleteChat').onclick = () => this.deleteCurrentChat();

        // Edit username
        document.getElementById('btnEditUsername').onclick = () => this.editUsername();

        // Typing indicator
        document.getElementById('messageInput').oninput = () => this.sendTypingIndicator();
    }

    connectToPeer(peerId) {
        if (this.connections.has(peerId)) {
            this.selectPeer(peerId);
            return;
        }

        const conn = this.peer.connect(peerId, { reliable: true });
        this.handleConnection(conn);
    }

    handleConnection(conn) {
        conn.on('open', () => {
            // Check if already approved
            if (this.approvedPeers.has(conn.peer)) {
                this.acceptConnection(conn);
            } else {
                // Pending - wait for request message
                conn.on('data', (data) => {
                    if (data.type === 'connect-request') {
                        this.pendingConnections.set(conn.peer, { conn, name: data.name });
                        this.showConnectionRequest(conn.peer, data.name);
                    }
                });
                // Send our request
                conn.send({ type: 'connect-request', name: this.username });
            }
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.pendingConnections.delete(conn.peer);
            this.updatePeersList();
        });

        conn.on('error', (err) => console.error('Connection error:', err));
    }

    acceptConnection(conn) {
        this.connections.set(conn.peer, conn);
        this.approvedPeers.add(conn.peer);
        localStorage.setItem('p2p_approved', JSON.stringify([...this.approvedPeers]));
        conn.send({ type: 'username', name: this.username });
        conn.send({ type: 'connect-accepted' });
        this.setupConnectionHandlers(conn);
        this.updatePeersList();
        this.selectPeer(conn.peer);
        this.showToast(`Connected to ${this.getPeerName(conn.peer)}`);
    }

    setupConnectionHandlers(conn) {
        conn.on('data', async (data) => {
            if (data.type === 'message') {
                const decrypted = await window.e2eCrypto.decrypt(data.content, conn.peer);
                this.receiveMessage(conn.peer, decrypted, data.timestamp);
                this.playNotificationSound();
            } else if (data.type === 'media') {
                this.receiveMedia(conn.peer, data);
                this.playNotificationSound();
            } else if (data.type === 'voice-key') {
                await window.voiceCrypto.importKey(new Uint8Array(data.key));
            } else if (data.type === 'username') {
                this.peerNames.set(conn.peer, data.name);
                this.savePeerNames();
                this.updatePeersList();
                if (this.currentPeer === conn.peer) this.updateChatHeader();
            } else if (data.type === 'typing') {
                this.showTypingIndicator(conn.peer, data.isTyping);
            } else if (data.type === 'connect-accepted') {
                this.acceptConnection(conn);
            }
        });
    }

    showConnectionRequest(peerId, name) {
        const peerName = name || peerId.slice(0, 8) + '...';
        if (confirm(`${peerName} wants to connect. Accept?`)) {
            const pending = this.pendingConnections.get(peerId);
            if (pending) {
                this.peerNames.set(peerId, name);
                this.acceptConnection(pending.conn);
                this.pendingConnections.delete(peerId);
            }
        } else {
            const pending = this.pendingConnections.get(peerId);
            if (pending) pending.conn.close();
            this.pendingConnections.delete(peerId);
        }
    }

    updatePeersList() {
        const list = document.getElementById('peersList');

        if (this.connections.size === 0) {
            list.innerHTML = '<p class="no-peers">No connections yet</p>';
            return;
        }

        list.innerHTML = '';
        this.connections.forEach((conn, peerId) => {
            const name = this.getPeerName(peerId);
            const div = document.createElement('div');
            div.className = 'peer-item' + (this.currentPeer === peerId ? ' active' : '');
            div.innerHTML = `
                <div class="peer-avatar">${name.charAt(0).toUpperCase()}</div>
                <div class="peer-info">
                    <div class="peer-name">${name}</div>
                    <div class="peer-status">Connected</div>
                </div>
            `;
            div.onclick = () => this.selectPeer(peerId);
            list.appendChild(div);
        });
    }

    selectPeer(peerId) {
        this.currentPeer = peerId;
        this.updatePeersList();

        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('chatView').style.display = 'flex';
        document.getElementById('chatPeerName').textContent = peerId.slice(0, 12) + '...';
        document.getElementById('chatAvatar').textContent = peerId.charAt(0).toUpperCase();

        this.renderMessages(peerId);
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();

        if (!text || !this.currentPeer) return;

        const conn = this.connections.get(this.currentPeer);
        if (!conn) return;

        const timestamp = Date.now();
        const encrypted = await window.e2eCrypto.encrypt(text, this.currentPeer);

        conn.send({
            type: 'message',
            content: encrypted,
            timestamp
        });

        this.addMessage(this.currentPeer, text, timestamp, true);
        input.value = '';
    }

    receiveMessage(peerId, text, timestamp) {
        this.addMessage(peerId, text, timestamp, false);

        if (this.currentPeer === peerId) {
            this.renderMessages(peerId);
        } else {
            this.showToast(`New message from ${peerId.slice(0, 8)}...`);
        }
    }

    addMessage(peerId, text, timestamp, sent) {
        if (!this.messages[peerId]) {
            this.messages[peerId] = [];
        }

        this.messages[peerId].push({ text, timestamp, sent });
        this.saveMessages();

        if (this.currentPeer === peerId) {
            this.renderMessages(peerId);
        }
    }

    renderMessages(peerId) {
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';

        const messages = this.messages[peerId] || [];
        messages.forEach(msg => {
            const div = document.createElement('div');
            div.className = 'message' + (msg.sent ? ' sent' : '');

            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let content = '';
            if (msg.isMedia) {
                if (msg.mediaType === 'image') {
                    content = `<img src="${msg.content}" class="media-image" alt="Shared image">`;
                } else if (msg.mediaType === 'video') {
                    content = `<video src="${msg.content}" class="media-video" controls></video>`;
                } else if (msg.mediaType === 'audio') {
                    content = `<audio src="${msg.content}" class="media-audio" controls></audio>`;
                }
            } else {
                content = `<div class="message-text">${this.escapeHtml(msg.text)}</div>`;
            }

            div.innerHTML = `
                <div class="message-bubble">
                    ${content}
                    <div class="message-time">${time}</div>
                </div>
            `;
            container.appendChild(div);
        });

        container.scrollTop = container.scrollHeight;
    }

    // Voice Calls
    async startCall() {
        if (!this.currentPeer) return;

        try {
            // Generate and share voice encryption key
            const keyData = await window.voiceCrypto.generateKey();
            const conn = this.connections.get(this.currentPeer);
            if (conn) {
                conn.send({ type: 'voice-key', key: Array.from(new Uint8Array(keyData)) });
            }

            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const call = this.peer.call(this.currentPeer, this.localStream, {
                metadata: { encrypted: window.voiceCrypto.supported }
            });

            this.handleOutgoingCall(call);

            document.getElementById('callOverlay').classList.add('active');
            document.getElementById('callPeerName').textContent = this.currentPeer.slice(0, 12) + '...';
            document.getElementById('callStatus').textContent = 'Calling...';
            document.getElementById('btnAcceptCall').style.display = 'none';
            document.getElementById('callEncryptionBadge').textContent =
                window.voiceCrypto.supported ? '🔐 E2E Encrypted' : '🔒 Transport Encrypted';
        } catch (err) {
            console.error('Error starting call:', err);
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
            this.endCall();
        });
    }

    handleIncomingCall(call) {
        this.pendingCall = call;

        document.getElementById('callOverlay').classList.add('active');
        document.getElementById('callPeerName').textContent = call.peer.slice(0, 12) + '...';
        document.getElementById('callStatus').textContent = 'Incoming call...';
        document.getElementById('btnAcceptCall').style.display = 'flex';
    }

    async acceptCall() {
        if (!this.pendingCall) return;

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.pendingCall.answer(this.localStream);

            this.pendingCall.on('stream', (remoteStream) => {
                document.getElementById('remoteAudio').srcObject = remoteStream;
                document.getElementById('callStatus').textContent = 'Connected';
            });

            this.calls.set(this.pendingCall.peer, this.pendingCall);
            document.getElementById('btnAcceptCall').style.display = 'none';
            this.pendingCall = null;
        } catch (err) {
            console.error('Error accepting call:', err);
            this.showToast('Could not access microphone');
        }
    }

    endCall() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        this.calls.forEach(call => call.close());
        this.calls.clear();

        document.getElementById('remoteAudio').srcObject = null;
        document.getElementById('callOverlay').classList.remove('active');
    }

    // Storage
    saveMessages() {
        localStorage.setItem('p2p_messages', JSON.stringify(this.messages));
    }

    loadSavedMessages() {
        const saved = localStorage.getItem('p2p_messages');
        if (saved) {
            this.messages = JSON.parse(saved);
        }
    }

    // Peer Names
    getPeerName(peerId) {
        return this.peerNames.get(peerId) || peerId.slice(0, 8) + '...';
    }

    savePeerNames() {
        const obj = Object.fromEntries(this.peerNames);
        localStorage.setItem('p2p_peerNames', JSON.stringify(obj));
    }

    loadPeerNames() {
        const saved = localStorage.getItem('p2p_peerNames');
        if (saved) {
            const obj = JSON.parse(saved);
            this.peerNames = new Map(Object.entries(obj));
        }
    }

    updateChatHeader() {
        if (!this.currentPeer) return;
        const name = this.getPeerName(this.currentPeer);
        document.getElementById('chatPeerName').textContent = name;
        document.getElementById('chatAvatar').textContent = name.charAt(0).toUpperCase();
    }

    // URL-based invite links
    checkUrlInvite() {
        const hash = window.location.hash.slice(1);
        if (hash && hash.length > 10 && hash !== this.peer.id) {
            document.getElementById('friendIdInput').value = hash;
            this.showToast('Invite link detected! Click Connect to join.');
            // Clear hash after reading
            history.replaceState(null, '', window.location.pathname);
        }
    }

    // Heartbeat keep-alive for mobile
    startHeartbeat() {
        setInterval(() => {
            this.connections.forEach((conn) => {
                if (conn.open) {
                    conn.send({ type: 'ping' });
                }
            });
        }, 30000); // Every 30 seconds
    }

    // Typing Indicators
    sendTypingIndicator() {
        if (!this.currentPeer) return;
        const conn = this.connections.get(this.currentPeer);
        if (!conn) return;

        conn.send({ type: 'typing', isTyping: true });

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            conn.send({ type: 'typing', isTyping: false });
        }, 2000);
    }

    showTypingIndicator(peerId, isTyping) {
        if (this.currentPeer !== peerId) return;
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.style.display = isTyping ? 'block' : 'none';
        }
    }

    // Notification Sound
    playNotificationSound() {
        if (document.hidden) {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2Onrq8vLy8vLy4p5R0W1RcdIecsNHcvLy8vLy0p4x0YGNwiZuqu8na3Ly8vLi0p4x0YGRyipyqu8na1Ly8vLi0p4x0YGNyipyru8na1Ly8vLi0p4x0YGNyipyru8rZ1Ly8vLi0p4x0YGNwiZuruszZ1Ly8vLiwo4hxX2BvhpequszZ1Ly8vLiroYZvXl9vhpequczZ1Ly8u7WpnIFsYGJ0');
            audio.volume = 0.3;
            audio.play().catch(() => { });
        }
    }

    // Utils
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

    // Clear all data
    clearAllData() {
        if (confirm('This will delete all messages, connections, and peer ID. Continue?')) {
            localStorage.clear();
            this.messages = {};
            this.connections.forEach(conn => conn.close());
            this.connections.clear();
            this.peer.destroy();
            this.showToast('All data cleared!');
            setTimeout(() => location.reload(), 1000);
        }
    }

    // Delete current chat only
    deleteCurrentChat() {
        if (!this.currentPeer) return;

        const peerName = this.currentPeer.slice(0, 12) + '...';
        if (confirm(`Delete chat with ${peerName}? This will remove all messages.`)) {
            // Delete messages for this peer
            delete this.messages[this.currentPeer];
            this.saveMessages();

            // Close connection if still connected
            const conn = this.connections.get(this.currentPeer);
            if (conn) {
                conn.close();
                this.connections.delete(this.currentPeer);
            }

            // Reset UI
            this.currentPeer = null;
            this.updatePeersList();
            document.getElementById('chatView').style.display = 'none';
            document.getElementById('emptyState').style.display = 'flex';

            this.showToast('Chat deleted');
        }
    }

    // Media sharing
    showMediaOptions() {
        document.getElementById('mediaFileInput').click();
    }

    async handleMediaSelect(e) {
        const file = e.target.files[0];
        if (!file || !this.currentPeer) return;

        const maxSize = 10 * 1024 * 1024; // 10MB limit
        if (file.size > maxSize) {
            this.showToast('File too large (max 10MB)');
            return;
        }

        const reader = new FileReader();
        reader.onload = async () => {
            const base64 = reader.result;
            const conn = this.connections.get(this.currentPeer);
            if (!conn) return;

            const mediaData = {
                type: 'media',
                mediaType: file.type.startsWith('image') ? 'image' :
                    file.type.startsWith('video') ? 'video' : 'audio',
                content: base64,
                fileName: file.name,
                timestamp: Date.now()
            };

            conn.send(mediaData);
            this.addMedia(this.currentPeer, mediaData, true);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    }

    addMedia(peerId, data, sent) {
        if (!this.messages[peerId]) {
            this.messages[peerId] = [];
        }
        this.messages[peerId].push({
            isMedia: true,
            mediaType: data.mediaType,
            content: data.content,
            fileName: data.fileName,
            timestamp: data.timestamp,
            sent
        });
        this.saveMessages();
        if (this.currentPeer === peerId) {
            this.renderMessages(peerId);
        }
    }

    receiveMedia(peerId, data) {
        this.addMedia(peerId, data, false);
        if (this.currentPeer !== peerId) {
            this.showToast(`New media from ${peerId.slice(0, 8)}...`);
        }
    }

    // Audio recording
    async toggleAudioRecording() {
        const btn = document.getElementById('btnRecordAudio');

        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
            btn.textContent = '🎙️';
            btn.classList.remove('recording');
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.audioChunks = [];
                this.mediaRecorder = new MediaRecorder(stream);

                this.mediaRecorder.ondataavailable = (e) => {
                    this.audioChunks.push(e.data);
                };

                this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    stream.getTracks().forEach(t => t.stop());

                    const reader = new FileReader();
                    reader.onload = () => {
                        const conn = this.connections.get(this.currentPeer);
                        if (!conn) return;

                        const mediaData = {
                            type: 'media',
                            mediaType: 'audio',
                            content: reader.result,
                            fileName: `recording_${Date.now()}.webm`,
                            timestamp: Date.now()
                        };
                        conn.send(mediaData);
                        this.addMedia(this.currentPeer, mediaData, true);
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
}

// Start the app
new P2PChat();
