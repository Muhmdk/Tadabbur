/** Browser URLs for the separate local backend or a same-origin HTTPS proxy. */
export function resolveEndpoints(
  pageUrl: string,
  configured: { api?: string; ws?: string; join?: string } = {},
): { api: string; ws: string; join: string } {
  const page = new URL(pageUrl);
  const secure = page.protocol === "https:";
  const backendHost = secure ? page.host : `${page.hostname}:8000`;
  return {
    api: configured.api || `${page.protocol}//${backendHost}`,
    ws: configured.ws || `${secure ? "wss:" : "ws:"}//${backendHost}`,
    join: configured.join || page.origin,
  };
}

export function browserEndpoints(): { api: string; ws: string; join: string } {
  return resolveEndpoints(window.location.href, {
    api: process.env.NEXT_PUBLIC_API_BASE_URL || window.location.origin,
    ws: process.env.NEXT_PUBLIC_WS_BASE_URL || window.location.origin.replace(/^http/, "ws"),
    join: window.location.protocol === "https:" ? window.location.origin : process.env.NEXT_PUBLIC_JOIN_BASE_URL,
  });
}
