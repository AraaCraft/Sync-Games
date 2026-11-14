const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseSemver(tag) {
  const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    raw: tag,
    clean: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}`,
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (a.prerelease && b.prerelease) return a.prerelease.localeCompare(b.prerelease);
  return 0;
}

function getLatestTag() {
  const tags = new Set();

  // 1. Fetch tags from remote origin if possible
  try {
    const remoteOutput = execSync('git ls-remote --tags origin', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    for (const line of remoteOutput.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[1].startsWith('refs/tags/')) {
        const tag = parts[1].replace('refs/tags/', '').replace(/\^{}$/, '');
        if (tag) tags.add(tag);
      }
    }
  } catch {
    // Remote might be offline or sandbox-restricted, fallback to local tags
  }

  // 2. Fetch local tags
  try {
    const localOutput = execSync('git tag -l', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    for (const tag of localOutput.split('\n')) {
      const clean = tag.trim();
      if (clean) tags.add(clean);
    }
  } catch {}

  const parsed = Array.from(tags)
    .map(parseSemver)
    .filter(Boolean)
    .sort(compareSemver);

  if (parsed.length === 0) {
    return null;
  }

  return parsed[parsed.length - 1];
}

function syncVersion() {
  const pkgPath = path.resolve(__dirname, '../package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('[sync-version] Error: package.json not found.');
    process.exit(1);
  }

  const shouldStage = process.argv.includes('--stage');
  const latest = getLatestTag();

  if (!latest) {
    console.log('[sync-version] No git tags found on GitHub origin or locally. Keeping existing package version.');
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const currentVersion = pkg.version;
  const targetVersion = latest.clean;

  if (currentVersion === targetVersion) {
    console.log(`[sync-version] package.json version is already in sync with latest tag (${latest.raw} -> ${targetVersion}).`);
    return;
  }

  console.log(`[sync-version] Updating package.json version: ${currentVersion} -> ${targetVersion} (from ${latest.raw})`);
  pkg.version = targetVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  // Also update package-lock.json if it exists
  const lockPath = path.resolve(__dirname, '../package-lock.json');
  let lockUpdated = false;
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      lock.version = targetVersion;
      if (lock.packages && lock.packages['']) {
        lock.packages[''].version = targetVersion;
      }
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
      lockUpdated = true;
    } catch (err) {
      console.warn('[sync-version] Could not update package-lock.json:', err.message);
    }
  }

  // Auto-stage modified files if inside a pre-commit hook
  if (shouldStage) {
    try {
      execSync(`git add package.json ${lockUpdated ? 'package-lock.json' : ''}`, {
        stdio: 'inherit',
      });
      console.log('[sync-version] Staged updated package.json.');
    } catch (err) {
      console.warn('[sync-version] Failed to stage package.json:', err.message);
    }
  }
}

syncVersion();
