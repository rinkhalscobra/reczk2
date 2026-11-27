import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const marketApiDevPlugin = (mode: string): Plugin => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const allowedOrigin = (env.PUBLIC_SITE_URL || env.VITE_PUBLIC_SITE_URL || 'http://localhost:8080').replace(/\/+$/, '');

  return {
    name: 'market-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/market', async (request, response) => {
        const origin = request.headers.origin;
        response.setHeader('Access-Control-Allow-Origin', origin === allowedOrigin ? allowedOrigin : 'null');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Vary', 'Origin');

        if (request.method === 'OPTIONS') {
          response.statusCode = 204;
          response.end();
          return;
        }
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        if (!supabaseUrl || !supabaseKey) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: 'Market API is not configured' }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const upstream = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/crypto-data`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: Buffer.concat(chunks),
          });
          response.statusCode = upstream.status;
          response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
          response.end(await upstream.text());
        } catch (error) {
          response.statusCode = 502;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Market API request failed',
          }));
        }
      });
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8081,
    watch: {
      // Poll on Windows so external editor writes invalidate cached modules reliably.
      usePolling: process.platform === "win32",
      interval: 300,
    },
  },
  plugins: [react(), marketApiDevPlugin(mode), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
