var queue = require('async').queue
var http = require('http')
var https = require('https')
var zlib = require('zlib')
var urlUtils = require('url')

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

  // check the last char on the url
  // protects us from urls registered with layers already in the url
  var end = url.split('/').pop()
  var layer
  if (parseInt(end, 10) >= 0) {
    layer = end
    var len = ('' + layer).length
    url = url.substring(0, url.length - ((len || 2) + 1))
  }

  this.url = url
  this.options = options || {}
  this.options.size = this.options.size || 5000
  this.layer = layer || this.options.layer || 0
  this.timeOut = 1.5 * 60 * 1000
  var concurrency = this.url.split('//')[1].match(/^service/) ? 16 : 4

  // an async for requesting pages of data
  this.pageQueue = queue(function (task, callback) {
    this._requestFeatures(task, callback)
  }.bind(this), concurrency)
}

/**
 * Wrap the request.get method for easier testing
 * @param {string} url
 * @param {function} callback
 */
 // TODO combine this with _requestFeatures
FeatureService.prototype.request = function (url, callback) {
  var uri = urlUtils.parse(encodeURI(decodeURI(url)))
  var self = this

  var opts = {
    method: 'GET',
    port: (uri.protocol === 'https:') ? 443 : uri.port || 80,
    keepAlive: true,
    hostname: uri.hostname,
    path: uri.path,
    headers: {
      'User-Agent': 'featureservices-node',
      'Accept-Encoding': 'gzip, deflate'
    }
  }

  // make an http or https request based on the protocol
  var req = ((uri.protocol === 'https:') ? https : http).request(opts, function (response) {
    var data = []
    response.on('data', function (chunk) {
      data.push(chunk)
    })

    response.on('error', function (err) {
      callback(err)
    })

    response.on('end', function () {
      self._decode(response, data, callback)
    })

  })

  req.setTimeout(self.timeOut, function () {
    this.error = new Error('The request timed out after ' + self.timeOut / 1000 + ' seconds.')
    this.error.code = 504
    req.abort()
  })

  req.on('error', function (error) {
    this.error = this.error ? this.error : error
    callback(this.error)
  })

  req.end()
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

  return this.url + '/' + this.layer + '/query?f=json&outFields=&outStatistics=' + JSON.stringify(json)
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
FeatureService.prototype.layerInfo = function (callback) {
  var url = this.url + '/' + this.layer + '?f=json'

  this.request(url, function (err, json) {
    /**
     * returns error on three conditions:
     * 1. err is present
     * 2. missing response json
     * 3. error in response json
     */
    if (err || !json || json.error) {
      var error = new Error('Request for layer information failed')
      error.timeStamp = new Date()
      error.url = url

      if (json.error) {
        error.code = json.error.code || 500
        error.body = json.error
      } else {
        error.code = 500
        error.body = err || 'missing response json'
      }

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
  info.fields.forEach(function (field) {
    if (field.type === 'esriFieldTypeOID') {
      oid = field.name
    }
  })
  return oid
}

/**
 * Gets the feature service object ids for pagination
 * @param {object} callback - called when the service info comes back
 */
FeatureService.prototype.layerIds = function (callback) {
  var url = this.url + '/' + this.layer + '/query?where=1=1&returnIdsOnly=true&f=json'
  this.request(url, function (err, json) {
    if (err || !json.objectIds) {
      var error = new Error('Request for object IDs failed')
      error.timeStamp = new Date()
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
 * Gets and derives layer metadata from two sources
 * @param {function} callback - called with an error or a metadata object
 */
FeatureService.prototype.metadata = function (callback) {
  // TODO memoize this
  this.layerInfo(function (err, layer) {
    if (err) {
      err.message = 'Unable to get layer metadata: ' + err.message
      return callback(err)
    }

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

    var size = Math.min(parseInt(meta.size, 10), 1000) || 1000
    // restrict page size to the passed in maximum
    if (size > 5000) size = this.options.maxPageSize

    var layer = meta.layer
    var nPages = Math.ceil(meta.count / size)

    this.options.objectIdField = meta.oid

    // if the service supports paging, we can use offset to build pages
    var canPage = layer.advancedQueryCapabilities && layer.advancedQueryCapabilities.supportsPagination
    if (canPage) return callback(null, this._offsetPages(nPages, size))

    // if the service supports statistics, we can request the maximum and minimum id to build pages
    if (layer.supportsStatistics) {
      this._getIdRangeFromStats(meta, function (err, stats) {
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

/**
 * Get the max and min object id
 * @param {object} meta - layer metadata, holds information needed to request oid stats
 * @param {function} callback - returns with an error or objectID stats
 */
FeatureService.prototype._getIdRangeFromStats = function (meta, callback) {

  this.statistics(meta.oid, ['min', 'max'], function (err, stats) {
    // TODO this is handled elsewhere now so move it
    if (err) return callback(err)
    var attrs = stats.features[0].attributes
    // dmf: what's up with this third strategy?
    var names = stats && stats.fieldAliases ? Object.keys(stats.fieldAliases) : null
    var min = attrs.min || attrs.MIN || attrs[names[0]]
    var max = attrs.max || attrs.MAX || attrs[names[1]]
    callback(null, {min: min, max: max})
  })
}

/**
 * Count of every single feature in the service
 * @param {object} callback - called when the service info comes back
 */
FeatureService.prototype.featureCount = function (callback) {
  var countUrl = this.url + '/' + (this.layer || 0)
  countUrl += '/query?where=1=1&returnCountOnly=true&f=json'

  this.request(countUrl, function (err, json) {
    if (err || json.error) {
      var error = new Error('Request for feature count failed')
      error.timeStamp = new Date()
      error.code = json.error.code || 500
      error.url = countUrl
      error.body = err || json.error

      return callback(error)
    }

    callback(null, json)
  })
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
  var url = this.url

  for (var i = 0; i < pages; i++) {
    resultOffset = i * size
    var pageUrl = url + '/' + (this.layer) + '/query?outSR=4326&f=json&outFields=*&where=1=1'
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
      var pageUrl = this.url + '/' + (this.layer) + '/query?outSR=4326&where=' + where + '&f=json&outFields=*'
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

  var url = this.url
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
  var uri = encodeURI(decodeURI(task.req))
  var self = this
  try {
    var url_parts = urlUtils.parse(uri)

    var opts = {
      method: 'GET',
      port: (url_parts.protocol === 'https:') ? 443 : url_parts.port || 80,
      hostname: url_parts.hostname,
      keepAlive: true,
      path: url_parts.path,
      headers: {
        'User-Agent': 'featureservices-node',
        'Accept-Encoding': 'gzip, deflate'
      }
    }

     // make an http or https request based on the protocol
    var req = ((url_parts.protocol === 'https:') ? https : http).request(opts, function (response) {
      var data = []

      response.on('data', function (chunk) {
        data.push(chunk)
      })

      response.on('error', function (err) {
        self._catchErrors(task, err, uri, cb)
      })

      response.on('end', function () {
        self._decode(response, data, function (err, json) {
          // the error coming back here is already well formed in _decode
          if (err) return self._catchErrors(task, err, uri, cb)
          // server responds 200 with error in the payload so we have to inspect
          if (json.error) {
            this.error = new Error('Request for a page of features failed')
            this.error.timeStamp = new Date()
            this.error.body = json.error
            return self._catchErrors(task, this.error, uri, cb)
          }
          cb(null, json)
        })
      })
    })

    req.setTimeout(self.timeOut, function () {
      // kill it immediately if a timeout occurs
      this.error = new Error('The request timed out after ' + self.timeOut / 1000 + ' seconds.')
      this.error.timestamp = new Date()
      this.error.code = 504
      req.abort()
    })

    // we need this error catch to handle ECONNRESET
    req.on('error', function (err) {
      // if an error came in from setTimeOut, use that, else use the default error
      var reported = this.error ? this.error : err
      reported.timestamp = reported.timestamp || new Date()
      self._catchErrors(task, reported, uri, cb)
    })

    req.end()
  } catch(e) {
    console.trace(e)
    this.error = new Error('Unknown failure')
    this.error.code = 500
    self._catchErrors(task, this.error, uri, cb)
  }
}

/* Decodes a response for features
 * @param {object} res - the response received from the GIS Server
 * @param {array} data - an array of chunks received from the server
 * @param {function} callback - calls back with either an error or the decoded feature json
 */
FeatureService.prototype._decode = function (res, data, callback) {
  var encoding = res.headers['content-encoding']
  if (!data.length > 0) return callback(new Error('Response from the server was empty'))

  try {
    var buffer = Buffer.concat(data)
    if (encoding === 'gzip') {
      zlib.gunzip(buffer, function (err, data) {
        callback(err, JSON.parse(data.toString().replace(/NaN/g, 'null')))
      })
    } else if (encoding === 'deflate') {
      zlib.inflate(buffer, function (err, data) {
        callback(err, JSON.parse(data.toString().replace(/NaN/g, 'null')))
      })
    } else {
      callback(null, JSON.parse(buffer.toString().replace(/NaN/g, 'null')))
    }
  } catch (e) {
    console.trace(e)
    callback(new Error('Failed to parse server response'))
  }
}

/* Catches an errors during paging and handles retry logic
 * @param {object} task - the currently executing job
 * @param {object} e - the error in application logic or from a failed request to a server
 * @param {string} url - the url of the last request for pages
 * @param {function} cb - callback passed through to the abort paging function
 */
FeatureService.prototype._catchErrors = function (task, error, url, cb) {
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

  console.log('Re-requesting page', task.req, task.retry)

  setTimeout(function () {
    this._requestFeatures(task, cb)
  }.bind(this), task.retry * 1000)
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
