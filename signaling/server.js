const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`Signaling server on port ${PORT}`);

// room -> Map<id, ws>
const rooms = new Map();

wss.on('connection', (ws) => {
    ws.id = null;
    ws.rooms = new Set();

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            handleMessage(ws, msg);
        } catch (e) {
            console.error('Parse error:', e.message);
        }
    });

    ws.on('close', () => {
        // Remove from all rooms
        for (const room of ws.rooms) {
            const r = rooms.get(room);
            if (r) {
                r.delete(ws.id);
                // Notify others
                broadcast(room, ws.id, { t: 'leave', id: ws.id });
                if (r.size === 0) rooms.delete(room);
            }
        }
        console.log(`[${ws.id}] Disconnected`);
    });
});

function handleMessage(ws, msg) {
    switch (msg.t) {
        case 'join': {
            ws.id = msg.id;
            const room = msg.room;
            ws.rooms.add(room);

            if (!rooms.has(room)) rooms.set(room, new Map());
            const r = rooms.get(room);

            // Send list of existing peers in room
            const peers = Array.from(r.keys());
            ws.send(JSON.stringify({ t: 'peers', room, peers }));

            // Add to room
            r.set(ws.id, ws);

            // Notify others
            broadcast(room, ws.id, { t: 'join', room, id: ws.id });

            console.log(`[${room}] ${ws.id} joined (${r.size} peers)`);
            break;
        }

        case 'leave': {
            const room = msg.room;
            ws.rooms.delete(room);
            const r = rooms.get(room);
            if (r) {
                r.delete(ws.id);
                broadcast(room, ws.id, { t: 'leave', id: ws.id });
                if (r.size === 0) rooms.delete(room);
            }
            break;
        }

        case 'signal': {
            const { room, to, data } = msg;
            const r = rooms.get(room);
            if (r && r.has(to)) {
                r.get(to).send(JSON.stringify({
                    t: 'signal',
                    room,
                    from: ws.id,
                    data
                }));
            }
            break;
        }
    }
}

function broadcast(room, excludeId, msg) {
    const r = rooms.get(room);
    if (!r) return;
    const data = JSON.stringify(msg);
    for (const [id, client] of r) {
        if (id !== excludeId && client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    }
}
