const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const asar = require('@electron/asar')

const STUB_REL_PATH = path.join('node_modules', '@promptx', 'package.json')
const STUB_CONTENT =
  JSON.stringify(
    {
      name: '@promptx',
      version: '0.0.0',
      private: true,
      description:
        'Stub package.json for the @promptx namespace folder. Required for Node.js require.resolve() inside packaged app.asar.',
    },
    null,
    2,
  ) + '\n'

async function injectStubIntoAsar(asarPath) {
  if (!asarPath || !fs.existsSync(asarPath)) {
    console.warn(`[afterPack-inject-stub] app.asar not found: ${asarPath}`)
    return
  }

  const stubPathForExtract = path.join('node_modules', '@promptx', 'package.json')
  try {
    const existing = asar.extractFile(asarPath, stubPathForExtract).toString('utf-8')
    if (existing === STUB_CONTENT) {
      console.log('[afterPack-inject-stub] stub already present, skipping.')
      return
    }
  } catch {
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-after-pack-'))
  try {
    await asar.extractAll(asarPath, tmpDir)

    const stubAbs = path.join(tmpDir, STUB_REL_PATH)
    fs.mkdirSync(path.dirname(stubAbs), { recursive: true })
    fs.writeFileSync(stubAbs, STUB_CONTENT, 'utf-8')

    const filenames = []
    const metadata = {}

    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name)
        const rel = path.relative(tmpDir, abs)
        if (entry.isSymbolicLink()) {
          metadata[rel] = { type: 'link', stat: fs.lstatSync(abs) }
        } else if (entry.isDirectory()) {
          metadata[rel] = { type: 'directory', stat: fs.statSync(abs) }
          walk(abs)
        } else if (entry.isFile()) {
          metadata[rel] = { type: 'file', stat: fs.statSync(abs) }
          filenames.push(abs)
        }
      }
    }

    walk(tmpDir)
    await asar.createPackageFromFiles(tmpDir, asarPath, filenames, metadata, {})

    const verifierDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-after-pack-verify-'))
    try {
      const verifierPath = path.join(verifierDir, 'verify.cjs')
      fs.writeFileSync(
        verifierPath,
        "'use strict'\n" +
          `const asar = require(${JSON.stringify(require.resolve('@electron/asar'))})\n` +
          `const content = asar.extractFile(${JSON.stringify(asarPath)}, ${JSON.stringify(stubPathForExtract)}).toString('utf-8')\n` +
          "process.stdout.write(content)\n",
        'utf-8',
      )
      const verified = execFileSync(process.execPath, [verifierPath], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      })
      if (verified !== STUB_CONTENT) {
        throw new Error('stub verification failed after repack')
      }
    } finally {
      fs.rmSync(verifierDir, { recursive: true, force: true })
    }

    console.log('[afterPack-inject-stub] stub injected into app.asar')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

module.exports = async function afterPack(context) {
  const asarPath = path.join(context.appOutDir, 'resources', 'app.asar')
  await injectStubIntoAsar(asarPath)
}
