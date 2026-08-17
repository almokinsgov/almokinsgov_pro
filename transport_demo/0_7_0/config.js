/*
  Transport Page Browser feature configuration.

  Set a feature to false to remove it from the interface for this deployment.
  The default configuration keeps every feature enabled.

  This file is intentionally separate from workspace JSON. A workspace can be
  moved between a full authoring build and a restricted publishing build
  without changing the workspace data itself.
*/
window.TRANSPORT_PAGE_BROWSER_CONFIG = {
  version: 1,
  features: {
    editorMode: false,
    showRemovedControl: false,
    saveControls: false,
    restoreControls: false,
    history: false,
    images: true,
    workspaceImportExport: true,
    codeView: false,
    copyTools: false,
    dynamicPlaceholders: true,
    metadataCopy: true,
    saveInfo: false
  }
};
