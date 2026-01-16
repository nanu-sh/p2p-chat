// PeerManager.js - Powered by Trystero
import { joinRoom } from 'trystero/torrent';

export class PeerManager {
    constructor(roomId, onConnected, onMessage, onDisconnected) {
        this.config = { appId: 'p2p-chat-v1' };
        this.roomId = roomId;
        this.room = null;

        // Trystero returns { makeAction, onPeerJoin, onPeerLeave }
        this.init(onConnected, onMessage, onDisconnected);
    }

    init(onConnected, onMessage, onDisconnected) {
        // 1. Join the "Room" via Torrent/Magnet (Public Signaling)
        this.room = joinRoom(this.config, this.roomId);

        // 2. Define Actions
        // 'chat' is the topic wrapper
        const [sendChat, getChat] = this.room.makeAction('chat');

        // 3. Listeners
        this.room.onPeerJoin(peerId => {
            console.log(`Peer Joined: ${peerId}`);
            onConnected(peerId);
        });

        this.room.onPeerLeave(peerId => {
            console.log(`Peer Left: ${peerId}`);
            onDisconnected(peerId);
        });

        getChat((data, peerId) => {
            // data = { text, sender, id }
            onMessage(data, peerId);
        });

        this.sendChat = sendChat; // Expose send function
    }

    sendMessage(payload) {
        if (this.sendChat) {
            this.sendChat(payload);
        }
    }

    // Cleanup if needed (Trystero auto-cleans usually)
    leave() {
        if (this.room) {
            this.room.leave();
        }
    }
}
