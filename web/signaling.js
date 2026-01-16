// Signaling client - Simple WebSocket wrapper

class SignalingClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.myId = null;
        this.handlers = {};
        this.rooms = new Set();
    }

    connect(myId) {
        this.myId = myId;
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log('[WS] Connected');
            // Rejoin all rooms
            for (const room of this.rooms) {
                this._send({ t: 'join', room, id: this.myId });
            }
            this._emit('open');
        };

        this.ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                this._emit(msg.t, msg);
            } catch (err) {
                console.error('[WS] Parse error:', err);
            }
        };

        this.ws.onclose = () => {
            console.log('[WS] Disconnected, reconnecting in 3s...');
            this._emit('close');
            setTimeout(() => this.connect(this.myId), 3000);
        };

        this.ws.onerror = (err) => {
            console.error('[WS] Error:', err);
        };
    }

    join(room) {
        this.rooms.add(room);
        this._send({ t: 'join', room, id: this.myId });
    }

    leave(room) {
        this.rooms.delete(room);
        this._send({ t: 'leave', room, id: this.myId });
    }

    send(room, to, data) {
        this._send({ t: 'signal', room, from: this.myId, to, data });
    }

    on(event, handler) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
    }

    _emit(event, data) {
        const handlers = this.handlers[event] || [];
        handlers.forEach(h => h(data));
    }

    _send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }
}
