const configuredOrigins = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

export const allowedClientOrigins = configuredOrigins
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)
