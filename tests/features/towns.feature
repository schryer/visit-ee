Feature: A page for each town
  A town (a municipality, the level of the URL above a site) has its own
  page: the area map large, first thing on the page, with every place in
  the town listed under it and the places to stay there. Its address is
  translated like any other, and the sites in it link to it.

  Scenario: The town page is in every language, at a translated address
    Given the sites are built
    Then the page "/vorumaa/rouge/" is in "et"
    And the page "/en/voru-county/rouge/" is in "en"
    And the page "/en/voru-county/rouge/" links "et" to "/vorumaa/rouge/"
    And there is no page "/en/vorumaa/rouge/"

  Scenario: It lists the places in the town, with what they are
    Given the sites are built
    Then the page "/en/voru-county/rouge/" describes "Suur Munamägi" as "Highest hill in the Baltics, with a tower"
    And the page "/en/voru-county/rouge/" has the place "suurjarv" at "#suurjarv"
    And the page "/en/voru-county/rouge/" describes a "TouristDestination"

  Scenario: It measures each place from the town's centre
    The positions are set here, so moving a real place in the editor does
    not change what this checks.

    Given a copy of the content
    And the town "rouge" has its centre at 57.7, 26.9
    And the place "suurjarv" is at 57.7014, 26.9
    And the place "paganamaa" is at 57.556, 26.9
    When I build it
    Then it succeeds
    And the page "/en/voru-county/rouge/" lists "Rõuge Suurjärv" at "2 min walk"
    And the page "/en/voru-county/rouge/" lists "Paganamaa õpperada" at "≈ 16 km as the crow flies"

  Scenario: It links to the places to stay in the town, and they link back
    Given the sites are built
    Then the page "/en/voru-county/rouge/" links to "/en/voru-county/rouge/oobikuoru/"
    And the page "/en/voru-county/rouge/oobikuoru/" links to "/en/voru-county/rouge/"
    And the page "/vorumaa/rouge/oobikuoru/peremaja/" links to "/vorumaa/rouge/"
