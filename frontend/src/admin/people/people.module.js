import "./people.controllers";

var AdminPeople = angular.module('metabase.admin.people', [
    'metabase.admin.people.controllers'
]);

AdminPeople.config(['$routeProvider', function ($routeProvider) {
    $routeProvider.when('/metabase/admin/people/', {
        template: '<div mb-redux-component class="flex flex-column flex-full" />',
        controller: 'PeopleList'
    });
}]);
