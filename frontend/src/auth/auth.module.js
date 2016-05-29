import "./auth.controllers";

var Auth = angular.module('metabase.auth', ['metabase.auth.controllers']);

Auth.config(['$routeProvider', function($routeProvider) {
    $routeProvider.when('/metabase/auth/login', {
        templateUrl: '/metabase/app/auth/partials/login.html',
        controller: 'Login'
    });

    $routeProvider.when('/metabase/auth/logout', {
        template: '',
        controller: 'Logout'
    });

    $routeProvider.when('/metabase/auth/forgot_password', {
        templateUrl: '/metabase/app/auth/partials/forgot_password.html',
        controller: 'ForgotPassword'
    });

    $routeProvider.when('/metabase/auth/reset_password/:token', {
        templateUrl: '/metabase/app/auth/partials/password_reset.html',
        controller: 'PasswordReset'
    });

    $routeProvider.when('/metabase/auth/password_reset_token_expired', {
        templateUrl: '/metabase/app/auth/partials/password_reset_token_expired.html'
    });
}]);
