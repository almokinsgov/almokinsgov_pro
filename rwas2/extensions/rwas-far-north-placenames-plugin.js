;(function (window) {
"use strict";

if (!window.RWAS_FAR_NORTH_IMPACT) {
  console.warn("RWAS Far North Placenames requires rwas-far-north-impact.js.");
  return;
}

const plugin = window.RWAS_FAR_NORTH_IMPACT.createPlugin({
  id: "rwas-far-north-placenames",
  name: "RWAS Far North Placenames",
  version: "0.1.0",
  description: "Lists named Far North places located inside each RWAS alert or warning polygon.",
  matchMode: "point-in-polygon",
  defaults: {
    geoJsonUrl: "./extensions/Far North Placenames.geojson",
    nameProperty: "name",
    sectionLabel: "Places affected",
    nonPolygonBufferKm: 2,
    emptyMessage: "No Far North placenames were identified inside this alert polygon."
  }
});

window.RWAS_PLUGINS = window.RWAS_PLUGINS || [];
window.RWAS_PLUGINS.push(plugin);
})(window);
