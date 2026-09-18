// Configuración de PM2 para el backend de Service Integral.
// Se usa así: pm2 startOrRestart ecosystem.config.js
// (el .bat ya lo hace solo, no hace falta ejecutarlo a mano en el día a día)

module.exports = {
  apps: [
    {
      name: 'service-integral-backend',
      script: 'server.js',
      cwd: __dirname,

      // Si Node se cae por cualquier motivo (error no controlado, falla de MySQL, etc.)
      // PM2 lo vuelve a levantar solo.
      autorestart: true,
      restart_delay: 3000,   // espera 3s entre reintentos
      max_restarts: 10,      // si se cae 10 veces seguidas, deja de insistir (evita un loop infinito)
      min_uptime: '10s',     // tiene que estar "sano" al menos 10s para contar como reinicio exitoso

      // Si el proceso llega a usar más de 300MB de memoria, PM2 lo reinicia solo
      // (protección barata contra memory leaks de larga duración)
      max_memory_restart: '300M',

      watch: false, // no reiniciar automáticamente si cambian archivos (eso es para desarrollo, no producción)

      // Logs a archivo, separados por salida normal y errores, con fecha y hora en cada línea
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