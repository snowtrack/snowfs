![snowfs][snowfs_banner]

# SnowFS - a fast, scalable version control file storage for graphic files

[![release](https://img.shields.io/badge/Download%20CLI%20Alpha-0.8.51-red)](https://github.com/Snowtrack/SnowFS/releases/tag/0.8.51)
[![Coverage Status](https://coveralls.io/repos/github/Snowtrack/SnowFS/badge.svg)](https://coveralls.io/github/Snowtrack/SnowFS)
[![Build and Test](https://github.com/Snowtrack/SnowFS/workflows/Build%20and%20Test/badge.svg)](https://github.com/snowtrack/SnowFS/actions)

## Overview

SnowFS is a lightweight multi-platform support library with a focus on binary file versioning. It is made for the graphics industry and was initially developed for [Snowtrack].

**Disclaimer:** This project is in alpha state and actively developed. Do not use this yet in a production environment or without backups.

![terminal][terminal_preview]

## Feature highlights

- Supports Branches

- Asynchronous File Hashing

- Project open to file-content awareness (e.g: `*.psd`, `*.blend`, `*.c4d`, `..`)

- Super-fast-detection of modifications in large binaries

- Support for instant snapshots\*\*

- Support for instant rollback\*\*

- Support for files bigger >4TB

- Block-cloning and Copy-on-Write support for APFS and ReFS\*\*\*

- Support for removing single versions and/or binaries

- Primarily I/O bound through [libuv](https://github.com/libuv/libuv)

- Feature XYZ made by you!

\*\* If the underlying filesystem supports it (e.g. APFS, ReFS)

## Why not Git/Git-LFS, libgit2, or SVN?

First and foremost, the implementations of Git - namely [Git](https://git-scm.com/)/[Git-LFS](https://github.com/git-lfs/git-lfs)
and [libgit2](https://libgit2.org/) are excellent implementations of version control systems.
But due to their focus on the software development lifecycle they are not suitable to version binaries or graphic files.
`SnowFS` addresses the technical challenges for graphic files by its core design.

### Git/Git-LFS:

**Advantages:**

  - Support on all major platforms
  - Supported by hosting platforms like GitHub, GitLab, and BitBucket.
  - Fast diff-operation for text-files

**Disadvantages:**

  - (**Without Git-LFS**): Heavy cost with zipping, packing, and delta-compression for larger files
  - If not properly tracked, binaries become accidentally part of "base" history
  - Removing older commits is cumbersome due to Gits commit hashing integrity
  - Complicated *rewriting history* procedure
  - Issues with binaries >4GB on Windows as reported [here](https://github.com/git-lfs/git-lfs/issues/2434), [here](https://confluence.atlassian.com/bitbucketserverkb/files-larger-than-4-gb-are-not-correctly-handled-on-windows-935385144.html), and [here](https://stackoverflow.com/questions/49018053/how-large-does-a-large-file-have-to-be-to-benefit-from-git-lfs)
  - Slow in binary modification detection
  - Git uses a restrictive license

### libgit2

**Advantages:**

  - Faster zipping, packing, and delta-compression than the reference implementation *Git*
  - Supports [custom backends](https://git-scm.com/book/it/v2/Appendix-B%3A-Embedding-Git-in-your-Applications-Libgit2)

**Disadvantages:**

  - No native support for Git-LFS without custom backends
  - Custom backends break compatibility with Git


## TypeScript / C++ backport

`SnowFS` is currently written in TypeScript. It is a great language to write powerful and performant
I/O bound prototypes. There is a basic and experimental **C/C++** backport, but we are looking for maintainers
to get things finally rolling. If you have comments, ideas or recommendations, please let us know.

## Examples

### Code

You can find the best and up-to-date code examples in the `test/` directory. Given below these are simply **"Hello World!"** examples to get you started.

```typescript
import * as fse from "fs-extra";

import { join } from "path";
import { Index } from "./src";
import { Repository } from "./src/repository";

export async function main() {
  let repo: Repository;
  let index: Index;
  const repoPath = "/path/to/a/non/existing/directory";
  Repository.initExt(repoPath)
    .then((repoResult: Repository) => {
      return fse.copyFile("/path/to/texture.psd", join(repoPath, "texture.psd"));
    })
    .then(() => {
      index.addFiles(["texture.psd"]);
      return index.writeFiles();
    })
    .then(() => {
      return repo.createCommit(index, "This is my first commit");
    });
}

main();
```

### Command line interface

The CLI of `SnowFS` offers some basic functionality and is subject to enhancements.

[![release](https://img.shields.io/badge/Download%20CLI%20Alpha-0.8.51-red)](https://github.com/Snowtrack/SnowFS/releases/tag/0.8.51)

```
$ snow init foo
$ cp /path/to/texture.psd foo/texture.psd
$ cd foo
$ snow add .
$ snow commit -m "My first texture"
$ snow log
$ snow checkout -b MyNewBranch
$ snow log
```

## Versioning

Starting with version 1.0.0 `SnowFS` follows the [semantic versioning](http://semver.org/)
scheme. The API change and backward compatibility rules are those indicated by
SemVer.

## Licensing

`SnowFS` is licensed under the **MIT** license, please review the [LICENSE file](LICENSE).
Excluded from the license are images, artworks, and logos. Please file a request by mail, if you have any questions.


## Community

- [Discord](https://discord.gg/RDKPuH8dkA)
- [Support](https://github.com/Snowtrack/snowfs/labels/question)
- [Email](mailto:support@snowtrack.io)


### Other resources

The [tests and benchmarks](https://github.com/snowtrack/snowfs/tree/main/test) also serve as API specification and usage examples.

These resources are not handled by `SnowFS` maintainers and might be out of date. Please verify it before opening new issues.

## Build Instructions

To build `SnowFS` use a version `>=12.10.0` of [node.js](https://nodejs.org/en/). To build with node run:

```bash
$ git clone https://github.com/Snowtrack/snowfs.git
$ cd snowfs.git
$ npm install
$ npm run ava
```

After `npm run ava` you will find a coverage report in `./coverage/index.html`.

### Running benchmarks

We have also implemented a comparison benchmark between `SnowFS` vs. `git`.
The benchmarks can be executed (after building) with the following command:

```bash
$ npm run benchmarks
```

Example Run on a Macbook Pro (2020) with an APFS formatted SSD:

```
...
git add texture.psd: 20164ms
snow add texture.psd: 4596ms
git rm texture.psd: 575ms
snow rm texture.psd: 111ms
git checkout HEAD~1: 9739ms
snow checkout HEAD~1: 1ms
```

## Supported Platforms

Currently, Windows, macOS, and Linux are supported. `SnowFS` works on plain filesystems like FAT, NTFS, HFS+ and has extended support for APFS and ReFS\*.

## How can I contribute?

See the [guidelines for contributing][].

[node.js]: http://nodejs.org/
[terminal_preview]: https://github.com/snowtrack/snowfs/raw/main/img/terminal.gif
[Snowtrack]: https://www.snowtrack.io/
[guidelines for contributing]: https://github.com/snowtrack/snowfs/blob/main/CONTRIBUTING.md
[snowfs_banner]: https://github.com/snowtrack/snowfs/raw/main/img/banner.png
