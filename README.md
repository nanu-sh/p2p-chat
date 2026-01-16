# P2P Session Chat

A private, ephemeral P2P chat application inspired by Session Messenger.

- **🔒 Safe**: End-to-End Encrypted (AES-GCM 256-bit).
- **💸 Free**: Free to use, free to host.
- **⚡ Fast**: Direct P2P connection via WebRTC.
- **Session ID**: Your identity is your Key. No phone numbers, no specific servers required.

## 🚀 How to use over the Internet (Free, Safe, Encrypted)

To chat securely over the internet, you need a **Signaling Server** to introduce peers. You can host this for free.

### Option 1: One-Click Public Server (Recommended)
Deploy the Signaling Server to Render for free.

1.  **Fork** this repo to your GitHub.
2.  **Sign up** for [Render](https://render.com) (Free).
3.  **New Web Service** -> Connect your GitHub repo.
4.  Render will auto-detect the `p2p-chat-signaling` folder config.
5.  **Deploy**.
6.  Render will give you a URL (e.g., `https://my-chat.onrender.com`).
    *   Change `https` to `wss`.
    *   Enter this as the **Signaling Server** in the app's "Advanced" settings.

### Option 2: Temporary Tunnel (For Testing)
Use `localtunnel` to expose your computer's server for a quick chat.

1.  Start local server: `cd signaling && npm start`.
2.  Start tunnel: `npx localtunnel --port 8080`.
3.  Use the `wss://...` URL it gives you.

## 🛡️ Security Details

-   **Encryption**: All messages are encrypted **on your device** using your recipient's Public Key before they are sent.
-   **No Logs**: The signaling server only blindly forwards encrypted "blobs". It cannot read your messages.
-   **No Storage**: Messages are never saved to a database. They exist only in your browser's memory.
-   **Verification**: Compare the **Session ID** (top left) with your friend to ensure no one is intercepting the chat.

## 💻 Local Development

1.  `cd signaling && npm start`
2.  `cd web && python -m http.server 3000`
3.  Open `http://localhost:3000`
