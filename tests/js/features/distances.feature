@distances
Feature: A site's distances.json (src/assets/distances.js), with the maps service's routes package (the sustenaut-maps git dependency, whose own tests cover the routing)

  Scenario: distances.json rounds a walk to 10 m and a drive to 0.1 km, and has none where no road goes
    Then distances.json rounds a walk to 10 m and a drive to 0.1 km, and has none where no road goes

  Scenario: Measure reads the networks around the site and its places
    Then measure reads the networks around the site and its places

  Scenario: Measure stops where the maps service has no roads
    Then measure stops where the maps service has no roads

  Scenario: distances.json is stale when the site or a place moves, or the list changes
    Then distances.json is stale when the site or a place moves, or the list changes
