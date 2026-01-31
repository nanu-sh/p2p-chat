# P2P Chat 🔒

A secure peer-to-peer chat application with **your own signaling server**. No third-party services required - just you, your friends, and direct connections.

## Features ✨

- 🔒 **Self-Hosted**: Run your own signaling server, no external services needed
- 🌐 **IPv6 Support**: Works over the internet with IPv6 (Jio and other carriers)
- 🔐 **E2E Encryption**: AES-GCM with ECDH key exchange
- 📞 **Voice Calls**: Secure P2P voice calls
- 📎 **File Sharing**: Send images, documents, videos
- 🎤 **Voice Notes**: Record and send audio messages
- ⌨️ **Typing Indicators**: Real-time typing status
- 💾 **Offline Messages**: Messages queue when peer is offline

## Quick Start 🚀

### 1. Install Dependencies
```bash
cd p2p-chat
npm install
```

### 2. Start the Server
```bash
node server.js
```

You'll see output like:
```
╔═══════════════════════════════════════════════════════════════════════════╗
║                    🚀 P2P Chat Server Running (IPv6 Enabled)              ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Local:     http://localhost:3000                                         ║
║  IPv4 LAN:  ws://192.168.x.x:3000
║  IPv6:      ws://[2402:3a80:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx]:3000
╠═══════════════════════════════════════════════════════════════════════════╣
║  🌐 INTERNET ACCESS: Share the IPv6 address with friends on IPv6 networks ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### 3. Connect

1. Open `http://localhost:3000` in your browser
2. Enter your name
3. Enter the server URL (shown when you start the server)
4. Click **Connect**

### 4. Share with Friends

- **Same network (WiFi/Hotspot)**: Share your IPv4 LAN address
- **Internet (IPv6)**: Share your IPv6 address - both users need IPv6

## How It Works

```
┌─────────────┐     WebSocket     ┌─────────────────┐
│  Your PC    │◄─────────────────►│ Signaling Server│
│  (Browser)  │                   │  (server.js)    │
└──────┬──────┘                   └────────┬────────┘
       │                                   │
       │         WebRTC (Direct P2P)       │
       │◄──────────────────────────────────┤
       │                                   │
┌──────┴──────┐                   ┌────────┴────────┐
│Friend's PC  │◄─────────────────►│                 │
│  (Browser)  │     WebSocket     │                 │
└─────────────┘                   └─────────────────┘
```

1. **Signaling** happens through your server (WebSocket)
2. **Actual chat** goes directly peer-to-peer (WebRTC)
3. Server only helps establish connection, doesn't see messages

## Network Requirements

| Scenario | What You Need |
|----------|---------------|
| Same WiFi/Hotspot | Just run the server, share local IP |
| Internet (Home WiFi) | Port forward 3000 on your router |
| Internet (Mobile Hotspot) | Need IPv6 (Jio 5G has it!) |

### Checking IPv6
```bash
# Windows
curl -6 ifconfig.me

# If you see an address starting with "2" (like 2402:...), you have IPv6!
```

## Tech Stack

- **Backend**: Node.js, `ws` (WebSocket)
- **Frontend**: Vanilla JS, WebRTC
- **Encryption**: Web Crypto API (ECDH + AES-GCM)

## Files

| File | Purpose |
|------|---------|
| `server.js` | WebSocket signaling server |
| `js/localP2P.js` | WebRTC connection manager |
| `js/app.js` | Main application logic |
| `js/crypto.js` | E2E encryption |
| `js/storage.js` | Local storage handling |

## Security 🛡️

- **No central server**: Your server, your rules
- **E2E Encryption**: Messages encrypted before sending
- **Direct P2P**: Chat data never touches the signaling server
- **Local keys**: Private keys stay in your browser

## Troubleshooting

**Connection fails over internet?**
- Check both users have IPv6
- Firewall may be blocking port 3000
- Try disabling Windows Firewall temporarily

**Works on LAN but not internet?**
- Mobile hotspots use CGNAT (blocks incoming IPv4)
- IPv6 is the solution for mobile hotspots

## License

MIT

---

**Built for privacy, powered by WebRTC** 🔐
