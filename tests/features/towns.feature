Feature: A page for each town
  A town (a municipality, the level of the URL above a site) has its own
  page: the area map large, first thing on the page, with every place in
  the town listed under it and the places to stay there. Its address is
  translated like any other, and the sites in it link to it.

  Background:
    Given the sites are built

  Scenario: The town page is in every language, at a translated address
    Then the page "/vorumaa/rouge/" is in "et"
    And the page "/en/voru-county/rouge/" is in "en"
    And the page "/en/voru-county/rouge/" links "et" to "/vorumaa/rouge/"
    And there is no page "/en/vorumaa/rouge/"

  Scenario: It lists the places in the town, nearest to its centre first
    Then the page "/en/voru-county/rouge/" lists "Rõuge Suurjärv" at "2 min walk"
    And the page "/en/voru-county/rouge/" lists "Paganamaa õpperada" at "≈ 16 km as the crow flies"
    And the page "/en/voru-county/rouge/" describes "Suur Munamägi" as "Highest hill in the Baltics, with a tower"
    And the page "/en/voru-county/rouge/" has the place "suurjarv" at "#suurjarv"
    And the page "/en/voru-county/rouge/" describes a "TouristDestination"

  Scenario: It links to the places to stay in the town, and they link back
    Then the page "/en/voru-county/rouge/" links to "/en/voru-county/rouge/oobikuoru/"
    And the page "/en/voru-county/rouge/oobikuoru/" links to "/en/voru-county/rouge/"
    And the page "/vorumaa/rouge/oobikuoru/peremaja/" links to "/vorumaa/rouge/"
