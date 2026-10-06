import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MidnightRoom } from "./room.js";

const port = Number(process.env.PORT) || 2567;
const httpServer = createServer();
const clientDist = fileURLToPath(new URL("../../client/dist/", import.meta.url));

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
  express: (app) => {
    app.get("/", (_request: unknown, response: { sendFile: (path: string) => void }) => {
      response.sendFile(join(clientDist, "index.html"));
    });
    app.get(
      "/assets/:filename",
      (
        request: { params: { filename: string } },
        response: {
          sendFile: (path: string) => void;
          status: (code: number) => { end: () => void };
        },
      ) => {
        const filename = request.params.filename;
        if (!/^[A-Za-z0-9_.-]+$/.test(filename)) {
          response.status(400).end();
          return;
        }
        response.sendFile(join(clientDist, "assets", filename));
      },
    );
    app.get("/health", (
      _request: unknown,
      response: { json: (body: { ok: boolean; game: string }) => void },
    ) => {
      response.json({ ok: true, game: "MIDNIGHT: THE LAST TEN MINUTES" });
    });
  },
});
gameServer.define("midnight", MidnightRoom);
gameServer.listen(port);

console.log(`MIDNIGHT room server listening on http://0.0.0.0:${port}`);
