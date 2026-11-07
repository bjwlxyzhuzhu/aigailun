import os from 'node:os';
// libuv threadpool carries scrypt + file reads; it must be sized before first use, hence the dynamic imports below.
process.env.UV_THREADPOOL_SIZE ||= String(Math.min(16, Math.max(4, os.cpus().length)));
const { seed } = await import('./seed.js');
const { startServer } = await import('./http.js');
await import('./teacher.js');
await import('./admin.js');
const { sweepExpired } = await import('./student.js');

seed();
const port = +process.env.PORT || 3000;
startServer(port);
// 90-minute exams auto-submit on the server clock even if the browser is closed (PRD §8.1)
setInterval(() => { try { sweepExpired(); } catch (e) { console.error('[sweep]', e); } }, 20000);
