import path from 'node:path';
import process from 'node:process';

const envFile = path.resolve(import.meta.dirname, '..', '.env.dev');
try { process.loadEnvFile(envFile); } catch { /* DEV env file is optional. */ }
process.env.HDDT_PORT = '8288';
process.env.HDDT_FIXED_PORT = '1';
process.env.HDDT_BIND_HOST = '0.0.0.0';
process.env.HDDT_NO_OPEN_BROWSER = '1';
if (!process.env.HDDT_ADMIN_TOKEN && process.env.HDDT_ADMIN_TOKEN_DEV) process.env.HDDT_ADMIN_TOKEN = process.env.HDDT_ADMIN_TOKEN_DEV;
if (!process.env.HDDT_CONNECTOR && process.env.HDDT_CONNECTOR_DEV) process.env.HDDT_CONNECTOR = process.env.HDDT_CONNECTOR_DEV;

await import('./dev.mjs');
