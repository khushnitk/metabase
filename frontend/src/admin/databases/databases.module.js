import "./databases.controllers";

var AdminDatabases = angular.module('metabase.admin.databases', [
    'metabase.admin.databases.controllers'
]);

AdminDatabases.config(['$routeProvider', function ($routeProvider) {
    $routeProvider.when('/metabase/admin/databases', {
        template: '<div class="flex flex-column flex-full" mb-react-component="DatabaseList"></div>',
        controller: 'DatabaseList'
    });
    $routeProvider.when('/metabase/admin/databases/create', {
        template: '<div class="flex flex-column flex-full" mb-react-component="DatabaseEdit"></div>',
        controller: 'DatabaseEdit'
    });
    $routeProvider.when('/metabase/admin/databases/:databaseId', {
        template: '<div class="flex flex-column flex-full" mb-react-component="DatabaseEdit"></div>',
        controller: 'DatabaseEdit'
    });
}]);
