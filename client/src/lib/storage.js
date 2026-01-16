// Local Persistence for P2P Rooms
const KEY = "p2p_rooms_v1";

export function loadRooms() {
    try {
        return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
        return [];
    }
}

export function saveRoom(room) {
    // room: { roomId, name, created: Date.now() }
    const rooms = loadRooms();
    if (rooms.some(r => r.roomId === room.roomId)) return; // No dups

    const newRooms = [room, ...rooms];
    localStorage.setItem(KEY, JSON.stringify(newRooms));
}

export function forgetRoom(roomId) {
    const rooms = loadRooms().filter(r => r.roomId !== roomId);
    localStorage.setItem(KEY, JSON.stringify(rooms));
}
