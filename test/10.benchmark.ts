import test from 'ava';
import * as os from 'os';
import { join } from '../src/path';
import {
  snowFsAddTexture, snowFsRestoreTexture, snowFsRmTexture, startBenchmark,
} from '../benchmarks/snowfs-vs-git';
import { MB20 } from '../src/common';

test('add texture', async (t) => {
  t.timeout(180000);
  const playground = os.tmpdir();
  const gitPath = join(playground, 'snowfs-benchmark');
  await snowFsAddTexture(gitPath, MB20, t);
  t.is(true, true);
});

test('remove texture', async (t) => {
  t.timeout(180000);
  const playground = os.tmpdir();
  const gitPath = join(playground, 'snowfs-benchmark');
  await snowFsRmTexture(gitPath, t);
  t.is(true, true);
});

test('restore texture', async (t) => {
  t.timeout(180000);
  const playground = os.tmpdir();
  const gitPath = join(playground, 'snowfs-benchmark');
  await snowFsRestoreTexture(gitPath, t);
  t.is(true, true);
});

test('full-benchmark', async (t) => {
  t.timeout(3600000);
  await startBenchmark(200000000, t);
  t.is(true, true);
});

test('full-benchmark', async (t) => {
  t.timeout(3600000);
  startBenchmark();
});
