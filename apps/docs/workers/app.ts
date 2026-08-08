import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "../app/cloudflare-context";
import { handleUpdateRequest } from "./update-api";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const updateResponse = await handleUpdateRequest(request, env);
    if (updateResponse) return updateResponse;
    const loadContext = new RouterContextProvider();
    loadContext.set(cloudflareContext, { env, ctx });
    return requestHandler(request, loadContext);
  },
} satisfies ExportedHandler<Env>;
