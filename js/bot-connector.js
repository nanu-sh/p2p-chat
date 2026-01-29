
// Bot Connector - Connects P2P Chat to Local Gateway
// This runs in the browser and talks to ws://localhost:3000

const GATEWAY_URL = 'ws://localhost:3000';
let ws;

export const BotConnector = {
    init() {
        this.connect();
    },

    connect() {
        ws = new WebSocket(GATEWAY_URL);

        ws.onopen = () => {
            console.log('[Bot] Connected to Gateway');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'reply') {
                this.handleReply(data);
            }
        };

        ws.onclose = () => {
            console.log('[Bot] Disconnected. Retrying in 5s...');
            setTimeout(() => this.connect(), 5000);
        };
    },

    // Send a message to the AI Gateway
    sendToGateway(text) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('[Bot] Gateway not connected');
            return;
        }

        ws.send(JSON.stringify({
            type: 'message',
            chatId: 'ai-assistant', // Fixed ID for the dedicated chat
            userId: 'user',        // User is just 'user' to the bot
            userName: 'User',
            text: text
        }));
    },

    // Handle reply from Gateway -> Send to P2P UI
    handleReply(data) {
        console.log('[Bot] Reply from Gateway:', data);
        if (window.App && window.App.receiveAiMessage) {
            window.App.receiveAiMessage(data.text);
        }
    }
};
