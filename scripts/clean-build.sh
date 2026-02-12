#!/bin/bash
# Clean Build Script for Iris Creation
# This script cleans all build artifacts and caches to fix path reference issues

echo "🧹 Cleaning Iris Creation build artifacts..."
echo ""

# Clean Rust/Cargo build cache
echo "Cleaning Rust build cache (src-tauri/target)..."
if [ -d "src-tauri/target" ]; then
    rm -rf "src-tauri/target"
    echo "✓ Removed src-tauri/target"
else
    echo "✓ src-tauri/target already clean"
fi

# Clean Vite build output
echo "Cleaning Vite build output (dist)..."
if [ -d "dist" ]; then
    rm -rf "dist"
    echo "✓ Removed dist"
else
    echo "✓ dist already clean"
fi

# Clean TypeScript build output
echo "Cleaning TypeScript build output..."
if [ -f "tsconfig.tsbuildinfo" ]; then
    rm -f "tsconfig.tsbuildinfo"
    echo "✓ Removed tsconfig.tsbuildinfo"
fi

# Clean node_modules (optional - uncomment if needed)
# echo "Cleaning node_modules..."
# if [ -d "node_modules" ]; then
#     rm -rf "node_modules"
#     echo "✓ Removed node_modules"
#     echo "Running npm install..."
#     npm install
#     echo "✓ npm install complete"
# fi

echo ""
echo "✅ Build cleanup complete!"
echo ""
echo "You can now run:"
echo "  npm run tauri:dev   - for development"
echo "  npm run tauri:build - for production build"
echo ""
