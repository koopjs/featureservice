# featureservice

> Get all features from an Esri Feature Service

[![npm][npm-image]][npm-url]
[![travis][travis-image]][travis-url]

[npm-image]: https://img.shields.io/npm/v/featureservice.svg?style=flat-square
[npm-url]: https://www.npmjs.com/package/featureservice
[travis-image]: https://img.shields.io/travis/koopjs/featureservice.svg?style=flat-square
[travis-url]: https://travis-ci.org/koopjs/featureservice

A little module that extracts every feature from an Esri Feature Service. The real power in this module is that it's designed to page over a service and extract every single feature no matter what ArcGIS Server version the data is hosted on.

## Install

```
npm install featureservice
```

## Usage

```javascript
var FeatureService = require('featureservice')

// a url to a feature service
var url = 'http://....../FeatureServer/0'

var service = new FeatureService(url, options)
service.pages(function (err, pages) {
/* will give you links to all pages of data in the service*/
})
```

### Options
An object passed as the second parameter when initializing a service
- layer: the layer index to use
- size: the maximum page size when requesting features
- concurrency: the maximum concurrency for requesting features from a single server
- timeOut: the amount of time to wait with no response before cancelling a request
- logger: An object with a log method that takes a level and a message e.g. a Winston instance

### API

#### info(callback)
Get the information describing the service itself

#### layerIds(callback)
Get all the ids in a feature service layer

#### layerInfo(callback)
Get the json metadata for a service layer

#### statistics(field, stats, callback)
Get statistics for a field and an array of stats.

```javascript
service.statistics('id', ['min', 'max'], function (err, stats) {
  console.log(stats.features)
})
```

#### pages(callback)
Returns an array of page urls that would get every feature in the service

### Browser

A browser ready build of this module is in `dist/featureservice.min.js`.

#### Example

```html
<html>
  <script src="dist/featureservice.min.js"></script>
  <script>
    var service = new FeatureService('http://koop.dc.esri.com/socrata/seattle/2tje-83f6/FeatureServer/0', {})
    service.statistics('id', ['max'], function (err, stats) {
      console.log(err, stats)
    })
  </script>
</html>
```

## License

[Apache 2.0](LICENSE)

<!-- [](Esri Tags: ArcGIS Web Mapping GeoJson FeatureServices) -->
<!-- [](Esri Language: JavaScript) -->
