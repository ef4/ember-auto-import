import EmberRouter from '@ember/routing/router';
import config from './config/environment';

const Router = EmberRouter.extend({
  location: config.locationType,
  rootURL: config.rootURL,
});

Router.map(function () {
  this.route('dynamic-import');
  this.route('dynamic-flavor', { path: '/flavor/:which' });
  this.route('native-import');
  this.route('v2-addon');
});

export default Router;
