import { buildApp } from './app';
import { config } from './config';
import { scheduleAutoClose } from './jobs/autoClose';

const app = buildApp();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[glisten-timecard] listening on :${config.port} (${config.nodeEnv})`);
});

// Cron only on the first PM2 instance to avoid double-fires under cluster mode.
if (process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === '0') {
  scheduleAutoClose();
}
