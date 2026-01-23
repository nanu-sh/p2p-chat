// Storage utilities - localStorage wrapper

const Storage = {
    // Keys
    IDENTITY_KEY: 'p2p_identity',
    CONTACTS_KEY: 'p2p_contacts',
    MESSAGES_KEY: 'p2p_messages',

    // Identity
    getIdentity() {
        const data = localStorage.getItem(this.IDENTITY_KEY);
        return data ? JSON.parse(data) : null;
    },

    saveIdentity(identity) {
        localStorage.setItem(this.IDENTITY_KEY, JSON.stringify(identity));
    },

    // Contacts
    getContacts() {
        const data = localStorage.getItem(this.CONTACTS_KEY);
        return data ? JSON.parse(data) : {};
    },

    saveContacts(contacts) {
        localStorage.setItem(this.CONTACTS_KEY, JSON.stringify(contacts));
    },

    addContact(sessionId, name) {
        const contacts = this.getContacts();
        contacts[sessionId] = {
            name,
            publicKey: null,
            keyFingerprint: null,
            verified: false,
            keyChanged: false,
            lastSeen: null,
            addedAt: Date.now()
        };
        this.saveContacts(contacts);
        return contacts[sessionId];
    },

    updateContact(sessionId, data) {
        const contacts = this.getContacts();
        if (contacts[sessionId]) {
            Object.assign(contacts[sessionId], data);
            this.saveContacts(contacts);
        }
    },

    deleteContact(sessionId) {
        const contacts = this.getContacts();
        delete contacts[sessionId];
        this.saveContacts(contacts);
        // Also delete messages
        this.deleteMessages(sessionId);
    },

    // Messages
    getMessages(contactId) {
        const all = localStorage.getItem(this.MESSAGES_KEY);
        const messages = all ? JSON.parse(all) : {};
        return messages[contactId] || [];
    },

    saveMessage(contactId, message) {
        const all = localStorage.getItem(this.MESSAGES_KEY);
        const messages = all ? JSON.parse(all) : {};
        if (!messages[contactId]) messages[contactId] = [];
        messages[contactId].push(message);
        localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(messages));
    },

    deleteMessages(contactId) {
        const all = localStorage.getItem(this.MESSAGES_KEY);
        const messages = all ? JSON.parse(all) : {};
        delete messages[contactId];
        localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(messages));
    },

    deleteMessageByIndex(contactId, index) {
        const all = localStorage.getItem(this.MESSAGES_KEY);
        const messages = all ? JSON.parse(all) : {};
        if (messages[contactId] && messages[contactId][index] !== undefined) {
            messages[contactId].splice(index, 1);
            localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(messages));
            return true;
        }
        return false;
    },

    // Clear all (for debugging)
    clearAll() {
        localStorage.removeItem(this.IDENTITY_KEY);
        localStorage.removeItem(this.CONTACTS_KEY);
        localStorage.removeItem(this.MESSAGES_KEY);
    }
};

export default Storage;
