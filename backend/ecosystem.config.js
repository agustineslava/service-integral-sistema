// Configuración de PM2 para el backend de Service Integral
module.exports = {
  apps: [
    {
      name: 'service-integral-backend',
      script: 'server.js',
      cwd: __dirname,

      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '300M',
      watch: false,

      out_file: './logs/salida.log',
      error_file: './logs/errores.log',
      merge_logs: true,
      time: true,

      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};