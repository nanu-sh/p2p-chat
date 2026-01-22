# P2P Chat 🔒

A secure, serverless, peer-to-peer chat application with voice calls, built with vanilla JS and Trystero.

![P2P Chat Screenshot](./screenshot.png)

## Features ✨

- **Serverless & Private**: 100% P2P using WebRTC (via [Trystero](https://github.com/dmotz/trystero) / Nostr). No central server stores your data.
- **E2E Encryption**: Messages are encrypted using AES-GCM with ECDH key exchange. Keys never leave your device.
- **Voice Calls**: Secure P2P voice calls with Mute, Accept, and Decline functionality.
- **Persistent Logic**: Identity and messages saved locally in your browser's `localStorage`.
- **WhatsApp-like UI**: Familiar, responsive design that works on desktop and mobile.
- **Contact Sharing**: Share your Session ID to connect. Scan QR codes (coming soon).

## Tech Stack 🛠️

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+)
- **P2P Networking**: [Trystero](https://github.com/dmotz/trystero) (Nostr strategy)
- **Encryption**: Web Crypto API (ECDH, HKDF, AES-GCM)
- **Styling**: Custom CSS (WhatsApp Web clone)

## Getting Started 🚀

### Prerequisites
- A modern web browser (Chrome, Firefox, Edge, Safari)
- NodeJS (optional, for local dev server)

### Installation

1. **Clone the repo**
   ```bash
   git clone https://github.com/YOUR_USERNAME/p2pchat.git
   cd p2pchat
   ```

2. **Run locally**
   You just need a static file server.
   
   Using Python:
   ```bash
   python -m http.server 3000
   ```
   
   Using Node/npx:
   ```bash
   npx serve .
   ```

3. **Open in Browser**
   Visit `http://localhost:3000`

## Usage 📱

1. **Setup**: Enter a nickname to generate your cryptographic identity.
2. **Connect**: 
   - Copy your **Session ID** from the sidebar.
   - Send it to a friend.
   - Click the **+** button and paste their Session ID.
3. **Chat**: Text and emojis are fully encrypted.
4. **Call**: Click the phone icon 📞 to start a secure voice call.

## Security 🛡️

- **Identity**: Generated locally using `crypto.subtle`.
- **Encryption**: 
  - ECDH (P-256) for shared secret derivation.
  - AES-GCM (256-bit) for message encryption.
- **Storage**: Private keys stored in `localStorage` (clearing browser data wipes your account).

## License
MIT
