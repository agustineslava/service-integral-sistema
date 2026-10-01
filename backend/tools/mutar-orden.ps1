# Corre la mutacion, verifica que el verificador falla, y restaura.
$ErrorActionPreference = 'Continue'
$server = 'D:\SitemaServiceIntegral\backend\server.js'
$bak = "$server.bak-mutacion"
Copy-Item $server $bak -Force

function Probar($nombre, $viejo, $nuevo) {
    Write-Host ""
    Write-Host "=== MUTACION: $nombre ===" -ForegroundColor Yellow
    $texto = [IO.File]::ReadAllText($server)
    if (-not $texto.Contains($viejo)) {
        Write-Host "  No se encontro el texto a mutar. Se omite." -ForegroundColor Red
        return $false
    }
    [IO.File]::WriteAllText($server, $texto.Replace($viejo, $nuevo), (New-Object Text.UTF8Encoding $false))
    npx pm2 restart service-integral-backend 2>&1 | Out-Null
    Start-Sleep -Seconds 4
    $out = node tools\ver-orden-reparaciones.js 2>&1
    $fallos = @($out | Select-String -Pattern "FALLO").Count
    $ok = @($out | Select-String -Pattern "  OK ").Count
    Write-Host "  -> $ok OK / $fallos FALLO"
    $out | Select-String -Pattern "FALLO" | ForEach-Object { Write-Host "     $($_.Line.Trim())" }
    if ($fallos -eq 0) {
        Write-Host "  ESTA MUTACION NO LA DETECTO EL VERIFICADOR" -ForegroundColor Red
    } else {
        Write-Host "  detectada." -ForegroundColor Green
    }
    [IO.File]::WriteAllText($server, [IO.File]::ReadAllText($bak), (New-Object Text.UTF8Encoding $false))
    npx pm2 restart service-integral-backend 2>&1 | Out-Null
    Start-Sleep -Seconds 3
    return ($fallos -gt 0)
}

$r = @()
$r += Probar "14 dias al reves (THEN 1 ELSE 0)" "AND fecha_inicio <= DATE_SUB(NOW(), INTERVAL 14 DAY)`r`n                THEN 0 ELSE 1" "AND fecha_inicio <= DATE_SUB(NOW(), INTERVAL 14 DAY)`r`n                THEN 1 ELSE 0"
$r += Probar "sin desempate por id" "            id DESC" "            fecha_inicio DESC"
$r += Probar "la busqueda pierde la ultima columna" "COLUMNAS_BUSQUEDA_REPARACIONES.map((col)" "COLUMNAS_BUSQUEDA_REPARACIONES.slice(0, -1).map((col)"
$r += Probar "cerrados primero en vez de al final" "CASE WHEN estado IN ('Entregado', 'Cancelado') THEN 1 ELSE 0 END ASC," "CASE WHEN estado IN ('Entregado', 'Cancelado') THEN 0 ELSE 1 END ASC,"
$r += Probar "Pendiente deja de ir primero" "CASE WHEN estado = 'Pendiente' THEN 0 ELSE 1 END ASC," "CASE WHEN estado = 'Pendiente' THEN 1 ELSE 0 END ASC,"
# Ojo con las comillas: en PowerShell las dobles interpolan `$` y acentos de
# backtick, asi que el texto a mutar va en comillas simples.
$r += Probar "no se escapan los comodines" 'return texto.replace(/[\\%_]/g, (ch) => `\\${ch}`);' 'return texto;'

Remove-Item $bak -Force
$detectadas = @($r | Where-Object { $_ -eq $true }).Count
Write-Host ""
Write-Host "=== RESUMEN ===" -ForegroundColor Cyan
Write-Host "  $detectadas de $($r.Count) mutaciones fueron detectadas"
if ($detectadas -lt $r.Count) { exit 1 }