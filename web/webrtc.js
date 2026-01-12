class RTCManager {
    constructor(selfId, config, sendSignal, onData, onStream) {
        this.selfId = selfId;
        this.config = config;
        this.sendSignal = sendSignal; // (roomId, to, payload)
        this.onData = onData;
        this.onStream = onStream;
        this.peers = new Map(); // peerId -> { pc, dc, roomId }
    }

    getPeer(peerId) { return this.peers.get(peerId); }

    connect(roomId, peerId, initiator = false) {
        if (this.peers.has(peerId)) return;

        console.log(`RTC: Connect to ${peerId} (Initiator: ${initiator})`);
        const pc = new RTCPeerConnection(this.config);
        const peerObj = { pc, id: peerId, roomId, dc: null };
        this.peers.set(peerId, peerObj);

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.sendSignal(roomId, peerId, { type: 'candidate', candidate: e.candidate });
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(`Connection to ${peerId}: ${pc.connectionState}`);
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                this.peers.delete(peerId);
            }
        };

        if (initiator) {
            const dc = pc.createDataChannel("chat");
            this._setupDataChannel(dc, peerId);
            peerObj.dc = dc;

            pc.createOffer().then(offer => {
                pc.setLocalDescription(offer);
                this.sendSignal(roomId, peerId, { type: 'offer', sdp: offer });
            });
        } else {
            pc.ondatachannel = (e) => {
                this._setupDataChannel(e.channel, peerId);
                peerObj.dc = e.channel;
            };
        }
    }

    async handleSignal(peerId, payload) {
        let peer = this.peers.get(peerId);
        // If receive offer but no peer, create one (Responder)
        if (!peer && payload.type === 'offer') {
            // We need to know roomId... context needed. 
            // Ideally signaling protocol passes roomId with message.
            // Assuming caller passed roomId in outside context or we track active room.
            // For now, accept we might have issues if we are not "expecting" calls.
            console.warn("Received offer from unknown peer context", peerId);
            return; // Wait for explicit room join trigger or Handle in App
        }

        // Special case: App calls connect(false) then we get offer.
        if (peer) {
            const { pc } = peer;
            if (payload.type === 'offer') {
                await pc.setRemoteDescription(payload.sdp);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.sendSignal(peer.roomId, peerId, { type: 'answer', sdp: answer });
            } else if (payload.type === 'answer') {
                await pc.setRemoteDescription(payload.sdp);
            } else if (payload.type === 'candidate') {
                await pc.addIceCandidate(payload.candidate);
            }
        }
    }

    _setupDataChannel(dc, peerId) {
        dc.onopen = () => console.log(`DataChannel open with ${peerId}`);
        dc.onmessage = (e) => this.onData(peerId, e.data);
    }

    send(peerId, msg) {
        const p = this.peers.get(peerId);
        if (p && p.dc && p.dc.readyState === 'open') {
            p.dc.send(msg);
        } else {
            console.warn(`Cannot send to ${peerId} - DC not open`);
        }
    }
}
