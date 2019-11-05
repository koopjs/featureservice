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
    // @todo: use the URL class once pre-node 6 has been deprecated
    var match = url.match(/^(.+?\/(?:feature|map)server)(?:\/(\d+))?/i)

    if (null === match) {
      throw new TypeError('unable to parse ' + url + ' as a mapserver or featureserver with optional layer')
    }

    return {
      layer: match[2],
      server: match[1],
      hosted: /services(\d)?(qa|dev)?.arcgis.com/.test(url)
    }
  },
  /**
   * Strip characters off a layer that don't belong
   * @param {string} raw - a raw layer options
   * @return {string} the layer index
   */
  sanitizeLayer: function (raw) {
    if (typeof raw === 'number') return raw
    else if (typeof raw !== 'string') return undefined

    var match = raw.match(/\/?(\d+)/)
    return match && match[1] ? match[1] : undefined
  }
}
