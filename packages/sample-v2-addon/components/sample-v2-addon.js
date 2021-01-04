import { setComponentTemplate } from '@ember/component';
import templateOnlyComponent from '@ember/component/template-only';
import template from './sample-v2-addon.hbs';
export default setComponentTemplate(template, templateOnlyComponent());
