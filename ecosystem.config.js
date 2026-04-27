// PM2 process config — single fork, instance 0 owns the autoClose cron.
// Runs alongside Holocron processes on the same droplet, isolated by
// process name + Postgres schema + JWT secret.

module.exports = {
  apps: [
    {
      name: 'glisten-timecard',
      script: 'server/dist/index.js',
      cwd: '/srv/glisten-timecard',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        TZ: 'UTC',
      },
      out_file: '/var/log/pm2/glisten-timecard.out.log',
      error_file: '/var/log/pm2/glisten-timecard.err.log',
      merge_logs: true,
      time: true,
      // Daily 06:59 AZ → 13:59 UTC. Cron-restarts in PM2 use UTC.
      cron_restart: '59 13 * * *',
    },
  ],
};
