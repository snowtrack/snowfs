/* eslint-disable no-await-in-loop */
import * as fse from 'fs-extra';

import test from 'ava';

import { difference } from 'lodash';
import { join } from '../src/path';
import {
  DirItem, OSWALK, osWalk, rmdir,
} from '../src/io';
import { COMMIT_ORDER, Repository, RESET } from '../src/repository';
import { createRandomFile, getRandomPath } from './helper';
import { Commit } from '../src/commit';

test('checkout test', async (t) => {
  const repoPath = getRandomPath();
  const repo = await Repository.initExt(repoPath);

  fse.ensureDirSync(join(repo.workdir(), 'subdir'));

  // 1. First add some initial files to the first commit
  const index = repo.ensureMainIndex();

  // a file that gets another file on each commit
  const dontTouchMe = join(repo.workdir(), 'subdir', 'dont-touch-me');
  await createRandomFile(dontTouchMe, 1);

  // a file that gets another file on each commit
  const snowignore = join(repo.workdir(), '.snowignore');
  fse.writeFileSync(snowignore, 'subdir/dont-touch-me');

  // a file that gets another file on each commit
  const newFile = join(repo.workdir(), 'subdir', 'new-file-0');
  await createRandomFile(newFile, 1);

  for (let i = 4; i > 0; --i) {
    // create 4 files that are never deleted
    const baseFile = join(repo.workdir(), 'subdir', `base-file-${i}`);
    fse.writeFileSync(baseFile, `base-file-${i}`);

    // create 4 files that are depending on the commit index and their i-value get deleted
    const delFile = join(repo.workdir(), 'subdir', `delete-file-${i}`);
    fse.writeFileSync(delFile, `delete-file-${i}`);

    // create 4 files that are depending on the commit index and their i-value get modified
    const modifiedFile = join(repo.workdir(), 'subdir', `modify-file-${i}`);
    fse.writeFileSync(modifiedFile, `modify-file-${i}`);

    index.addFiles([baseFile, newFile, delFile, modifiedFile]);
  }
  await index.writeFiles();
  await repo.createCommit(index, 'Commit 0');

  // 2. now create 9 more commits with each commit adding a new file, and removing one file
  for (let i = 1; i < 5; ++i) {
    const index = repo.ensureMainIndex();

    // each commit modify the 'modify-file-' file
    const modifiedFile = join(repo.workdir(), 'subdir', `modify-file-${i}`);
    fse.writeFileSync(modifiedFile, `modify-file-${i}`);
    t.log(`Add modified: ${modifiedFile}`);
    index.addFiles([modifiedFile]);

    // each commit add a new file 'new-file'
    const newFile = join(repo.workdir(), 'subdir', `new-file-${i}`);
    fse.writeFileSync(newFile, `new-file-${i}`);
    t.log(`Add new file: ${newFile}`);
    index.addFiles([newFile]);

    // remove an initial foo file
    const delfile = join(repo.workdir(), 'subdir', `delete-file-${i}`);
    fse.unlinkSync(delfile);
    t.log(`Delete file: ${delfile}`);
    index.deleteFiles([delfile]);

    await index.writeFiles();

    const commit: Commit = await repo.createCommit(index, `Commit ${i}`);
    t.log(`Created commit: ${commit.hash}`);
  }

  // $ snow log --verbose
  /*
    commit: 9ef8a52935a8f380dea412147ab3519df410183b3ce518b59f228a27bed4d7b2  (Main)
    Date: Wed Mar 24 2021 20:38:06 GMT-0400 (Eastern Daylight Time)

    Commit 4

        [5f74df465e3c060bc42f303316273f7dacd903a16709043a50b8d347b8df91c1] subdir
        [65c74c15a686187bb6bbf9958f494fc6b80068034a659a9ad44991b08c58f2d2] subdir/base-file-1 (1B)
        [6df1cdbef6d8a6d590e6572fb26ca0603dc6b564885a2e9506037bd0d8dcad91] subdir/base-file-2 (4B)
        [d01e15b531452b4b0a5259db4f850581b11e212b0b78849ec61719edcbad1f95] subdir/base-file-3 (9B)
        [ea82dff25bb1ddacf91abcb2cf2aaa80171d2355215a0a430feca15e191e4051] subdir/base-file-4 (16B)
        [19581e27de7ced00ff1ce50b2047e7a567c76b1cbaebabe5ef03f7c3017bb5b7] subdir/modify-file-1 (1B)
        [2228c32534fecf2796b16cd947a234bdb8abdc224ef19aa6586b1648efea4502] subdir/modify-file-2 (4B)
        [61acd489c6be59ed1d1286b80470d4b24a155714d9f7dc4fa257e6a05fef0d7b] subdir/modify-file-3 (9B)
        [87958fee4bc73003ea3bb033decb03ef7f816abf1f94736e701f43828dc5a032] subdir/modify-file-4 (16B)
        [6da43b944e494e885e69af021f93c6d9331c78aa228084711429160a5bbd15b5] subdir/new-file-0 (1B)
        [ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d] subdir/new-file-1 (1B)
        [e0c88b3734b229692a5874c23a6db28e9f3985c894615a6bbad8c666051abb8e] subdir/new-file-2 (4B)
        [0893ac2b5f482ec15c6e69bcc008ada24416e7b3b66108caf550b00c2300f72d] subdir/new-file-3 (9B)
        [8c1bdf973e192acb5f59e595f92699d949e0f548b04faee967790e060558258f] subdir/new-file-4 (16B)

    commit: f3e3c4ed9827489361712032c13257828a3efde4d0ab7ca0cdb61337e6da0cf8  (HEAD)
    Date: Wed Mar 24 2021 20:38:06 GMT-0400 (Eastern Daylight Time)

    Commit 3

        [13297803ec330935eff3eb44bf6edf942f51a371476b002b94e9b8335f1eff8d] subdir
        [65c74c15a686187bb6bbf9958f494fc6b80068034a659a9ad44991b08c58f2d2] subdir/base-file-1 (1B)
        [6df1cdbef6d8a6d590e6572fb26ca0603dc6b564885a2e9506037bd0d8dcad91] subdir/base-file-2 (4B)
        [d01e15b531452b4b0a5259db4f850581b11e212b0b78849ec61719edcbad1f95] subdir/base-file-3 (9B)
        [ea82dff25bb1ddacf91abcb2cf2aaa80171d2355215a0a430feca15e191e4051] subdir/base-file-4 (16B)
        [d96c00ea59c8d765d89c53479320a86fd4f980a21b880c959df51861b9a7296d] subdir/delete-file-4 (16B)
        [19581e27de7ced00ff1ce50b2047e7a567c76b1cbaebabe5ef03f7c3017bb5b7] subdir/modify-file-1 (1B)
        [2228c32534fecf2796b16cd947a234bdb8abdc224ef19aa6586b1648efea4502] subdir/modify-file-2 (4B)
        [61acd489c6be59ed1d1286b80470d4b24a155714d9f7dc4fa257e6a05fef0d7b] subdir/modify-file-3 (9B)
        [623c74da77468a40c7b9c02d4923046b0e978ec0bdf1d608ab644a9021208a28] subdir/modify-file-4 (16B)
        [6da43b944e494e885e69af021f93c6d9331c78aa228084711429160a5bbd15b5] subdir/new-file-0 (1B)
        [ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d] subdir/new-file-1 (1B)
        [e0c88b3734b229692a5874c23a6db28e9f3985c894615a6bbad8c666051abb8e] subdir/new-file-2 (4B)
        [0893ac2b5f482ec15c6e69bcc008ada24416e7b3b66108caf550b00c2300f72d] subdir/new-file-3 (9B)

    commit: 7f4327e67c0b12a19f378f3a73af1c9027283894ac5b6ceaa6d58c789e3e2e1d
    Date: Wed Mar 24 2021 20:38:06 GMT-0400 (Eastern Daylight Time)

    Commit 2

        [3e2c8fe702a221beefcbab948c7da98ebd04cb7cef1ee3b84355c5a9c215c256] subdir
        [65c74c15a686187bb6bbf9958f494fc6b80068034a659a9ad44991b08c58f2d2] subdir/base-file-1 (1B)
        [6df1cdbef6d8a6d590e6572fb26ca0603dc6b564885a2e9506037bd0d8dcad91] subdir/base-file-2 (4B)
        [d01e15b531452b4b0a5259db4f850581b11e212b0b78849ec61719edcbad1f95] subdir/base-file-3 (9B)
        [ea82dff25bb1ddacf91abcb2cf2aaa80171d2355215a0a430feca15e191e4051] subdir/base-file-4 (16B)
        [0e0a7f744e678005be1b149fefbfed5a2091d89f3bba854b6a00750f238a5aad] subdir/delete-file-3 (9B)
        [d96c00ea59c8d765d89c53479320a86fd4f980a21b880c959df51861b9a7296d] subdir/delete-file-4 (16B)
        [19581e27de7ced00ff1ce50b2047e7a567c76b1cbaebabe5ef03f7c3017bb5b7] subdir/modify-file-1 (1B)
        [2228c32534fecf2796b16cd947a234bdb8abdc224ef19aa6586b1648efea4502] subdir/modify-file-2 (4B)
        [4ca54774420b33c211cb9f0c5fa68de83d9921560bbde2d71234bc29fab5f139] subdir/modify-file-3 (9B)
        [623c74da77468a40c7b9c02d4923046b0e978ec0bdf1d608ab644a9021208a28] subdir/modify-file-4 (16B)
        [6da43b944e494e885e69af021f93c6d9331c78aa228084711429160a5bbd15b5] subdir/new-file-0 (1B)
        [ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d] subdir/new-file-1 (1B)
        [e0c88b3734b229692a5874c23a6db28e9f3985c894615a6bbad8c666051abb8e] subdir/new-file-2 (4B)

    commit: 210e2ae85d56401de4c3ad93dd4f92edf0c4a05c1e1cad98796fa18c2a93eb4c
    Date: Wed Mar 24 2021 20:38:06 GMT-0400 (Eastern Daylight Time)

    Commit 1

        [64980f1dfaa257c045d67241132e5ad8d005dcaefef0d7f953f7a84bc47f0536] subdir
        [65c74c15a686187bb6bbf9958f494fc6b80068034a659a9ad44991b08c58f2d2] subdir/base-file-1 (1B)
        [6df1cdbef6d8a6d590e6572fb26ca0603dc6b564885a2e9506037bd0d8dcad91] subdir/base-file-2 (4B)
        [d01e15b531452b4b0a5259db4f850581b11e212b0b78849ec61719edcbad1f95] subdir/base-file-3 (9B)
        [ea82dff25bb1ddacf91abcb2cf2aaa80171d2355215a0a430feca15e191e4051] subdir/base-file-4 (16B)
        [543f5780f1da696a679083f2fcc57c97dfed48f7b958b93425fb63324c2250db] subdir/delete-file-2 (4B)
        [0e0a7f744e678005be1b149fefbfed5a2091d89f3bba854b6a00750f238a5aad] subdir/delete-file-3 (9B)
        [d96c00ea59c8d765d89c53479320a86fd4f980a21b880c959df51861b9a7296d] subdir/delete-file-4 (16B)
        [19581e27de7ced00ff1ce50b2047e7a567c76b1cbaebabe5ef03f7c3017bb5b7] subdir/modify-file-1 (1B)
        [573bfe8a7a26b2ac8ec8a1cecd6e88ed3be179e9f5939ffe83d44487dfd12d2d] subdir/modify-file-2 (4B)
        [4ca54774420b33c211cb9f0c5fa68de83d9921560bbde2d71234bc29fab5f139] subdir/modify-file-3 (9B)
        [623c74da77468a40c7b9c02d4923046b0e978ec0bdf1d608ab644a9021208a28] subdir/modify-file-4 (16B)
        [6da43b944e494e885e69af021f93c6d9331c78aa228084711429160a5bbd15b5] subdir/new-file-0 (1B)
        [ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d] subdir/new-file-1 (1B)

    commit: d04fe13891e256e41f0b6927a2fd3dc89be1e49e51a3045415d6f4ba4b92b8dd
    Date: Wed Mar 24 2021 20:38:06 GMT-0400 (Eastern Daylight Time)

    Commit 0

        [41627a5e901674477e6519d80809a439afb49b4437bab96f4cba272cbb25e6ee] subdir
        [65c74c15a686187bb6bbf9958f494fc6b80068034a659a9ad44991b08c58f2d2] subdir/base-file-1 (1B)
        [6df1cdbef6d8a6d590e6572fb26ca0603dc6b564885a2e9506037bd0d8dcad91] subdir/base-file-2 (4B)
        [d01e15b531452b4b0a5259db4f850581b11e212b0b78849ec61719edcbad1f95] subdir/base-file-3 (9B)
        [ea82dff25bb1ddacf91abcb2cf2aaa80171d2355215a0a430feca15e191e4051] subdir/base-file-4 (16B)
        [e7f6c011776e8db7cd330b54174fd76f7d0216b612387a5ffcfb81e6f0919683] subdir/delete-file-1 (1B)
        [543f5780f1da696a679083f2fcc57c97dfed48f7b958b93425fb63324c2250db] subdir/delete-file-2 (4B)
        [0e0a7f744e678005be1b149fefbfed5a2091d89f3bba854b6a00750f238a5aad] subdir/delete-file-3 (9B)
        [d96c00ea59c8d765d89c53479320a86fd4f980a21b880c959df51861b9a7296d] subdir/delete-file-4 (16B)
        [fcb5f40df9be6bae66c1d77a6c15968866a9e6cbd7314ca432b019d17392f6f4] subdir/modify-file-1 (1B)
        [573bfe8a7a26b2ac8ec8a1cecd6e88ed3be179e9f5939ffe83d44487dfd12d2d] subdir/modify-file-2 (4B)
        [4ca54774420b33c211cb9f0c5fa68de83d9921560bbde2d71234bc29fab5f139] subdir/modify-file-3 (9B)
        [623c74da77468a40c7b9c02d4923046b0e978ec0bdf1d608ab644a9021208a28] subdir/modify-file-4 (16B)
        [6da43b944e494e885e69af021f93c6d9331c78aa228084711429160a5bbd15b5] subdir/new-file-0 (1B)

    commit: 013a2b407799c277e944215384362e4f5a928c3a3c576c7ab17689946443d557
    Date: Wed Mar 24 2021 20:38:06 GMT-0400 (Eastern Daylight Time)

    Created Project
    */

  for (let i = 0; i < 5; ++i) {
    const commit = repo.getAllCommits(COMMIT_ORDER.OLDEST_FIRST)[i];
    t.log(`Checkout ${commit.hash}, run ${i}`);
    await repo.checkout(commit, RESET.DEFAULT);

    const dirItems = await osWalk(repo.workdir(), OSWALK.DIRS | OSWALK.FILES | OSWALK.HIDDEN);
    if (i === 0) {
      const items = dirItems.map((v: DirItem) => v.relPath);

      const diffs = difference(items, [
        '.snowignore',
        'subdir',
        'subdir/dont-touch-me',
      ]);
      t.is(diffs.length, 0);
    } else {
      t.is(dirItems.length, 16); // 14 files in subdir + subdir directory + .snowignore

      const items = dirItems.map((v: DirItem) => v.relPath);

      if (i === 1) {
        const diffs = difference(items, [
          '.snowignore',
          'subdir',
          'subdir/dont-touch-me',
          'subdir/base-file-1',
          'subdir/base-file-2',
          'subdir/base-file-3',
          'subdir/base-file-4',
          'subdir/delete-file-1',
          'subdir/delete-file-2',
          'subdir/delete-file-3',
          'subdir/delete-file-4',
          'subdir/modify-file-1',
          'subdir/modify-file-2',
          'subdir/modify-file-3',
          'subdir/modify-file-4',
          'subdir/new-file-0',
        ]);
        t.is(diffs.length, 0);
      } else if (i === 2) {
        const diffs = difference(items, [
          '.snowignore',
          'subdir',
          'subdir/dont-touch-me',
          'subdir/base-file-1',
          'subdir/base-file-2',
          'subdir/base-file-3',
          'subdir/base-file-4',
          'subdir/delete-file-2',
          'subdir/delete-file-3',
          'subdir/delete-file-4',
          'subdir/modify-file-1',
          'subdir/modify-file-2',
          'subdir/modify-file-3',
          'subdir/modify-file-4',
          'subdir/new-file-0',
          'subdir/new-file-1',
        ]);
        t.is(diffs.length, 0);
      } else if (i === 3) {
        const diffs = difference(items, [
          '.snowignore',
          'subdir',
          'subdir/dont-touch-me',
          'subdir/base-file-1',
          'subdir/base-file-2',
          'subdir/base-file-3',
          'subdir/base-file-4',
          'subdir/delete-file-3',
          'subdir/delete-file-4',
          'subdir/modify-file-1',
          'subdir/modify-file-2',
          'subdir/modify-file-3',
          'subdir/modify-file-4',
          'subdir/new-file-0',
          'subdir/new-file-1',
          'subdir/new-file-2',
        ]);
        t.is(diffs.length, 0);
      } else if (i === 4) {
        const diffs = difference(items, [
          '.snowignore',
          'subdir',
          'subdir/dont-touch-me',
          'subdir/base-file-1',
          'subdir/base-file-2',
          'subdir/base-file-3',
          'subdir/base-file-4',
          'subdir/delete-file-4',
          'subdir/modify-file-1',
          'subdir/modify-file-2',
          'subdir/modify-file-3',
          'subdir/modify-file-4',
          'subdir/new-file-0',
          'subdir/new-file-1',
          'subdir/new-file-2',
          'subdir/new-file-3',
        ]);
        t.is(diffs.length, 0);
      } else {
        throw new Error('out of index');
      }
    }
  }

  rmdir(repoPath);
});
