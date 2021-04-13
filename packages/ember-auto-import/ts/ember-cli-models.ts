import { Node } from 'broccoli-node-api';
export interface Project {
  targets: unknown;
  ui: {
    write(...args: any[]): void;
  };
  pkg: { name: string; version: string };
  root: string;
  addons: AddonInstance[];
  isEnabled(): boolean;
}

export interface AppInstance {
  env: 'development' | 'test' | 'production';
  project: Project;
  options: any;
  addonPostprocessTree: (which: string, tree: Node) => Node;
}

interface BaseAddonInstance {
  project: Project;
  pkg: { name: string; version: string };
  root: string;
  options: any;
  addons: AddonInstance[];
  name: string;
  isEnabled(): boolean;
}

export interface DeepAddonInstance extends BaseAddonInstance {
  // this is how it looks when an addon is beneath another addon
  parent: AddonInstance;
}

export interface ShallowAddonInstance extends BaseAddonInstance {
  // this is how it looks when an addon is directly beneath the app
  parent: Project;
  app: AppInstance;
}

export type AddonInstance = DeepAddonInstance | ShallowAddonInstance;

export function isDeepAddonInstance(addon: AddonInstance): addon is DeepAddonInstance {
  return addon.parent !== addon.project;
}

export function findTopmostAddon(addon: AddonInstance): ShallowAddonInstance {
  if (isDeepAddonInstance(addon)) {
    return findTopmostAddon(addon.parent);
  } else {
    return addon;
  }
}
