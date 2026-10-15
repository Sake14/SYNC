import type { MusicProvider } from "@sync/shared";
import { MusicCatalog } from "../catalog/catalog.js";
import type { RoomManager } from "../rooms/room-manager.js";
import { LocalMusicProvider } from "./local-music-provider.js";
import { ZvukMusicProvider } from "./zvuk-music-provider.js";

export type MusicProviders = { local: MusicProvider; zvuk: MusicProvider };
export function createMusicProviders(catalog: MusicCatalog, rooms?: RoomManager): MusicProviders {
  return {
    local: new LocalMusicProvider(catalog, rooms ? scope => rooms.getSnapshot(scope.connectionId, { roomId: scope.roomId }).room.library : undefined),
    // No endpoint/token/enable flag: the researched unofficial clients are not used.
    zvuk: new ZvukMusicProvider(),
  };
}
