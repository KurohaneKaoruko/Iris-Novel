# Build Troubleshooting Guide

## Common Build Issues and Solutions

### Issue: Path Reference Error (Project Rename)

**Error Message:**
```
failed to read plugin permissions: failed to read file '\\?\D:\.Programs\.Program.Project\Iris-Creation\src-tauri\target\release\build\tauri-...'
```

**Cause:** Cached build artifacts referencing the old project path.

**Solution:**

1. **Quick Fix - Clean build cache:**
   ```bash
   npm run clean
   npm run tauri:build
   ```

2. **Manual Fix:**
   ```bash
   # Remove Rust build cache
   rm -rf src-tauri/target
   
   # Remove Vite build output
   rm -rf dist
   
   # Rebuild
   npm run tauri:build
   ```

3. **Full Clean (if above doesn't work):**
   ```bash
   npm run clean:full
   npm run tauri:build
   ```

### Issue: Large Bundle Size Warning

**Warning Message:**
```
Some chunks are larger than 500 kB after minification
```

**Current Status:** Known issue, bundle is ~927 KB (acceptable for desktop app)

**Future Optimization (if needed):**
- Use dynamic imports for large dependencies
- Split Lexical editor into separate chunk
- Configure manual chunks in vite.config.ts

### Issue: TypeScript Build Errors

**Solution:**
```bash
# Clean TypeScript build info
rm tsconfig.tsbuildinfo

# Rebuild
npm run build
```

### Issue: Vite Dev Server Port Conflict

**Error:** Port 1420 already in use

**Solution:**
```bash
# Kill existing process on port 1420 (Windows)
netstat -ano | findstr :1420
taskkill /PID <PID> /F

# Or change port in package.json
"dev": "vite --port 1421 --strictPort"
```

### Issue: Tauri CLI Not Found

**Solution:**
```bash
# Reinstall Tauri CLI
npm install -D @tauri-apps/cli@latest

# Or use npx
npx tauri dev
npx tauri build
```

## Build Scripts Reference

### Development
```bash
npm run dev          # Start Vite dev server only
npm run tauri:dev    # Start Tauri app in dev mode
```

### Production
```bash
npm run build        # Build frontend only
npm run tauri:build  # Build complete Tauri app
```

### Testing
```bash
npm test             # Run all tests once
npm run test:watch   # Run tests in watch mode
npm run test:ui      # Open Vitest UI
```

### Maintenance
```bash
npm run clean        # Clean build artifacts
npm run clean:full   # Clean everything and reinstall
npm run lint         # Run ESLint
```

## Platform-Specific Notes

### Windows
- Use PowerShell for scripts
- Antivirus may slow down builds (add exclusions for `src-tauri/target`)
- Long path support may be needed for deep node_modules

### Linux/Mac
- Make scripts executable: `chmod +x scripts/*.sh`
- Use bash scripts instead of PowerShell
- May need to install additional dependencies for Tauri

## Performance Tips

1. **Faster Builds:**
   - Use `npm run tauri:dev` for development (no optimization)
   - Only run `npm run tauri:build` for releases
   - Keep `node_modules` when cleaning (default behavior)

2. **Reduce Build Time:**
   - Close other applications during build
   - Use SSD for project directory
   - Increase Node.js memory: `NODE_OPTIONS=--max-old-space-size=4096`

3. **Cache Management:**
   - Clean cache only when necessary
   - Cargo cache grows over time - clean periodically
   - Consider using `sccache` for Rust builds

## Getting Help

If you encounter an issue not covered here:

1. Check the error message carefully
2. Search Tauri documentation: https://tauri.app/
3. Check Vite documentation: https://vitejs.dev/
4. Look for similar issues on GitHub
5. Ask in the project's issue tracker

## Related Documentation

- [scripts/README.md](../scripts/README.md) - Build scripts documentation
- [Tauri Build Guide](https://tauri.app/v2/guides/building/)
- [Vite Build Guide](https://vitejs.dev/guide/build.html)
