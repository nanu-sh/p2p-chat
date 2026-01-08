// P2P Chat App using PeerJS
class P2PChat {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection
        this.calls = new Map(); // peerId -> MediaConnection
        this.currentPeer = null;
        this.messages = {}; // peerId -> [messages]
        this.localStream = null;

        this.init();
    }

    init() {
        // Create peer with random ID
        this.peer = new Peer();

        this.peer.on('open', (id) => {
            document.getElementById('myPeerId').textContent = id;
            document.getElementById('connectionStatus').textContent = '🟢 Connected to network';
            document.getElementById('connectionStatus').classList.add('connected');

            // Save to localStorage for persistence
            localStorage.setItem('myPeerId', id);
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
        document.getElementById('messageInput').onkeypress = (e) => {
            if (e.key === 'Enter') this.sendMessage();
        };

        // Voice call
        document.getElementById('btnVoiceCall').onclick = () => this.startCall();
        document.getElementById('btnEndCall').onclick = () => this.endCall();
        document.getElementById('btnAcceptCall').onclick = () => this.acceptCall();
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
            this.connections.set(conn.peer, conn);
            this.updatePeersList();
            this.selectPeer(conn.peer);
            this.showToast(`Connected to ${conn.peer.slice(0, 8)}...`);
        });

        conn.on('data', async (data) => {
            if (data.type === 'message') {
                const decrypted = await window.e2eCrypto.decrypt(data.content, conn.peer);
                this.receiveMessage(conn.peer, decrypted, data.timestamp);
            }
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.updatePeersList();
            this.showToast(`Disconnected from ${conn.peer.slice(0, 8)}...`);
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
        });
    }

    updatePeersList() {
        const list = document.getElementById('peersList');

        if (this.connections.size === 0) {
            list.innerHTML = '<p class="no-peers">No connections yet</p>';
            return;
        }

        list.innerHTML = '';
        this.connections.forEach((conn, peerId) => {
            const div = document.createElement('div');
            div.className = 'peer-item' + (this.currentPeer === peerId ? ' active' : '');
            div.innerHTML = `
                <div class="peer-avatar">${peerId.charAt(0).toUpperCase()}</div>
                <div class="peer-info">
                    <div class="peer-name">${peerId.slice(0, 12)}...</div>
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

            div.innerHTML = `
                <div class="message-bubble">
                    <div class="message-text">${this.escapeHtml(msg.text)}</div>
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
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const call = this.peer.call(this.currentPeer, this.localStream);

            this.handleOutgoingCall(call);

            document.getElementById('callOverlay').classList.add('active');
            document.getElementById('callPeerName').textContent = this.currentPeer.slice(0, 12) + '...';
            document.getElementById('callStatus').textContent = 'Calling...';
            document.getElementById('btnAcceptCall').style.display = 'none';
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
}

// Start the app
new P2PChat();
