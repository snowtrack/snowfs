import * as crypto from 'crypto';
import { Repository } from './repository';
import { TreeDir } from './treedir';
import { jsonCompliant } from './common';

/**
 * A class that represents the commits of a repository.
 * It contains a variety of information like the creation date,
 * a human-readable message string, that describes the changes, etc.
 *
 * Each commit is distinguishable by its commit hash that can be obtained
 * by [[Commit.hash]]
 */
export class Commit {
  /** Unique commit hash */
  hash: string;

  /** Custom commit user data, that was added to [[Repository.createCommit]]. */
  userData: Record<string, any> | undefined = {};

  /** The repository this commit belongs to. */
  repo: Repository;

  /** Human-readable message string. */
  message: string;

  /** Creation date of the commit. */
  date: Date;

  /** The root represents the directory of the worktree when the commit was created. */
  root: TreeDir;

  /** Parent commit before this commit. */
  parent: string[] | null;

  tags: Set<string> = new Set<string>();

  constructor(repo: Repository, message: string, creationDate: Date, root: TreeDir, parent: string[] | null) {
    const uniqueInputValue = `${repo.id}${creationDate.toISOString()}${message}`;
    this.hash = crypto.createHash('sha256').update(uniqueInputValue).digest('hex');
    this.repo = repo;
    this.message = jsonCompliant(message);
    this.date = creationDate;
    this.root = root;
    this.parent = parent;
  }

  /**
   * Return a cloned commit object.
   */
  clone(): Commit {
    const commit = new Commit(this.repo, this.message, new Date(this.date), this.root, this.parent ? [...this.parent] : null);
    commit.hash = this.hash;
    commit.tags = new Set(this.tags);
    commit.userData = { ...this.userData };
    return commit;
  }

  /**
   * Add custom data to the commit object.
   */
  addData(key: string, value: any): void {
    this.userData[key] = value;
  }

  /**
   * Add custom tag to the commit object.
   */
  addTag(tag: string): void {
    if (tag.length === 0) {
      return;
    }
    tag = jsonCompliant(tag);
    this.tags.add(tag);
  }

  /**
   * The owner repository of the commit.
   */
  owner(): Repository {
    return this.repo;
  }
}
