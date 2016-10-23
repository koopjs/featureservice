var queue = require('async').queue
var Utils = require('./lib/utils.js')

/**
 * Feature Service constructor. Requires a URL.
 * Exposes a pageQueue that can take an array of page URLs.
 * The pageQueue will report back each page of features as they return.
 *
 * @class
 * @param {string} url - address of feature service
 * @param {object} options - layer (default: 0)
 */
var FeatureService = function (url, options) {
  // catch omission of `new` keyword
  if (!(this instanceof FeatureService)) {
    return new FeatureService(url, options)
  }
  var service = Utils.parseUrl(url)
  this.hosted = service.hosted
  this.server = service.server
  this.options = options || {}
  if (this.options.layer || this.options.layer === 0) this.options.layer = Utils.sanitizeLayer(this.options.layer)
  this.options.size = this.options.size || 5000
  this.options.backoff = this.options.backoff || 1000
  this.options.timeOut = this.options.timeOut || (1.5 * 60 * 1000)
  this.layer = this.options.layer || service.layer || 0

  this.logger = this.options.logger

  this._request = require('request').defaults({
    gzip: true,
    // had to remove forever agent due to https://github.com/nodejs/node/issues/3595
    // this is fixed in node 4
    timeout: this.options.timeOut,
    headers: {
      'user-agent': 'Featureservices-Node'
    }
  })

  // an async for requesting pages of data
  this.pageQueue = queue(this._requestFeatures.bind(this), this.options.concurrency || 4)
}

/**
 * Wraps logging functionality so a logger can be passed in
 *
 * @param {string} level - the log level to use
 * @param {string} message - the message to log
 */
FeatureService.prototype.log = function (level, message) {
  if (this.logger && this.logger.log) return this.logger.log(level, message)
  this._console(level, message)
}

/**
 * Wraps console logging to make it testable
 *
 * @param {string} level - the log level to use
 * @param {string} message - the message to log
 */
FeatureService.prototype._console = function (level, message) {
  switch (level) {
    case 'info':
      console.info(message)
      break
    case 'warn':
      console.warn(message)
      break
    case 'error':
      console.error(message)
      break
    default:
      console.log(message)
  }
}

/**
 * Wrap the request.get method for easier testing
 * @param {string} url
 * @param {function} callback
 */
 // TODO combine this with _requestFeatures
FeatureService.prototype.request = function (url, callback) {
  var json
  // to ensure things are encoded just right for ArcGIS
  var encoded = encodeURI(decodeURI(url))
  var options = {
    method: 'GET',
    url: encoded
  }
  this._request(options, function (err, res) {
    if (err) {
      if (err.message === 'ESOCKETTIMEDOUT') err.code = 504
      return callback(err)
    }
    try {
      json = JSON.parse(res.body)
    } catch (err) {
      // sometimes we get html or plain strings back
      var pattern = new RegExp(/[^{\[]/)
      if (res.body.slice(0, 1).match(pattern)) {
        return callback(new Error('Received HTML or plain text when expecting JSON'))
      }
      return callback(new Error('Failed to parse server response'))
    }
    callback(null, json)
  })
}

/**
 * Builds a url for querying the min/max values of the object id
 *
 * @param {string} field - the name of a field to build a stat request for
 * @returns {string} url
 */
FeatureService.prototype._statsUrl = function (field, stats) {
  field = field || this.options.objectIdField
  var json = []

  stats.forEach(function (stat) {
    json.push({
      'statisticType': stat,
      'onStatisticField': field,
      'outStatisticFieldName': stat + '_' + field
    })
  })

  return this.server + '/' + this.layer + '/query?f=json&outFields=&outStatistics=' + JSON.stringify(json)
}

/**
 * Gets the feature service info
 * @param {string} field - the name of a field to build a stat request for
 * @param {array} stats - an array of stats to request: ['min', 'max', 'avg', 'stddev', 'count']
 */
FeatureService.prototype.statistics = function (field, stats, callback) {
  var url = this._statsUrl(field, stats)
  this.request(url, function (err, json) {
    if (err || json.error) {
      if (!json) json = {error: {}}
      var error = new Error('Request for statistics failed')
      error.timestamp = new Date()
      error.code = json.error.code || 500
      error.body = err || json.error
      error.url = url
      return callback(error)
    }
    callback(null, json)
  })
}

/**
 * Gets the feature service info
 * @param {function} callback - called when the service info comes back
 */
FeatureService.prototype.info = function (callback) {
  if (typeof callback === 'undefined') return this._info
  if (this._info) return callback(null, this._info)
  var url = this.server + '?f=json'
  this.request(url, function (err, json) {
    /**
     * returns error on three conditions:
     * 1. err is present
     * 2. missing response json
     * 3. error in response json
     */
    if (err || !json || json.error) {
      if (!json) json = {error: {}}
      var error = new Error('Request for service information failed')
      error.timestamp = new Date()
      error.url = url
      error.code = json.error.code || 500
      error.body = json.error

      return callback(error)
    }
    this._info = json
    json.url = url
    callback(null, json)
  })
}

/**
 * Gets the feature service layer info
 * @param {function} callback - called when the layer info comes back
 */
FeatureService.prototype.layerInfo = function (callback) {
  // used saved version if available
  if (typeof callback === 'undefined') return this._layerInfo
  if (this._layerInfo) return callback(null, this._layerInfo)

  var url = this.server + '/' + this.layer + '?f=json'

  this.request(url, function (err, json) {
    /**
     * returns error on three conditions:
     * 1. err is present
     * 2. missing response json
     * 3. error in response json
     */
    if (err || !json || json.error) {
      if (!json) json = {error: {}}
      var error = new Error('Request for layer information failed')
      error.timestamp = new Date()
      error.url = url
      error.code = json.error.code || 500
      error.body = json.error

      return callback(error)
    }

    json.url = url
    callback(null, json)
  })
}

/**
 * Gets the objectID field from the service info
 @param {object} info the feature layer metadata
 @returns {string} service's object id field
*/
FeatureService.prototype.getObjectIdField = function (info) {
  var oid
  if (!info.fields) return false
  if (info.objectIdField) return info.objectIdField
  info.fields.some(function (field) {
    if (field.type === 'esriFieldTypeOID') {
      oid = field.name
      return true
    }
  })

  return oid
}

/**
 * Gets the feature service object ids for pagination
 * @param {object} callback - called when the service info comes back
 */
FeatureService.prototype.layerIds = function (callback) {
  var url = this.server + '/' + this.layer + '/query?where=1=1&returnIdsOnly=true&f=json'
  this.request(url, function (err, json) {
    if (err || !json.objectIds) {
      if (!json) json = {error: {}}
      var error = new Error('Request for object IDs failed')
      error.timestamp = new Date()
      error.code = json.error.code || 500
      error.url = url
      error.body = err || json.error

      return callback(error)
    }
    // TODO: is this really necessary
    json.objectIds.sort(function (a, b) { return a - b })
    callback(null, json.objectIds)
  })
}

/**
 * Count of every single feature in the service
 * @param {object} callback - called when the service info comes back
 */
FeatureService.prototype.featureCount = function (callback) {
  var countUrl = this.server + '/' + (this.layer || 0)
  countUrl += '/query?where=1=1&returnCountOnly=true&f=json'

  this.request(countUrl, function (err, json) {
    if (err || json.error) {
      // init empty json error so we can handle building the error in one logic stream
      if (!json) json = {error: {}}
      var error = new Error('Request for feature count failed')
      error.timestamp = new Date()
      error.code = json.error.code || 500
      error.url = countUrl
      error.body = err || json.error

      return callback(error)
    }

    callback(null, json)
  })
}

/**
 * Gets and derives layer metadata from two sources
 * @param {function} callback - called with an error or a metadata object
 */
FeatureService.prototype.metadata = function (callback) {
  if (typeof callback === 'undefined') return this._metadata
  if (this._metadata) return callback(null, this._metadata)

  this.layerInfo(function (err, layer) {
    if (err) {
      err.message = 'Unable to get layer metadata: ' + err.message
      return callback(err)
    }
    this._layerInfo = layer
    var oid = this.getObjectIdField(layer)
    var size = layer.maxRecordCount

    // TODO flatten this
    var metadata = {layer: layer, oid: oid, size: size}

    // 10.0 servers don't support count requests
    // they also do not show current version on the layer
    if (!layer.currentVersion) return callback(null, metadata)

    this.featureCount(function (err, json) {
      if (err) return callback(err)
      if (json.count < 1) return callback(new Error('Service returned count of 0'))
      metadata.count = json.count
      this._metadata = metadata
      callback(null, metadata)
    })
  }.bind(this))
}

/**
 * Build an array pages that will cover every feature in the service
 * @param {object} callback - called when the service info comes back
 */
FeatureService.prototype.pages = function (callback) {
  this.metadata(function (err, meta) {
    if (err) return callback(err)
    if (meta.count < meta.layer.maxRecordCount && meta.count < this.options.size) return callback(null, singlePage(this.server, this.layer))
    this.concurrency = this.options.concurrency || Utils.setConcurrency(this.hosted, meta.layer.geometryType)
    this.maxConcurrency = this.concurrency
    this.pageQueue.concurrency = this.concurrency
    var size = Math.min(parseInt(meta.size, 10), 1000) || 1000
    // restrict page size to the passed in maximum
    if (size > 5000) size = this.options.size

    var layer = meta.layer
    var nPages = Math.ceil(meta.count / size)

    // if the service supports paging, we can use offset to build pages
    var canPage = layer.advancedQueryCapabilities && layer.advancedQueryCapabilities.supportsPagination
    if (canPage && this.hosted) return callback(null, this._offsetPages(nPages, size))

    if (!meta.oid) return callback(new Error('ObjectID type field not found, unable to page'))
    this.options.objectIdField = meta.oid
    // if the service supports statistics, we can request the maximum and minimum id to build pages
    if (layer.supportsStatistics) {
      this.getObjectIdRange(meta.oid, function (err, stats) {
      // if this worked then we can pagination using where clauses
        if (!err) return callback(null, this._rangePages(stats, size))
        // if it failed, try to request all the ids and split them into pages
        this.layerIds(function (err, ids) {
          // either this works or we give up
          if (err) return callback(err)
          return callback(null, this._idPages(ids, size))
        }.bind(this))
      }.bind(this))
    } else {
      // this is the last thing we can try
      this.layerIds(function (err, ids) {
        if (err) return callback(err)
        callback(null, this._idPages(ids, size))
      }.bind(this))
    }
  }.bind(this))
}

function singlePage (server, layer) {
  return [{req: [server, '/', layer, '/query?where=1=1&returnGeometry=true&outFields=*&outSR=4326&f=json'].join('')}]
}

/**
 * Get the max and min object id
 * @param {object} meta - layer metadata, holds information needed to request oid stats
 * @param {function} callback - returns with an error or objectID stats
 */
FeatureService.prototype.getObjectIdRange = function (oidField, callback) {
  this.statistics(oidField, ['min', 'max'], function (err, statResponse) {
    // TODO this is handled elsewhere now so move it
    if (err) return callback(err)
    var eMsg = 'Response from statistics was invalid'
    var stats
    try {
      stats = findMinAndMax(statResponse)
    } catch (e) {
      return callback(new Error(eMsg))
    }
    if (!stats.min > 0 && !stats.max > 0) return callback(new Error(eMsg))
    callback(null, stats)
  })
}

function findMinAndMax (statResponse) {
  var attributes = statResponse.features[0].attributes
  var values = Object.keys(attributes).map(function (key) {
    return attributes[key]
  })
  var minMax = {}
  minMax.min = values[0] < values[1] ? values[0] : values[1]
  minMax.max = values[1] > values[0] ? values[1] : values[0]
  return minMax
}

/**
 * build result Offset based page requests
 * these pages use Server's built in paging via resultOffset and resultRecordCount
 * @param {integer} pages - the number of pages we'll create
 * @param {integer} size - the max number of features per page
 * @returns {object} reqs - contains all the pages for extracting features
 */
FeatureService.prototype._offsetPages = function (pages, size) {
  var reqs = []
  var resultOffset
  var url = this.server

  for (var i = 0; i < pages; i++) {
    resultOffset = i * size
    var pageUrl = url + '/' + this.layer + '/query?outSR=4326&f=json&outFields=*&where=1=1'
    if (pages === 1) return [{req: pageUrl + '&geometry=&returnGeometry=true&geometryPrecision='}]
    pageUrl += '&resultOffset=' + resultOffset
    pageUrl += '&resultRecordCount=' + size
    pageUrl += '&geometry=&returnGeometry=true&geometryPrecision='
    reqs.push({req: pageUrl})
  }

  return reqs
}

/**
 * build `id` query based page requests
 * these pages use object ids in URLs directly
 * @param {array} ids - an array of each object id in the service
 * @param {integer} size - the max record count for each page
 * @returns {object} reqs - contains all the pages for extracting features
 */
FeatureService.prototype._idPages = function (ids, size) {
  var reqs = []
  var oidField = this.options.objectIdField || 'objectId'
  var pages = (ids.length / size)

  for (var i = 0; i < pages + 1; i++) {
    var pageIds = ids.splice(0, size)
    if (pageIds.length) {
      var pageMin = pageIds[0]
      var pageMax = pageIds.pop()
      var where = [oidField, ' >= ', pageMin, ' AND ', oidField, '<=', pageMax].join('')
      var pageUrl = this.server + '/' + (this.layer) + '/query?outSR=4326&where=' + where + '&f=json&outFields=*'
      pageUrl += '&geometry=&returnGeometry=true&geometryPrecision=10'
      reqs.push({req: pageUrl})
    }
  }

  return reqs
}

/**
 * build object id query based page requests
 * these pages use object ids in where clauses via < and >
 * you could call this objectId queries
 * @param {object} stats - contains the max and min object id
 * @param {integer} size - the size of records to include in each page
 * @returns {object} reqs - contains all the pages for extracting features
 */
FeatureService.prototype._rangePages = function (stats, size) {
  var reqs = []
  var pageUrl
  var pageMax
  var pageMin
  var where
  var objId = this.options.objectIdField

  var url = this.server
  var pages = Math.max((stats.max === size) ? stats.max : Math.ceil((stats.max - stats.min) / size), 1)

  for (var i = 0; i < pages; i++) {
    // there is a bug in server where queries fail if the max value queried is higher than the actual max
    // so if this is the last page, then set the max to be the maxOID
    if (i === pages - 1) {
      pageMax = stats.max
    } else {
      pageMax = stats.min + (size * (i + 1)) - 1
    }
    pageMin = stats.min + (size * i)
    where = [objId, '>=', pageMin, '+AND+', objId, '<=', pageMax].join('')
    pageUrl = url + '/' + (this.layer || 0) + '/query?outSR=4326&where=' + where + '&f=json&outFields=*'
    pageUrl += '&geometry=&returnGeometry=true&geometryPrecision='
    reqs.push({req: pageUrl})
  }

  return reqs
}

/**
 * Requests a page of features
 * @param {object} task - a task object with a "req" property
 * @param {function} callback
 */
FeatureService.prototype._requestFeatures = function (task, cb) {
  var self = this

  this.request(task.req, function (err, json) {
    if (err) return self._catchErrors(task, err, task.req, cb)
    if (!json || json.error) {
      if (!json) json = {error: {}}
      var error = new Error('Request for a page of features failed')
      error.timestamp = new Date()
      error.body = json.error
      error.code = json.error.code || 500
      return self._catchErrors(task, error, task.req, cb)
    }
    self._throttleQueue()
    cb(null, json)
  })
}

/* Catches an errors during paging and handles retry logic
 * @param {object} task - the currently executing job
 * @param {object} e - the error in application logic or from a failed request to a server
 * @param {string} url - the url of the last request for pages
 * @param {function} cb - callback passed through to the abort paging function
 */
FeatureService.prototype._catchErrors = function (task, error, url, cb) {
  this._throttleQueue(error)
  // be defensive in case there was no json payload
  error.body = error.body || {}
  // set the error code from the json payload if the error doesn't have one already
  if (!error.code) error.code = error.body.code
  error.url = url
  if (task.retry && task.retry === 3) return this._abortPaging(error, cb)
  // initiate the count or increment it
  if (!task.retry) {
    task.retry = 1
  } else {
    task.retry++
  }

  this.log('info', 'Re-requesting page ' + task.req + ' attempt ' + task.retry)

  setTimeout(function () {
    this._requestFeatures(task, cb)
  }.bind(this), task.retry * this.options.backoff)
}

FeatureService.prototype._throttleQueue = function (fail) {
  if (fail) this.concurrency -= 0.5
  else this.concurrency += 0.1
  if (this.concurrency > this.maxConcurrency) this.concurrency = this.maxConcurrency
  this.pageQueue.concurrency = this.concurrency >= 1 ? Math.floor(this.concurrency) : 1
}

/**
 * Aborts the request queue by emptying all queued up tasks
 * @param {object} error - error payload to send back to the original requestor
 * @param {function} callback - calls back with the error payload
 */
FeatureService.prototype._abortPaging = function (error, callback) {
  this.pageQueue.kill()
  error.message = 'Paging aborted: ' + error.message
  callback(error)
}

module.exports = FeatureService
