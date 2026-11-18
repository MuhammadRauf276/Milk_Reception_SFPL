module.exports = {
  apps: [
    {
      // Same name and arguments as the process running on the production VM (pm2 describe mpd-app),
      // so "pm2 start ecosystem.config.js" restarts it instead of starting a second copy on port 3000.
      name: "mpd-app",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
    },
    {
      name: "whatsapp-gateway",
      script: "scripts/whatsapp_service.js",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
