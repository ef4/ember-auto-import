import { module, test } from 'qunit';
import { visit } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';

module('Acceptance | basic', function(hooks) {
  setupApplicationTest(hooks);

  test('visiting /basic', async function(assert) {
    await visit('/');
    assert.equal(document.querySelector('[data-test-import-result]').textContent.trim(), 'ember-auto-import-a-dependency');
    assert.equal(document.querySelector('[data-test-module-result]').textContent.trim(), 'module transpiled');
  });
});
