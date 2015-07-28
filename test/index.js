var sinon = require('sinon')
var test = require('tape')
var FeatureService = require('../')

var service = new FeatureService('http://koop.dc.esri.com/socrata/seattle/2tje-83f6/FeatureServer/0', {})

test('build offset pages', function (t) {
  var pages
  var min = 0
  var max = 2000
  pages = service._objectIdPages(min, max, max / 2)
  t.equal(pages.length, 2)
  pages = service._objectIdPages(min, max, max / 4)
  t.equal(pages.length, 4)
  t.end()
})

test('build id based pages', function (t) {
  var ids = [1, 2, 3, 4]
  var maxCount = 2
  var pages = service._idPages(ids, maxCount)
  t.equal(pages.length, 2)

  t.end()
})

test('build result offset pages', function (t) {
  var maxCount = 100
  var pages = service._offsetPages(4, maxCount)
  t.equal(pages.length, 4)

  t.end()
})

test('creates an out statistics url', function (t) {
  var url = service._statsUrl('test', ['min', 'max'])
  t.equal(url, 'http://koop.dc.esri.com/socrata/seattle/2tje-83f6/FeatureServer/0/query?f=json&outFields=&outStatistics=[{"statisticType":"min","onStatisticField":"test","outStatisticFieldName":"min_test"},{"statisticType":"max","onStatisticField":"test","outStatisticFieldName":"max_test"}]')
  t.end()
})

test('builds pages for the service', function (t) {
  var url = 'http://maps.indiana.edu/ArcGIS/rest/services/Infrastructure/Railroads_Rail_Crossings_INDOT/MapServer'
  var indiana = new FeatureService(url, {})
  indiana.pages(function (err, pages) {
    t.equal(err, null)
    t.equal(pages.length, 156)
    t.end()
  })
})

test('stub setup', function (t) {
  sinon.stub(service, 'request', function (url, callback) {
    callback(null, {body: '{}'})
  })
  t.end()
})

test('get the metadata for a layer on the service', function (t) {
  service.layerInfo(function (err, metadata) {
    t.equal(err, null)
    t.equal(service.request.calledWith('http://koop.dc.esri.com/socrata/seattle/2tje-83f6/FeatureServer/0?f=json'), true)
    t.end()
  })
})

test('get all the object ids for a layer on the service', function (t) {
  service.layerIds(function (err, metadata) {
    t.equal(err, null)
    var expected = 'http://koop.dc.esri.com/socrata/seattle/2tje-83f6/FeatureServer/0/query?where=1=1&returnIdsOnly=true&f=json'
    t.equal(service.request.calledWith(expected), true)
    t.end()
  })
})

test('get all feature count for a layer on the service', function (t) {
  service.featureCount(function (err, metadata) {
    t.equal(err, null)
    var expected = 'http://koop.dc.esri.com/socrata/seattle/2tje-83f6/FeatureServer/0/query?where=1=1&returnIdsOnly=true&returnCountOnly=true&f=json'
    t.equal(service.request.calledWith(expected), true)
    t.end()
  })
})

test('teardown', function (t) {
  service.request.restore()
  t.end()
})
