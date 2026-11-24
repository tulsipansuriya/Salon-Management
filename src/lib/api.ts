const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()

// In local development, Vite proxies /api and /socket.io to the Express server.
// Production deployments provide the public Render URL through VITE_API_URL.
export const API_BASE = configuredApiUrl ? configuredApiUrl.replace(/\/+$/, '') : ''
