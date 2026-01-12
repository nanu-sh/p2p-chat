class SignalingClient {
    constructor(url, selfId, onMessage, onOpen) {
        this.url = url;
        this.selfId = selfId;
        this.onMessage = onMessage;
        this.onOpen = onOpen;
        this.ws = null;
        this.reconnectDelay = 1000;
        this.connect();
    }

    connect() {
        console.log("Connecting to signaling...");
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log("Signaling Connected");
            this.reconnectDelay = 1000;
            if (this.onOpen) this.onOpen();
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.onMessage(data);
            } catch (e) { console.error("Signaling msg error", e); }
        };

        this.ws.onclose = () => {
            console.log("Signaling Disconnected. Reconnecting...");
            setTimeout(() => this.connect(), this.reconnectDelay);
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
        };
    }

    join(roomId) {
        this.send({ t: 'join', roomId, selfId: this.selfId });
    }

    sendSignal(roomId, to, payload) {
        this.send({ t: 'signal', roomId, to, payload });
    }

    send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }
}
