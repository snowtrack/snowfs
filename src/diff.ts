import { difference, intersection } from 'lodash';
import { Commit } from './commit';
import { TreeEntry } from './treedir';

/**
 * Class to generate a diff between commits.
 */
export class Diff {
  target: Map<string, TreeEntry>;

  base: Map<string, TreeEntry>;

  /**
   * Constructor of the diff object. Return a diff for added, deleted, modified or non-modified
   * objects based on the 'base' commit. Typically the base commit is the older commit, whereas the target
   * commit represents a newer commit.
   * @param target    Target commit.
   * @param base      Base commit.
   * @param opts      Boolean option to include directories in the results.
   */
  constructor(target: Commit, base: Commit, opts: { includeDirs: boolean}) {
    this.target = target.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: opts.includeDirs });
    this.base = base.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: opts.includeDirs });
  }

  /**
   * Generator function. Return added items between the base and target commit.
   */
  * added() {
    const filenames: string[] = difference(Array.from(this.target.keys()), Array.from(this.base.keys()));
    for (const sameFile of filenames) {
      yield this.target.get(sameFile);
    }
  }

  /**
   * Generator function. Return deleted items between the base and target commit.
   */
  * deleted() {
    const filenames: string[] = difference(Array.from(this.base.keys()), Array.from(this.target.keys()));
    for (const sameFile of filenames) {
      yield this.base.get(sameFile);
    }
  }

  /**
   * Generator function. Return modified items between the base and target commit.
   */
  * modified() {
    const filenames: string[] = intersection(Array.from(this.target.keys()), Array.from(this.base.keys()));

    for (const sameFile of filenames) {
      const l = this.target.get(sameFile);
      const r = this.base.get(sameFile);
      if (l.hash !== r.hash) {
        yield l;
      }
    }
  }

  /**
   * Generator function. Return non-modified items between the base and target commit.
   */
  * nonModified() {
    const filenames: string[] = intersection(Array.from(this.target.keys()), Array.from(this.base.keys()));

    for (const sameFile of filenames) {
      const l = this.target.get(sameFile);
      const r = this.base.get(sameFile);
      if (l.hash === r.hash) {
        yield l;
      }
    }
  }
}
