# Back up the table: the database (pg_dump) and uploaded maps, into backups\<date>\.
# Run from the folder that holds compose.yaml:  powershell -File scripts\backup.ps1
param([string]$Project = 'project')
$ErrorActionPreference = 'Stop'
$folder = Join-Path 'backups' (Get-Date -Format 'yyyy-MM-dd_HHmm')
New-Item -ItemType Directory -Force $folder | Out-Null
docker compose -p $Project exec -T db pg_dump -U beholder -d beholder --clean --if-exists | Set-Content -Encoding utf8 (Join-Path $folder 'beholder.sql')
docker compose -p $Project exec -T app tar -C /data -cf /tmp/maps.tar maps
docker compose -p $Project cp app:/tmp/maps.tar (Join-Path $folder 'maps.tar')
Write-Output "Saved to $folder"
