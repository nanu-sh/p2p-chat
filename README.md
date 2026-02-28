# P2P Chat

A secure, open-source peer-to-peer chat application. It provides end-to-end encrypted messaging, file sharing, and voice calls directly between browsers, using a lightweight Node.js signaling server to establish the initial connection.

## Features

- **End-to-End Encryption**: Messages and files are encrypted client-side using AES-GCM-256 with ECDH key exchange. The server never sees your content.
- **Direct P2P**: Once connected, all data flows directly between peers via WebRTC data channels.
- **File Sharing**: Securely send images, documents, and videos of any size.
- **Voice Calls & Notes**: High-quality WebRTC audio streaming and recordable voice notes.
- **Frictionless Connect**: Easily connect using short 6-character connection codes or shareable invite links (`?peer=ID`).
- **Offline Queuing**: Messages queue locally and send automatically when the peer reconnects.
- **Progressive Web App (PWA)**: Installable on desktop and mobile for native-like access.

## Quick Start

### 1. Requirements
- [Node.js](https://nodejs.org/) (v16+)
- A modern web browser

### 2. Run the Signaling Server
The server is only used to broker the initial WebRTC connection.
```bash
npm install
npm start
```

### 3. Connect
1. Open `http://localhost:3000` in your browser.
2. Enter a display name.
3. Share your 6-character connection code, or copy the invite link.
4. (Optional) To connect over the internet, expose port `3000` via [ngrok](https://ngrok.com/), [Cloudflare Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), or use direct IPv6.

## Architecture & Security

- **Signaling**: Express + PeerJS Server (`server.js`)
- **Transport**: WebRTC Data Channels (PeerJS)
- **Encryption**: Web Crypto API
  - Key Exchange: ECDH P-256
  - Key Derivation: HKDF-SHA256
  - Content Encryption: AES-GCM-256
- **Storage**: IndexedDB (Files/Media) and `localStorage` (Keys/Messages/Identity)

*Note: Private keys are stored in the browser's `localStorage` as JWKs. For production deployments handling highly sensitive data, consider migrating to `extractable: false` Web Crypto keys.*

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (No frameworks)
- **Backend (Signaling)**: Node.js, Express, PeerJS Server

## License
MIT
