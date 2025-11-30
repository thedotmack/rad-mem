#!/usr/bin/env node

/**
 * Build script for rad-mem RAD Protocol server
 * Bundles TypeScript services into standalone executables using esbuild
 */

import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKER_SERVICE = {
  name: 'worker-service',
  source: 'src/services/worker-service.ts'
};

const SEARCH_SERVER = {
  name: 'search-server',
  source: 'src/servers/search-server.ts'
};

async function buildServer() {
  console.log('🔨 Building rad-mem RAD Protocol server...\n');

  try {
    // Read version from package.json
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    const version = packageJson.version;
    console.log(`📌 Version: ${version}`);

    // Create output directories
    console.log('\n📦 Preparing output directories...');
    const serverDir = 'dist/server';
    const uiDir = 'dist/ui';

    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }
    if (!fs.existsSync(uiDir)) {
      fs.mkdirSync(uiDir, { recursive: true });
    }
    console.log('✓ Output directories ready');

    // Build React viewer
    console.log('\n📋 Building React viewer...');
    const { spawn } = await import('child_process');
    const viewerBuild = spawn('node', ['scripts/build-viewer.js'], { stdio: 'inherit' });
    await new Promise((resolve, reject) => {
      viewerBuild.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Viewer build failed with exit code ${code}`));
        }
      });
    });

    // Build worker service
    console.log(`\n🔧 Building worker service...`);
    await build({
      entryPoints: [WORKER_SERVICE.source],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: `${serverDir}/${WORKER_SERVICE.name}.cjs`,
      minify: true,
      logLevel: 'error', // Suppress warnings (import.meta warning is benign)
      external: ['better-sqlite3'],
      define: {
        '__DEFAULT_PACKAGE_VERSION__': `"${version}"`
      },
      banner: {
        js: '#!/usr/bin/env node'
      }
    });

    // Make worker service executable
    fs.chmodSync(`${serverDir}/${WORKER_SERVICE.name}.cjs`, 0o755);
    const workerStats = fs.statSync(`${serverDir}/${WORKER_SERVICE.name}.cjs`);
    console.log(`✓ worker-service built (${(workerStats.size / 1024).toFixed(2)} KB)`);

    // Build search server
    console.log(`\n🔧 Building search server...`);
    await build({
      entryPoints: [SEARCH_SERVER.source],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: `${serverDir}/${SEARCH_SERVER.name}.cjs`,
      minify: true,
      logLevel: 'error',
      external: ['better-sqlite3'],
      define: {
        '__DEFAULT_PACKAGE_VERSION__': `"${version}"`
      },
      banner: {
        js: '#!/usr/bin/env node'
      }
    });

    // Make search server executable
    fs.chmodSync(`${serverDir}/${SEARCH_SERVER.name}.cjs`, 0o755);
    const searchServerStats = fs.statSync(`${serverDir}/${SEARCH_SERVER.name}.cjs`);
    console.log(`✓ search-server built (${(searchServerStats.size / 1024).toFixed(2)} KB)`);

    console.log('\n✅ RAD Protocol server built successfully!');
    console.log(`   Output: ${serverDir}/`);
    console.log(`   - Worker: worker-service.cjs`);
    console.log(`   - Search Server: search-server.cjs`);
    console.log(`   - UI: ${uiDir}/`);

  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    if (error.errors) {
      console.error('\nBuild errors:');
      error.errors.forEach(err => console.error(`  - ${err.text}`));
    }
    process.exit(1);
  }
}

buildServer();
