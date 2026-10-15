export type RoomMetadata = {
    id: string;
    name: string;
    hostId: string | null;
    createdAt: number;
}

export function createRoomMetadata(
    id: string,
    name: string,
    hostId: string | null,
): RoomMetadata {
    return {
        id,
        name,
        hostId,
        createdAt: Date.now(),
    }
}