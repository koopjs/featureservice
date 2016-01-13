module.exports = {
  /**
   * Given a service url and a geometry type, determines a default concurrency for requests
   *
   * @param {string} service - the feature or map service targeted
   * @param {string} geomType - the geometry type of the features in the service
   * @return {integer} the suggested concurrency
   */
  setConcurrency: function (service, geomType) {
    var isHosted = service.match(/services(\d)?(qa|dev)?.arcgis.com/)
    var naieve = isHosted ? 16 : 4
    if (!geomType) return naieve
    var concurrency = geomType.match(/point/i) ? naieve : naieve / 4
    return Math.floor(concurrency)
  }
}
