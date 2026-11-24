const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()

// Vite's dev proxy handles same-origin requests locally; production can point
// directly at Render with VITE_API_URL or serve the API from this same origin.
export const API_BASE = configuredApiUrl ? configuredApiUrl.replace(/\/+$/, '') : window.location.origin
