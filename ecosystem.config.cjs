/**
 * PM2 Ecosystem Configuration for rad-mem RAD Protocol Server
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 stop rad-mem-worker
 *   pm2 restart rad-mem-worker
 *   pm2 logs rad-mem-worker
 *   pm2 status
 */

module.exports = {
  apps: [
    {
      name: 'rad-mem-worker',
      script: './dist/server/worker-service.cjs'
      // , watch: true,
      // ignore_watch: [
      //   'node_modules',
      //   'logs',
      //   '*.log',
      //   '*.db',
      //   '*.db-*',
      //   '.git'
      // ]
    }
  ]
};
