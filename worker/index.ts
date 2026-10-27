import { api } from "../server/research.mjs";
import { deliverDailyDrafts } from "../server/mailbox.mjs";
import centered from "../content/index.html?raw";
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async scheduled(controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(deliverDailyDrafts(env));
  },
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const result = await api(request, env);
    if (result) return result;
    const path = new URL(request.url).pathname;
    if (path === '/split.html') {
      const target = new URL(request.url);
      target.pathname = '/';
      return Response.redirect(target.href, 308);
    }
    if (path === '/' || path === '/index.html') return new Response(centered, {headers:{'Content-Type':'text/html; charset=utf-8'}});
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};

export default worker;
