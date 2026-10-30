Feature: Every site in every language it is translated into
  Estonian, the source language, has no URL prefix; every other language
  lives under its own prefix. Each part of a path is in the page's own
  language, and each page names its versions in the other languages.

  Background:
    Given the sites are built

  Scenario: Estonian has no prefix and English lives under /en/
    Then the page "/vorumaa/rouge/oobikuoru/" is in "et"
    And the page "/en/voru-county/rouge/oobikuoru/" is in "en"
    And the page "/" is in "et"
    And the page "/en/" is in "en"

  Scenario: Every place to stay has its own page in each language
    Then every stay of "oobikuoru" has a page in "et" and in "en"
    And the page "/en/voru-county/rouge/oobikuoru/groups-and-class-trips/" is in "en"

  Scenario: A page names its versions in the other languages
    Then the page "/en/voru-county/rouge/oobikuoru/large-houses/" links "et" to "/vorumaa/rouge/oobikuoru/suured-puhkemajad/"
    And the page "/en/voru-county/rouge/oobikuoru/large-houses/" links "en" to "/en/voru-county/rouge/oobikuoru/large-houses/"
    And the page "/en/voru-county/rouge/oobikuoru/large-houses/" links "x-default" to "/vorumaa/rouge/oobikuoru/suured-puhkemajad/"

  Scenario: Each part of a path is in the page's language
    Then the page "/vorumaa/rouge/oobikuoru/peremaja/" is in "et"
    And the page "/vorumaa/rouge/oobikuoru/peremaja/" links "en" to "/en/voru-county/rouge/oobikuoru/family-house/"
    And there is no page "/en/vorumaa/rouge/oobikuoru/peremaja/"
    And there is no page "/voru-county/rouge/oobikuoru/"

  Scenario: A translated page shows the Estonian name beside the English one
    Then the page "/en/voru-county/rouge/oobikuoru/large-houses/" shows "Suured puhkemajad" in "et"

  Scenario: Languages that are not enabled are not built
    Then there is no page "/fi/"
    And there is no page "/ru/"
