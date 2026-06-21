;(function (window) {
"use strict";

if (!window.RWAS_FAR_NORTH_IMPACT) {
  console.warn("RWAS Far North Areas requires rwas-far-north-impact.js.");
  return;
}

const plugin = window.RWAS_FAR_NORTH_IMPACT.createPlugin({
  id: "rwas-far-north-areas",
  name: "RWAS Far North Areas",
  version: "0.1.0",
  description: "Lists Far North suburbs and localities that intersect each RWAS alert or warning polygon.",
  matchMode: "polygon-intersection",
  defaults: {
    geoJsonUrl: "./extensions/Far North Suburbs and localities.geojson",
    nameProperty: "name",
    sectionLabel: "Areas affected",
    emptyMessage: "No Far North suburbs or localities intersect this alert polygon."
  }
});

window.RWAS_PLUGINS = window.RWAS_PLUGINS || [];
window.RWAS_PLUGINS.push(plugin);
})(window);
