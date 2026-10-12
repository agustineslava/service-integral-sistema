@echo off
:: Backup diario de Aexia: central + TODAS las bases de empresa (un .sql por base).
:: Lo dispara la tarea programada "AexiaBackupDiario" (06:00). Ver docs/plan-produccion.md, paso 9.
:: Usa la ruta absoluta de node.exe para no depender del PATH ni del shim de npm.
cd /d D:\aexia\backend
"D:\Program Files\nodejs\node.exe" tools\backup.js >> logs\backup-cron.log 2>&1
