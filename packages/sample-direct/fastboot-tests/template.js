const FastBoot = require('fastboot');
const { execFileSync } = require('child_process');
const { module: Qmodule, test } = require('qunit');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

module.exports = function (environment) {
  Qmodule(`sample-direct | fastboot ${environment}`, function (hooks) {
    let fastboot;

    hooks.before(async function () {
      execFileSync('node', [require.resolve('ember-cli/bin/ember'), 'build', '--environment', environment]);
      fastboot = new FastBoot({
        distPath: 'dist',
        resilient: false,
      });
    });

    test('no test deps in app', async function (assert) {
      let page = await fastboot.visit('/');
      let html = await page.html();
      let document = new JSDOM(html).window.document;
      assert.equal(document.querySelector('.lodash').textContent.trim(), 'no', 'expected lodash to not be present');
    });

    test('app deps in app', async function (assert) {
      let page = await fastboot.visit('/');
      let html = await page.html();
      let document = new JSDOM(html).window.document;
      assert.equal(document.querySelector('.hello-world').textContent.trim(), '2018-05-31', 'expected moment to work');
    });

    test('lazy loaded deps', async function (assert) {
      let page = await fastboot.visit('/dynamic-import');
      let html = await page.html();
      let document = new JSDOM(html).window.document;
      assert.equal(
        document.querySelector('[data-test="dynamic-import-result"]').textContent.trim(),
        'ember-auto-import-a-dependency'
      );
    });

    test('lazy loaded template deps', async function (assert) {
      let page = await fastboot.visit('/flavor/vanilla');
      let html = await page.html();
      let document = new JSDOM(html).window.document;
      assert.equal(document.querySelector('[data-test="dynamic-import-result"]').textContent.trim(), 'vanilla');
    });

    test('v2-addon', async function (assert) {
      let page = await fastboot.visit('/v2-addon');
      let html = await page.html();
      let document = new JSDOM(html).window.document;
      assert.equal(document.querySelector('[data-test="sample-v2-addon"]').textContent.trim(), 'it worked');
    });
  });
};
