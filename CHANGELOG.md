# Change Log
All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).

## Unreleased
### Changed
* All requests accept gzip or deflate compressed
* Requests are decoded async (for compatibility with node < 0.11.12)

### Fixed
* Pages are built correctly for layers with an index > 1

## [1.2.0] - 2015-08-11
### Fixed
* Pages based on object ids are now formed correctly

### Changed
* All errors returned to the requestor are standardized

## [1.1.1] - 2015-08-10
### Fixed
* Build dist for changes

## [1.1.0] - 2015-08-10
### Added
* New fixtures and integration tests for paging
* Support for paging layers from server version 10.0
* New fixtures and tests for decoding

### Changed
* Refactored paging strategy
* Moved feature request decoding into isolated function

### Fixed
* Catch errors that come on 200 responses
* Errors are reported correctly up the chain
* Retries for all errors

## [1.0.0] - 2015-08-07
### Added
* New function gets objectID from service info

### Changed
* Moved to koopjs github organization

### Fixed
* detach http/https modules from FeatureService instances

## [0.2.0] - 2015-08-06
### Added
* Feature requests time out

### Changed
* Timeout set at 90 seconds

### Fixed
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

[1.2.0]: https://github.com/koopjs/featureservice/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/koopjs/featureservice/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/koopjs/featureservice/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/koopjs/featureservice/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/koopjs/featureservice/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/koopjs/featureservice/compare/v0.0.4...v0.1.0
[0.0.4]: https://github.com/koopjs/featureservice/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/koopjs/featureservice/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/koopjs/featureservice/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/koopjs/featureservice/releases/tag/v0.0.1

