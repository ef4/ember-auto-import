import webpack, { Configuration } from 'webpack';
import { join, dirname } from 'path';
import { mergeWith, flatten, zip } from 'lodash';
import { writeFileSync, realpathSync } from 'fs';
import { compile, registerHelper } from 'handlebars';
import jsStringEscape from 'js-string-escape';
import { BundleDependencies, ResolvedImport, sharedResolverOptions } from './splitter';
import { BundlerHook, BuildResult } from './bundler';
import BundleConfig from './bundle-config';
import { ensureDirSync } from 'fs-extra';
import { babelFilter, templateCompilerModule } from '@embroider/core';
import { Options } from './package';
import type { HbsLoaderConfig } from '@embroider/hbs-loader';
import { Memoize } from 'typescript-memoize';

registerHelper('js-string-escape', jsStringEscape);
registerHelper('join', function (list, connector) {
  return list.join(connector);
});

const entryTemplate = compile(`
if (typeof document !== 'undefined') {
  {{#if publicAssetURL}}
  __webpack_public_path__ = '{{js-string-escape publicAssetURL}}';
  {{else}}
  {{!
      locate the webpack lazy loaded chunks relative to the currently executing
      script. The last <script> in DOM should be us, assuming that we are being
      synchronously loaded, which is the normal thing to do. If people are doing
      weirder things than that, they may need to explicitly set a publicAssetURL
      instead.
  }}
  __webpack_public_path__ = (function(){
    var scripts = document.querySelectorAll('script');
    return scripts[scripts.length - 1].src.replace(/\\/[^/]*$/, '/');
  })();
  {{/if}}
}

module.exports = (function(){
  var d = _eai_d;
  var r = _eai_r;
  window.emberAutoImportDynamic = function(specifier) {
    if (arguments.length === 1) {
      return r('_eai_dyn_' + specifier);
    } else {
      return r('_eai_dynt_' + specifier)(Array.prototype.slice.call(arguments, 1))
    }
  };
  {{#each staticImports as |module|}}
    d('{{js-string-escape module.specifier}}', [], function() { return require('{{js-string-escape module.entrypoint}}'); });
  {{/each}}
  {{#each dynamicImports as |module|}}
    d('_eai_dyn_{{js-string-escape module.specifier}}', [], function() { return import('{{js-string-escape module.entrypoint}}'); });
  {{/each}}
  {{#each dynamicTemplateImports as |module|}}
    d('_eai_dynt_{{js-string-escape module.key}}', [], function() {
      return function({{module.args}}) {
        return import({{{module.template}}});
      }
    });
  {{/each}}
})();
`) as (args: {
  staticImports: ResolvedImport[];
  dynamicImports: ResolvedImport[];
  dynamicTemplateImports: { key: string; args: string; template: string }[];
  publicAssetURL: string | undefined;
}) => string;

// this goes in a file by itself so we can tell webpack not to parse it. That
// allows us to grab the "require" and "define" from our enclosing scope without
// webpack messing with them.
//
// It's important that we're using our enclosing scope and not jumping directly
// to window.require (which would be easier), because the entire Ember app may be
// inside a closure with a "require" that isn't the same as "window.require".
const loader = `
window._eai_r = require;
window._eai_d = define;
`;

export default class WebpackBundler implements BundlerHook {
  private stagingDir: string;
  private webpack: webpack.Compiler;
  private outputDir: string;

  constructor(
    private bundles: BundleConfig,
    environment: 'production' | 'development' | 'test',
    extraWebpackConfig: webpack.Configuration | undefined,
    private consoleWrite: (message: string) => void,
    private publicAssetURL: string | undefined,
    private skipBabel: Required<Options>['skipBabel'],
    private babelTargets: unknown,
    tempArea: string
  ) {
    // resolve the real path, because we're going to do path comparisons later
    // that could fail if this is not canonical.
    tempArea = realpathSync(tempArea);

    this.stagingDir = join(tempArea, 'staging');
    ensureDirSync(this.stagingDir);
    this.outputDir = join(tempArea, 'output');
    ensureDirSync(this.outputDir);
    let entry: { [name: string]: string[] } = {};
    bundles.names.forEach(bundle => {
      entry[bundle] = [join(this.stagingDir, 'l.js'), join(this.stagingDir, `${bundle}.js`)];
    });

    let config: Configuration = {
      mode: environment === 'production' ? 'production' : 'development',
      entry,
      performance: {
        hints: false,
      },
      output: {
        path: this.outputDir,
        filename: `chunk.[id].[chunkhash].js`,
        chunkFilename: `chunk.[id].[chunkhash].js`,
        libraryTarget: 'var',
        library: '__ember_auto_import__',
      },
      optimization: {
        splitChunks: {
          chunks: 'all',
        },
      },
      resolveLoader: {
        alias: {
          // these loaders are our dependencies, not the app's dependencies. I'm
          // not overriding the default loader resolution rules in case the app also
          // wants to control those.
          'babel-loader-8': require.resolve('babel-loader'),
        },
      },
      resolve: {
        ...sharedResolverOptions,
      },
      module: {
        noParse: file => file === join(this.stagingDir, 'l.js'),
        rules: [this.babelRule(), this.hbsRule()],
      },
      node: false,
    };
    if (extraWebpackConfig) {
      mergeConfig(config, extraWebpackConfig);
    }
    this.webpack = webpack(config);
  }

  @Memoize()
  private get templateCompilerFile(): string {
    let file = join(this.stagingDir, '_template_compiler_.js');
    writeFileSync(
      file,
      templateCompilerModule(
        {
          compilerPath: this.bundles.emberTemplateCompilerPath,
          EmberENV: {},
          plugins: { ast: [] },
        },
        []
      ).src
    );
    return file;
  }

  private babelRule(): webpack.Rule {
    let shouldTranspile = babelFilter(this.skipBabel);
    let stagingDir = this.stagingDir;
    return {
      test(filename: string) {
        // We don't apply babel to our own stagingDir (it contains only our own
        // entrypoints that we wrote, and it can use `import()`, which we want
        // to leave directly for webpack).
        //
        // And we otherwise defer to the `skipBabel` setting as implemented by
        // `@embroider/core`.
        return dirname(filename) !== stagingDir && shouldTranspile(filename);
      },
      use: {
        loader: 'babel-loader-8',
        options: {
          plugins: [
            require.resolve('babel-plugin-ember-data-packages-polyfill'),
            require.resolve('babel-plugin-ember-modules-api-polyfill'),
          ],
          presets: [
            [
              require.resolve('@babel/preset-env'),
              {
                modules: false,
                targets: this.babelTargets,
              },
            ],
          ],
        },
      },
    };
  }

  private hbsRule(): webpack.RuleSetRule {
    let options: HbsLoaderConfig = {
      templateCompilerFile: this.templateCompilerFile,
      // TODO: we will ultimately need to run with multiple variants in prod
      // builds
      variant: {
        name: 'dev',
        runtime: 'all',
        optimizeForProduction: false,
      },
    };
    return {
      test: /\.hbs$/,
      use: [
        {
          loader: require.resolve('@embroider/hbs-loader'),
          options,
        },
      ],
    };
  }

  async build(bundleDeps: Map<string, BundleDependencies>) {
    for (let [bundle, deps] of bundleDeps.entries()) {
      this.writeEntryFile(bundle, deps);
    }
    this.writeLoaderFile();
    let stats = await this.runWebpack();
    return this.summarizeStats(stats);
  }

  private summarizeStats(_stats: Required<webpack.Stats>): BuildResult {
    let stats = _stats.toJson() as Required<webpack.Stats.ToJsonOutput>;
    let output = {
      entrypoints: new Map(),
      lazyAssets: [] as string[],
      dir: this.outputDir,
    };
    let nonLazyAssets: Set<string> = new Set();
    for (let id of Object.keys(stats.entrypoints)) {
      let entrypoint = stats.entrypoints[id];
      output.entrypoints.set(id, entrypoint.assets);
      entrypoint.assets.forEach((asset: string) => nonLazyAssets.add(asset));
    }
    for (let asset of stats.assets) {
      if (!nonLazyAssets.has(asset.name)) {
        output.lazyAssets.push(asset.name);
      }
    }
    return output;
  }

  private writeEntryFile(name: string, deps: BundleDependencies) {
    writeFileSync(
      join(this.stagingDir, `${name}.js`),
      entryTemplate({
        staticImports: deps.staticImports,
        dynamicImports: deps.dynamicImports,
        dynamicTemplateImports: deps.dynamicTemplateImports.map(imp => ({
          key: imp.importedBy[0].cookedQuasis.join('${e}'),
          args: imp.expressionNameHints.join(','),
          template:
            '`' +
            zip(imp.cookedQuasis, imp.expressionNameHints)
              .map(([q, e]) => q + (e ? '${' + e + '}' : ''))
              .join('') +
            '`',
        })),
        publicAssetURL: this.publicAssetURL,
      })
    );
  }

  private writeLoaderFile() {
    writeFileSync(join(this.stagingDir, `l.js`), loader);
  }

  private async runWebpack(): Promise<Required<webpack.Stats>> {
    return new Promise((resolve, reject) => {
      this.webpack.run((err, stats) => {
        if (err) {
          this.consoleWrite(stats.toString());
          reject(err);
          return;
        }
        if (stats.hasErrors()) {
          this.consoleWrite(stats.toString());
          reject(new Error('webpack returned errors to ember-auto-import'));
          return;
        }
        if (stats.hasWarnings() || process.env.AUTO_IMPORT_VERBOSE) {
          this.consoleWrite(stats.toString());
        }
        // this cast is justified because we already checked hasErrors above
        resolve(stats as Required<webpack.Stats>);
      });
    }) as Promise<Required<webpack.Stats>>;
  }
}

export function mergeConfig(dest: Configuration, ...srcs: Configuration[]) {
  return mergeWith(dest, ...srcs, combine);
}

function combine(objValue: any, srcValue: any, key: string) {
  if (key === 'noParse') {
    return eitherPattern(objValue, srcValue);
  }

  // arrays concat
  if (Array.isArray(objValue)) {
    return objValue.concat(srcValue);
  }
}

// webpack configs have several places where they accept:
//   - RegExp
//   - [RegExp]
//   - (resource: string) => boolean
//   - string
//   - [string]
// This function combines any of these with a logical OR.
function eitherPattern(...patterns: any[]): (resource: string) => boolean {
  let flatPatterns = flatten(patterns);
  return function (resource) {
    for (let pattern of flatPatterns) {
      if (pattern instanceof RegExp) {
        if (pattern.test(resource)) {
          return true;
        }
      } else if (typeof pattern === 'string') {
        if (pattern === resource) {
          return true;
        }
      } else if (typeof pattern === 'function') {
        if (pattern(resource)) {
          return true;
        }
      }
    }
    return false;
  };
}
