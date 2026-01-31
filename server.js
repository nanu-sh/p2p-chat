/**
 * Simple WebSocket Signaling Server for P2P Chat
 * 
 * How it works:
 * 1. Run: node server.js
 * 2. Share your local IP (shown on startup) with your friend
 * 3. Both connect to the same server IP in the app
 * 4. WebRTC signaling happens through this server
 * 5. After connection, chat goes directly P2P
 * 
 * Works on: Same WiFi/hotspot network (LAN)
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;

// Get local IP addresses (IPv4 and IPv6)
function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    let ipv4 = null;
    let ipv6 = null;

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.internal) continue;

            if (iface.family === 'IPv4' && !ipv4) {
                ipv4 = iface.address;
            }
            if (iface.family === 'IPv6' && !iface.address.startsWith('fe80') && !ipv6) {
                // Skip link-local addresses (fe80::)
                ipv6 = iface.address;
            }
        }
    }

    return { ipv4: ipv4 || '127.0.0.1', ipv6 };
}

// Simple static file server for the app
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);

    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// WebSocket signaling
const wss = new WebSocket.Server({ server });

// Track connected peers: peerId -> { ws, rooms: Set<roomId> }
const peers = new Map();
// Track rooms: roomId -> Set<peerId>
const rooms = new Map();

wss.on('connection', (ws) => {
    const peerId = Math.random().toString(36).substring(2, 10);
    console.log(`[+] Peer connected: ${peerId}`);

    peers.set(peerId, { ws, rooms: new Set() });

    // Send peer their ID
    ws.send(JSON.stringify({ type: 'welcome', peerId }));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            handleMessage(peerId, msg);
        } catch (err) {
            console.error('Invalid message:', err);
        }
    });

    ws.on('close', () => {
        console.log(`[-] Peer disconnected: ${peerId}`);
        const peer = peers.get(peerId);

        if (peer) {
            // Notify all rooms this peer was in
            for (const roomId of peer.rooms) {
                const room = rooms.get(roomId);
                if (room) {
                    room.delete(peerId);
                    // Notify others in the room
                    broadcast(roomId, { type: 'peer-left', peerId }, peerId);
                    // Clean up empty rooms
                    if (room.size === 0) {
                        rooms.delete(roomId);
                    }
                }
            }
        }

        peers.delete(peerId);
    });
});

function handleMessage(peerId, msg) {
    const peer = peers.get(peerId);
    if (!peer) return;

    switch (msg.type) {
        case 'join':
            // Join a room
            const roomId = msg.roomId;
            if (!rooms.has(roomId)) {
                rooms.set(roomId, new Set());
            }

            const room = rooms.get(roomId);
            const existingPeers = Array.from(room);

            room.add(peerId);
            peer.rooms.add(roomId);

            console.log(`[Room ${roomId}] ${peerId} joined. Peers: ${room.size}`);

            // Tell new peer about existing peers
            peer.ws.send(JSON.stringify({
                type: 'room-peers',
                roomId,
                peers: existingPeers
            }));

            // Tell existing peers about new peer
            broadcast(roomId, { type: 'peer-joined', peerId, roomId }, peerId);
            break;

        case 'signal':
            // Forward WebRTC signaling to target peer
            const target = peers.get(msg.to);
            if (target) {
                target.ws.send(JSON.stringify({
                    type: 'signal',
                    from: peerId,
                    signal: msg.signal
                }));
            }
            break;

        case 'leave':
            // Leave a room
            if (peer.rooms.has(msg.roomId)) {
                peer.rooms.delete(msg.roomId);
                const r = rooms.get(msg.roomId);
                if (r) {
                    r.delete(peerId);
                    broadcast(msg.roomId, { type: 'peer-left', peerId }, peerId);
                }
            }
            break;
    }
}

function broadcast(roomId, msg, exclude = null) {
    const room = rooms.get(roomId);
    if (!room) return;

    for (const peerId of room) {
        if (peerId !== exclude) {
            const peer = peers.get(peerId);
            if (peer) {
                peer.ws.send(JSON.stringify(msg));
            }
        }
    }
}

// Start server on dual-stack (IPv4 + IPv6)
const { ipv4, ipv6 } = getLocalIPs();

server.listen(PORT, '::', () => {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    🚀 P2P Chat Server Running (IPv6 Enabled)              ║');
    console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
    console.log(`║  Local:     http://localhost:${PORT}                                        ║`);
    console.log(`║  IPv4 LAN:  ws://${ipv4}:${PORT}`);
    if (ipv6) {
        console.log(`║  IPv6:      ws://[${ipv6}]:${PORT}`);
        console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
        console.log('║  🌐 INTERNET ACCESS: Share the IPv6 address with friends on IPv6 networks ║');
        console.log('║  📱 Both you AND your friend need IPv6 (Jio users usually have it!)       ║');
    }
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
});
