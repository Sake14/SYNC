import type { RoomMetadata } from "./room-metadata.js"
import { createRoomMetadata } from "./room-metadata.js"

export function createRoomStore() {
    const rooms = new Map<string, RoomMetadata>();

    return rooms
}

export function createRoom(
    rooms: Map<string, RoomMetadata>,
    id: string,
    name: string,
    hostId: string | null,
): RoomMetadata {
    if (rooms.has(id)) {
        throw new Error(`Room with ID ${id} already exists`);
    }
    const room = createRoomMetadata(id, name, hostId);
    rooms.set(id, room);
    return room;
}

export function getRoom(
    rooms: Map<string, RoomMetadata>,
    id: string,
) : RoomMetadata | undefined {
    return rooms.get(id)
}