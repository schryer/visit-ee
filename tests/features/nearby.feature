Feature: Places nearby
  A site lists the places around it, nearest first, with a distance a
  guest can use. The list is plain HTML, so it works without the map and
  search engines read it; the map draws the same places. Places belong to
  the platform: their names stay in Estonian, and each has a short
  description in Estonian and English, and in other languages when
  someone translates it.

  Scenario: Distances are walking time, road distance or the straight line
    Given the sites are built
    Then the page "/en/south-estonia/rouge/oobikuoru/" lists "Rõuge Suurjärv" at "6 min walk"
    And the page "/en/south-estonia/rouge/oobikuoru/" lists "Suur Munamägi" at "9 km by road"
    And the page "/en/south-estonia/rouge/oobikuoru/" lists "Hinni kanjon" at "≈ 7.9 km as the crow flies"
    And the page "/louna-eesti/rouge/oobikuoru/" lists "Suur Munamägi" at "9 km autoga"

  Scenario: The nearest places come first
    Given the sites are built
    Then the page "/en/south-estonia/rouge/oobikuoru/" lists "Ööbikuoru Hüdrotöökoda" first

  Scenario: Names stay in Estonian, descriptions follow the page
    Given the sites are built
    Then the page "/en/south-estonia/rouge/oobikuoru/" shows "Rõuge Suurjärv" in "et"
    And the page "/en/south-estonia/rouge/oobikuoru/" describes "Rõuge Suurjärv" as "Estonia’s deepest lake, 38 m"
    And the page "/louna-eesti/rouge/oobikuoru/" describes "Rõuge Suurjärv" as "Eesti sügavaim järv, 38 m"

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
    And stderr mentions "i18n/places/en.json"

  Scenario: Other languages may lack a description, with a warning
    Given a copy of the content
    And Finnish is enabled, and "oobikuoru" is translated into it
    And only "suurjarv" has a Finnish description
    When I build it
    Then it succeeds
    And stderr mentions "warning: i18n/places/fi.json"
    And stderr mentions "pesapuu"
    And the page "/fi/south-estonia/rouge/oobikuoru/" lists "Pesapuu vaatetorn" without a description
    And the page "/fi/south-estonia/rouge/oobikuoru/" describes "Rõuge Suurjärv" as "Viron syvin järvi"

  Scenario: Every place has a link of its own
    Given the sites are built
    Then the page "/en/south-estonia/rouge/oobikuoru/" has the place "suurjarv" at "#suurjarv"

  Scenario: A site cannot name a place that does not exist
    Given a copy of the content
    And "oobikuoru" lists the place "nowhere" nearby
    When I build it
    Then it fails
    And stderr mentions "nowhere"

  Scenario: Search engines learn about the places
    Given the sites are built
    Then the page "/louna-eesti/rouge/oobikuoru/" describes a "TouristAttraction"

  Scenario: The map comes from the maps service
    Given the sites are built
    Then the build has "/assets/map.js"
    And the build does not have "/assets/vendor/maplibre/maplibre-gl.mjs"
    And the map on "/louna-eesti/rouge/oobikuoru/" loads from "https://maps.sustenaut.eu"

  Scenario: The home page maps every site
    Given the sites are built
    Then the build has "/assets/platform-map.js"
    And the map on "/en/" loads from "https://maps.sustenaut.eu"
    And the map on "/en/" has "Nightingale Valley" at "/en/south-estonia/rouge/oobikuoru/"
    And the map on "/" has "Ööbikuorg" at "/louna-eesti/rouge/oobikuoru/"

  Scenario: A build can use another maps service
    Given a copy of the content
    When I build it with the maps at "http://localhost:8091/"
    Then it succeeds
    And the map on "/louna-eesti/rouge/oobikuoru/" loads from "http://localhost:8091"
