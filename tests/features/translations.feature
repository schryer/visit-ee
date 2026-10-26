Feature: Incomplete translations
  A missing UI string is a bug and stops the build. A site whose own
  strings are incomplete in a language is left out of that language, and
  nothing links to it, so a half-translated page never ships.

  Scenario: A missing UI string stops the build
    Given a copy of the content
    And the English UI string "book.check" is removed
    When I build it
    Then it fails
    And stderr mentions "book.check"

  Scenario: A site with an incomplete translation is left out of that language
    Given a copy of the content
    And the English string "stay.family-house.body" of "oobikuoru" is removed
    When I build it
    Then it succeeds
    And there is no page "/en/south-estonia/rouge/oobikuoru/"
    And the page "/louna-eesti/rouge/oobikuoru/" is in "et"
    And the page "/louna-eesti/rouge/oobikuoru/" has no version in "en"
    And the page "/en/" does not link to "/en/south-estonia/rouge/oobikuoru/"

  Scenario: A path part that is not a URL slug stops the build
    Given a copy of the content
    And the English string "stay.family-house.slug" of "oobikuoru" is "Family House"
    When I build it
    Then it fails
    And stderr mentions "stay.family-house.slug"

  Scenario: Two pages of a site cannot share a path
    Given a copy of the content
    And the English string "stay.family-house.slug" of "oobikuoru" is "large-houses"
    When I build it
    Then it fails
    And stderr mentions "stay.large-houses.slug"
