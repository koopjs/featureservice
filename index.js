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
  var layer = url.split('/').pop()
  if (parseInt(layer, 0) >= 0) {
    var len = ('' + layer).length
    url = url.substring(0, url.length - ((len || 2) + 1))
  }

  this.url = url
  this.options = options
  this.layer = options.layer || 0
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
      'User-Agent': 'featureservices-node'
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
      var err
      var json
      var buffer = Buffer.concat(data)
      try {
        json = JSON.parse(buffer.toString())
      } catch (error) {
        err = error
      }
      callback(err, json)
    })

  })

  req.setTimeout(self.timeOut, function () {
    req.end()
    callback(new Error('The request timed out after ' + self.timeOut / 1000 + ' seconds.'))
  })

  req.on('error', function (error) {
    callback(error)
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
  this.request(this._statsUrl(field, stats), callback)
}

/**
 * Gets the feature service info
 * @param {function} callback - called when the service info comes back
 */
FeatureService.prototype.layerInfo = function (callback) {
  var url = this.url + '/' + this.layer + '?f=json'
  this.request(url, function (err, json) {
    try {
      json.url = url
    } catch (e) {
      err = 'failed to parse service info: ' + e
    }
    return callback(err, json)
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
  this.request(this.url + '/' + this.layer + '/query?where=1=1&returnIdsOnly=true&f=json', function (err, json) {
    callback(err, json.objectIds)
  })
}

/**
 * Build an array pages that will cover every feature in the service
 * @param {object} callback - called when the service info comes back
 */
FeatureService.prototype.pages = function (callback) {

  this.featureCount(function (err, json) {
    if (err) {
      return callback(err)
    }

    var count = json.count

    if (count === 0) {
      return callback('Service returned a count of zero')
    }

    // get layer info
    this.layerInfo(function (err, serviceInfo) {
      if (err || !serviceInfo) {
        return callback(err || 'Unable to get layer metadata')
      }

      this.options.objectIdField = this.getObjectIdField(serviceInfo)

      // figure out what kind of pages we can build
      var maxCount = Math.min(parseInt(serviceInfo.maxRecordCount, 0), 1000) || 1000

      // build legit offset based page requests
      if (serviceInfo.advancedQueryCapabilities &&
        serviceInfo.advancedQueryCapabilities.supportsPagination) {
        var nPages = Math.ceil(count / maxCount)
        return callback(null, this._offsetPages(nPages, maxCount))
      }

      // build where clause based pages
      if (serviceInfo.supportsStatistics) {

        this.statistics(serviceInfo.objectIdField, ['min', 'max'], function (err, stats) {
          if (err) {
            return callback(err)
          }

          try {
            if (stats.error) {
              try {
                var idUrl = this.url + '/' + (this.layer || 0) + '/query?where=1=1&returnIdsOnly=true&f=json'
                this.request(idUrl, function (err, idJson) {
                  if (err) {
                    return callback(err)
                  }

                  var minID, maxID
                  if (idJson.error) {
                    // DMF: if grabbing objectIDs fails fall back to guessing based on 0 and count
                    minID = 0
                    maxID = count
                  } else {
                    idJson.objectIds.sort(function (a, b) { return a - b })
                    minID = idJson.objectIds[0]
                    maxID = idJson.objectIds[idJson.objectIds.length - 1]
                  }
                  return callback(null, this._objectIdPages(minID, maxID, maxCount))
                }.bind(this))

              } catch (e) {
                return callback(e)
              }

            } else {
              var names, minId, maxId
              var attrs = stats.features[0].attributes
              if (stats && stats.fieldAliases) {
                names = Object.keys(stats.fieldAliases)
              }
              minId = attrs.min_oid || attrs.MIN_OID || attrs[names[0]]
              maxId = attrs.max_oid || attrs.MAX_OID || attrs[names[1]]

              return callback(null, this._objectIdPages(minId, maxId, maxCount))
            }
          } catch (e) {
            return callback(e)
          }
        }.bind(this))
      } else {
        if (count < 1000000) {
          this.layerIds(function (err, ids) {
            callback(err, this._idPages(ids, 250))
          }.bind(this))
        } else {
          // default to sequential objectID paging starting from zero
          return callback(null, this._objectIdPages(0, count, maxCount))
        }
      }
    }.bind(this))
  }.bind(this))
}

/**
 * Count of every single feature in the service
 * @param {object} callback - called when the service info comes back
 */
FeatureService.prototype.featureCount = function (callback) {
  var countUrl = this.url + '/' + (this.options.layer || 0)
  countUrl += '/query?where=1=1&returnIdsOnly=true&returnCountOnly=true&f=json'

  this.request(countUrl, function (err, json) {
    if (err) {
      return callback(err)
    }

    if (json.error) {
      return callback(json.error.message + ': ' + countUrl, null)
    }

    callback(null, json)
  })
}

/**
 * build result Offset based page requests
 * these pages use Server's built in paging via resultOffset and resultRecordCount
 * @param {number} pages - the number of pages we'll create
 * @param {number} max - the max number of feature per page
 */
FeatureService.prototype._offsetPages = function (pages, max) {
  var reqs = []
  var resultOffset
  var url = this.url

  for (var i = 0; i < pages; i++) {
    resultOffset = i * max
    var pageUrl = url + '/' + (this.options.layer || 0) + '/query?outSR=4326&f=json&outFields=*&where=1=1'
    pageUrl += '&resultOffset=' + resultOffset
    pageUrl += '&resultRecordCount=' + max
    pageUrl += '&geometry=&returnGeometry=true&geometryPrecision='
    reqs.push({req: pageUrl})
  }

  return reqs
}

/**
 * build `id` query based page requests
 * these pages use object ids in URLs directly
 * @param {array} ids - an array of each object id in the service
 * @param {number} maxCount - the max record count for each page
 */
FeatureService.prototype._idPages = function (ids, maxCount) {
  var reqs = []
  var where
  var pageUrl

  var objId = this.options.objectIdField || 'objectId'
  var pages = (ids.length / maxCount)

  for (var i = 0; i < pages + 1; i++) {
    var pageIds = ids.splice(0, maxCount)
    if (pageIds.length) {
      where = objId + ' in (' + pageIds.join(',') + ')'
      pageUrl = this.url + '/' + (this.options.layer || 0) + '/query?outSR=4326&where=' + where + '&f=json&outFields=*'
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
 * @param {number} min - the max object id in the service
 * @param {number} max - the max object id in the service
 * @param {number} maxCount - the max record count for each page
 */
FeatureService.prototype._objectIdPages = function (min, max, maxRecordCount) {
  var reqs = []
  var pageUrl
  var pageMax
  var pageMin
  var where
  var objId = this.options.objectIdField

  var url = this.url
  var pages = Math.max((max === maxRecordCount) ? max : Math.ceil((max - min) / maxRecordCount), 1)

  for (var i = 0; i < pages; i++) {
    // there is a bug in server where queries fail if the max value queried is higher than the actual max
    // so if this is the last page, then set the max to be the maxOID
    if (i === pages - 1) {
      pageMax = max
    } else {
      pageMax = min + (maxRecordCount * (i + 1)) - 1
    }
    pageMin = min + (maxRecordCount * i)
    where = objId + '<=' + pageMax + '+AND+' + objId + '>=' + pageMin
    pageUrl = url + '/' + (this.options.layer || 0) + '/query?outSR=4326&where=' + where + '&f=json&outFields=*'
    pageUrl += '&geometry=&returnGeometry=true&geometryPrecision='
    reqs.push({req: pageUrl})
  }

  return reqs
}

/**
 * Aborts the request queue by emptying all queued up tasks
 */
FeatureService.prototype._abortPaging = function (msg, uri, error, code, done) {
  this.pageQueue.kill()
  done(JSON.stringify({
    message: msg,
    request: uri,
    response: error,
    code: code || 500
  }))
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
        catchErrors(task, err, uri, cb)
      })

      response.on('end', function () {
        try {
          var json

          var buffer = Buffer.concat(data)
          var encoding = response.headers['content-encoding']
          // TODO all this shit is ugly -- make it less shitty (less try/catch)
          if (encoding === 'gzip') {
            zlib.gunzip(buffer, function (e, result) {
              try {
                json = JSON.parse(result.toString().replace(/NaN/g, 'null'))
                cb(null, json)
              } catch (e) {
                catchErrors(task, e, uri, cb)
              }
            })
          } else if (encoding === 'deflate') {
            try {
              json = JSON.parse(zlib.inflateSync(buffer).toString())
              cb(null, json)
            } catch (e) {
              catchErrors(task, e, uri, cb)
            }
          } else {
            json = JSON.parse(buffer.toString().replace(/NaN/g, 'null'))
            cb(null, json)
          }
        } catch(e) {
          catchErrors(task, e, uri, cb)
        }
      })
    })

    req.setTimeout(self.timeOut, function () {
      // kill it immediately if a timeout occurs
      req.end()
      var err = JSON.stringify({message: 'The request timed out after ' + self.timeOut / 1000 + ' seconds.'})
      catchErrors(task, err, uri, cb)
    })

    // we need this error catch to handle ECONNRESET
    req.on('error', function (err) {
      catchErrors(task, err, uri, cb)
    })

    req.end()
  } catch(e) {
    catchErrors(task, e, uri, cb)
  }

  // Catch any errors and either retry the request or fail it
  var catchErrors = function (task, e, url, cb) {
    if (task.retry && task.retry === 3) {
      try {
        var jsonErr = JSON.parse(e)
        this._abortPaging('Failed to request a page of features', url, jsonErr.message, jsonErr.code, cb)
      } catch (parseErr) {
        this._abortPaging('Failed to request a page of features', url, parseErr, null, cb)
      }
      return
    }
    // immediately kill
    if (!task.retry) {
      task.retry = 1
    } else {
      task.retry++
    }

    console.log('Re-requesting page', task.req, task.retry)

    setTimeout(function () {
      this._requestFeatures(task, cb)
    }.bind(this), task.retry * 1000)

  }.bind(this)
}

module.exports = FeatureService
