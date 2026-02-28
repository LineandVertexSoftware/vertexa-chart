import { copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '../src/shaders');
const distDir = join(__dirname, '../dist/shaders');

// Shader files with their subdirectory structure
const shaders = [
  { src: 'scatter/scatter.wgsl', dest: 'scatter/scatter.wgsl' },
  { src: 'scatter/scatter_pick.wgsl', dest: 'scatter/scatter_pick.wgsl' },
  { src: 'scatter/scatter_hover.wgsl', dest: 'scatter/scatter_hover.wgsl' },
  { src: 'line/line.wgsl', dest: 'line/line.wgsl' }
];

// Create directory structure and copy files
for (const { src, dest } of shaders) {
  const srcPath = join(srcDir, src);
  const destPath = join(distDir, dest);
  
  // Ensure destination directory exists
  mkdirSync(dirname(destPath), { recursive: true });
  
  // Copy file
  copyFileSync(srcPath, destPath);
}

console.log('✓ Copied WGSL shaders to dist/');
