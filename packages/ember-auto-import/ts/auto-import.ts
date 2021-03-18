import Splitter from './splitter';
import Bundler from './bundler';
import Analyzer from './analyzer';
import type { TreeType } from './analyzer';
import Package from './package';
import { buildDebugCallback } from 'broccoli-debug';
import BundleConfig from './bundle-config';
import Append from './broccoli-append';
import { Node } from 'broccoli-node-api';
import { LeaderChooser } from './leader';
import { AddonInstance, AppInstance, findTopmostAddon } from './ember-cli-models';

const debugTree = buildDebugCallback('ember-auto-import');

// This interface must be stable across all versions of ember-auto-import that
// speak the same leader-election protocol. So don't change this unless you know
// what you're doing.
export interface AutoImportSharedAPI {
  isPrimary(addonInstance: AddonInstance): boolean;
  analyze(tree: Node, addon: AddonInstance, treeType?: TreeType): Node;
  included(addonInstance: AddonInstance): void;
  updateFastBootManifest(manifest: { vendorFiles: string[] }): void;
}

export default class AutoImport implements AutoImportSharedAPI {
  private primaryPackage: AddonInstance;
  private packages: Set<Package> = new Set();
  private env: 'development' | 'test' | 'production';
  private consoleWrite: (msg: string) => void;
  private analyzers: Map<Analyzer, Package> = new Map();
  private bundles: BundleConfig;
  private targets: unknown;

  static register(addon: AddonInstance) {
    LeaderChooser.for(addon).register(addon, () => new AutoImport(addon));
  }

  static lookup(addon: AddonInstance): AutoImportSharedAPI {
    return LeaderChooser.for(addon).leader;
  }

  constructor(addonInstance: AddonInstance) {
    this.primaryPackage = addonInstance;
    let topmostAddon = findTopmostAddon(addonInstance);
    let host = topmostAddon.app;
    this.env = host.env;
    this.targets = host.project.targets;

    let entryPackage = Package.lookupParentOf(topmostAddon);
    entryPackage.excludePackageByName(host.project.pkg.name);

    this.packages.add(entryPackage);

    this.bundles = new BundleConfig(host);
    if (!this.env) {
      throw new Error('Bug in ember-auto-import: did not discover environment');
    }

    this.consoleWrite = (...args) => addonInstance.project.ui.write(...args);
  }

  isPrimary(addon: AddonInstance) {
    return this.primaryPackage === addon;
  }

  analyze(tree: Node, addon: AddonInstance, treeType?: TreeType) {
    let pack = Package.lookupParentOf(addon);
    this.packages.add(pack);
    let analyzer = new Analyzer(debugTree(tree, `preprocessor:input-${this.analyzers.size}`), pack, treeType);
    this.analyzers.set(analyzer, pack);
    return analyzer;
  }

  private makeBundler(allAppTree: Node) {
    // The Splitter takes the set of imports from the Analyzer and
    // decides which ones to include in which bundles
    let splitter = new Splitter({
      analyzers: this.analyzers,
      bundles: this.bundles,
    });

    // The Bundler asks the splitter for deps it should include and
    // is responsible for packaging those deps up.
    return new Bundler(allAppTree, {
      splitter,
      environment: this.env,
      packages: this.packages,
      consoleWrite: this.consoleWrite,
      bundles: this.bundles,
      targets: this.targets,
    });
  }

  addTo(allAppTree: Node) {
    let bundler = debugTree(this.makeBundler(allAppTree), 'output');

    let mappings = new Map();
    for (let name of this.bundles.names) {
      let byType = new Map();
      mappings.set(`entrypoints/${name}`, byType);
      for (let type of this.bundles.types) {
        let target = this.bundles.bundleEntrypoint(name, type);
        byType.set(type, target);
      }
    }

    let passthrough = new Map();
    passthrough.set('lazy', this.bundles.lazyChunkPath);

    return new Append(allAppTree, bundler, {
      mappings,
      passthrough,
    });
  }

  included(addonInstance: AddonInstance) {
    let host = findTopmostAddon(addonInstance).app;
    this.configureFingerprints(host);

    // ember-cli as of 3.4-beta has introduced architectural changes that make
    // it impossible for us to nicely emit the built dependencies via our own
    // vendor and public trees, because it now considers those as *inputs* to
    // the trees that we analyze, causing a circle, even though there is no
    // real circular data dependency.
    //
    // We also cannot use postprocessTree('all'), because that only works in
    // first-level addons.
    //
    // So we are forced to monkey patch EmberApp. We insert ourselves right at
    // the beginning of addonPostprocessTree.
    let original = host.addonPostprocessTree.bind(host);
    host.addonPostprocessTree = (which: string, tree: Node) => {
      if (which === 'all') {
        tree = this.addTo(tree);
      }
      return original(which, tree);
    };
  }

  // We need to disable fingerprinting of chunks, because (1) they already
  // have their own webpack-generated hashes and (2) the runtime loader code
  // can't easily be told about broccoli-asset-rev's hashes.
  private configureFingerprints(host: AppInstance) {
    let pattern = 'assets/chunk.*.js';
    if (!host.options.fingerprint) {
      host.options.fingerprint = {};
    }
    if (!('exclude' in host.options.fingerprint)) {
      host.options.fingerprint.exclude = [pattern];
    } else {
      host.options.fingerprint.exclude.push(pattern);
    }
  }

  updateFastBootManifest(manifest: { vendorFiles: string[] }) {
    manifest.vendorFiles.push(`${this.bundles.lazyChunkPath}/auto-import-fastboot.js`);
  }
}
