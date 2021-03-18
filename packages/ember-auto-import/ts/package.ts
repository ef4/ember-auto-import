import resolvePackagePath from 'resolve-package-path';
import { join, dirname } from 'path';
import { readFileSync } from 'fs';
import { Memoize } from 'typescript-memoize';
import { Configuration } from 'webpack';
import { AddonInstance, isDeepAddonInstance, Project } from './ember-cli-models';

const cache: WeakMap<AddonInstance, Package> = new WeakMap();
let pkgGeneration = 0;

export function reloadDevPackages() {
  pkgGeneration++;
}

export interface Options {
  exclude?: string[];
  alias?: { [fromName: string]: string };
  webpack?: Configuration;
  publicAssetURL?: string;
  forbidEval?: boolean;
  skipBabel?: { package: string; semverRange?: string }[];
  watchDependencies?: (string | string[])[];
}

interface DepResolution {
  type: 'package';
  path: string;
  packageName: string;
  packagePath: string;
  local: string;
}

interface LocalResolution {
  type: 'local';
  local: string;
}

interface URLResolution {
  type: 'url';
  url: string;
}

interface ImpreciseResolution {
  type: 'imprecise';
}

type Resolution = DepResolution | LocalResolution | URLResolution | ImpreciseResolution;

export default class Package {
  public name: string;
  public root: string;
  public isAddon: boolean;
  private _options: any;
  private _parent: Project | AddonInstance;
  private _hasBabelDetails = false;
  private _babelMajorVersion?: number;
  private _babelOptions: any;
  private _emberCLIBabelExtensions?: string[];
  private autoImportOptions: Options | undefined;
  private isDeveloping: boolean;
  private pkgGeneration: number;
  private pkgCache: any;
  private localExcludes: Set<string>;

  static lookupParentOf(child: AddonInstance): Package {
    if (!cache.has(child)) {
      cache.set(child, new this(child));
    }
    return cache.get(child)!;
  }

  constructor(child: AddonInstance) {
    this.name = child.parent.pkg.name;
    this.root = child.parent.root;

    if (isDeepAddonInstance(child)) {
      this.isAddon = true;
      this.isDeveloping = this.root === child.project.root;
      // This is the per-package options from ember-cli
      this._options = child.parent.options;
    } else {
      this.isAddon = false;
      this.isDeveloping = true;
      this._options = child.app.options;
    }

    this._parent = child.parent;

    // Stash our own config options
    this.autoImportOptions = this._options.autoImport;

    this.localExcludes = new Set(excludePackagesFomOptions(this.autoImportOptions));
    this.pkgCache = child.parent.pkg;
    this.pkgGeneration = pkgGeneration;
  }

  _ensureBabelDetails() {
    if (this._hasBabelDetails) {
      return;
    }
    let { babelOptions, extensions, version } = this.buildBabelOptions(this._parent, this._options);

    this._emberCLIBabelExtensions = extensions;
    this._babelOptions = babelOptions;
    this._babelMajorVersion = version;
    this._hasBabelDetails = true;
  }

  get babelOptions() {
    this._ensureBabelDetails();
    return this._babelOptions;
  }

  get babelMajorVersion() {
    this._ensureBabelDetails();
    return this._babelMajorVersion;
  }

  @Memoize()
  get isFastBootEnabled() {
    return (
      process.env.FASTBOOT_DISABLED !== 'true' &&
      !!this._parent.addons.find(addon => addon.name === 'ember-cli-fastboot')
    );
  }

  private buildBabelOptions(instance: Project | AddonInstance, options: any) {
    // Generate the same babel options that the package (meaning app or addon)
    // is using. We will use these so we can configure our parser to
    // match.
    let babelAddon = instance.addons.find(addon => addon.name === 'ember-cli-babel') as any;
    let babelOptions = babelAddon.buildBabelOptions(options);
    let extensions = babelOptions.filterExtensions || ['js'];

    // https://github.com/babel/ember-cli-babel/issues/227
    delete babelOptions.annotation;
    delete babelOptions.throwUnlessParallelizable;
    delete babelOptions.filterExtensions;
    if (babelOptions.plugins) {
      babelOptions.plugins = babelOptions.plugins.filter((p: any) => !p._parallelBabel);
    }
    let version = parseInt(babelAddon.pkg.version.split('.')[0], 10);
    return { babelOptions, extensions, version };
  }

  private get pkg() {
    if (!this.pkgCache || (this.isDeveloping && pkgGeneration !== this.pkgGeneration)) {
      // avoiding `require` here because we don't want to go through the
      // require cache.
      this.pkgCache = JSON.parse(readFileSync(join(this.root, 'package.json'), 'utf-8'));
      this.pkgGeneration = pkgGeneration;
    }
    return this.pkgCache;
  }

  get namespace(): string {
    // This namespacing ensures we can be used by multiple packages as
    // well as by an addon and its dummy app simultaneously
    return `${this.name}/${this.isAddon ? 'addon' : 'app'}`;
  }

  private hasDependency(name: string): boolean {
    let pkg = this.pkg;
    return (
      (pkg.dependencies && Boolean(pkg.dependencies[name])) ||
      (pkg.devDependencies && Boolean(pkg.devDependencies[name])) ||
      (pkg.peerDependencies && Boolean(pkg.peerDependencies[name]))
    );
  }

  private hasNonDevDependency(name: string): boolean {
    let pkg = this.pkg;
    return (
      (pkg.dependencies && Boolean(pkg.dependencies[name])) ||
      (pkg.peerDependencies && Boolean(pkg.peerDependencies[name]))
    );
  }

  static categorize(importedPath: string, partial = false) {
    if (/^(\w+:)?\/\//.test(importedPath) || importedPath.startsWith('data:')) {
      return 'url';
    }

    if (importedPath[0] === '.' || importedPath[0] === '/') {
      return 'local';
    }

    if (partial && !isPrecise(importedPath)) {
      return 'imprecise';
    }
    return 'dep';
  }

  resolve(importedPath: string): DepResolution | LocalResolution | URLResolution;
  resolve(importedPath: string, partial: true): DepResolution | LocalResolution | URLResolution | ImpreciseResolution;
  resolve(importedPath: string, partial = false): Resolution | undefined {
    switch (Package.categorize(importedPath, partial)) {
      case 'url':
        return { type: 'url', url: importedPath };
      case 'local':
        return {
          type: 'local',
          local: importedPath,
        };
      case 'imprecise':
        if (partial) {
          return {
            type: 'imprecise',
          };
        }
        break;
    }

    let path = this.aliasFor(importedPath);
    let [first, ...rest] = path.split('/');
    let packageName;
    if (first[0] === '@') {
      packageName = `${first}/${rest.shift()}`;
    } else {
      packageName = first;
    }

    if (this.excludesDependency(packageName)) {
      // This package has been explicitly excluded.
      return;
    }

    if (!this.hasDependency(packageName)) {
      return;
    }

    let packagePath = resolvePackagePath(packageName, this.root);
    if (packagePath === null) {
      throw new Error(
        `${this.name} tried to import "${packageName}" but the package was not resolvable from ${this.root}`
      );
    }

    if (isEmberAddonDependency(packagePath)) {
      // ember addon are not auto imported
      return;
    }
    this.assertAllowedDependency(packageName);
    return {
      type: 'package',
      path,
      packageName,
      local: rest.join('/'),
      packagePath,
    };
  }

  excludePackageByName(name: string) {
    this.localExcludes.add(name);
  }

  private assertAllowedDependency(name: string) {
    if (this.isAddon && !this.hasNonDevDependency(name)) {
      throw new Error(
        `${this.name} tried to import "${name}" from addon code, but "${name}" is a devDependency. You may need to move it into dependencies.`
      );
    }
  }

  private excludesDependency(name: string): boolean {
    return this.localExcludes.has(name);
  }

  get webpackConfig(): any {
    return this.autoImportOptions && this.autoImportOptions.webpack;
  }

  get skipBabel(): Options['skipBabel'] {
    return this.autoImportOptions && this.autoImportOptions.skipBabel;
  }

  private aliasFor(name: string): string {
    let alias = this.autoImportOptions?.alias;
    if (!alias) return name;
    if (alias[name]) return alias[name];

    let prefix = Object.keys(alias).find(p => name.startsWith(`${p}/`));
    if (prefix) return alias[prefix] + name.slice(prefix.length);

    return name;
  }

  get fileExtensions(): string[] {
    this._ensureBabelDetails();

    // type safety: this will have been populated by the call above
    return this._emberCLIBabelExtensions!;
  }

  get publicAssetURL(): string | undefined {
    let url = this.autoImportOptions && this.autoImportOptions.publicAssetURL;
    if (url) {
      if (url[url.length - 1] !== '/') {
        url = url + '/';
      }
    }
    return url;
  }

  get forbidsEval(): boolean {
    // only apps (not addons) are allowed to set this, because it's motivated by
    // the apps own Content Security Policy.
    return Boolean(!this.isAddon && this.autoImportOptions && this.autoImportOptions.forbidEval);
  }

  get watchedDirectories(): string[] | undefined {
    // only apps (not addons) are allowed to set this
    if (!this.isAddon && this.autoImportOptions?.watchDependencies) {
      return this.autoImportOptions.watchDependencies
        .map(nameOrNames => {
          let names: string[];
          if (typeof nameOrNames === 'string') {
            names = [nameOrNames];
          } else {
            names = nameOrNames;
          }
          let cursor = this.root;
          for (let name of names) {
            let path = resolvePackagePath(name, cursor);
            if (!path) {
              return undefined;
            }
            cursor = dirname(path);
          }
          return cursor;
        })
        .filter(Boolean) as string[];
    }
  }
}

const isAddonCache = new Map<string, boolean>();
function isEmberAddonDependency(pathToPackageJSON: string): boolean {
  let cached = isAddonCache.get(pathToPackageJSON);
  if (cached === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let packageJSON = require(pathToPackageJSON);
    let answer = packageJSON.keywords?.includes('ember-addon') || false;
    isAddonCache.set(pathToPackageJSON, answer);
    return answer;
  } else {
    return cached;
  }
}

function count(str: string, letter: string): number {
  return [...str].reduce((a, b) => a + (b === letter ? 1 : 0), 0);
}

function isPrecise(leadingQuasi: string): boolean {
  if (leadingQuasi.startsWith('.') || leadingQuasi.startsWith('/')) {
    return true;
  }
  let slashes = count(leadingQuasi, '/');
  let minSlashes = leadingQuasi.startsWith('@') ? 2 : 1;
  return slashes >= minSlashes;
}

function excludePackagesFomOptions(opts: Options | undefined) {
  if (opts) {
    if (Array.isArray(opts.exclude)) {
      return opts.exclude;
    }
  }
  return [];
}
