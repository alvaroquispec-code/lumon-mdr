import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';

function buildSha(): string {
  const fromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.COMMIT_REF ??
    process.env.GITHUB_SHA;
  if (fromEnv && /^[0-9a-f]{7,40}$/.test(fromEnv)) return fromEnv.slice(0, 7);
  if (process.env.NODE_ENV === 'production' || process.argv.includes('build')) {
    try {
      const sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (/^[0-9a-f]{7}$/.test(sha)) return sha;
    } catch {
      /* sin git */
    }
  }
  return 'dev';
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __LUMON_BUILD__: JSON.stringify(command === 'build' ? buildSha() : 'dev'),
  },
}));
