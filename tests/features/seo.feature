Feature: Search engines
  A preview build keeps search engines out; a production build gives
  them a sitemap with every language version, canonical addresses,
  structured data, and redirects from the old WordPress addresses.

  Scenario: A preview keeps search engines out
    Given the sites are built
    Then robots.txt disallows everything
    And the page "/louna-eesti/rouge/oobikuoru/" asks not to be indexed

  Scenario: A production build lets them in
    Given the sites are built for production at "https://visit.ee"
    Then robots.txt names the sitemap "https://visit.ee/sitemap.xml"
    And the page "/louna-eesti/rouge/oobikuoru/" does not ask not to be indexed
    And the page "/en/south-estonia/rouge/oobikuoru/" has the canonical address "https://visit.ee/en/south-estonia/rouge/oobikuoru/"

  Scenario: The sitemap lists every page with its other languages
    Given the sites are built
    Then the sitemap lists every page that was built
    And the sitemap lists "/en/south-estonia/rouge/oobikuoru/groups-and-class-trips/" with its "et" version

  Scenario: Places to stay carry structured data
    Given the sites are built
    Then the page "/en/south-estonia/rouge/oobikuoru/large-houses/" describes an "Accommodation" for up to 8 people
    And the page "/louna-eesti/rouge/oobikuoru/" describes a "LodgingBusiness"

  Scenario: The old WordPress addresses redirect to the new pages
    Given the sites are built
    Then "/laagriplats/" redirects to "/louna-eesti/rouge/oobikuoru/kampingumajad/"
    And "/kontakt/" redirects to "/louna-eesti/rouge/oobikuoru/#contact"

  Scenario: Every link and file a page uses is there
    Given the sites are built
    Then every internal link, image, video, script and stylesheet resolves
