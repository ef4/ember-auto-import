import EmberRouter from '@ember/routing/router';
import config from 'sample-direct/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('dynamic-import');
  this.route('dynamic-flavor', { path: '/flavor/:which' });
  this.route('native-import');
  this.route('data-import');
});
