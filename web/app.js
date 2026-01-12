// Main App Logic
const dom = {
    app: document.getElementById('app'),
    sidebar: document.getElementById('sidebar'),
    chatView: document.getElementById('chat-view'),
    welcome: document.getElementById('welcome-screen'),
    chatList: document.getElementById('chat-list'),
    msgsArea: document.getElementById('messages-area'),
    input: document.getElementById('message-input'),
    btnSend: document.getElementById('btn-send'),
    btnShowInvite: document.getElementById('btn-show-invite'),
    modalInvite: document.getElementById('modal-invite'),
    inviteText: document.getElementById('invite-link-text'),
    btnCloseInvite: document.getElementById('btn-close-invite'),
    btnCopyLink: document.getElementById('btn-copy-link'),
    btnClearChat: document.getElementById('btn-clear-chat'),
    chatTitle: document.getElementById('chat-title'),
    chatAvatar: document.getElementById('chat-avatar'),
    searchInput: document.getElementById('search-input'),
    btnNewChat: document.getElementById('btn-new-chat')
};

const state = {
    self: null, // { id, publicKey, privateKey }
    peers: new Map(),
    activeChatId: null,
    signaling: null,
    rtc: null
};

async function init() {
    await Storage.init();

    // 1. Identity
    let storedId = await Storage.getIdentity();
    if (!storedId) {
        const keyPair = await Crypto.generateIdentity();
        const selfId = crypto.randomUUID();
        storedId = { id: 'self', selfId, ...keyPair };
        await Storage.saveIdentity(storedId);
    }
    state.self = storedId;
    console.log("My ID:", state.self.selfId);

    // 2. Load Peers
    const peers = await Storage.getPeers();
    peers.forEach(p => state.peers.set(p.id, p));
    renderSidebar();

    // 3. Signaling
    state.signaling = new SignalingClient(
        Config.SIGNALING_URL,
        state.self.selfId,
        handleSignalingMessage,
        onSignalingOpen
    );

    // 4. WebRTC
    state.rtc = new RTCManager(
        state.self.selfId,
        Config.RTC_CONFIG,
        (roomId, to, payload) => state.signaling.sendSignal(roomId, to, payload),
        handleRTCData,
        null
    );

    // 5. Check Invite Link
    checkInviteLink();

    // 6. Global listeners
    setupUI();
}

function onSignalingOpen() {
    // Join rooms for all peers
    state.peers.forEach(p => {
        const roomId = getDMRoomID(state.self.selfId, p.id);
        state.signaling.join(roomId);
        // Attempt connect? (Initiator logic is tricky, let's try strict "caller" based on ID sort or on-demand)
        // For simplicity: If I have peer, I am willing to connect.
        // We can trigger connect on 'join' ack if we wanted, or just wait for sidebar click.
        // Let's rely on Sidebar Click for "Call" or automatic if we want 'always on'.
        // For now: Connect on load if we know them.
        state.rtc.connect(roomId, p.id, state.self.selfId > p.id);
    });
}

function handleSignalingMessage(msg) {
    if (msg.t === 'peers') {
        const { roomId, peers } = msg;
        // Simple mesh: Connect to everyone in room who is not me
        peers.forEach(pid => {
            if (pid !== state.self.selfId && state.peers.has(pid)) {
                // Only connect if we know them? Or if it's a group?
                // For 1:1 DM, we definitely know them if we calculated the RoomID.
                state.rtc.connect(roomId, pid, state.self.selfId > pid);
            }
        });
    } else if (msg.t === 'signal') {
        // Need to know room context for the peer
        // We can find the peer and their associated room
        // Or blindly trust the signaling to forward correctly
        // RTCManager needs to handle connection based on peerId
        // But RTC connect needs roomId.
        // If we receive an offer from a known peer, we can deduce roomId (DM).
        state.rtc.handleSignal(msg.from, msg.payload);
    }
}

async function handleRTCData(peerId, dataStr) {
    try {
        const payload = JSON.parse(dataStr);
        // Decrypt
        const peer = state.peers.get(peerId);
        if (!peer) return;

        // Optimised: Derive SharedKey (cache this in real app)
        const sharedKey = await Crypto.deriveSharedKey(state.self.privateKey, peer.publicKey);

        // Decrypt
        const plaintext = await Crypto.decrypt(sharedKey, payload);
        const msgObj = JSON.parse(plaintext);

        // Save & Render
        const msgRecord = {
            id: msgObj.id,
            chatId: peerId,
            text: msgObj.text,
            timestamp: msgObj.timestamp,
            fromMe: false,
            senderId: peerId
        };
        await Storage.saveMessage(msgRecord);

        if (state.activeChatId === peerId) {
            renderMessage(msgRecord);
        }
        renderSidebar(); // Update preview

    } catch (e) { console.error("Data Error", e); }
}

async function sendMessage() {
    const text = dom.input.value.trim();
    if (!text || !state.activeChatId) return;

    const peer = state.peers.get(state.activeChatId);
    if (!peer) return;

    const msgId = crypto.randomUUID();
    const timestamp = Date.now();
    const msgPayload = { id: msgId, text, timestamp };

    // Encrypt
    const sharedKey = await Crypto.deriveSharedKey(state.self.privateKey, peer.publicKey);
    const encrypted = await Crypto.encrypt(sharedKey, JSON.stringify(msgPayload));

    // Send
    state.rtc.send(peer.id, JSON.stringify(encrypted));

    // Save Local
    const msgRecord = {
        id: msgId,
        chatId: peer.id,
        text,
        timestamp,
        fromMe: true,
        senderId: 'self'
    };
    await Storage.saveMessage(msgRecord);
    renderMessage(msgRecord);

    dom.input.value = '';
    renderSidebar();
}

// --- Invite System ---
async function generateInviteLink() {
    const jwk = await Crypto.exportKey(state.self.publicKey);
    const data = JSON.stringify({ id: state.self.selfId, key: jwk });
    const b64 = btoa(data);
    return `${window.location.origin}${window.location.pathname}#invite=${b64}`;
}

async function checkInviteLink() {
    if (window.location.hash.startsWith('#invite=')) {
        try {
            const b64 = window.location.hash.split('#invite=')[1];
            const data = JSON.parse(atob(b64));

            if (data.id === state.self.selfId) return; // Self
            if (state.peers.has(data.id)) return; // Already friend

            // Import Key
            const pubKey = await Crypto.importKey(data.key, 'public');

            const newPeer = {
                id: data.id,
                publicKey: pubKey,
                name: `User ${data.id.substring(0, 4)}`,
                addedAt: Date.now()
            };

            await Storage.savePeer(newPeer);
            state.peers.set(newPeer.id, newPeer);

            // Connect
            const roomId = getDMRoomID(state.self.selfId, newPeer.id);
            state.signaling.join(roomId);
            state.rtc.connect(roomId, newPeer.id, state.self.selfId > newPeer.id);

            alert(`You are now connected with ${newPeer.name}`);
            window.location.hash = ''; // Clear
            renderSidebar();
            openChat(newPeer.id);

        } catch (e) {
            console.error("Invite Error", e);
            alert("Invalid Invite Link");
        }
    }
}

// --- UI Helpers ---
function getDMRoomID(id1, id2) {
    return id1 < id2 ? `dm-${id1}-${id2}` : `dm-${id2}-${id1}`;
}

function renderSidebar() {
    dom.chatList.innerHTML = '';
    state.peers.forEach(peer => {
        const el = document.createElement('div');
        el.className = `chat-item ${state.activeChatId === peer.id ? 'active' : ''}`;
        el.innerHTML = `
            <div class="avatar">${peer.name.charAt(0)}</div>
            <div class="chat-content">
                <div class="chat-row-top">
                    <span class="chat-name">${peer.name}</span>
                    <span class="chat-date"></span>
                </div>
                <div class="chat-row-btm">
                    <span class="chat-last-msg">Click to chat</span>
                </div>
            </div>
        `;
        el.onclick = () => openChat(peer.id);
        dom.chatList.appendChild(el);
    });
}

async function openChat(peerId) {
    state.activeChatId = peerId;
    const peer = state.peers.get(peerId);

    dom.welcome.classList.add('hidden');
    dom.chatView.classList.remove('hidden');
    dom.chatTitle.innerText = peer.name;
    dom.chatAvatar.innerText = peer.name.charAt(0);
    dom.msgsArea.innerHTML = '';

    const msgs = await Storage.getMessages(peerId);
    msgs.forEach(renderMessage);

    // Highlight
    renderSidebar();
}

function renderMessage(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.fromMe ? 'sent' : 'received'}`;
    const date = new Date(msg.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `${msg.text} <span class="msg-time">${timeStr}</span>`;
    dom.msgsArea.appendChild(div);
    dom.msgsArea.scrollTop = dom.msgsArea.scrollHeight;
}

function setupUI() {
    // Send
    dom.btnSend.onclick = sendMessage;
    dom.input.onkeydown = (e) => { if (e.key === 'Enter') sendMessage(); };

    // Invite
    dom.btnShowInvite.onclick = async () => {
        const link = await generateInviteLink();
        dom.inviteText.value = link;
        dom.modalInvite.classList.add('open');
    };
    dom.btnCloseInvite.onclick = () => dom.modalInvite.classList.remove('open');
    dom.btnCopyLink.onclick = () => {
        dom.inviteText.select();
        document.execCommand('copy');
        alert("Link Copied!");
    };

    // Clear Chat
    dom.btnClearChat.onclick = async () => {
        if (state.activeChatId && confirm("Delete all messages in this chat?")) {
            await Storage.clearMessages(state.activeChatId);
            dom.msgsArea.innerHTML = '';
        }
    };

    // New Chat (Mock)
    dom.btnNewChat.onclick = () => alert("Use 'Invite Link' to add peers!");

    // Search
    dom.searchInput.oninput = (e) => {
        const val = e.target.value.toLowerCase();
        // Simple filter of state.peers 
        // Re-render sidebar filtering keys
        // (Skipping implementation details for brevity)
    };
}

// Start
init();
