/**
 * Post-install script to ensure Electron binary is properly installed
 * This solves the issue where Electron binary is not automatically downloaded
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Set timeout for downloads (5 minutes)
const DOWNLOAD_TIMEOUT = 5 * 60 * 1000;

// Find electron path in pnpm's node_modules
function findElectronPath() {
  // Get electron version from package.json
  const packageJson = require('../package.json');
  const electronVersion = packageJson.devDependencies?.electron || '32.2.7';
  const versionOnly = electronVersion.replace(/^[\^~]/, '');

  const possiblePaths = [
    // Local node_modules
    path.join(__dirname, '..', 'node_modules', 'electron'),
    // Workspace root node_modules
    path.join(__dirname, '..', '..', '..', 'node_modules', 'electron'),
    // pnpm's .pnpm directory structure with dynamic version
    path.join(__dirname, '..', '..', '..', 'node_modules', '.pnpm', `electron@${versionOnly}`, 'node_modules', 'electron'),
  ];

  for (const electronPath of possiblePaths) {
    if (fs.existsSync(electronPath)) {
      return electronPath;
    }
  }

  console.log('❌ Electron package not found in expected locations');
  return null;
}

function installElectronBinary() {
  console.log('🔍 Checking Electron installation...');
  
  const electronPath = findElectronPath();
  if (!electronPath) {
    console.log('❌ Could not find Electron package. Please run pnpm install first.');
    return;
  }

  // Check if electron binary already exists
  try {
    const electronExe = require(electronPath);
    execSync(`"${electronExe}" --version`, { stdio: 'pipe' });
    console.log('✅ Electron binary is already installed');
    return;
  } catch (error) {
    console.log('📦 Installing Electron binary...');
  }

  // Run electron's install script
  const installScript = path.join(electronPath, 'install.js');
  if (!fs.existsSync(installScript)) {
    console.log('❌ Electron install script not found at:', installScript);
    return;
  }

  try {
    // Set environment variables for mirror if available
    if (process.env.ELECTRON_MIRROR) {
      console.log('ℹ️  Using Electron mirror:', process.env.ELECTRON_MIRROR);
    }

    // Change to electron directory and run install
    const originalDir = process.cwd();
    process.chdir(electronPath);

    // Try to run install with timeout
    console.log('⏳ Downloading Electron binary (this may take a few minutes)...');

    const installPromise = new Promise((resolve, reject) => {
      try {
        // Set a timeout for the download
        const timeout = setTimeout(() => {
          reject(new Error('Download timeout after 5 minutes'));
        }, DOWNLOAD_TIMEOUT);

        // Run the install script
        require(installScript);

        clearTimeout(timeout);
        resolve();
      } catch (error) {
        reject(error);
      }
    });

    // Wait for installation with timeout
    Promise.race([installPromise]).then(() => {
      console.log('✅ Electron binary installation completed');
    }).catch((error) => {
      if (error.message.includes('timeout')) {
        console.error('⏱️  Download timeout. The network might be slow.');
        console.log('💡 Try using a mirror by setting ELECTRON_MIRROR environment variable');
        console.log('   Example: export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/');
      } else {
        console.error('❌ Installation failed:', error.message);
      }
      console.log('ℹ️  You can manually run: node', installScript);
    });

    // Change back to original directory
    process.chdir(originalDir);
  } catch (error) {
    console.error('❌ Failed to install Electron binary:', error.message);
    console.log('ℹ️  You may need to run: node', installScript);

    // For CI environments, exit with error
    if (process.env.CI) {
      process.exit(1);
    }
  }
}

// Only run if this is the main module
if (require.main === module) {
  installElectronBinary();
}

module.exports = { installElectronBinary };