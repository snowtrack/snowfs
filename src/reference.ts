import { Repository } from './repository';

/**
 * A class currently representing a branch. A reference points to an existing commit through the hash (aka `target`).
 * In the future, a reference might also be used as a **tag** or other commit references.
 */
export class Reference {
    hash: string;

    refName: string;

    repo: Repository;

    start: string;

    constructor(refName: string, repo: Repository, c: {hash: string, start: string}) {
      this.hash = c.hash;
      this.start = c.start;
      this.refName = refName;
      this.repo = repo;
    }

    getName(): string {
      return this.refName;
    }

    setName(name: string) {
      this.refName = name;
    }

    owner(): Repository {
      return this.repo;
    }

    isDetached(): boolean {
      return this.refName === 'HEAD';
    }

    target(): string {
      return this.hash;
    }

    clone(): Reference {
      return new Reference(this.refName, this.repo, { hash: this.hash, start: this.start });
    }
}
