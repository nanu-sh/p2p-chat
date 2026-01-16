import { joinRoom } from 'trystero/torrent';

const APP_ID = 'p2p-chat-v1';

export function connectRoom(roomConfig, callbacks) {
    // roomConfig: { roomId }
    // callbacks: { onPeerJoin, onPeerLeave, onMessage }

    const room = joinRoom({ appId: APP_ID }, roomConfig.roomId);

    // Actions
    const [sendChat, getChat] = room.makeAction('chat');

    // Usage: sendChat({ text, sender, ... })

    // Events
    room.onPeerJoin(peerId => {
        console.log(`[P2P] Peer Joined ${roomConfig.roomId}:`, peerId);
        if (callbacks.onPeerJoin) callbacks.onPeerJoin(peerId);
    });

    room.onPeerLeave(peerId => {
        console.log(`[P2P] Peer Left ${roomConfig.roomId}:`, peerId);
        if (callbacks.onPeerLeave) callbacks.onPeerLeave(peerId);
    });

    getChat((data, peerId) => {
        if (callbacks.onMessage) callbacks.onMessage(data, peerId);
    });

    return {
        leave: () => room.leave(),
        sendChat: (payload) => sendChat(payload),
        roomId: roomConfig.roomId
    };
}
