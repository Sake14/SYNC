import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { parseConfig } from "./config.js";
import { createServer } from "./server.js";
import { loadCatalog } from "./catalog/catalog.js";
import { RoomManager } from "./rooms/room-manager.js";
import { UploadStore } from "./uploads/upload-store.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const config = parseConfig(process.env);
const catalog = await loadCatalog(config.mediaDir);
const uploads=new UploadStore(config.uploads); await uploads.prepare();await uploads.sweep(()=>false);
const server = createServer(config, new RoomManager({ ...config.rooms, getTrackDuration: (id) => catalog.duration(id) }), catalog, uploads);
server.httpServer.on("error", (error: NodeJS.ErrnoException) => {
  console.error(`Server failed to listen (${error.code ?? "UNKNOWN"})`);
  process.exitCode = 1;
});
server.httpServer.listen(config.port, config.host, () => {
  console.info(`API listening on http://${config.host}:${config.port}`);
});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    void server.close().then(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
  });
}
