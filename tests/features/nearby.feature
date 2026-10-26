Feature: Places nearby
  A site lists the places around it, nearest first, with a distance a
  guest can use. The list is plain HTML, so it works without the map and
  search engines read it; the map draws the same places. Places belong to
  the platform: their names stay in Estonian, and each language may add
  a short description.

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

  Scenario: A place with no description in a language is listed without one
    Given a copy of the content
    And the English description of the place "suurjarv" is removed
    When I build it
    Then it succeeds
    And the page "/en/south-estonia/rouge/oobikuoru/" lists "Rõuge Suurjärv" without a description

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

  Scenario: The map's script, library and label font ship with the site
    Given the sites are built
    Then the build has "/assets/map.js"
    And the build has "/assets/vendor/maplibre/maplibre-gl.mjs"
    And the build has "/assets/vendor/maplibre/maplibre-gl-worker.mjs"
    And the build has "/assets/vendor/pmtiles.js"
    And the build has "/assets/map/fonts/noto-sans-regular/0-255.pbf"

  Scenario: Map packs are served under /maps/
    Given a copy of the content
    And a folder of map packs with "louna-eesti/rouge/map.pmtiles" and "notes.txt"
    When I build it with those maps
    Then it succeeds
    And the build has "/maps/louna-eesti/rouge/map.pmtiles"
    And the build does not have "/maps/notes.txt"
