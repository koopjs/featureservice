# Change Log
All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).

## [0.2.0] - 2015-08-06
### Added
* Feature requests time out

## Changed
* Timeout set at 90 seconds

## Fixed
* Reference to non-existent functions

## [0.1.0] - 2015-08-05
### Added
* Feature service requests time out after 5 minutes of inactivity by default

### Changed
* TCP sockets are kept alive

## [0.0.4] - 2015-07-29
### Fixed
* request method was calling the callback twice when it wrapped a callback in a try/catch
* passing min and max to statsUrl for creating stats in pages method 

## [0.0.3] - 2015-07-28
### Fixed 
* A change made in v0.0.2 broke pagination. Its now fixed and a test for pages was added.

## [0.0.2] - 2015-07-27
### Added
* A method for making statistics calls to a service
* Support for using the module in the browser

### Changed 
* http requests are all routed through the core http/https libs now

## [0.0.1] - 2015-07-22
### Added
* Code for requesting data from FeatureServices
* Tests on most methods

[0.2.0]: https://github.com/chelm/featureservice/ompare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/chelm/featureservice/ompare/v0.0.4...v0.1.0
[0.0.4]: https://github.com/chelm/featureservice/ompare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/chelm/featureservice/ompare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/chelm/featureservice/ompare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/chelm/featureservice/releases/tag/v0.0.1

