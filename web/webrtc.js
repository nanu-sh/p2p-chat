// Simple WebRTC connection manager

class RTCPeer {
    constructor(config, peerId, initiator, onSignal, onOpen, onMessage, onClose) {
        this.peerId = peerId;
        this.onSignal = onSignal;
        this.onOpen = onOpen;
        this.onMessage = onMessage;
        this.onClose = onClose;

        this.pc = new RTCPeerConnection(config);
        this.dc = null;
        this.connected = false;

        this.pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.onSignal({ type: 'ice', ice: e.candidate });
            }
        };

        this.pc.onconnectionstatechange = () => {
            console.log(`[RTC ${peerId}] State: ${this.pc.connectionState}`);
            if (this.pc.connectionState === 'connected') {
                this.connected = true;
            }
            if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
                this.onClose();
            }
        };

        this.pc.ondatachannel = (e) => {
            this._setupChannel(e.channel);
        };

        this.pc.ontrack = (e) => {
            if (this.onTrack) this.onTrack(e.streams[0]);
        };

        if (initiator) {
            this.dc = this.pc.createDataChannel('data');
            this._setupChannel(this.dc);
            this._createOffer();
        }
    }

    async _createOffer() {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.onSignal({ type: 'offer', sdp: offer });
    }

    async handleSignal(data) {
        try {
            if (data.type === 'offer') {
                // Check if we're in a state where we can accept an offer
                if (this.pc.signalingState !== 'stable' && this.pc.signalingState !== 'have-local-offer') {
                    console.warn(`[RTC ${this.peerId}] Ignoring offer in state: ${this.pc.signalingState}`);
                    return;
                }

                // Handle glare (both sides sent offers) - higher ID yields
                if (this.pc.signalingState === 'have-local-offer') {
                    // Rollback if we should yield
                    console.log(`[RTC ${this.peerId}] Glare detected, rolling back local offer`);
                    await this.pc.setLocalDescription({ type: 'rollback' });
                }

                await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                const answer = await this.pc.createAnswer();
                await this.pc.setLocalDescription(answer);
                this.onSignal({ type: 'answer', sdp: answer });
            } else if (data.type === 'answer') {
                // Only accept answer if we're waiting for one
                if (this.pc.signalingState !== 'have-local-offer') {
                    console.warn(`[RTC ${this.peerId}] Ignoring answer in state: ${this.pc.signalingState}`);
                    return;
                }
                await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            } else if (data.type === 'ice') {
                // Only add ICE candidates if we have a remote description
                if (this.pc.remoteDescription) {
                    await this.pc.addIceCandidate(new RTCIceCandidate(data.ice));
                } else {
                    console.warn(`[RTC ${this.peerId}] Ignoring ICE candidate - no remote description yet`);
                }
            }
        } catch (err) {
            console.error(`[RTC ${this.peerId}] Signal error:`, err);
        }
    }

    _setupChannel(channel) {
        this.dc = channel;
        channel.onopen = () => {
            console.log(`[RTC ${this.peerId}] Channel open`);
            this.connected = true;
            this.onOpen();
        };
        channel.onclose = () => {
            console.log(`[RTC ${this.peerId}] Channel closed`);
            this.connected = false;
            this.onClose();
        };
        channel.onmessage = (e) => {
            this.onMessage(e.data);
        };
    }

    send(data) {
        if (this.dc && this.dc.readyState === 'open') {
            this.dc.send(data);
            return true;
        }
        return false;
    }

    close() {
        if (this.dc) this.dc.close();
        this.pc.close();
    }
}
