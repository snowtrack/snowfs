import { REFERENCE_TYPE, Repository } from './repository';

/**
 * A class currently representing a branch. A reference points to an existing commit through the hash (aka `target`).
 * In the future, a reference might also be used as a **tag** or other commit references.
 */
export class Reference {
    hash: string;

    /** Custom commit user data, that was added to [[Repository.createCommit]]. */
    userData: any;

    refName: string;

    repo: Repository;

    startHash: string;

    type: REFERENCE_TYPE;

    constructor(type: REFERENCE_TYPE, refName: string, repo: Repository, c: {hash: string, start: string, userData?: any}) {
      this.hash = c.hash;
      this.userData = c.userData ?? {};
      this.startHash = c.start;
      this.refName = refName;
      this.repo = repo;
      this.type = type;
    }

    getName(): string {
      return this.refName;
    }

    setName(name: string): void {
      this.refName = name;
    }

    getType(): REFERENCE_TYPE {
      return this.type;
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

    start(): string {
      return this.startHash;
    }

    clone(): Reference {
      const ref = new Reference(this.type, this.refName, this.repo,
        {
          hash: this.hash,
          start: this.startHash,
        });

      ref.userData = {};
      if (this.userData != null) {
        ref.userData = { ...this.userData };
      }

      return ref;
    }
}
