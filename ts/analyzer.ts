import Plugin, { Tree } from 'broccoli-plugin';
import walkSync from 'walk-sync';
import { unlinkSync, rmdirSync, mkdirSync, readFileSync, removeSync } from 'fs-extra';
import FSTree from 'fs-tree-diff';
import makeDebug from 'debug';
import { Pipeline, File } from '@babel/core';
import { parse } from '@babel/parser';
import { join, extname } from 'path';
import { isEqual, flatten } from 'lodash';
import Package from './package';
import symlinkOrCopy from 'symlink-or-copy';

makeDebug.formatters.m = modules => {
  return JSON.stringify(
    modules.map(m => ({
      specifier: m.specifier,
      path: m.path,
      isDynamic: m.isDynamic,
      package: m.package.name
    })),
    null,
    2
  );
};

const debug = makeDebug('ember-auto-import:analyzer');

export interface Import {
  path: string;
  package: Package;
  specifier: string;
  isDynamic: boolean;
}

/*
  Analyzer discovers and maintains info on all the module imports that
  appear in a broccoli tree.
*/
export default class Analyzer extends Plugin {
  private previousTree = new FSTree();
  private parserOptions;
  private modules: Import[] | null = [];
  private paths: Map<string, Import[]> = new Map();

  constructor(inputTree: Tree, private pack: Package) {
    super([inputTree], {
      annotation: 'ember-auto-import-analyzer',
      persistentOutput: true
    });
    this.parserOptions = this.buildParserOptions(pack.babelOptions);
  }

  get imports(): Import[] {
    if (!this.modules) {
      this.modules = flatten([...this.paths.values()]);
      debug('imports %m', this.modules);
    }
    return this.modules;
  }

  private buildParserOptions(babelOptions) {
    let p = new Pipeline();
    let f = new File(babelOptions, p);
    return f.parserOpts;
  }

  build() {
    this.getPatchset().forEach(([operation, relativePath]) => {
      let outputPath = join(this.outputPath, relativePath);

      switch (operation) {
        case 'unlink':
          if (extname(relativePath) === '.js') {
            this.removeImports(relativePath);
          }
          unlinkSync(outputPath);
          break;
        case 'rmdir':
          rmdirSync(outputPath);
          break;
        case 'mkdir':
          mkdirSync(outputPath);
          break;
        case 'change':
          removeSync(outputPath);
          // deliberate fallthrough
        case 'create': {
          let absoluteInputPath = join(this.inputPaths[0], relativePath);
          if (extname(relativePath) === '.js') {
            this.updateImports(
              relativePath,
              readFileSync(absoluteInputPath, 'utf8')
            );
          }
          symlinkOrCopy.sync(absoluteInputPath, outputPath);
        }
      }
    });
  }

  private getPatchset() {
    let input = walkSync.entries(this.inputPaths[0]);
    let previous = this.previousTree;
    let next = (this.previousTree = FSTree.fromEntries(input));
    return previous.calculatePatch(next);
  }

  removeImports(relativePath) {
    debug(`removing imports for ${relativePath}`);
    let imports = this.paths.get(relativePath);
    if (imports) {
      if (imports.length > 0) {
        this.modules = null; // invalidates cache
      }
      this.paths.delete(relativePath);
    }
  }

  updateImports(relativePath, source) {
    debug(`updating imports for ${relativePath}, ${source.length}`);
    let newImports = this.parseImports(relativePath, source);
    if (!isEqual(this.paths.get(relativePath), newImports)) {
      this.paths.set(relativePath, newImports);
      this.modules = null; // invalidates cache
    }
  }

  private parseImports(relativePath, source): Import[] {
    let ast;
    try {
      ast = parse(source, this.parserOptions);
    } catch (err) {
      if (err.name !== 'SyntaxError') {
        throw err;
      }
      debug('Ignoring an unparseable file');
    }
    let imports: Import[] = [];
    if (!ast) {
      return imports;
    }

    forEachNode(ast.program.body, node => {
      if (
        node.type === 'CallExpression' &&
        node.callee &&
        node.callee.type === 'Import'
      ) {
        // it's a syntax error to have anything other than exactly one
        // argument, so we can just assume this exists
        let argument = node.arguments[0];
        if (argument.type !== 'StringLiteral') {
          throw new Error(
            'ember-auto-import only supports dynamic import() with a string literal argument.'
          );
        }
        imports.push({
          isDynamic: true,
          specifier: argument.value,
          path: relativePath,
          package: this.pack
        });
      }
    });

    // No need to recurse here, because we only deal with top-level static import declarations
    for (let node of ast.program.body) {
      let specifier: string | null;
      if (node.type === 'ImportDeclaration') {
        specifier = node.source.value;
      }
      if (node.type === 'ExportNamedDeclaration' && node.source) {
        specifier = node.source.value;
      }
      if (specifier) {
        imports.push({
          isDynamic: false,
          specifier,
          path: relativePath,
          package: this.pack
        });
      }
    }
    return imports;
  }
}

const skipKeys = {
  loc: true,
  type: true,
  start: true,
  end: true
};

function forEachNode(node, visit) {
  visit(node);
  for (let key in node) {
    if (skipKeys[key]) {
      continue;
    }
    let child = node[key];
    if (
      child &&
      typeof child === 'object' &&
      (child.type || Array.isArray(child))
    ) {
      forEachNode(child, visit);
    }
  }
}
