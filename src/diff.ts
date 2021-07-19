import { difference, intersection } from 'lodash';
import { Commit } from './commit';
import { TreeEntry } from './treedir';

export class Diff {
  left: Map<string, TreeEntry>;

  right: Map<string, TreeEntry>;

  constructor(left: Commit, right: Commit, opts: { includeDirs: boolean}) {
    this.left = left.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: opts.includeDirs });
    this.right = right.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: opts.includeDirs });
  }

  * added() {
    const filenames: string[] = difference(Array.from(this.left.keys()), Array.from(this.right.keys()));
    for (const sameFile of filenames) {
      yield this.left.get(sameFile);
    }
  }

  * deleted() {
    const filenames: string[] = difference(Array.from(this.right.keys()), Array.from(this.left.keys()));
    for (const sameFile of filenames) {
      yield this.right.get(sameFile);
    }
  }

  * modified() {
    const filenames: string[] = intersection(Array.from(this.left.keys()), Array.from(this.right.keys()));

    for (const sameFile of filenames) {
      const l = this.left.get(sameFile);
      const r = this.right.get(sameFile);
      if (l.hash !== r.hash) {
        yield l;
      }
    }
  }

  * nonModified() {
    const filenames: string[] = intersection(Array.from(this.left.keys()), Array.from(this.right.keys()));

    for (const sameFile of filenames) {
      const l = this.left.get(sameFile);
      const r = this.right.get(sameFile);
      if (l.hash === r.hash) {
        yield l;
      }
    }
  }
}
