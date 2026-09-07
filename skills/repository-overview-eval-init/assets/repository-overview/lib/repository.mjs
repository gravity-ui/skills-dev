import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, lstatSync, readlinkSync, realpathSync, existsSync} from 'node:fs';
import {resolve, relative, sep, dirname, basename} from 'node:path';

export function canonicalPath(path) {
  let existing = resolve(path);
  const suffix = [];
  while (!existsSync(existing)) { suffix.unshift(basename(existing)); existing = dirname(existing); }
  return resolve(realpathSync(existing), ...suffix);
}
export function repositoryState(repo, excludedRoots = []) {
  repo = canonicalPath(repo);
  excludedRoots = excludedRoots.map(canonicalPath);
  const git = (args) => {
    const r = spawnSync('git', ['-C', repo, ...args], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
    if (r.status !== 0) throw new Error(`Git state unavailable: git ${args[0]}`);
    return r.stdout;
  };
  const excluded = excludedRoots.map((root) => relative(repo, root).split(sep).join('/'));
  const keep = (file) => !excluded.some((root) => file === root || file.startsWith(`${root}/`));
  const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].filter(keep).sort();
  const hashes = {};
  for (const file of files) {
    const absolute = resolve(repo, file);
    try {
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) { hashes[file] = 'directory'; continue; }
      const data = stat.isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute);
      hashes[file] = `${stat.mode}:${createHash('sha256').update(data).digest('hex')}`;
    } catch (error) { if (error.code === 'ENOENT') hashes[file] = 'deleted'; else throw error; }
  }
  const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
  const filtered = [];
  for (let i = 0; i < status.length; i++) {
    const entry = status[i];
    if (!entry) continue;
    const rename = /^[RC]|^.[RC]/u.test(entry);
    const old = rename ? status[++i] : null;
    if (keep(entry.slice(3)) || old && keep(old)) filtered.push(entry, ...(old ? [old] : []));
  }
  // Include index blob identities to detect staging changes with unchanged worktree/status labels.
  const index = git(['ls-files', '--stage', '-z']).split('\0').filter((line) => line && keep(line.slice(line.indexOf('\t') + 1)));
  return {commit: git(['rev-parse', 'HEAD']).trim(), status: filtered.join('\n'), indexDigest: createHash('sha256').update(index.join('\0')).digest('hex'), files: hashes};
}
export function stateDifference(before, after) {
  const changedPaths = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter((path) => before.files[path] !== after.files[path]);
  return {detected: before.commit !== after.commit || before.status !== after.status || before.indexDigest !== after.indexDigest || changedPaths.length > 0, changedPaths, before: {commit: before.commit, status: before.status, indexDigest: before.indexDigest}, after: {commit: after.commit, status: after.status, indexDigest: after.indexDigest}};
}
