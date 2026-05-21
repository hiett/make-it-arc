/// <reference path="../arc/types/src/index.d.ts" />

import { createKaitoHandler } from "@kaito-http/core";
import { getContext, router } from "./context.ts";

async function doTheThing() {
  const base = router()
    .get("/", async (req) => {
      Arc.log("Running /");
      return {
        hello: "world",
      };
    })
    .get("/goodbye", async (req) => {
      Arc.log("Running /goodbye");
      return {
        something: "goodbye",
      };
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

  const url = new URL("https://google.com/goodbye");
  Arc.log(url);
  Arc.log(JSON.stringify(url));
  Arc.log("path", url.pathname);

  const request = new Request({
    url: "https://google.com",
    method: "GET",
  });
  Arc.log("/ Request:", request);
  Arc.log("/ Response:", await handle(request));

  const request2 = new Request({
    url: "https://google.com/goodbye",
    method: "GET",
  });
  Arc.log("/goodbye Request:", request2);
  try {
    Arc.log("/goodbye Response:", await handle(request2));
  } catch (e: any) {
    Arc.log("/goodbye ERROR:", e && e.message, "stack:", e && e.stack);
  }
}

doTheThing().then(() => {
  Arc.log("Done running.");
});
