// P2P Chat App - Using Trystero for reliable P2P (like Chitchatter)
// Trystero uses BitTorrent trackers for signaling - much more reliable than PeerJS cloud

import { joinRoom } from 'https://esm.sh/trystero/torrent';

class P2PChat {
    constructor() {
        this.room = null;
        this.peers = new Map(); // peerId -> peer data
        this.messages = [];
        this.username = localStorage.getItem('p2p_username') || '';
        this.typingPeers = new Set();
        this.typingTimeout = null;
        this.localStream = null;
        this.myFingerprint = null;
        this.verifiedPeers = new Set(JSON.parse(localStorage.getItem('verified_peers') || '[]'));

        // Trystero actions (will be set when joining room)
        this.sendMessage = null;
        this.sendTyping = null;
        this.sendUsername = null;
        this.sendMedia = null;

        this.init();
    }

    async init() {
        // Wait for crypto to be ready
        await window.e2eCrypto.init();

        // Generate fingerprint
        this.myFingerprint = await this.generateFingerprint();

        this.setupUI();
        this.promptForUsername();

        // Show fingerprint
        document.getElementById('myFingerprint').textContent = this.myFingerprint;
        document.getElementById('securitySection').style.display = 'block';

        // Update status
        document.getElementById('connectionStatus').textContent = '⚪ Ready';

        // Check for room in URL
        this.checkUrlRoom();
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

            // Broadcast to all peers
            if (this.sendUsername) {
                this.sendUsername({ name: this.username });
            }
            this.showToast('Username updated!');
        }
    }

    setupUI() {
        // Sidebar toggle
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
        document.getElementById('btnSend').onclick = () => this.sendChatMessage();
        document.getElementById('messageInput').onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        };
        document.getElementById('messageInput').oninput = () => this.sendTypingIndicator();

        // Voice call
        document.getElementById('btnVoiceCall').onclick = () => this.startGroupCall();
        document.getElementById('btnEndCall').onclick = () => this.endCall();
        document.getElementById('btnAcceptCall').onclick = () => this.acceptCall();

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
        if (this.room) {
            this.leaveRoom(false);
        }

        this.showToast('Connecting to room...');
        document.getElementById('connectionStatus').textContent = '🟡 Connecting...';

        try {
            // Using Trystero with BitTorrent trackers (like Chitchatter)
            const config = {
                appId: 'p2p-chat-' + roomId // Each room is a unique app
            };

            this.room = joinRoom(config, roomId);
            this.currentRoomId = roomId;
            this.messages = [];

            // Set up Trystero actions for sending/receiving
            const [sendMessage, getMessage] = this.room.makeAction('message');
            const [sendTyping, getTyping] = this.room.makeAction('typing');
            const [sendUsername, getUsername] = this.room.makeAction('username');
            const [sendMedia, getMedia] = this.room.makeAction('media');
            const [sendHandshake, getHandshake] = this.room.makeAction('handshake');

            this.sendMessage = sendMessage;
            this.sendTyping = sendTyping;
            this.sendUsername = sendUsername;
            this.sendMedia = sendMedia;
            this.sendHandshake = sendHandshake;

            // Handle incoming messages
            getMessage(async (data, peerId) => {
                const decrypted = await window.e2eCrypto.decrypt(data.content, peerId);
                this.receiveMessage(peerId, decrypted, data.timestamp);
            });

            getTyping((data, peerId) => {
                this.handleTypingIndicator(peerId, data.isTyping);
            });

            getUsername((data, peerId) => {
                this.peers.set(peerId, { ...this.peers.get(peerId), name: data.name });
                this.updatePeersList();
            });

            getMedia((data, peerId) => {
                this.receiveMedia(peerId, data);
            });

            getHandshake(async (data, peerId) => {
                // Import peer's public key
                await window.e2eCrypto.importPeerPublicKey(peerId, data.publicKey);
                this.peers.set(peerId, {
                    name: data.name,
                    fingerprint: data.fingerprint
                });
                this.updatePeersList();
                this.addSystemMessage(`${data.name} joined the room`);
            });

            // Handle peer join
            this.room.onPeerJoin(async (peerId) => {
                console.log('Peer joined:', peerId);

                // Send our handshake
                const myPublicKey = await window.e2eCrypto.getPublicKeyString();
                sendHandshake({
                    name: this.username,
                    publicKey: myPublicKey,
                    fingerprint: this.myFingerprint
                });

                this.updatePeersList();
            });

            // Handle peer leave
            this.room.onPeerLeave((peerId) => {
                const name = this.peers.get(peerId)?.name || 'Someone';
                this.peers.delete(peerId);
                this.updatePeersList();
                this.addSystemMessage(`${name} left the room`);
            });

            // Update URL
            history.replaceState(null, '', `#${roomId}`);

            // Update UI
            document.getElementById('connectionStatus').textContent = '🟢 Connected';
            document.getElementById('connectionStatus').classList.add('connected');
            document.getElementById('roomSection').style.display = 'block';
            document.getElementById('currentRoomName').textContent = roomId;
            document.getElementById('emptyState').style.display = 'none';
            document.getElementById('chatView').style.display = 'flex';
            document.getElementById('chatRoomName').textContent = 'Room: ' + roomId.slice(0, 12);
            document.getElementById('roomInput').value = '';

            // Collapse sidebar on mobile
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.add('collapsed');
            }

            this.showToast('Connected! Share the link to invite others.');
            this.updatePeersList();
            this.renderMessages();

        } catch (err) {
            console.error('Failed to join room:', err);
            this.showToast('Failed to connect: ' + err.message);
            document.getElementById('connectionStatus').textContent = '🔴 Error';
        }
    }

    leaveRoom(showEmpty = true) {
        if (this.room) {
            this.room.leave();
            this.room = null;
        }

        this.peers.clear();
        this.messages = [];
        this.currentRoomId = null;

        history.replaceState(null, '', window.location.pathname);

        document.getElementById('roomSection').style.display = 'none';
        document.getElementById('connectionStatus').textContent = '⚪ Ready';
        document.getElementById('connectionStatus').classList.remove('connected');

        if (showEmpty) {
            document.getElementById('emptyState').style.display = 'flex';
            document.getElementById('chatView').style.display = 'none';
        }

        this.updatePeersList();
        this.showToast('Left the room');
    }

    copyRoomLink() {
        const url = `${window.location.origin}${window.location.pathname}#${this.currentRoomId}`;
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

        if (!text || !this.room) return;

        const timestamp = Date.now();

        // Encrypt and send to all peers
        for (const [peerId] of this.peers) {
            try {
                const encrypted = await window.e2eCrypto.encrypt(text, peerId);
                this.sendMessage({ content: encrypted, timestamp }, peerId);
            } catch (e) {
                console.error('Failed to encrypt for', peerId, e);
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
        const senderName = sent ? this.username : (this.peers.get(peerId)?.name || 'Unknown');
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
        if (!this.room) return;
        this.sendTyping({ isTyping: true });

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.sendTyping({ isTyping: false });
        }, 2000);
    }

    handleTypingIndicator(peerId, isTyping) {
        const name = this.peers.get(peerId)?.name || 'Someone';

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
        const peer = this.peers.get(peerId);
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
        this.updatePeersList();
        this.showToast('Peer verified! ✓');
    }

    updatePeersList() {
        const list = document.getElementById('peersList');
        const count = this.peers.size;

        document.getElementById('peerCount').textContent = count;
        document.getElementById('peerCountBadge').textContent = `${count} peer${count !== 1 ? 's' : ''}`;

        if (count === 0) {
            list.innerHTML = '<p class="no-peers">Waiting for peers to join...</p>';
            return;
        }

        list.innerHTML = '';
        this.peers.forEach((peer, peerId) => {
            const name = peer.name || 'Connecting...';
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

    // Voice Calls (simplified for now)
    async startGroupCall() {
        this.showToast('Voice calls coming soon!');
    }

    endCall() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }
        document.getElementById('callOverlay').classList.remove('active');
    }

    acceptCall() {
        this.showToast('Voice calls coming soon!');
    }

    // Media Sharing
    async handleMediaSelect(e) {
        const file = e.target.files[0];
        if (!file || !this.room) return;

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
                mediaType,
                content: reader.result,
                fileName: file.name,
                timestamp: Date.now()
            };

            this.sendMedia(mediaData);
            this.addMedia(null, mediaData, true);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    }

    addMedia(peerId, data, sent) {
        const senderName = sent ? this.username : (this.peers.get(peerId)?.name || 'Unknown');

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
                            mediaType: 'audio',
                            content: reader.result,
                            fileName: `voice_${Date.now()}.webm`,
                            timestamp: Date.now()
                        };
                        this.sendMedia(mediaData);
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
