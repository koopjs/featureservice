module.exports = {
  /**
   * Given a service url and a geometry type, determines a default concurrency for requests
   *
   * @param {boolean} hosted - whether or not the service is hosted on ArcGIS Online
   * @param {string} geomType - the geometry type of the features in the service
   * @return {integer} the suggested concurrency
   */
  setConcurrency: function (hosted, geomType) {
    var naieve = hosted ? 16 : 4
    if (!geomType) return naieve
    var concurrency = geomType.match(/point/i) ? naieve : naieve / 4
    return Math.floor(concurrency)
  },
  /**
   * Parsed the layer and server from a feature service url
   * @param {string} url - a link to a feature service
   * @return {object} contains the layer, the server and whether or not the server is hosted
   */
  parseUrl: function (url) {
    var layer = url.match(/(?:.+\/(?:feature|map)server\/)(\d+)/i)
    return {
      layer: layer && layer[1] ? layer[1] : undefined,
      server: url.match(/.+\/(feature|map)server/i)[0],
      hosted: /services(\d)?(qa|dev)?.arcgis.com/.test(url)
    }
  }
}
