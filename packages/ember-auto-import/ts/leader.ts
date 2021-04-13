import { gt } from 'semver';
import type AutoImport from './auto-import';
import { Project, AddonInstance } from './ember-cli-models';
import { Node } from 'broccoli-node-api';

const protocolV1 = '__ember_auto_import_protocol_v1__';
const protocolV2 = '__ember_auto_import_protocol_v2__';
const g = (global as any) as {
  [protocolV1]: any;
  [protocolV2]: WeakMap<Project, LeaderChooser> | undefined;
};

export class LeaderChooser {
  static for(addon: AddonInstance): LeaderChooser {
    let map: WeakMap<Project, LeaderChooser> | undefined = g[protocolV2];
    if (!map) {
      map = g[protocolV2] = new WeakMap();
    }
    // this needs to be based on project and not app instance because at the
    // early stage where we're doing `register`, the app instance isn't
    // available on the addons yet
    let project = addon.project;
    let chooser = map.get(project);
    if (!chooser) {
      chooser = new this();
      map.set(project, chooser);
    }
    return chooser;
  }

  private tentative: { create: () => AutoImport; version: string; parent: AddonInstance | Project } | undefined;
  private locked: AutoImport | undefined;

  register(addon: AddonInstance, create: () => AutoImport) {
    if (this.locked) {
      throw new Error(`bug: LeaderChooser already locked`);
    }
    let version = addon.pkg.version;
    let parent = addon.parent;
    if (!this.tentative || gt(version, this.tentative.version)) {
      this.tentative = { create, version, parent };
    }
  }

  get leader(): AutoImport {
    if (!this.locked) {
      if (!this.tentative) {
        throw new Error(`bug: no candidates added`);
      }

      let parentIncludedHookWillRun = this.tentative.parent.isEnabled?.() ?? true;
      if (!parentIncludedHookWillRun) {
        const parentName = this.tentative.parent.root.split('/').pop();
        throw new Error(`bug: ${parentName} is the parent of the leader, but it's isEnabled hook returns false`);
      }

      this.locked = this.tentative.create();
      let v1 = g[protocolV1];
      if (v1?.isV1Placeholder) {
        v1.leader = this.locked;
      }
    }
    return this.locked;
  }
}

class V1Placeholder {
  isV1Placeholder = true;
  leader: AutoImport | undefined;

  // we never want v1-speaking copies of ember-auto-import to consider
  // themselves primary, so if they're asking here, the answer is no.
  isPrimary() {
    return false;
  }

  // this is the only method that is called after isPrimary returns false. So we
  // need to implement this one and don't need to implement the other public API
  // of AutoImport.
  analyze(tree: Node, addon: AddonInstance) {
    if (!this.leader) {
      throw new Error(
        `bug: expected some protcol v2 copy of ember-auto-import to take charge before any v1 copy started trying to analyze trees`
      );
    }
    return this.leader.analyze(tree, addon);
  }
}

// at module load time, preempt all earlier versions of ember-auto-import that
// don't use our v2 leadership protocol. This ensures that the v2 protocol will
// pick which version is in charge (and v1-speaking copies won't be eligible).
(function v1ProtocolCompat() {
  let v1 = g[protocolV1];
  if (v1) {
    if (!v1.isV1Placeholder) {
      throw new Error(`bug: an old version of ember-auto-import has already taken over. This is unexpected.`);
    }
  } else {
    g[protocolV1] = new V1Placeholder();
  }
})();
