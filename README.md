ember-auto-import
==============================================================================

Just `import` from NPM, with zero configuration.

Installation
------------------------------------------------------------------------------

```
ember install ember-auto-import
```


Usage
------------------------------------------------------------------------------

Add whatever dependency you want to your project using NPM or yarn like:

```
npm install --save-dev lodash-es
```

or

```
yarn add --dev lodash-es
```

Then just import it from your Ember app code:

```js
import { capitalize } from 'lodash-es';
```

There is no step two. Works from both app code and test code.

Dynamic Import
------------------------------------------------------------------------------

In addition to static top-level `import` statements, you can use dynamic `import()` to lazily load your dependencies. This can be great for reducing your initial bundle size.

Dynamic import is currently a Stage 3 ECMA feature, so to use it there are a few extra setup steps:

1. `npm install --save-dev babel-eslint`
2. In your `.eslintrc.js` file, add

        parser: 'babel-eslint'
3. In your `ember-cli-build.js` file, enable the babel plugin provided by ember-auto-import:

```js
let app = new EmberApp(defaults, {
  babel: {
    plugins: [ require.resolve('ember-auto-import/babel-plugin') ]
  }
});
```

Once you're setup, you can use dynamic `import()` and it will result in loading that particular dependency (and all its recursive dependencies) via a separate Javascript file at runtime. Here's an example of using dynamic import from within a `Route`, so that the extra library needed for the route is loaded at the same time the data is loaded:

```js
export default Route.extend({
  model({ id }) {
    return Promise.all([
      fetch(`/data-for-chart/${id}`).then(response => response.json()),
      import('highcharts').then(module => module.default)
    ]).then(([ dataPoints, highcharts ]) => {
      return { dataPoints, highcharts };
    });
  }
});
```

If you're using custom deployment code, make sure it will include all the Javascript files in `dist/assets`, not just the default `app.js` and `vendor.js`.

Customizing Build Behavior
------------------------------------------------------------------------------

While most NPM packages authored in CommonJS or ES Modules will Just Work, for others you may need some give ember-auto-import a hint about what to do.

You can set options like this in your ember-cli-build.js:

```js
// In your ember-cli-build.js file
let app = new EmberApp(defaults, {
  autoImport: {
    alias: {
      // when the app tries to import from "plotly.js", use
      // the real package "plotly.js-basic-dist" instead.
      'plotly.js': 'plotly.js-basic-dist',

      // you can also use aliases to pick a different entrypoint
      // within the same package. This can come up when the default
      // entrypoint only works in Node, but there is also a browser
      // build available (and the author didn't provide a "browser"
      // field in package.json that would let us detect it
      // automatically).
      'handlebars': 'handlebars/dist/handlebars'
    },
    exclude: ['some-package'],
    skipBabel: [{
      // when an already babel transpiled addons like "mapbox-gl" is 
      // not skipped, it can produce errors in the production mode 
      // due to double transpilation
      package: 'mapbox-gl',
      semverRange: '*'
    }, {
      // list can continue
    }],
    webpack: {
      // extra webpack configuration goes here
    }
  }
});
```

Supported Options

 - `alias`: _object_, Map from package names to substitute packages that will be used instead.
 - `exclude`: _list of strings, defaults to []_. Packages in this list will be ignored by ember-auto-import. Can be helpful if the package is already included another way (like a shim from some other Ember addon).
 - `forbidEval`: _boolean_, controls if `eval` is used in development. It is used because that is the fastest way to provide sourcemaps. Defaults to `false` unless [ember-cli-content-security-policy](https://github.com/rwjblue/ember-cli-content-security-policy) is used.
 - `publicAssetURL`: where to load additional dynamic javascript files from. You usually don't need to set this -- the default works for most apps. However, if you're using `<script defer>` or another method of asynchronously loading your vendor.js script you will need to set this to the URL where your asset directory is served (typically `/assets`).
 - `skipBabel`: _list of objects, defaults to []_. The specified packages will be skipped from babel transpilation.
 - `webpack`: _object_, An object that will get merged into the configuration we pass to webpack. This lets you work around quirks in underlying libraries and otherwise customize the way Webpack will assemble your dependencies.

Usage from Addons
------------------------------------------------------------------------------

Using ember-auto-import inside an addon is almost exactly the same as inside an app. The only differences are:

 - ember-auto-import must be in the  `dependencies` of your addon, not in `devDependencies`. Otherwise it won't come along when people install your addon.
 - ember-auto-import will refuse to import `devDependencies` of your addon, for the same reason. Whatever you're importing must be in `dependencies`.
 - ember-auto-import will not detect import statements inside your `app` folder. This is because the files inside `app` are conceptually not part of your addon's own package namespace at all, so they don't get access to your addon's dependencies. Do all your auto-importing from the `addon` folder, and reexport in `app` as needed.
 - you configure ember-auto-import in your `index.js` file (not your `ember-cli-build.js` file), like this:

    ```js
    // In your addon's index.js file
    module.exports = {
      name: 'sample-addon',
      options: {
        autoImport:{
          exclude: ['some-package'],
          webpack: {
            // extra webpack configuration goes here
          }
        }
      }
    };
    ```
 - if your addon has an `included` hook, it's critical that you call `super` correctly so that ember-auto-import's `included` will also run:
    ```js
    included() {
      this._super.included.apply(this, arguments);
    }
    ```
 - if your addon uses [Dynamic Import](#dynamic-import), it is [required](https://github.com/babel/ember-cli-babel#options) that you
   register the babel plugin in your `index.js` instead of `ember-cli-build.js`:
    ```js
    // index.js
    module.exports = {
      options: {
        babel: {
          plugins: [ require.resolve('ember-auto-import/babel-plugin') ]
        }
      }
    };
    ```
FAQ
---

### `global is undefined` or `can't find module "path"` or `can't find module "fs"`

You're trying to use a library that is written to work in NodeJS and not in the browser. You can choose to polyfill the Node feature you need by passing settings to webpack. For example:


```
let app = new EmberApp(defaults, {
  autoImport: {
    webpack: {
      node: {
        global: true,
        fs: 'empty'
      }
    }
  }
```

See [webpack's docs on Node polyfills](https://v4.webpack.js.org/configuration/node/).


###  I use Content Security Policy (CSP) and it breaks ember-auto-import.

Ember Auto Import uses `eval` in development if `forbidEval` is `false`. Recent versions detect if [ember-cli-content-security-policy](https://github.com/rwjblue/ember-cli-content-security-policy) is used. `forbidEval` default to `true` in that cases.

If you use an older version or use Content Security Policy without that addon, you should set `forbidEval` option to `true` explicitly.

### I'm trying to load a jQuery plugin, but it doesn't attach itself to the copy of jQuery that's already in my Ember app.

Ember apps typically get jQuery from the `ember-source` or `@ember/jquery` packages. Neither of these is the real `jquery` NPM package, so ember-auto-import cannot "see" it statically at build time. You will need to give webpack a hint to treat jQuery as external:

```js
// In your ember-cli-build.js file
let app = new EmberApp(defaults, {
  autoImport: {
    webpack: {
      externals: { jquery: 'jQuery' }
    }
  }
});
```

Also, some jQuery plugins like masonry and flickity have [required manual steps to connect them to jQuery](https://github.com/ef4/ember-auto-import/issues/59#issuecomment-405391414).

### I upgraded my `ember-auto-import` version and now things don't import. What changed?

As of version `1.4.0`, by default, `ember-auto-import` does not include webpack's automatic polyfills for certain Node packages.
Some signs that your app was depending on these polyfills by accident are things like "global is not defined," "can't resolve path," or "default is not a function."
You can opt-in to [Webpack's polyfills](https://webpack.js.org/configuration/node/), or install your own.
See [this issue](https://github.com/ef4/ember-auto-import/issues/224#issuecomment-503400386) for an example.

### I get `Uncaught ReferenceError: a is not defined` [251](https://github.com/ef4/ember-auto-import/issues/251) with an already babel transpiled addon, e.g: `mapbox-gl`

We should skip that specific addon from the ember-auto-import's babel transpilation as:  

```js
// In your app's ember-cli-build.js file or check the `Usage from Addons` section for relevant usage of the following in addons
let app = new EmberApp(defaults, {
  autoImport: {
    skipBabel: [{
      package: 'mapbox-gl',
      semverRange: '*'
    }]
  }
});
```

Debugging Tips
--------------

Set the environment variable `DEBUG="ember-auto-import:*"` to see debug logging during the build.

To see Webpack's console output, set the environment variable `AUTO_IMPORT_VERBOSE=true`.

Credit / History
------------------------------------------------------------------------------

Takes inspiration and some code from ember-browserify and ember-cli-cjs-transform. This package is basically what you get when you combine the ideas from those two addons.


Contributing
------------------------------------------------------------------------------

[See CONTRIBUTING.md](CONTRIBUTING.md)

License
------------------------------------------------------------------------------

This project is licensed under the [MIT License](LICENSE.md).
