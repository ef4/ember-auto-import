import { module, test } from 'qunit';
import { visit, currentURL } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';

module('Acceptance | v2-addon', function (hooks) {
  setupApplicationTest(hooks);

  test('renders', async function (assert) {
    await visit('/v2-addon');
    assert.equal(currentURL(), '/v2-addon');
    assert.equal(document.querySelector('[data-test="sample-v2-addon"]').textContent.trim(), 'it worked');
  });
});
