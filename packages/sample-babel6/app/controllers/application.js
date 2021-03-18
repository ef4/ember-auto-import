import Controller from '@ember/controller';
import { computed } from '@ember/object';
import aDependency from 'a-dependency';
import aModuleDependency from 'a-module-dependency';

export default Controller.extend({
  result: computed(function () {
    return aDependency();
  }),

  moduleResult: computed(function () {
    return aModuleDependency();
  }),
});
