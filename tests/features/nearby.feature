Feature: Places nearby
  A site lists the places around it, nearest first, with a distance a
  guest can use. The list is plain HTML, so it works without the map and
  search engines read it; the map draws the same places. Places belong to
  the platform: their names stay in Estonian, and each has a short
  description in Estonian and English, and in other languages when
  someone translates it.

  Scenario: Distances are walking time, road distance or the straight line
    Given the sites are built
    Then the page "/en/voru-county/rouge/oobikuoru/" lists "Rõuge Suurjärv" at "6 min walk"
    And the page "/en/voru-county/rouge/oobikuoru/" lists "Suur Munamägi" at "9 km by road"
    And the page "/en/voru-county/rouge/oobikuoru/" lists "Hinni kanjon" at "≈ 7.9 km as the crow flies"
    And the page "/vorumaa/rouge/oobikuoru/" lists "Suur Munamägi" at "9 km autoga"

  Scenario: The nearest places come first
    Given the sites are built
    Then the page "/en/voru-county/rouge/oobikuoru/" lists "Ööbikuoru Hüdrotöökoda" first

  Scenario: Names stay in Estonian, descriptions follow the page
    Given the sites are built
    Then the page "/en/voru-county/rouge/oobikuoru/" shows "Rõuge Suurjärv" in "et"
    And the page "/en/voru-county/rouge/oobikuoru/" describes "Rõuge Suurjärv" as "Estonia’s deepest lake, 38 m"
    And the page "/vorumaa/rouge/oobikuoru/" describes "Rõuge Suurjärv" as "Eesti sügavaim järv, 38 m"

  Scenario: Every place needs an Estonian description
    Given a copy of the content
    And the Estonian description of the place "suurjarv" is removed
    When I build it
    Then it fails
    And stderr mentions "suurjarv"

  Scenario: Every place needs an English description
    Given a copy of the content
    And the English description of the place "suurjarv" is removed
    When I build it
    Then it fails
    And stderr mentions "towns/rouge/places/suurjarv/strings/en.json"

  Scenario: Other languages may lack a description, with a warning
    Given a copy of the content
    And Finnish is enabled, and "oobikuoru" is translated into it
    And only "suurjarv" has a Finnish description
    When I build it
    Then it succeeds
    And stderr mentions "warning: towns/rouge/places/pesapuu/strings/fi.json"
    And the page "/fi/voru-county/rouge/oobikuoru/" lists "Pesapuu vaatetorn" without a description
    And the page "/fi/voru-county/rouge/oobikuoru/" describes "Rõuge Suurjärv" as "Viron syvin järvi"

  Scenario: Every place has a link of its own
    Given the sites are built
    Then the page "/en/voru-county/rouge/oobikuoru/" has the place "suurjarv" at "#suurjarv"

  Scenario: A place card can open up with a photo
    Given a copy of the content
    And the place "pesapuu" has a photo file in the repository
    When I build it
    Then it succeeds
    And the place card of "Pesapuu vaatetorn" on "/en/voru-county/rouge/oobikuoru/" has a photo

  Scenario: A place's photo can live in the storage service
    Given a copy of the content
    And the place "pesapuu" shows the stored photo "0123456789abcdef", by "Mari"
    When I build it with the photos at "https://photos.example"
    Then it succeeds
    And the place card of "Pesapuu vaatetorn" on "/en/voru-county/rouge/oobikuoru/" shows "https://photos.example/p/0123456789abcdef/960.jpg"
    And the page "/en/voru-county/rouge/oobikuoru/" shows "Photo: Mari" in "en"
    And "/photos.json" lists the photo "0123456789abcdef"

  Scenario: The build tells the maps service where every place is
    Given a copy of the content
    When I build it
    Then it succeeds
    And "/map-places.json" lists the place "maanteemuuseum" at 58.035, 27.042

  Scenario: A photo the storage service could not have made fails the build
    Given a copy of the content
    And the place "pesapuu" shows the stored photo "not-a-hash", by "Mari"
    When I build it
    Then it fails
    And stderr mentions "towns/rouge/places/pesapuu/place.json: photo must be"

  Scenario: A place card links to the place's official website, in a new tab
    Given the sites are built
    Then the place card of "Eesti Maanteemuuseum" on "/en/voru-county/rouge/oobikuoru/" links to "https://maanteemuuseum.ee/en" in a new tab
    And the place card of "Eesti Maanteemuuseum" on "/vorumaa/rouge/oobikuoru/" links to "https://maanteemuuseum.ee" in a new tab

  Scenario: A place with its own visit.ee site links there instead
    Given a copy of the content
    And the place "pesapuu" has the site "oobikuoru"
    When I build it
    Then it succeeds
    And the place card of "Pesapuu vaatetorn" on "/en/voru-county/rouge/oobikuoru/" links to "/en/voru-county/rouge/oobikuoru/"

  Scenario: A place's website must be an https address
    Given a copy of the content
    And the place "pesapuu" has the url "http://example.com"
    When I build it
    Then it fails
    And stderr mentions "towns/rouge/places/pesapuu/place.json"

  Scenario: A place id is used once, whoever owns it
    Given a copy of the content
    And the place "pesapuu" is also in "sites/oobikuoru"
    When I build it
    Then it fails
    And stderr mentions "sites/oobikuoru/places/pesapuu/place.json: there is already a place"

  Scenario: A site's private place is on its map and its town's
    Given a copy of the content
    And "oobikuoru" has a private place "saun" called "Järvesaun"
    And "oobikuoru" lists the place "saun" nearby
    When I build it
    Then it succeeds
    And the page "/en/voru-county/rouge/oobikuoru/" describes "Järvesaun" as "Sauna by the lake"
    And the page "/en/voru-county/rouge/" describes "Järvesaun" as "Sauna by the lake"

  Scenario: A site cannot name a place that does not exist
    Given a copy of the content
    And "oobikuoru" lists the place "nowhere" nearby
    When I build it
    Then it fails
    And stderr mentions "nowhere"

  Scenario: Search engines learn about the places
    Given the sites are built
    Then the page "/vorumaa/rouge/oobikuoru/" describes a "TouristAttraction"

  Scenario: The map comes from the maps service
    Given the sites are built
    Then the build has "/assets/map.js"
    And the build does not have "/assets/vendor/maplibre/maplibre-gl.mjs"
    And the map on "/vorumaa/rouge/oobikuoru/" loads from "https://maps.sustenaut.eu"

  Scenario: The home page maps every site
    Given the sites are built
    Then the build has "/assets/platform-map.js"
    And the map on "/en/" loads from "https://maps.sustenaut.eu"
    And the map on "/en/" has "Nightingale Valley" at "/en/voru-county/rouge/oobikuoru/"
    And the map on "/" has "Ööbikuorg" at "/vorumaa/rouge/oobikuoru/"

  Scenario: A build can use another maps service
    Given a copy of the content
    When I build it with the maps at "http://localhost:8091/"
    Then it succeeds
    And the map on "/vorumaa/rouge/oobikuoru/" loads from "http://localhost:8091"
