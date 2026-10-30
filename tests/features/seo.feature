Feature: Search engines
  A preview build keeps search engines out but lets link-preview bots
  in; every page has an Open Graph card with a photo; a production build gives
  them a sitemap with every language version, canonical addresses,
  structured data, and redirects from the old WordPress addresses.

  Scenario: A preview keeps search engines out
    Given the sites are built
    Then robots.txt disallows everything
    And the page "/vorumaa/rouge/oobikuoru/" asks not to be indexed

  Scenario: Shared links show a preview card, even on a preview
    Given the sites are built
    Then robots.txt lets "LinkedInBot" read "/vorumaa/rouge/oobikuoru/"
    And robots.txt lets "facebookexternalhit" read "/"
    And robots.txt keeps "Googlebot" out of "/vorumaa/rouge/oobikuoru/"
    And the page "/" has a link preview with an image that resolves
    And the page "/vorumaa/rouge/" has a link preview with an image that resolves
    And the page "/en/voru-county/rouge/oobikuoru/" has a link preview with an image that resolves
    And the page "/en/voru-county/rouge/oobikuoru/large-houses/" has a link preview with an image that resolves
    And the link preview of "/en/voru-county/rouge/oobikuoru/small-houses/" is a 1200×630 card
    And the link preview of "/en/voru-county/rouge/oobikuoru/family-house/" is the one of "/en/voru-county/rouge/oobikuoru/"

  Scenario: A production build lets them in
    Given the sites are built for production at "https://visit.ee"
    Then robots.txt names the sitemap "https://visit.ee/sitemap.xml"
    And the page "/vorumaa/rouge/oobikuoru/" does not ask not to be indexed
    And the page "/en/voru-county/rouge/oobikuoru/" has the canonical address "https://visit.ee/en/voru-county/rouge/oobikuoru/"

  Scenario: The sitemap lists every page with its other languages
    Given the sites are built
    Then the sitemap lists every page that was built
    And the sitemap lists "/en/voru-county/rouge/oobikuoru/groups-and-class-trips/" with its "et" version

  Scenario: Places to stay carry structured data
    Given the sites are built
    Then the page "/en/voru-county/rouge/oobikuoru/large-houses/" describes an "Accommodation" for up to 8 people
    And the page "/vorumaa/rouge/oobikuoru/" describes a "LodgingBusiness"

  Scenario: The old WordPress addresses redirect to the new pages
    Given the sites are built
    Then "/laagriplats/" redirects to "/vorumaa/rouge/oobikuoru/kampingumajad/"
    And "/kontakt/" redirects to "/vorumaa/rouge/oobikuoru/#contact"

  Scenario: Every link and file a page uses is there
    Given the sites are built
    Then every internal link, image, video, script and stylesheet resolves
