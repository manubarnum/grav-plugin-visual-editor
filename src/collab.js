/**
 * Admin2 collaborative editing (Sync plugin). Admin2 hands the field a shared Y.XmlFragment, an
 * Awareness and the local user; the editor binds to them with y-prosemirror: shared document,
 * other participants' cursors and a shared undo history (TipTap's own history is then disabled).
 *
 * Yjs must be ONE instance in the page: y-prosemirror relies on `instanceof Y.XmlFragment` and the
 * fragment is created by Admin2's copy. The build redirects `yjs` and `y-protocols/awareness` to
 * relay modules (see build.mjs) bound here to Admin2's `window.__GRAV_YJS__` when collaboration
 * starts; tests use the real packages, which have no binder.
 */
import { Extension, createDocument } from '@tiptap/core';
import { initProseMirrorDoc, prosemirrorToYXmlFragment, redo, undo, yCursorPlugin, ySyncPlugin, yUndoPlugin, yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

function bindSharedYjs() {
  const shared = typeof window !== 'undefined' ? window.__GRAV_YJS__ : null;
  if (typeof Y.__bindShared === 'function') {
    if (!shared) throw new Error('Collaborative editing needs Admin2 (window.__GRAV_YJS__ is missing).');
    Y.__bindShared(shared.Y || shared.yjs);
    awarenessProtocol.__bindShared?.(shared.awareness);
  }
}

/**
 * The document to start from, and its Yjs mapping. An empty fragment (first participant, or a stale
 * fragment Admin2 just cleared) is seeded from the page's Markdown first: y-prosemirror would
 * otherwise render the empty fragment over the content.
 */
export function startCollaboration({ fragment }, schema, html) {
  bindSharedYjs();
  if (fragment.length === 0) {
    const seed = createDocument(html, schema);
    fragment.doc.transact(() => prosemirrorToYXmlFragment(seed, fragment));
  }
  return initProseMirrorDoc(fragment, schema);
}

/** TipTap extension wiring the shared document, cursors and undo; mapping comes from startCollaboration. */
export function collaborationExtension({ fragment, awareness, user }, mapping) {
  return Extension.create({
    name: 'visualEditorCollaboration',
    priority: 1000,
    addProseMirrorPlugins() {
      const plugins = [ySyncPlugin(fragment, { mapping }), yUndoPlugin()];
      if (awareness) {
        if (user) awareness.setLocalStateField('user', user);
        plugins.push(yCursorPlugin(awareness));
      }
      return plugins;
    },
    addKeyboardShortcuts() {
      return {
        'Mod-z': () => undo(this.editor.state),
        'Mod-y': () => redo(this.editor.state),
        'Mod-Shift-z': () => redo(this.editor.state),
      };
    },
  });
}

export function sharedUndo(state) { return undo(state); }
export function sharedRedo(state) { return redo(state); }

export function canSharedUndo(state) { return (yUndoPluginKey.getState(state)?.undoManager.undoStack.length ?? 0) > 0; }
export function canSharedRedo(state) { return (yUndoPluginKey.getState(state)?.undoManager.redoStack.length ?? 0) > 0; }
