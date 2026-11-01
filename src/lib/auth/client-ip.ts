/**
 * The visitor's IP for rate limits and the security log.
 *
 * X-Forwarded-For is "client, proxy1, proxy2": anything on the left can be typed by the visitor, only
 * the entries added by our own reverse proxies can be trusted. With `hops` trusted proxies in front of
 * the app (default 1: one nginx / Caddy / IIS), the real client is the hops-th entry from the right.
 * Run the app behind exactly that many proxies (docs/PLAN.md §11); with hops = 0 the header is ignored.
 */
export function clientIp(forwardedFor: string | null | undefined, hopsSetting: string | undefined): string | null {
  const hops = hopsSetting === undefined || hopsSetting === "" ? 1 : Number(hopsSetting);
  if (!Number.isInteger(hops) || hops <= 0 || !forwardedFor) return null;
  const list = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
  const ip = list[list.length - hops];
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}
