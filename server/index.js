const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const cors = require('cors');

const db = require('./db');

// Config
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod';

// App Setup
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Lock down in prod
        methods: ["GET", "POST"]
    }
});

// Initialize DB
db.init();

// --- STATE ---
// Map<UserID, SocketID>
const activeSockets = new Map();
// Cache<GroupID, Set<UserID>> - In-memory cache for fast message validation
const groupMembersCache = new Map();

// --- API ROUTES (Auth) ---

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Missing fields" });

        const hash = await bcrypt.hash(password, 10);
        const id = crypto.randomUUID();

        await db.createUser(id, username, hash);
        // Auto-join global
        await db.joinGroup(id, 'global');

        const token = jwt.sign({ id, username }, JWT_SECRET);
        res.json({ token, user: { id, username } });
    } catch (e) {
        console.error(e);
        res.status(400).json({ error: "Registration failed (Username taken?)" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.getUserByName(username);

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
        res.json({ token, user: { id: user.id, username: user.username } });
    } catch (e) {
        res.status(500).json({ error: "Login failed" });
    }
});

// --- SOCKET.IO LOGIC ---

// Middleware: Verify Token
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error"));

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error("Authentication error"));
        socket.user = decoded;
        next();
    });
});

io.on('connection', async (socket) => {
    const userId = socket.user.id;
    console.log(`User connected: ${userId} (${socket.id})`);

    // 1. Single Socket Rule
    if (activeSockets.has(userId)) {
        const oldSocketId = activeSockets.get(userId);
        const oldSocket = io.sockets.sockets.get(oldSocketId);
        if (oldSocket) {
            console.log(`Disconnecting duplicate socket for user ${userId}`);
            oldSocket.disconnect(true); // "duplicate" implied
        }
    }
    activeSockets.set(userId, socket.id);

    // 2. Join Groups
    const groups = await db.getUserGroups(userId);
    const groupIds = groups.map(g => g.id);
    socket.join(groupIds);

    // Populate Cache
    for (const gid of groupIds) {
        if (!groupMembersCache.has(gid)) {
            // Lazy load
            const members = await db.getGroupMembers(gid);
            groupMembersCache.set(gid, new Set(members));
        } else {
            groupMembersCache.get(gid).add(userId);
        }
    }

    // 3. Message Handling
    socket.on('message', (packet) => {
        // Packet: { room: 'id', content: '...', type: 'text' }
        if (!packet || !packet.room || !packet.content) return; // Silent drop

        // Strict Membership Check
        const authorizedMembers = groupMembersCache.get(packet.room);
        if (!authorizedMembers || !authorizedMembers.has(userId)) {
            console.warn(`User ${userId} attempted to message unauthorized room ${packet.room}`);
            return; // Drop
        }

        // Forward
        const outbound = {
            sender: userId, // Trust server-side ID, not packet
            senderName: socket.user.username,
            room: packet.room,
            content: packet.content,
            type: packet.type || 'text',
            timestamp: Date.now()
        };

        socket.to(packet.room).emit('message', outbound);
    });

    // 4. Voice Signaling
    socket.on('voice-signal', (packet) => {
        // Packet: { to: 'targetUserId', signal: '...' }
        if (!packet.to || !packet.signal) return;

        // Relay direct
        const targetSocketId = activeSockets.get(packet.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('voice-signal', {
                from: userId,
                signal: packet.signal
            });
        }
    });

    // 5. Cleanup
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${userId}`);
        if (activeSockets.get(userId) === socket.id) {
            activeSockets.delete(userId);
        }
        // Ideally remove from groupMembersCache sets to save RAM, 
        // but keeping it is fine for "permanent" groups to avoid DB hits on reconnect.
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
