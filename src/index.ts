/// <reference path="../arc/types/src/index.d.ts" />

import { createKaitoHandler } from "@kaito-http/core";
import { getContext, router } from "./context.ts";
import { serverRenderReact } from "./test-component.tsx";

type Message = {
  path: string;
};
type Context = {};

type DanceSystem = {
  emit: (data: any) => void;
};
declare const Dance: DanceSystem;

function makeKaito() {
  const base = router()
    .get("/", async (req) => {
      return {
        hello: "world",
      };
    })
    .get("/goodbye", async (req) => {
      return {
        something: "goodbye",
      };
    })
    .get("/react", async (req) => {
      return new Response(serverRenderReact(), {
        headers: {
          "Content-Type": "text/plain",
        },
      });
    });

  const handle = createKaitoHandler({
    router: base,
    getContext,
    async onError(err) {
      return {
        status: 500,
        message: "Cooked!",
      };
    },
  });

  return handle;
}

let cachedKaito: ReturnType<typeof makeKaito> | null = null;

function getKaito() {
  if (cachedKaito) {
    return cachedKaito;
  }

  return (cachedKaito = makeKaito());
}

export async function receive(message: string, context: Context) {
  Dance.emit("Good morning all, let's get this show on the road...");
  const handle = getKaito();

  const path = message || "/";
  const request = new Request({
    url: `https://google.com${path}`,
    method: "GET",
  });
  Dance.emit(`${path} Request:` + JSON.stringify(request));
  Dance.emit(`${path} Response:` + JSON.stringify(await handle(request)));
}
