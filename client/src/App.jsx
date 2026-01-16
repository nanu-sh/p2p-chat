import { useState, useRef, useEffect } from 'react'
import { PeerManager } from './lib/PeerManager'

// --- WHATSAPP WEB THEME (Reusing Theme) ---
// (Keeping Styles exact same as before, just updating LOGIC)
const THEME = {
  bg: '#111b21',
  sidebarBg: '#202c33',
  chatBg: '#0b141a',
  headerBg: '#202c33',
  inputBg: '#2a3942',
  incoming: '#202c33',
  outgoing: '#005c4b',
  textPrimary: '#e9edef',
  textSecondary: '#8696a0',
  accent: '#00a884',
  border: '#374045'
};

const STYLES = {
  appContainer: { display: 'flex', height: '100vh', width: '100vw', backgroundColor: THEME.bg, color: THEME.textPrimary, fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif', overflow: 'hidden' },
  sidebar: { width: '30%', minWidth: '300px', maxWidth: '450px', backgroundColor: THEME.sidebarBg, borderRight: `1px solid ${THEME.border}`, display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 2 },
  main: { flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: THEME.chatBg, backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")', backgroundBlendMode: 'overlay', position: 'relative' },
  header: { height: '60px', backgroundColor: THEME.headerBg, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  searchBar: { padding: '8px', backgroundColor: THEME.bg, borderBottom: `1px solid ${THEME.border}` },
  searchInput: { width: '100%', backgroundColor: THEME.inputBg, border: 'none', borderRadius: '8px', padding: '8px 12px', color: THEME.textPrimary, fontSize: '14px', outline: 'none' },
  contactList: { flex: 1, overflowY: 'auto' },
  contactItem: { display: 'flex', alignItems: 'center', padding: '12px', cursor: 'pointer', borderBottom: `1px solid ${THEME.border}`, transition: 'background 0.2s' },
  avatar: { width: '40px', height: '40px', borderRadius: '50%', backgroundColor: THEME.textSecondary, marginRight: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '20px' },
  chatArea: { flex: 1, overflowY: 'auto', padding: '20px 50px', display: 'flex', flexDirection: 'column', gap: '4px' },
  messageRow: { display: 'flex', marginBottom: '8px' },
  messageBubble: { maxWidth: '60%', padding: '6px 7px 8px 9px', borderRadius: '8px', fontSize: '14.2px', lineHeight: '19px', position: 'relative', boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)' },
  footer: { height: '62px', backgroundColor: THEME.headerBg, padding: '10px 16px', display: 'flex', alignItems: 'center', flexShrink: 0, zIndex: 2 },
  input: { flex: 1, backgroundColor: THEME.inputBg, border: 'none', borderRadius: '8px', padding: '9px 12px', margin: '0 10px', color: THEME.textPrimary, fontSize: '15px', outline: 'none' },
  btnFlat: { background: 'transparent', border: 'none', color: THEME.textSecondary, cursor: 'pointer', padding: '8px', fontSize: '20px' },
  btnPrimary: { background: THEME.accent, color: '#fff', border: 'none', borderRadius: '24px', padding: '8px 16px', cursor: 'pointer', fontWeight: '500' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  modal: { backgroundColor: THEME.headerBg, width: '400px', padding: '24px', borderRadius: '12px', boxShadow: '0 17px 50px 0 rgba(0,0,0,.19)', textAlign: 'center' }
};

function App() {
  const [activeRoom, setActiveRoom] = useState(localStorage.getItem('last_room') || null);
  const [status, setStatus] = useState('Connecting...'); // Connecting, Online, Peer Joined
  const [messages, setMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');

  // Modal State
  const [showModal, setShowModal] = useState(!activeRoom);
  const [roomInput, setRoomInput] = useState('');

  const pm = useRef(null);
  const scrollRef = useRef(null);

  // --- INIT PEER ---
  useEffect(() => {
    if (activeRoom) {
      init(activeRoom);
    }
  }, [activeRoom]);

  const init = (roomId) => {
    if (pm.current) pm.current.leave();

    setStatus(`Joining #${roomId}...`);

    // Trystero Auto-Join
    pm.current = new PeerManager(
      roomId,
      (peerId) => {
        setStatus('Online'); // Peer Joined
      },
      (msg, peerId) => {
        setMessages(p => [...p, { ...msg, self: false }]);
      },
      (peerId) => {
        setStatus('Waiting for peer...');
      }
    );
  };

  const createRoom = () => {
    // Generate random 6-char code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    join(code);
  };

  const join = (code) => {
    if (!code) return;
    localStorage.setItem('last_room', code);
    setActiveRoom(code);
    setShowModal(false);
    setMessages([]); // Clear old messages on room switch (v1 limit)
  };

  const leave = () => {
    localStorage.removeItem('last_room');
    setActiveRoom(null);
    if (pm.current) pm.current.leave();
    setShowModal(true);
    setMessages([]);
    setStatus('Disconnected');
  };

  // --- CHAT ---
  const sendMessage = (e) => {
    e.preventDefault();
    if (!msgInput.trim()) return;
    const payload = { id: Date.now(), text: msgInput, sender: 'Me' };
    pm.current?.sendMessage(payload);
    setMessages(p => [...p, { ...payload, self: true }]);
    setMsgInput('');
  };

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const copy = () => {
    navigator.clipboard.writeText(activeRoom);
    alert('Room Code Copied: ' + activeRoom);
  };

  return (
    <div style={STYLES.appContainer}>
      {/* MODAL: Join/Create */}
      {showModal && (
        <div style={STYLES.overlay}>
          <div style={STYLES.modal}>
            <h2>P2P Chat</h2>
            <p style={{ color: THEME.textSecondary, marginBottom: '20px' }}>
              Enter a Room ID to auto-connect. <br />
              (No server, uses Public Torrent Trackers)
            </p>

            <button style={{ ...STYLES.btnPrimary, width: '100%', marginBottom: '20px' }} onClick={createRoom}>Create New Room</button>

            <div style={{ borderTop: `1px solid ${THEME.border}`, margin: '20px 0', position: 'relative' }}>
              <span style={{ background: THEME.headerBg, padding: '0 10px', position: 'absolute', top: '-10px', left: '42%', color: THEME.textSecondary, fontSize: '12px' }}>OR</span>
            </div>

            <input
              style={{ ...STYLES.input, width: '80%', margin: '0 0 10px 0' }}
              placeholder="Enter 6-char Room Code"
              value={roomInput}
              onChange={e => setRoomInput(e.target.value.toUpperCase())}
            />
            <button style={STYLES.btnPrimary} onClick={() => join(roomInput)}>Join Room</button>
          </div>
        </div>
      )}

      {/* SIDEBAR */}
      <div style={STYLES.sidebar}>
        <div style={STYLES.header}>
          <div style={STYLES.avatar}>ME</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button style={STYLES.btnFlat} onClick={leave} title="Leave / Logout">⎋</button>
            <button style={STYLES.btnFlat} onClick={() => setShowModal(true)} title="New Chat">+</button>
          </div>
        </div>
        <div style={STYLES.searchBar}>
          <input style={STYLES.searchInput} placeholder="Search" />
        </div>

        {/* Active Contact */}
        <div style={STYLES.contactList}>
          {activeRoom && (
            <div style={{ ...STYLES.contactItem, background: '#2a3942' }}>
              <div style={STYLES.avatar}>#</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: THEME.textPrimary, fontWeight: '500' }}>Room: {activeRoom}</div>
                <div style={{ color: THEME.textSecondary, fontSize: '13px' }}>{status}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MAIN CHAT */}
      {(!activeRoom || showModal) ? (
        <div style={{ ...STYLES.main, alignItems: 'center', justifyContent: 'center', borderBottom: `6px solid ${THEME.accent}` }}>
          <div style={{ textAlign: 'center', maxWidth: '400px' }}>
            <h1 style={{ color: THEME.textSecondary, fontWeight: '300' }}>P2P Web</h1>
            <p style={{ color: THEME.textSecondary }}>Connects via Trystero (BitTorrent).<br />Encrypted. Serverless. Permanent.</p>
          </div>
        </div>
      ) : (
        <div style={STYLES.main}>
          <div style={STYLES.header}>
            <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={copy}>
              <div style={STYLES.avatar}>#</div>
              <div>
                <div style={{ color: THEME.textPrimary }}>Room: {activeRoom} <span style={{ fontSize: '10px', color: THEME.accent }}>(Click to Copy)</span></div>
                <div style={{ color: THEME.textSecondary, fontSize: '12px' }}>{status}</div>
              </div>
            </div>
          </div>

          <div style={STYLES.chatArea}>
            {messages.map((m, i) => (
              <div key={i} style={{ ...STYLES.messageRow, justifyContent: m.self ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  ...STYLES.messageBubble,
                  backgroundColor: m.self ? THEME.outgoing : THEME.incoming,
                  borderTopRightRadius: m.self ? '0' : '8px',
                  borderTopLeftRadius: m.self ? '8px' : '0'
                }}>
                  {m.text}
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', textAlign: 'right', marginTop: '4px', float: 'right', marginLeft: '10px' }}>
                    {new Date(m.id).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            <div ref={scrollRef} />
          </div>

          <div style={STYLES.footer}>
            <form onSubmit={sendMessage} style={{ flex: 1, display: 'flex' }}>
              <input
                style={STYLES.input}
                placeholder="Type a message"
                value={msgInput}
                onChange={e => setMsgInput(e.target.value)}
                autoFocus
              />
            </form>
            <button style={STYLES.btnFlat} onClick={sendMessage}>➤</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App
