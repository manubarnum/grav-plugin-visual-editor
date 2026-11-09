import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs the dependency-free PHP tests (tests/php/run.php) as part of `npm test`; skipped without PHP.
const php = spawnSync('php', ['-v'], { encoding: 'utf8' });

test('PHP plugin logic', { skip: php.status !== 0 && 'php is not installed' }, () => {
  const runner = fileURLToPath(new URL('./php/run.php', import.meta.url));
  const result = spawnSync('php', [runner], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
