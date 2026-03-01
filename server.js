/**
 * WebRTC Signaling Server for P2P Chat using PeerJS
 * 
 * How it works:
 * 1. Run: node server.js
 * 2. Share your local IP (shown on startup) with your friend
 * 3. Both connect to the same server IP in the app
 * 4. PeerJS server handles WebRTC brokering
 * 5. After connection, chat goes directly P2P
 */

const express = require('express');
const { ExpressPeerServer } = require('peer');
const http = require('http');
const path = require('path');
const os = require('os');
const cors = require('cors');

const PORT = 3000;
const app = express();
app.use(cors());

// Rate limiting - prevent brute-force ID guessing and connection spam
const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests, try again later.'
});

const signalingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many signaling requests.'
});

app.use(generalLimiter);

// Serve static files (the app)
app.use(express.static(path.join(__dirname, '/')));

// Create HTTP server
const server = http.createServer(app);

// Setup PeerJS Server
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/p2p' // Signaling endpoint will be /peerjs/p2p
});

// Mount the PeerJS server with stricter rate limiting
app.use('/peerjs', signalingLimiter, peerServer);

// Listen for peer connections
peerServer.on('connection', (client) => {
    console.log(`[+] Peer connected to signaling server: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
    console.log(`[-] Peer disconnected from signaling server: ${client.getId()}`);
});

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
                // Skip link-local addresses
                ipv6 = iface.address;
            }
        }
    }

    return { ipv4: ipv4 || '127.0.0.1', ipv6 };
}

// Start server on dual-stack (IPv4 + IPv6)
const { ipv4, ipv6 } = getLocalIPs();

server.listen(PORT, '::', () => {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    🚀 P2P Chat Server Running (PeerJS)                    ║');
    console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
    console.log(`║  Local:     http://localhost:${PORT}                                        ║`);
    console.log(`║  IPv4 LAN:  http://${ipv4}:${PORT}`);
    if (ipv6) {
        console.log(`║  IPv6:      http://[${ipv6}]:${PORT}`);
        console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
        console.log('║  🌐 INTERNET ACCESS: Share the IPv6 address with friends on IPv6 networks ║');
    }
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
});
