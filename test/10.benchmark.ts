import test from 'ava';
import { join } from 'path';
import * as os from 'os';
import { snowFsAddTexture, snowFsRestoreTexture, snowFsRmTexture } from '../benchmarks/snowfs-vs-git';

test('add texture', async (t) => {
  t.timeout(180000);
  const playground = os.tmpdir();
  const gitPath = join(playground, 'snowfs-benchmark');
  await snowFsAddTexture(gitPath, t.log);
  t.is(true, true);
});

test('remove texture', async (t) => {
  t.timeout(180000);
  const playground = os.tmpdir();
  const gitPath = join(playground, 'snowfs-benchmark');
  await snowFsRmTexture(gitPath, t.log);
  t.is(true, true);
});

test('restore texture', async (t) => {
  t.timeout(180000);
  const playground = os.tmpdir();
  const gitPath = join(playground, 'snowfs-benchmark');
  await snowFsRestoreTexture(gitPath, t.log);
  t.is(true, true);
});
