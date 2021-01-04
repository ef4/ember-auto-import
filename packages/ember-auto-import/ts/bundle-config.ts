/*
  This module is the only place where we make assumptions about Ember's default
  "app" vs "test" bundles.
*/

import { dirname, resolve } from 'path';
import { AppInstance } from './ember-cli-models';
const testsPattern = new RegExp(`^/?[^/]+/(tests|test-support)/`);

import type { TreeType } from './analyzer';
import resolvePackagePath from 'resolve-package-path';
import { Memoize } from 'typescript-memoize';

function exhausted(label: string, value: never): never {
  throw new Error(`Unknown ${label} specified: ${value}`);
}

export type BundleName = 'app' | 'tests';
export type BundleType = 'js' | 'css';

export default class BundleConfig {
  constructor(private emberApp: AppInstance) {}

  // This list of valid bundles, in priority order. The first one in the list that
  // needs a given import will end up with that import.
  get names(): ReadonlyArray<BundleName> {
    return Object.freeze(['app', 'tests']);
  }

  get types(): ReadonlyArray<BundleType> {
    return Object.freeze(['js', 'css']);
  }

  // Which final JS file the given bundle's dependencies should go into.
  bundleEntrypoint(name: BundleName, type: BundleType): string | undefined {
    switch (name) {
      case 'tests':
        switch (type) {
          case 'js':
            return 'assets/test-support.js';
          case 'css':
            return 'assets/test-support.css';
          default:
            exhausted('test bundle type', type);
        }
      case 'app':
        switch (type) {
          case 'js':
            return this.emberApp.options.outputPaths.vendor.js.replace(/^\//, '');
          case 'css':
            return this.emberApp.options.outputPaths.vendor.css.replace(/^\//, '');
          default:
            exhausted('app bundle type', type);
        }
      default:
        exhausted('bundle name', name);
    }
  }

  bundleForTreeType(treeType: TreeType): BundleName {
    switch (treeType) {
      case 'app':
      case 'addon':
      case 'addon-templates':
      case 'styles':
      case 'templates':
        return 'app';

      case 'addon-test-support':
      case 'test':
        return 'tests';

      default:
        exhausted('bundle name', treeType);
    }
  }

  // For any relative path to a module in our application, return which bundle its
  // imports go into.
  bundleForPath(path: string): BundleName {
    if (testsPattern.test(path)) {
      return 'tests';
    } else {
      return 'app';
    }
  }

  get lazyChunkPath() {
    return dirname(this.bundleEntrypoint(this.names[0], 'js')!);
  }

  @Memoize()
  get emberTemplateCompilerPath(): string {
    let pkgPath = resolvePackagePath('ember-source', this.emberApp.project.root);
    if (!pkgPath) {
      throw new Error(`unable to locate ember-source`);
    }
    return resolve(dirname(pkgPath), './dist/ember-template-compiler.js');
  }
}
