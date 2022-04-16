import * as fse from 'fs-extra';

import nm = require('micromatch');

const DEFAULT_IGNORE_PATTERNS = [
  'thumbs.db',
  '*.bkp',
  'bkp/**',
  '*_bak[0-9]*.[A-Za-z0-9]+',
  '*.tmp',
  'tmp/**',
  'temp/**',
  'cache/**',
  '*.lnk',
  '[Dd]esktop.ini',
  '.Spotlight-V100/**',

  'Backup_of*', // Auto backup by Corel Draw
  'Adobe Premiere Pro Auto-Save/**', // Adobe Premiere
  'Adobe After Effects Auto-Save/**', // Adobe After Effects
  'tmpAEtoAMEProject-*.aep', // Adobe After Effects <--> Media Encoder
  'RECOVER_*', // Adobe Animate
  'temp.noindex/**', // Adobe Character Animator
  '~*', // Adobe InDesign lock files start with ~ and end with 'idlk'
  '*.blend+([0-9])', // Blender auto-saved files
  '*.bak*([0-9])', // Cinema 4D Backup files
  'backup/**', // Cinema 4D auto-saved
  '*.3dm.rhl', // Rhino tmp files
  '*.3dmbak', // Rhino backup files
];
export class IgnoreManager {
  patterns: string[] = [];

  async init(filepath: string | null): Promise<void> {
    const patterns: string[] = [];

    if (filepath) {
      const content: Buffer = await fse.readFile(filepath);

      for (let line of content.toString().split('\n')) {
        line = line.trim().replace(/\/\*[\s\S]*?\*\/|\/\/.*|#.*/g, ''); // remove # comment */ or // comment #
        if (line.length > 0) {
          patterns.push(line);
        }
      }
    }

    this.loadPatterns(patterns);
  }

  loadPatterns(patterns: string[]): void {
    this.patterns = this.patterns.concat(DEFAULT_IGNORE_PATTERNS);

    for (const item of patterns) {
      this.patterns.push(`${item}`); // if item is a file or directory located in root

      if (!item.endsWith('/**')) {
        // if item is a directory in root with children
        if (item.endsWith('/')) {
          this.patterns.push(`${item}**`);
        } else {
          this.patterns.push(`${item}/**`);
        }
      }

      // Don't apply the subdirectory rules if the path begins with a slash.
      if (!item.startsWith('/')) {
        if (!item.startsWith('**/')) {
          // If item is an item in a directory
          this.patterns.push(`**/${item}`);
        }

        if (!item.startsWith('**/') && !item.endsWith('/**')) {
          // if item is a directory in a directory
          if (item.endsWith('/')) {
            this.patterns.push(`**/${item}**`);
          } else {
            this.patterns.push(`**/${item}/**`);
          }
        }
      }
    }
  }

  getIgnoreItemsArray(filepaths: string[]): string[] {
    const options = {
      // Match dotfiles. Otherwise dotfiles are ignored unless a . is explicitly defined in the pattern.
      dot: false,

      // make matcher case-sensitive
      nocase: false,

      // Convert all slashes in file paths to forward slashes. This does not convert slashes in the glob pattern itself
      posixSlashes: true,

      // Disable support for matching with extglobs (like +(a|b))
      noextglob: true,

      // Disable brace matching, so that {a,b} and {1..3} would be treated as literal characters.
      // Instead use [1-3]
      nobrace: true,

      // Disable regex positive and negative lookbehinds. Note that you must be using Node 8.1.10 or higher to enable regex lookbehinds.
      lookbehinds: false,
    };

    const ignored = nm(filepaths, this.patterns, options);
    return ignored;
  }

  getIgnoreItems(filepaths: string[]): Set<string> {
    return new Set(this.getIgnoreItemsArray(filepaths) as string[]);
  }
}
