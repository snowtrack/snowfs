import * as fse from 'fs-extra';

import nm = require('micromatch');

export class IgnoreManager {
  patterns: string[];

  constructor() {
    this.patterns = [];
    /* [
      '.DS_Store',
      'thumbs.db',
      '._.*',
      '.git', // for .git worktree file
      '.git/**',
      '.snowignore',
      '*.bkp',
      'bkp/**',
      '*_bak[0-9]*.[A-Za-z0-9]+',
      '*.tmp',
      'tmp/**',
      'temp/**',
      'cache/**',
      '*.lnk',
      'desktop.ini',
      '.idea/**',
      '.Spotlight-V100',

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
      '.autosave/**', // autosave for Substance
      '*.3dm.rhl', // Rhino tmp files
      '*.3dmbak', // Rhino backup files
    ];
    */
  }

  async loadFile(filepath: string): Promise<void> {
    const content: Buffer = await fse.readFile(filepath);

    const patterns: string[] = [];

    for (let line of content.toString().split('\n')) {
      line = line.trim().replace(/\/\*[\s\S]*?\*\/|\/\/.*|#.*/g, ''); // remove # comment */ or // comment #
      if (line.length > 0) {
        patterns.push(line);
      }
    }

    this.loadPatterns(patterns);
  }

  loadPatterns(patterns: string[]): void {
    for (const item of patterns) {
      this.patterns.push(`${item}`); // if item is a file or directory located in root

      if (!item.endsWith('/**')) {
        this.patterns.push(`${item}/**`); // if item is a directory in root with children
      }

      if (!item.startsWith('**/')) {
        this.patterns.push(`**/${item}`); // if item is an item in a directory
      }

      if (!item.startsWith('**/') && !item.endsWith('/**')) {
        this.patterns.push(`**/${item}/**`); // if item is a directory in a directory
      }
    }
  }

  getIgnoreItemsArray(filepaths: string[]): string[] {
    const options = {
      dot: true, // Match dotfiles
      nocase: true, // a case-insensitive regex for matching files
      // basename: true,
      posixSlashes: true,
    };

    const ignored = nm(filepaths, this.patterns, options);
    return ignored;
  }

  getIgnoreItems(filepaths: string[]): Set<string> {
    return new Set(this.getIgnoreItemsArray(filepaths) as string[]);
  }
}
