# Clean Build Script for Iris-Creation
# This script cleans all build artifacts and caches to fix path reference issues

Write-Host "Cleaning Iris-Creation build artifacts..." -ForegroundColor Cyan
Write-Host ""

# Clean Rust/Cargo build cache
Write-Host "Cleaning Rust build cache (src-tauri/target)..." -ForegroundColor Yellow
if (Test-Path "src-tauri/target") {
    Remove-Item -Recurse -Force "src-tauri/target"
    Write-Host "Removed src-tauri/target" -ForegroundColor Green
} else {
    Write-Host "src-tauri/target already clean" -ForegroundColor Green
}

# Clean Vite build output
Write-Host "Cleaning Vite build output (webui/dist)..." -ForegroundColor Yellow
if (Test-Path "webui/dist") {
    Remove-Item -Recurse -Force "webui/dist"
    Write-Host "Removed webui/dist" -ForegroundColor Green
} else {
    Write-Host "webui/dist already clean" -ForegroundColor Green
}

# Clean TypeScript build output cache
Write-Host "Cleaning TypeScript build cache (webui/node_modules/.tmp)..." -ForegroundColor Yellow
if (Test-Path "webui/node_modules/.tmp") {
    Remove-Item -Recurse -Force "webui/node_modules/.tmp"
    Write-Host "Removed webui/node_modules/.tmp" -ForegroundColor Green
} else {
    Write-Host "webui/node_modules/.tmp already clean" -ForegroundColor Green
}

Write-Host ""
Write-Host "Build cleanup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "You can now run:" -ForegroundColor Cyan
Write-Host "  pnpm run tauri:dev   - for development" -ForegroundColor White
Write-Host "  pnpm run tauri:build - for production build" -ForegroundColor White
Write-Host ""
