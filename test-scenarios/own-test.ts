import { supportMatrix } from './scenarios';
import { PreparedApp, Scenarios } from 'scenario-tester';
import QUnit from 'qunit';
import { dirname, resolve } from 'path';
const { module: Qmodule, test } = QUnit;

// this runs ember-auto-import's own tests (but through our support matrix, so
// we get separate test runs for different ember-cli versions, for example)
supportMatrix(Scenarios.fromDir(dirname(require.resolve('ember-auto-import/package.json'))))
  // this is here because we want our scenarios to have a name.
  .map('own', () => {})
  .forEachScenario(scenario => {
    Qmodule(scenario.name, function (hooks) {
      let app: PreparedApp;
      hooks.before(async () => {
        app = await scenario.prepare();
      });
      test('npm run test', async function (assert) {
        let result = await app.execute('npm run test');
        assert.equal(result.exitCode, 0, result.output);
      });
      test('npm run node:test', async function (assert) {
        let result = await app.execute('npm run test:node');
        assert.equal(result.exitCode, 0, result.output);
      });
    });
  });

Qmodule('self-version-check', function () {
  test('npm run test', async function (assert) {
    assert.equal(
      require('./package.json').devDependencies['ember-auto-import'],
      require(resolve(__dirname, '../packages/ember-auto-import/package.json')).version
    );
  });
});
