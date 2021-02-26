import * as crypto from 'crypto';
import { Repository } from './repository';
import { TreeDir } from './treedir';

/**
 * A class that represents the commits of a repository.
 * It contains a variety of information like the creation date,
 * a human readable message string, that describes the changes, etc.
 *
 * Each commit is distinguishable by its commit hash that can be obtained
 * by [[Commit.hash]]
 */
export class Commit {
  /** Unique commit hash */
  hash: string;

  tags: string[];

  /** Custom commit user data, that was added to [[Repository.createCommit]]. */
  userData: any;

  /** The repository this commit belongs to. */
  repo: Repository;

  /** Human readable message string. */
  message: string;

  /** Creation date of the commit. */
  date: Date;

  /** The root represents the directory of the worktree when the commit was created. */
  root: TreeDir;

  /** Parent commit before this commit. */
  parent: string[] | null;

  constructor(repo: Repository, message: string, creationDate: Date, root: TreeDir, parent: string[] | null) {
    this.hash = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex');
    this.tags = [];
    this.userData = {};
    this.repo = repo;
    this.message = message;
    this.date = creationDate;
    this.root = root;
    this.parent = parent;
  }

  /**
   * Return a cloned commit object.
   */
  clone(): Commit {
    const commit = new Commit(this.repo,
      this.message,
      this.date,
      this.root,
      this.parent ? [...this.parent] : []);
    commit.hash = this.hash;

    commit.tags = [];
    if (this.tags != null) {
      commit.tags = [...this.tags];
    }

    commit.userData = {};
    if (this.userData != null) {
      commit.userData = { ...this.userData };
    }

    return commit;
  }

  /**
   * Add custom data to the commit object.
   */
  addData(key: string, value: any) {
    this.userData[key] = value;
  }

  /**
   * Add custom tag to the commit object.
   */
  addTag(tag: string) {
    if (tag.length === 0) {
      return;
    }

    if (this.tags == null) {
      this.tags = [];
    }

    if (this.tags.includes(tag)) {
      return;
    }

    tag = tag
      .replace(/\\n/g, '\\n')
      .replace(/\\'/g, "\\'")
      .replace(/\\"/g, '\\"')
      .replace(/\\&/g, '\\&')
      .replace(/\\r/g, '\\r')
      .replace(/\\t/g, '\\t')
      .replace(/\\b/g, '\\b')
      .replace(/\\f/g, '\\f');

    this.tags.push(tag);
  }

  /**
   * The owner repository of the commit.
   */
  owner(): Repository {
    return this.repo;
  }
}
