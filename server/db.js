const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const dbPath = path.join(dataDir, 'chat.db');
const db = new sqlite3.Database(dbPath);

function init() {
    db.serialize(() => {
        // Users: Permanent identity
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            password_hash TEXT,
            created_at INTEGER
        )`);

        // Groups: Permanent rooms
        db.run(`CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT,
            created_at INTEGER
        )`);

        // Memberships: Who is in what group
        db.run(`CREATE TABLE IF NOT EXISTS group_members (
            group_id TEXT,
            user_id TEXT,
            joined_at INTEGER,
            PRIMARY KEY (group_id, user_id),
            FOREIGN KEY(group_id) REFERENCES groups(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // Initial Seed (Optional: Create a default 'Welcome' group)
        db.get("SELECT id FROM groups WHERE id = 'global'", (err, row) => {
            if (!row) {
                db.run("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)", ['global', 'Global Lobby', Date.now()]);
            }
        });
    });
}

function createUser(id, username, hash) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)");
        stmt.run(id, username, hash, Date.now(), function (err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
        stmt.finalize();
    });
}

function getUserByName(username) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getUserGroups(userId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT g.id, g.name 
            FROM groups g 
            JOIN group_members gm ON g.id = gm.group_id 
            WHERE gm.user_id = ?
        `;
        db.all(query, [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getGroupMembers(groupId) {
    return new Promise((resolve, reject) => {
        const query = `SELECT user_id FROM group_members WHERE group_id = ?`;
        db.all(query, [groupId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.user_id));
        });
    });
}

function joinGroup(userId, groupId) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)");
        stmt.run(groupId, userId, Date.now(), function (err) {
            if (err) reject(err);
            else resolve();
        });
        stmt.finalize();
    });
}

module.exports = {
    init,
    createUser,
    getUserByName,
    getUserGroups,
    getGroupMembers,
    joinGroup,
    db // Direct access if needed, but try to use helpers
};
