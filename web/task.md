# P2P Chat Rebuild - Task Checklist

## Storage Layer
- [ ] Revamp `storage.js` - contacts, groups, identity only (no messages)
- [ ] Add group storage schema

## Core App Logic
- [ ] Fix infinite init() loop bug
- [ ] Implement auto-connect to all saved contacts on load
- [ ] Add online status tracking per contact
- [ ] Implement 1:1 personal chat (select contact → chat)
- [ ] Implement group chat (select group → chat)

## Features
- [ ] Voice calls (WebRTC audio)
- [ ] Media sharing (chunked file transfer, max 10MB)

## Reliability
- [ ] Add TURN servers to config
- [ ] Handle reconnection gracefully

## UI
- [ ] Contact list with online indicators
- [ ] Group list
- [ ] Add contact modal (paste Session ID)
- [ ] Create group modal (select contacts)
- [ ] Active chat view (personal or group)
- [ ] Call UI (simple)

## Deployment
- [ ] Deploy signaling server to Render
- [ ] Test with friends
