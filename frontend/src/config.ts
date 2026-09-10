// Set VITE_API_URL and VITE_ADMIN_KEY in a .env file (see .env.example).
// VITE_API_URL is the API Gateway endpoint printed as a CDK output after
// `cdk deploy`. VITE_ADMIN_KEY must match the adminApiSecret passed to
// that same deploy — only used by the compose tool (main.ts), not exposed publicly.
export const API_URL = import.meta.env.VITE_API_URL as string;
export const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY as string;
