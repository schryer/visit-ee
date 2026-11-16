@edit-changes
Feature: The edit mode's file changes (src/assets/edit-changes.js)

  Scenario: Moving a place sets its position and drops the estimate
    Then moving a place sets its position and drops the estimate

  Scenario: A new place gets its file, descriptions and a place on the site's list
    Then a new place gets its file, descriptions and a place on the site's list

  Scenario: A new place cannot take an id that exists
    Then a new place cannot take an id that exists

  Scenario: Taking a place off a site keeps the place
    Then taking a place off a site keeps the place

  Scenario: A listed place keeps its spot, and a distance given by hand
    Then a listed place keeps its spot, and a distance given by hand

  Scenario: Deleting a place removes its folder and takes it off every site
    Then deleting a place removes its folder and takes it off every site

  Scenario: Touched paths cover the description languages and sites
    Then touched paths cover the description languages and sites

  Scenario: Moving a place reads every site's list and distances
    Then moving a place reads every site's list and distances

  Scenario: Moving a listed place works its site's distances out again
    Then moving a listed place works its site's distances out again

  Scenario: Adding a place to a site's list works its distances out too
    Then adding a place to a site's list works its distances out too

  Scenario: An edit that moves nothing a site lists leaves its distances alone
    Then an edit that moves nothing a site lists leaves its distances alone

  Scenario: An edit says what it does
    Then an edit says what it does

  Scenario: Ids come from names
    Then ids come from names

  Scenario: A photo, its credit and a website go into the place's file
    Then a photo, its credit and a website go into the place's file

  Scenario: A removed or replaced photo's file goes, and so does a deleted place's
    Then a removed or replaced photo's file goes, and so does a deleted place's

  Scenario: A photo from the photo service replaces a file in the repository
    Then a photo from the photo service replaces a file in the repository

  Scenario: A description goes into the place's own strings, and an emptied one goes
    Then a description goes into the place's own strings, and an emptied one goes

  Scenario: A place's folder says who owns it
    Then a place's folder says who owns it
