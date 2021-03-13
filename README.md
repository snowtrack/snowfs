![snowfs][snowfs_banner]

# SnowFS - a fast, scalable version control file storage for graphic files

[![release](https://img.shields.io/badge/Download%20CLI%20Alpha-0.8.51-red)](https://github.com/Snowtrack/SnowFS/releases/tag/0.8.51)
[![Coverage Status](https://coveralls.io/repos/github/Snowtrack/SnowFS/badge.svg)](https://coveralls.io/github/Snowtrack/SnowFS)
[![Build and Test](https://github.com/Snowtrack/SnowFS/workflows/Build%20and%20Test/badge.svg)](https://github.com/snowtrack/SnowFS/actions)
[![MIT Licence](https://badges.frapsoft.com/os/mit/mit.png?v=102)](https://opensource.org/licenses/mit-license.php)

## Overview

SnowFS is a lightweight command-line application and library with a focus on binary file versioning. It is made for the graphics industry and was initially developed for [Snowtrack].

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

- Block-cloning and Copy-on-Write support for [APFS](https://developer.apple.com/documentation/foundation/file_system/about_apple_file_system), [ReFS](https://docs.microsoft.com/en-us/windows-server/storage/refs/refs-overview) and [Btrfs](https://en.wikipedia.org/wiki/Btrfs)

- Support for removing single versions and/or binaries

- Primarily I/O bound through [libuv](https://github.com/libuv/libuv)

- Feature XYZ made by you!

\*\* If the underlying filesystem supports it (e.g. APFS, ReFS and Btrfs)

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
I/O bound prototypes. We are aware of the demand for a C++ implementation, and due to
our roots as C++ developers, we are very interested in a backport as well. It would make SnowFS easier
to integrate into other projects. If you have comments, ideas or recommendations, please let us know.

## Running benchmarks

We have also implemented a comparison benchmark between **SnowFS** vs. **git-lfs**.
After executing the [build instructions](#build-instructions) for a development build, the benchmarks can be executed with the following command:

```bash
$ npm run benchmarks
```

Example run on a Macbook Pro (2020) with an APFS formatted SSD to check-in, delete and restore a 4GB Photoshop File.

```
...
git lfs track *.psd
git add texture.psd: 20164ms
snow add texture.psd: 4596ms
git rm texture.psd: 575ms
snow rm texture.psd: 111ms
git checkout HEAD~1: 9739ms
snow checkout HEAD~1: 1ms <-- Yeap!
```

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

## Build Instructions

1. To build `SnowFS` install [node.js](https://nodejs.org/en/) for your specific platform.

    1.1. On Windows, Visual Studio is required. We recommend the [Visual Studio 2019 Community Edition](https://visualstudio.microsoft.com/downloads/). During the installation, please enable <a href="https://docs.microsoft.com/en-us/cpp/build/media/vscpp-concierge-choose-workload.gif?view=msvc-160" target="_blank">Desktop development with C++</a>.

    1.2. On MacOS, [XCode](https://developer.apple.com/xcode/) is required.

2. To build a **development build** execute:

```bash
$ git clone https://github.com/Snowtrack/snowfs.git
$ cd snowfs.git
$ npm install
$ npm run ava
```

3. To build a **production build including the CLI**, execute the commands above, and continue with the commands below:

```bash
$ npm run tsc
$ npm run build
$ cd dist/out-tsc
```

### How To Debug

For the development of SnowFS we recommend **VSCode**. The repository contains a [launch.json](.vscode/launch.json) file with pre-defined runner configurations. For more information, please visit [this](https://github.com/Snowtrack/SnowFS/pull/49#issue-579026705) pull-request.


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

## Supported Platforms

Currently, Windows, macOS, and Linux are supported. `SnowFS` works on plain filesystems like FAT, NTFS, HFS+ and has extended support for APFS, ReFS and Btrfs.

## How can I contribute?

See the [guidelines for contributing][].

[node.js]: http://nodejs.org/
[terminal_preview]: https://github.com/snowtrack/snowfs/raw/main/img/terminal.gif
[Snowtrack]: https://www.snowtrack.io/
[guidelines for contributing]: https://github.com/snowtrack/snowfs/blob/main/CONTRIBUTING.md
[snowfs_banner]: https://github.com/snowtrack/snowfs/raw/main/img/banner.png
