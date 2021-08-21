import * as crypto from 'crypto';
import { Repository } from './repository';
import { TreeDir } from './treedir';
import { jsonCompliant } from './common';
import { join } from './path';

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

  /** Custom commit runtime data. Only for internal use. */
  runtimeData: any;

  /** The repository this commit belongs to. */
  repo: Repository;

  /** Human readable message string. */
  message: string;

  /** Creation date of the commit. */
  date: Date;

  /** Last modified date of commit. If null, it never got modified after being created*/
  lastModifiedDate: Date | null;

  /** The root represents the directory of the worktree when the commit was created. */
  root: TreeDir;

  /** Parent commit before this commit. */
  parent: string[] | null;

  constructor(repo: Repository, message: string, creationDate: Date, root: TreeDir, parent: string[] | null) {
    this.hash = crypto.createHash('sha256').update(process.hrtime().toString()).digest('hex');
    this.tags = [];
    this.userData = {};
    this.runtimeData = {};
    this.repo = repo;
    this.message = jsonCompliant(message);
    this.date = new Date(creationDate.getTime());
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
    commit.lastModifiedDate = this.lastModifiedDate ? new Date(this.lastModifiedDate.getTime()) : null;

    commit.tags = [];
    if (this.tags != null) {
      commit.tags = [...this.tags];
    }

    commit.userData = {};
    if (this.userData && Object.keys(this.userData).length > 0) {
      commit.userData = { ...this.userData };
    }

    commit.runtimeData = {};
    if (this.runtimeData && Object.keys(this.runtimeData).length > 0) {
      commit.runtimeData = { ...this.runtimeData };
    }

    return commit;
  }

  /**
   * Update the commit message.
   */
  setCommitMessage(message: string): void {
    this.message = message;
    this.lastModifiedDate = new Date();
  }

  /**
   * Add custom data to the commit object.
   */
  addData(key: string, value: any): void {
    this.userData[key] = value;
    this.lastModifiedDate = new Date();
  }

  /**
   * Add custom tag to the commit object.
   */
  addTag(tag: string): void {
    if (tag.length === 0) {
      return;
    }

    if (this.tags == null) {
      this.tags = [];
    }

    if (this.tags.includes(tag)) {
      return;
    }

    tag = jsonCompliant(tag);
    this.tags.push(tag);
    this.lastModifiedDate = new Date();
  }

  /**
   * The owner repository of the commit.
   */
  owner(): Repository {
    return this.repo;
  }

  toJson(): any {
    const parent = this.parent ? this.parent : null;
    const root = this.root.toJson();
    const tags = this.tags?.length > 0 ? this.tags : undefined;
    const userData = this.userData && Object.keys(this.userData).length > 0 ? this.userData : undefined;

    return {
      hash: this.hash,
      message: this.message,
      date: this.date.getTime(),
      parent,
      root,
      ...(this.lastModifiedDate ? {lastModifiedDate: this.lastModifiedDate?.getTime()}: {}),
      ...(tags? {tags}: {}),
      ...(userData? {userData}: {}),
    };
  }
}
