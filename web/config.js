// Configuration
const Config = {
    // Signaling server - change this after deploying to Render
    SIGNALING_URL: (() => {
        // Use localhost for development
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
            return `ws://${location.hostname}:8080`;
        }
        // For GitHub Pages, use your deployed Render URL
        // Replace this with your actual Render URL after deployment
        return 'wss://p2p-chat-signaling.onrender.com';
    })(),

    // WebRTC configuration with STUN and TURN servers
    RTC_CONFIG: {
        iceServers: [
            // Google STUN
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            // Free TURN servers (metered.ca - works for small usage)
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    },

    // Limits
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    CHUNK_SIZE: 16 * 1024 // 16KB chunks for file transfer
};
