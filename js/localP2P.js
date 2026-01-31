/**
 * Local P2P Connection Manager
 * Uses your own signaling server instead of Nostr relays
 * 
 * This replaces Trystero for local/LAN connections
 */

export class LocalP2P {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.peerId = null;
        this.rooms = new Map(); // roomId -> { peers, handlers }
        this.peerConnections = new Map(); // peerId -> RTCPeerConnection
        this.dataChannels = new Map(); // peerId -> DataChannel
        this.pendingCandidates = new Map(); // peerId -> [candidates]

        this.onPeerJoinCallback = null;
        this.onPeerLeaveCallback = null;
        this.onStreamCallback = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.onopen = () => {
                    console.log('[LocalP2P] Connected to signaling server');
                };

                this.ws.onmessage = (event) => {
                    const msg = JSON.parse(event.data);
                    this.handleSignal(msg);

                    if (msg.type === 'welcome') {
                        this.peerId = msg.peerId;
                        console.log('[LocalP2P] Got peer ID:', this.peerId);
                        resolve(this.peerId);
                    }
                };

                this.ws.onerror = (err) => {
                    console.error('[LocalP2P] WebSocket error:', err);
                    reject(err);
                };

                this.ws.onclose = () => {
                    console.log('[LocalP2P] Disconnected from server');
                };
            } catch (err) {
                reject(err);
            }
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        // Close all peer connections
        for (const pc of this.peerConnections.values()) {
            pc.close();
        }
        this.peerConnections.clear();
        this.dataChannels.clear();
    }

    joinRoom(roomId, handlers = {}) {
        this.rooms.set(roomId, { peers: new Set(), handlers });

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'join', roomId }));
        }

        return this;
    }

    leaveRoom(roomId) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'leave', roomId }));
        }
        this.rooms.delete(roomId);
    }

    async handleSignal(msg) {
        switch (msg.type) {
            case 'room-peers':
                // Existing peers in the room - initiate connection to each
                console.log('[LocalP2P] Existing peers:', msg.peers);
                for (const peerId of msg.peers) {
                    await this.createPeerConnection(peerId, true);
                }
                break;

            case 'peer-joined':
                // New peer joined - wait for their offer
                console.log('[LocalP2P] Peer joined:', msg.peerId);
                const room = this.rooms.get(msg.roomId);
                if (room) {
                    room.peers.add(msg.peerId);
                }
                break;

            case 'peer-left':
                console.log('[LocalP2P] Peer left:', msg.peerId);
                this.cleanupPeer(msg.peerId);
                break;

            case 'signal':
                await this.handleRTCSignal(msg.from, msg.signal);
                break;
        }
    }

    async createPeerConnection(peerId, initiator = false) {
        if (this.peerConnections.has(peerId)) {
            return this.peerConnections.get(peerId);
        }

        console.log(`[LocalP2P] Creating connection to ${peerId}, initiator: ${initiator}`);

        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        const pc = new RTCPeerConnection(config);
        this.peerConnections.set(peerId, pc);
        this.pendingCandidates.set(peerId, []);

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal(peerId, { type: 'candidate', candidate: event.candidate });
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`[LocalP2P] ICE state with ${peerId}:`, pc.iceConnectionState);

            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                if (this.onPeerJoinCallback) {
                    this.onPeerJoinCallback(peerId);
                }
            } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                this.cleanupPeer(peerId);
            }
        };

        // Handle incoming data channel
        pc.ondatachannel = (event) => {
            console.log('[LocalP2P] Got data channel');
            this.setupDataChannel(peerId, event.channel);
        };

        // Handle incoming streams
        pc.ontrack = (event) => {
            console.log('[LocalP2P] Got remote track');
            if (this.onStreamCallback) {
                this.onStreamCallback(event.streams[0], peerId);
            }
        };

        if (initiator) {
            // Create data channel
            const dc = pc.createDataChannel('data');
            this.setupDataChannel(peerId, dc);

            // Create and send offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal(peerId, { type: 'offer', sdp: pc.localDescription });
        }

        return pc;
    }

    setupDataChannel(peerId, channel) {
        this.dataChannels.set(peerId, channel);

        channel.onopen = () => {
            console.log(`[LocalP2P] Data channel open with ${peerId}`);
        };

        channel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleDataMessage(peerId, data);
            } catch (err) {
                console.error('[LocalP2P] Invalid data message:', err);
            }
        };

        channel.onclose = () => {
            console.log(`[LocalP2P] Data channel closed with ${peerId}`);
        };
    }

    handleDataMessage(peerId, data) {
        // Dispatch to room handlers based on action
        for (const [roomId, room] of this.rooms) {
            if (room.handlers[data.action]) {
                room.handlers[data.action](data.payload, peerId);
            }
        }
    }

    async handleRTCSignal(peerId, signal) {
        let pc = this.peerConnections.get(peerId);

        if (signal.type === 'offer') {
            // Create connection if it doesn't exist
            if (!pc) {
                pc = await this.createPeerConnection(peerId, false);
            }

            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

            // Process any pending candidates
            const pending = this.pendingCandidates.get(peerId) || [];
            for (const candidate of pending) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            this.pendingCandidates.set(peerId, []);

            // Create and send answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.sendSignal(peerId, { type: 'answer', sdp: pc.localDescription });

        } else if (signal.type === 'answer') {
            if (pc && pc.signalingState === 'have-local-offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

                // Process any pending candidates
                const pending = this.pendingCandidates.get(peerId) || [];
                for (const candidate of pending) {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                }
                this.pendingCandidates.set(peerId, []);
            }

        } else if (signal.type === 'candidate') {
            if (pc && pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } else {
                // Queue candidate for later
                const pending = this.pendingCandidates.get(peerId) || [];
                pending.push(signal.candidate);
                this.pendingCandidates.set(peerId, pending);
            }
        }
    }

    sendSignal(to, signal) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'signal', to, signal }));
        }
    }

    // Send data to a specific peer
    send(peerId, action, payload) {
        const dc = this.dataChannels.get(peerId);
        if (dc && dc.readyState === 'open') {
            dc.send(JSON.stringify({ action, payload }));
            return true;
        }
        return false;
    }

    // Broadcast data to all connected peers
    broadcast(action, payload) {
        for (const [peerId, dc] of this.dataChannels) {
            if (dc.readyState === 'open') {
                dc.send(JSON.stringify({ action, payload }));
            }
        }
    }

    // Add a stream to share with peers
    addStream(stream) {
        for (const [peerId, pc] of this.peerConnections) {
            for (const track of stream.getTracks()) {
                pc.addTrack(track, stream);
            }
        }
    }

    cleanupPeer(peerId) {
        const pc = this.peerConnections.get(peerId);
        if (pc) {
            pc.close();
        }
        this.peerConnections.delete(peerId);
        this.dataChannels.delete(peerId);
        this.pendingCandidates.delete(peerId);

        if (this.onPeerLeaveCallback) {
            this.onPeerLeaveCallback(peerId);
        }
    }

    // Event handlers
    onPeerJoin(callback) {
        this.onPeerJoinCallback = callback;
    }

    onPeerLeave(callback) {
        this.onPeerLeaveCallback = callback;
    }

    onPeerStream(callback) {
        this.onStreamCallback = callback;
    }

    // Make an action (like Trystero)
    makeAction(actionName) {
        const send = (payload, targetPeerId = null) => {
            if (targetPeerId) {
                this.send(targetPeerId, actionName, payload);
            } else {
                this.broadcast(actionName, payload);
            }
        };

        // Return [sendFunction, registerHandler]
        return [
            send,
            (callback) => {
                for (const [roomId, room] of this.rooms) {
                    room.handlers[actionName] = callback;
                }
            }
        ];
    }
}

// Factory function similar to Trystero's joinRoom
export function createLocalRoom(serverUrl, roomId) {
    const p2p = new LocalP2P(serverUrl);

    return {
        p2p,
        async connect() {
            await p2p.connect();
            p2p.joinRoom(roomId);
            return this;
        },
        makeAction: (name) => p2p.makeAction(name),
        onPeerJoin: (cb) => p2p.onPeerJoin(cb),
        onPeerLeave: (cb) => p2p.onPeerLeave(cb),
        onPeerStream: (cb) => p2p.onPeerStream(cb),
        addStream: (stream) => p2p.addStream(stream),
        leave: () => {
            p2p.leaveRoom(roomId);
            p2p.disconnect();
        }
    };
}
