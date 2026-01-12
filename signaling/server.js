const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

console.log('Signaling Server running on port 8080');

const rooms = new Map(); // roomId -> Set<ws>

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const { t, roomId, selfId } = data;

            if (t === 'join') {
                if (!rooms.has(roomId)) rooms.set(roomId, new Set());
                rooms.get(roomId).add(ws);
                ws.roomId = roomId;
                ws.selfId = selfId;

                // Notify others in room
                const peers = Array.from(rooms.get(roomId))
                    .filter(client => client !== ws && client.readyState === WebSocket.OPEN)
                    .map(client => client.selfId);

                // Send current peers to new joiner
                ws.send(JSON.stringify({ t: 'peers', roomId, peers }));

                console.log(`[${roomId}] ${selfId} joined.`);
            }
            else if (t === 'leave') {
                handleLeave(ws);
            }
            else if (t === 'signal') {
                const { to, payload } = data;
                // Relay to specific peer
                const room = rooms.get(roomId);
                if (room) {
                    for (const client of room) {
                        if (client.selfId === to && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                t: 'signal',
                                from: selfId,
                                payload
                            }));
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Error parsing message:", e);
        }
    });

    ws.on('close', () => {
        handleLeave(ws);
    });
});

function handleLeave(ws) {
    if (ws.roomId && rooms.has(ws.roomId)) {
        rooms.get(ws.roomId).delete(ws);
        if (rooms.get(ws.roomId).size === 0) {
            rooms.delete(ws.roomId);
        } else {
            // Notify others? (Optional, usually we find out via ICE disconnect)
        }
        console.log(`[${ws.roomId}] ${ws.selfId} disconnected.`);
    }
}
