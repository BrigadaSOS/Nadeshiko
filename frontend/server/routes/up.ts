import { setResponseHeader } from 'h3';

// Liveness only. The frontend's dependency is the backend, but gating this on
// backend reachability would take the whole site down (and restart-loop Nitro)
// during a backend outage, when cached and static pages still render fine.
// Backend health is reported by the backend's own /up.
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store');
  return { status: 'ok' };
});
