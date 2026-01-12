# P2P Encrypted Chat (WhatsApp-like)

A persistent-identity, ephemeral-messaging P2P chat application built with Vanilla JS, WebRTC, and WebCrypto.

## Architecture

1.  **Transport**: P2P via WebRTC DataChannels (Mesh topology for groups).
2.  **Signaling**: Stateless Node.js WebSocket server (routes messages, does not store them).
3.  **Storage**: IndexedDB for **Identity & Contacts ONLY**. Messages are **never** stored (ephemeral in-memory).
4.  **Encryption**:
    *   **Identity**: ECDH P-256 Key Pairs.
    *   **1:1 Chat**: ECDH + HKDF -> AES-GCM (256-bit).
    *   **Group Chat**: Random AES-GCM Group Key, distributed via 1:1 channels (Wrapped).
    *   **Verification**: Fingerprint comparison (SHA-256 of Public Keys).

## Threat Model & Security

*   **End-to-End Encrypted**: All chat content is encrypted before leaving the browser. The signaling server sees only opaque blobs.
*   **Ephemeral**: Messages effectively "self-destruct" on page refresh. No residual logs on disk.
*   **Metadata Leakage**: The signaling server knows *who* is talking to *whom* (Peer IDs and connection times). WebRTC reveals IP addresses to peers (unless TURN is strictly enforced/proxied, currently using public STUN).
*   **Trust on First Use (TOFU)**: You must exchange Public Keys ID strings securely out-of-band (e.g. paste into the "Add Contact" modal). If an attacker intercepts this exchange, they could MITM. Use the "Fingerprint" verification to confirm keys.

## Running Locally

### 1. Signaling Server
```bash
cd signaling
npm install
npm start
# Runs on Port 8080
```

### 2. Frontend
You can serve the `web` folder with any static server.
```bash
# Example using python
cd web
python3 -m http.server 3000
```
Open `http://localhost:3000` in two different browser windows (or Incognito).

## Deployment (GitHub Pages)

1.  **Deploy Frontend**:
    *   Push the `/web` folder to a GitHub repository.
    *   Enable GitHub Pages for that repository (Source: /web).
2.  **Deploy Signaling**:
    *   Deploy the `/signaling` folder to a Node.js host (Render, Fly.io, Heroku).
    *   **Important**: It must support **WSS** (Secure WebSockets) to work with HTTPS GitHub Pages.
    *   Update `web/config.js` with your new `SIGNALING_URL`.

## Usage Guide
1.  **First Run**: The app generates a unique ID and Key Pair.
2.  **Share ID**: Open Console (`Ctrl+Shift+J`) and run `getMyShareBlob()` to get your JSON connection string.
3.  **Add Contact**: Click "+" and paste the blob from your friend.
4.  **Chat**: Messages are sent P2P. Green = Encrypted.
5.  **Voice**: Click the Phone icon to start a WebRTC audio track call.

## Browser Support
Requires modern browsers with support for:
*   WebRTC (DataChannel + MediaStream)
*   WebCrypto (ECDH, HKDF, AES-GCM)
*   ES6 Modules
*   Tested on Chrome 120+, Firefox 120+
