import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// dev-only：/__snapshot 接收页面 POST 的截图（canvas 图片），写到 .snapshots/ 方便无界面调试
export default defineConfig({
  server: { host: '127.0.0.1' },
  plugins: [{
    name: 'kp-dev-snapshot',
    configureServer(server) {
      server.middlewares.use('/__snapshot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = path.resolve(__dirname, '.snapshots');
          fs.mkdirSync(dir, { recursive: true });
          const name = String(new URL(req.url || '', 'http://x').searchParams.get('name') || `snap-${Date.now()}`).replace(/[^\w-]/g, '_');
          const file = path.join(dir, `${name}.jpg`);
          fs.writeFileSync(file, Buffer.concat(chunks));
          res.end(file);
        });
      });
    },
  }],
});
