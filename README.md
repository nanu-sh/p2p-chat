# P2P Chat 🔒

A secure, serverless, peer-to-peer chat application with voice calls, file sharing, and typing indicators. Built with vanilla JS and Trystero.

## [🌐 Live Demo](https://nanu-sh.github.io/p2p-chat/)

Try it now: **https://nanu-sh.github.io/p2p-chat/**

---

## Features ✨

### Core Features
- 🔒 **Serverless & Private**: 100% P2P using WebRTC (via [Trystero](https://github.com/dmotz/trystero) / Nostr). No central server stores your data.
- 🔐 **E2E Encryption**: Messages encrypted using AES-GCM with ECDH key exchange. Keys never leave your device.
- 📞 **Voice Calls**: Secure P2P voice calls with Mute, Accept, and Decline functionality.
- 💾 **Persistent Storage**: Identity and messages saved locally in your browser's `localStorage`.
- 🎨 **WhatsApp-like UI**: Familiar dark theme, responsive design for desktop and mobile.

### New Features
- 📎 **File Attachments**: Share images, documents, videos with chunked P2P transfer
- 🎤 **Voice Notes**: Record and send audio messages with one click
- 🗑️ **Delete Messages**: Remove individual messages (yours or theirs) one by one
- 🔌 **Disconnect/Reconnect**: Temporarily disconnect without losing chat history
- ⌨️ **Typing Indicators**: See when your contact is typing in real-time
- 🖼️ **Image Previews**: Images display inline with click-to-expand

## Tech Stack 🛠️

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+)
- **P2P Networking**: [Trystero](https://github.com/dmotz/trystero) (Nostr strategy)
- **Encryption**: Web Crypto API (ECDH, HKDF, AES-GCM)
- **File Transfer**: Base64-encoded chunking (8KB chunks)
- **Voice**: MediaRecorder API for audio capture
- **Styling**: Custom CSS (WhatsApp Web-inspired dark theme)

## Getting Started 🚀

### Quick Start
Just visit **https://nanu-sh.github.io/p2p-chat/** - no installation needed!

### Local Development

**Prerequisites:**
- A modern web browser (Chrome, Firefox, Edge, Safari)
- Node.js (optional, for local dev server)

**Installation:**

1. Clone the repo:
   ```bash
   git clone https://github.com/nanu-sh/p2p-chat.git
   cd p2p-chat
   ```

2. Run a local server:
   
   Using npx:
   ```bash
   npx serve . -l 3000
   ```
   
   Or Python:
   ```bash
   python -m http.server 3000
   ```

3. Open in browser:
   ```
   http://localhost:3000
   ```

## Usage 📱

### Getting Started
1. **Setup**: Enter a nickname to generate your cryptographic identity
2. **Connect**: 
   - Copy your **Session ID** from the sidebar
   - Send it to a friend
   - Click the **+** button and paste their Session ID
3. **Chat**: All messages are E2E encrypted automatically

### Features Guide
- 📞 **Voice Call**: Click phone icon to start a call
- 📎 **Send File**: Click paperclip icon, select file
- 🎤 **Voice Note**: Click mic icon, record, click again to send
- �️ **Delete Message**: Hover over any message, click trash icon
- 🔌 **Disconnect**: Click disconnect button to temporarily leave room
- ⌨️ **Typing Status**: Automatically shows when peer is typing

## Security 🛡️

- **Identity**: Generated locally using `crypto.subtle`, never sent to servers
- **Encryption**: 
  - ECDH (P-256) for shared secret derivation
  - HKDF for key derivation
  - AES-GCM (256-bit) for message encryption
- **Storage**: Private keys stored in `localStorage` (clearing browser data wipes your account)
- **P2P Only**: Direct peer connections, no server intermediary for messages

## Architecture

- **Signaling**: Nostr relays (via Trystero) for WebRTC connection setup only
- **Data Transfer**: Direct P2P via WebRTC data channels
- **File Chunking**: Large files split into 8KB base64 chunks for reliable transfer
- **Typing Indicators**: Real-time signals with 3-second debounce

## Contributing

Contributions welcome! Feel free to open issues or submit PRs.

## License

MIT

---

**Built with ❤️ using vanilla JavaScript and WebRTC**
