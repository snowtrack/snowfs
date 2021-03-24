import test from 'ava';
import * as fse from 'fs-extra';
import { join, dirname, basename } from '../src/path';
import { IoContext, FILESYSTEM } from '../src/io_context';
import { createRandomFile, createRandomString } from './4.repo.commit';

async function copyTest(t, searchForFilesystem: FILESYSTEM) {
  const ioContext = new IoContext();
  await ioContext.init();
  for (const [mountpoint, drive] of ioContext.drives) {
    if (mountpoint !== '/' && !mountpoint.startsWith('/System') && drive.filesystem === searchForFilesystem) {
      // eslint-disable-next-line no-await-in-loop
      const testfile = await createRandomFile(join(mountpoint, `snowfs-unittest-${createRandomString(10)}`), 25000);
      const src = testfile.filepath;
      const dst = `${src}_copy`;
      t.log(`Copy ${src} to ${dst}`);
      // eslint-disable-next-line no-await-in-loop
      await ioContext.copyFile(src, dst);

      const srcSize = fse.statSync(src).size;
      const dstSize = fse.statSync(dst).size;
      t.log(`${src} size: ${srcSize} bytes`);
      t.log(`${dst} size: ${dstSize} bytes`);
      t.is(srcSize, dstSize, 'src and dst file size');
      fse.unlinkSync(src);
      fse.unlinkSync(dst);
      return true;
    }
  }
  return false;
}

if (!process.env.GITHUB_WORKFLOW) {
  test('ReFS Test', async (t) => {
    const driveFound: boolean = await copyTest(t, FILESYSTEM.REFS);
    if (!driveFound) {
      t.log('Skipped test because no ReFS drive could be found');
      t.pass();
    }
  });

  test('APFS Test', async (t) => {
    const driveFound: boolean = await copyTest(t, FILESYSTEM.APFS);
    if (!driveFound) {
      t.log('Skipped test because no APFS drive could be found');
      t.pass();
    }
  });
}
