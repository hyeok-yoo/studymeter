import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const rootDir = process.cwd();
const sourceIcon = path.join(rootDir, 'assets', 'icon.svg');
const publicDir = path.join(rootDir, 'public');
const androidResDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'res');
const generatedIconsDir = path.join(rootDir, 'icons');
const isWindows = process.platform === 'win32';
const capacitorAssetsBin = path.join(
  rootDir,
  'node_modules',
  '.bin',
  isWindows ? 'capacitor-assets.cmd' : 'capacitor-assets',
);

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: isWindows,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const removeLegacyLauncherWebpFiles = async () => {
  const densities = ['mipmap-hdpi', 'mipmap-mdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
  const filenames = ['ic_launcher.webp', 'ic_launcher_round.webp', 'ic_launcher_foreground.webp'];

  await Promise.all(
    densities.flatMap((density) =>
      filenames.map((filename) =>
        rm(path.join(androidResDir, density, filename), { force: true }),
      ),
    ),
  );
};

await mkdir(publicDir, { recursive: true });

run(capacitorAssetsBin, ['generate', '--android', '--pwa', '--assetPath', 'assets']);
await removeLegacyLauncherWebpFiles();
await rm(generatedIconsDir, { recursive: true, force: true });

await sharp(sourceIcon).resize(192, 192).png().toFile(path.join(publicDir, 'pwa-192x192.png'));
await sharp(sourceIcon).resize(512, 512).png().toFile(path.join(publicDir, 'pwa-512x512.png'));

console.log('Generated Android launcher assets and public PWA PNG icons.');
