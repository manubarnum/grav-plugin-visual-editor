/** Encode a native file input in Grav's configuration field so no template override is required. */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('[data-grav-editor]')) {
      var input = document.querySelector('[data-visual-editor-config-input]');
      if (input) { input.value = document.documentElement.getAttribute('data-visual-editor-config') || ''; }
    }
  });
}());
