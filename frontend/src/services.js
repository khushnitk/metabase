import _ from "underscore";

import MetabaseAnalytics from 'metabase/lib/analytics';
import MetabaseCookies from 'metabase/lib/cookies';
import * as MetabaseCore from 'metabase/lib/core';
import MetabaseSettings from 'metabase/lib/settings';


var MetabaseServices = angular.module('metabase.services', ['http-auth-interceptor', 'ipCookie', 'metabase.core.services']);

MetabaseServices.factory('AppState', ['$rootScope', '$q', '$location', '$interval', '$timeout', 'ipCookie', 'Session', 'User', 'Settings',
    function($rootScope, $q, $location, $interval, $timeout, ipCookie, Session, User, Settings) {
        // this is meant to be a global service used for keeping track of our overall app state
        // we fire 2 events as things change in the app
        // 1. appstate:user

        var initPromise;
        var currentUserPromise;

        var service = {

            model: {
                setupToken: null,
                currentUser: null,
                appContext: 'none',
                requestedUrl: null
            },

            init: function() {

                if (!initPromise) {
                    // hackery to allow MetabaseCookies to tie into Angular
                    MetabaseCookies.bootstrap($rootScope, $location, ipCookie);

                    var deferred = $q.defer();
                    initPromise = deferred.promise;

                    // grab our global settings
                    service.refreshSiteSettings();

                    // just make sure we grab the current user
                    service.refreshCurrentUser().then(function(user) {
                        deferred.resolve();
                    }, function(error) {
                        deferred.resolve();
                    });
                }

                return initPromise;
            },

            clearState: function() {
                currentUserPromise = null;
                service.model.currentUser = null;

                // clear any existing session cookies if they exist
                ipCookie.remove('metabase.SESSION_ID');
            },

            refreshCurrentUser: function() {

                // this is meant to be called once on app startup
                var userRefresh = User.current(function(result) {
                    service.model.currentUser = result;

                    $rootScope.$broadcast('appstate:user', result);

                }, function(error) {
                    console.log('unable to get current user', error);
                });

                // NOTE: every time we refresh the user we update our current promise to ensure that
                //       we can guarantee we've resolved the current user
                currentUserPromise = userRefresh.$promise;

                return currentUserPromise;
            },

            refreshSiteSettings: function() {

                var settingsRefresh = Session.properties(function(settings) {

                    MetabaseSettings.setAll(_.omit(settings, function(value, key, object) {
                        return (key.indexOf('$') === 0);
                    }));

                    $rootScope.$broadcast('appstate:site-settings', settings);

                }, function(error) {
                    console.log('unable to get site settings', error);
                });

                return settingsRefresh.$promise;
            },

            // This function performs whatever state cleanup and next steps are required when a user tries to access
            // something they are not allowed to.
            invalidAccess: function(user, url, message) {
                $location.path('/unauthorized/');
            },

            setAppContext: function(appContext) {
                service.model.appContext = appContext;
                $rootScope.$broadcast('appstate:context-changed', service.model.appContext);
            },

            routeChanged: function(event) {
                // establish our application context based on the route (URI)
                // valid app contexts are: 'setup', 'auth', 'main', 'admin', or 'unknown'
                var routeContext;
                if ($location.path().indexOf('/metabase/auth/') === 0) {
                    routeContext = 'auth';
                } else if ($location.path().indexOf('/metabase/setup/') === 0) {
                    routeContext = 'setup';
                } else if ($location.path().indexOf('/metabase/admin/') === 0) {
                    routeContext = 'admin';
                } else if ($location.path() === '/metabase/') {
                    routeContext = 'home';
                } else {
                    routeContext = 'main';
                }

                // if the context of the app has changed due to this route change then send out an event
                if (service.model.appContext !== routeContext) {
                    service.setAppContext(routeContext);
                }

                // this code is here to ensure that we have resolved our currentUser BEFORE we execute any other
                // code meant to establish app context based on the current route
                if (currentUserPromise) {
                    currentUserPromise.then(function(user) {
                        service.routeChangedImpl(event);
                    }, function(error) {
                        service.routeChangedImpl(event);
                    });
                } else {
                    service.routeChangedImpl(event);
                }
            },

            routeChangedImpl: function(event) {
                // whenever we have a route change (including initial page load) we need to establish some context

                // handle routing protections for /setup/
                if ($location.path().indexOf('/setup') === 0 && !MetabaseSettings.hasSetupToken()) {
                    // someone trying to access setup process without having a setup token, so block that.
                    $location.path('/metabase/');
                    return;
                } else if ($location.path().indexOf('/setup') !== 0 && MetabaseSettings.hasSetupToken()) {
                    // someone who has a setup token but isn't routing to setup yet, so send them there!
                    $location.path('/setup/');
                    return;
                }

                // if we don't have a current user then the only sensible destination is the login page
                if (!service.model.currentUser) {
                    // make sure we clear out any current state just to be safe
                    service.clearState();

                    if ($location.path().indexOf('/metabase/auth/') !== 0 && $location.path().indexOf('/setup/') !== 0) {
                        // if the user is asking for a url outside of /auth/* then record the url then send them
                        // to login page, otherwise we will let the user continue on to their requested page
                        service.model.requestedUrl = $location.path();
                        $location.path('/metabase/auth/login');
                    }

                    return;
                }

                if ($location.path().indexOf('/metabase/admin/') === 0) {
                    // the user is trying to change to a superuser page
                    if (!service.model.currentUser.is_superuser) {
                        service.invalidAccess(service.model.currentUser, $location.url(), "user is not a superuser!!!");
                        return;
                    }

                }
            },

            redirectAfterLogin: function() {
                if (service.model.requestedUrl) {
                    $location.path(service.model.requestedUrl);
                    delete service.model.requestedUrl;
                } else {
                    $location.path('/metabase');
                }
            }
        };

        // listen for location changes and use that as a trigger for page view tracking
        $rootScope.$on('$locationChangeSuccess', function() {
            // NOTE: we are only taking the path right now to avoid accidentally grabbing sensitive data like table/field ids
            MetabaseAnalytics.trackPageView($location.path());
        });

        // listen for all route changes so that we can update organization as appropriate
        $rootScope.$on('$routeChangeSuccess', service.routeChanged);

        // login just took place, so lets force a refresh of the current user
        $rootScope.$on("appstate:login", function(event, session_id) {
            service.refreshCurrentUser();
        });

        // logout just took place, do some cleanup
        $rootScope.$on("appstate:logout", function(event, session_id) {

            // clear out any current state
            service.clearState();

            // NOTE that we don't really care about callbacks in this case
            Session.delete({
                'session_id': session_id
            });
        });

        // enable / disable GA based on opt-out of anonymous tracking
        $rootScope.$on("appstate:site-settings", function(event, settings) {
            const ga_code = MetabaseSettings.get('ga_code');
            if (MetabaseSettings.isTrackingEnabled()) {
                // we are doing tracking
                window['ga-disable-'+ga_code] = null;
            } else {
                // tracking is disabled
                window['ga-disable-'+ga_code] = true;
            }
        });

        // NOTE: the below events are generated from the http-auth-interceptor which listens on our $http calls
        //       and intercepts calls that result in a 401 or 403 so that we can handle them here.  You must be
        //       careful to consider the implications of this because any endpoint that returns a 401/403 can
        //       have its call stack interrupted now and handled here instead of its normal callback sequence.

        // $http interceptor received a 401 response
        $rootScope.$on("event:auth-loginRequired", function() {
            // this is effectively just like a logout, we want to reset everything to a base state, then force login
            service.clearState();

            // this is ridiculously stupid.  we have to wait (300ms) for the cookie to actually be set in the browser :(
            $timeout(function() {
                $location.path('/metabase/auth/login');
            }, 300);
        });

        // $http interceptor received a 403 response
        $rootScope.$on("event:auth-forbidden", function() {
            $location.path("/metabase/unauthorized");
        });

        return service;
    }
]);

MetabaseServices.service('MetabaseCore', ['User', function(User) {
    // this just makes it easier to access the current user
    this.currentUser = User.current;

    // copy over MetabaseCore properties and functions
    angular.forEach(MetabaseCore, (value, key) => this[key] = value);
}]);


// API Services
var CoreServices = angular.module('metabase.core.services', ['ngResource', 'ngCookies']);

CoreServices.factory('Activity', ['$resource', '$cookies', function($resource, $cookies) {
    return $resource('/metabase/api/activity', {}, {
        list: {
            method: 'GET',
            isArray: true
        },
        recent_views: {
            url: '/metabase/api/activity/recent_views',
            method: 'GET',
            isArray: true
        }
    });
}]);

CoreServices.factory('Card', ['$resource', '$cookies', function($resource, $cookies) {
    return $resource('/metabase/api/card/:cardId', {}, {
        list: {
            url: '/metabase/api/card',
            method: 'GET',
            isArray: true
        },
        create: {
            url: '/metabase/api/card',
            method: 'POST'
        },
        get: {
            method: 'GET',
            params: {
                cardId: '@cardId'
            }
        },
        update: {
            method: 'PUT',
            params: {
                cardId: '@id'
            }
        },
        delete: {
            method: 'DELETE',
            params: {
                cardId: '@cardId'
            }
        },
        isfavorite: {
            url: '/metabase/api/card/:cardId/favorite',
            method: 'GET',
            params: {
                cardId: '@cardId'
            }
        },
        favorite: {
            url: '/metabase/api/card/:cardId/favorite',
            method: 'POST',
            params: {
                cardId: '@cardId'
            }
        },
        unfavorite: {
            url: '/metabase/api/card/:cardId/favorite',
            method: 'DELETE',
            params: {
                cardId: '@cardId'
            }
        },
        updateLabels: {
            url: '/metabase/api/card/:cardId/labels',
            method: 'POST',
            params: {
                cardId: '@cardId',
                label_ids: '@label_ids'
            }
        }
    });
}]);

CoreServices.factory('Dashboard', ['$resource', '$cookies', function($resource, $cookies) {
    return $resource('/metabase/api/dashboard/:dashId', {}, {
        list: {
            url:'/metabase/api/dashboard',
            method:'GET',
            isArray:true
        },
        create: {
            url:'/metabase/api/dashboard',
            method:'POST'
        },
        get: {
            method:'GET',
            params:{dashId:'@dashId'},
        },
        update: {
            method:'PUT',
            params:{dashId:'@id'}
        },
        delete: {
            method:'DELETE',
            params:{dashId:'@dashId'}
        },
        addcard: {
            url:'/metabase/api/dashboard/:dashId/cards',
            method:'POST',
            params:{dashId:'@dashId'}
        },
        removecard: {
            url:'/metabase/api/dashboard/:dashId/cards',
            method:'DELETE',
            params:{dashId:'@dashId'}
        },
        reposition_cards: {
            url:'/metabase/api/dashboard/:dashId/cards',
            method:'PUT',
            params:{dashId:'@dashId'}
        }
    });
}]);

CoreServices.factory('Email', ['$resource', function($resource) {
    return $resource('/metabase/api/email', {}, {

        updateSettings: {
            url: '/metabase/api/email/',
            method: 'PUT'
        },

        sendTest: {
            url: '/metabase/api/email/test',
            method: 'POST'
        }
    });
}]);

CoreServices.factory('Slack', ['$resource', function($resource) {
    return $resource('/metabase/api/slack', {}, {

        updateSettings: {
            url: '/metabase/api/slack/settings',
            method: 'PUT'
        }
    });
}]);

CoreServices.factory('Metabase', ['$resource', '$cookies', 'MetabaseCore', function($resource, $cookies, MetabaseCore) {
    return $resource('/metabase/api/meta', {}, {
        db_list: {
            url: '/metabase/api/database/',
            method: 'GET',
            isArray: true
        },
        db_list_with_tables: {
            method: 'GET',
            url: '/metabase/api/database/',
            params: {
                include_tables: 'true'
            },
            isArray: true
        },
        db_create: {
            url: '/metabase/api/database/',
            method: 'POST'
        },
        db_add_sample_dataset: {
            url: '/metabase/api/database/sample_dataset',
            method: 'POST'
        },
        db_get: {
            url: '/metabase/api/database/:dbId',
            method: 'GET',
            params: {
                dbId: '@dbId'
            }
        },
        db_update: {
            url: '/metabase/api/database/:dbId',
            method: 'PUT',
            params: {
                dbId: '@id'
            }
        },
        db_delete: {
            url: '/metabase/api/database/:dbId',
            method: 'DELETE',
            params: {
                dbId: '@dbId'
            }
        },
        db_metadata: {
            url: '/metabase/api/database/:dbId/metadata',
            method: 'GET',
            params: {
                dbId: '@dbId'
            }
        },
        db_tables: {
            url: '/metabase/api/database/:dbId/tables',
            method: 'GET',
            params: {
                dbId: '@dbId'
            },
            isArray: true
        },
        db_idfields: {
            url: '/metabase/api/database/:dbId/idfields',
            method: 'GET',
            params: {
                dbId: '@dbId'
            },
            isArray: true
        },
        db_autocomplete_suggestions: {
            url: '/metabase/api/database/:dbId/autocomplete_suggestions?prefix=:prefix',
            method: 'GET',
            params: {
                dbId: '@dbId'
            },
            isArray: true
        },
        db_sync_metadata: {
            url: '/metabase/api/database/:dbId/sync',
            method: 'POST',
            params: {
                dbId: '@dbId'
            }
        },
        table_list: {
            url: '/metabase/api/table/',
            method: 'GET',
            params: {
                tableId: '@tableId'
            },
            isArray: true
        },
        table_get: {
            url: '/metabase/api/table/:tableId',
            method: 'GET',
            params: {
                tableId: '@tableId'
            }
        },
        table_update: {
            url: '/metabase/api/table/:tableId',
            method: 'PUT',
            params: {
                tableId: '@id'
            }
        },
        table_fields: {
            url: '/metabase/api/table/:tableId/fields',
            method: 'GET',
            params: {
                tableId: '@tableId'
            },
            isArray: true
        },
        table_fks: {
            url: '/metabase/api/table/:tableId/fks',
            method: 'GET',
            params: {
                tableId: '@tableId'
            },
            isArray: true
        },
        table_reorder_fields: {
            url: '/metabase/api/table/:tableId/reorder',
            method: 'POST',
            params: {
                tableId: '@tableId'
            }
        },
        table_query_metadata: {
            url: '/metabase/api/table/:tableId/query_metadata',
            method: 'GET',
            params: {
                dbId: '@tableId'
            }
        },
        table_sync_metadata: {
            url: '/metabase/api/table/:tableId/sync',
            method: 'POST',
            params: {
                tableId: '@tableId'
            }
        },
        field_get: {
            url: '/metabase/api/field/:fieldId',
            method: 'GET',
            params: {
                fieldId: '@fieldId'
            }
        },
        field_summary: {
            url: '/metabase/api/field/:fieldId/summary',
            method: 'GET',
            params: {
                fieldId: '@fieldId'
            },
            isArray: true
        },
        field_values: {
            url: '/metabase/api/field/:fieldId/values',
            method: 'GET',
            params: {
                fieldId: '@fieldId'
            }
        },
        field_value_map_update: {
            url: '/metabase/api/field/:fieldId/value_map_update',
            method: 'POST',
            params: {
                fieldId: '@fieldId'
            }
        },
        field_update: {
            url: '/metabase/api/field/:fieldId',
            method: 'PUT',
            params: {
                fieldId: '@id'
            }
        },
        dataset: {
            url: '/metabase/api/dataset',
            method: 'POST'
        }
    });
}]);

CoreServices.factory('Pulse', ['$resource', '$cookies', function($resource, $cookies) {
    return $resource('/metabase/api/pulse/:pulseId', {}, {
        list: {
            url: '/metabase/api/pulse',
            method: 'GET',
            isArray: true
        },
        create: {
            url: '/metabase/api/pulse',
            method: 'POST'
        },
        get: {
            method: 'GET',
            params: { pulseId: '@pulseId' },
        },
        update: {
            method: 'PUT',
            params: { pulseId: '@id' }
        },
        delete: {
            method: 'DELETE',
            params: { pulseId: '@pulseId' }
        },
        test: {
            url: '/metabase/api/pulse/test',
            method: 'POST'
        },
        form_input: {
            url: '/metabase/api/pulse/form_input',
            method: 'GET',
        },
        preview_card: {
            url: '/metabase/api/pulse/preview_card_info/:id',
            params: { id: '@id' },
            method: 'GET',
        }
    });
}]);

CoreServices.factory('Segment', ['$resource', '$cookies', function($resource, $cookies) {
    return $resource('/metabase/api/segment/:segmentId', {}, {
        create: {
            url: '/metabase/api/segment',
            method: 'POST'
        },
        get: {
            method: 'GET',
            params: { segmentId: '@segmentId' },
        },
        update: {
            method: 'PUT',
            params: { segmentId: '@id' }
        },
        delete: {
            method: 'DELETE',
            params: { segmentId: '@segmentId' }
        }
    });
}]);

CoreServices.factory('Metric', ['$resource', '$cookies', function($resource, $cookies) {
    return $resource('/metabase/api/metric/:metricId', {}, {
        create: {
            url: '/metabase/api/metric',
            method: 'POST'
        },
        get: {
            method: 'GET',
            params: { metricId: '@metricId' },
        },
        update: {
            method: 'PUT',
            params: { metricId: '@id' }
        },
        delete: {
            method: 'DELETE',
            params: { metricId: '@metricId' }
        }
    });
}]);

CoreServices.factory('Revision', ['$resource', function($resource) {
    return $resource('/metabase/api/revision', {}, {
        list: {
            url: '/metabase/api/revision',
            method: 'GET',
            isArray: true,
            params: {
                'entity': '@entity',
                'id': '@id'
            }
        },
        revert: {
            url: '/metabase/api/revision/revert',
            method: 'POST',
            params: {
                'entity': '@entity',
                'id': '@id',
                'revision_id': '@revision_id'
            }
        }
    });
}]);

// Revisions V2
CoreServices.factory('Revisions', ['$resource', function($resource) {
    return $resource('/metabase/api/:entity/:id/revisions', {}, {
        get: {
            method: 'GET',
            isArray: true,
            params: {
                'entity': '@entity',
                'id': '@id'
            }
        }
    });
}]);

CoreServices.factory('Label', ['$resource', function($resource) {
    return $resource('/metabase/api/label/:id', {}, {
        list: {
            url: '/metabase/api/label',
            method: 'GET',
            isArray: true
        },
        create: {
            url: '/metabase/api/label',
            method: 'POST'
        },
        update: {
            method: 'PUT',
            params: {
                id: '@id'
            }
        },
        delete: {
            method: 'DELETE',
            params: {
                id: '@id'
            }
        }
    });
}]);

CoreServices.factory('Session', ['$resource', '$cookies', function($resource, $cookies) {
    return $resource('/metabase/api/session/', {}, {
        create: {
            method: 'POST',
            ignoreAuthModule: true // this ensures a 401 response doesn't trigger another auth-required event
        },
        delete: {
            method: 'DELETE'
        },
        properties: {
            url: '/metabase/api/session/properties',
            method: 'GET'
        },
        forgot_password: {
            url: '/metabase/api/session/forgot_password',
            method: 'POST'
        },
        reset_password: {
            url: '/metabase/api/session/reset_password',
            method: 'POST'
        },
        password_reset_token_valid: {
            url: '/metabase/api/session/password_reset_token_valid',
            method: 'GET'
        }
    });
}]);

CoreServices.factory('Settings', ['$resource', function($resource) {
    return $resource('/metabase/api/setting', {}, {
        list: {
            url: '/metabase/api/setting',
            method: 'GET',
            isArray: true,
        },
        // POST endpoint handles create + update in this case
        put: {
            url: '/metabase/api/setting/:key',
            method: 'PUT',
            params: {
                key: '@key'
            }
        },
        // set multiple values at once
        setAll: {
            url: '/metabase/api/setting/',
            method: 'PUT',
            isArray: true
        },
        delete: {
            url: '/metabase/api/setting/:key',
            method: 'DELETE',
            params: {
                key: '@key'
            }
        }
    });
}]);

CoreServices.factory('Setup', ['$resource', '$cookies', function($resource, $cookies) {
    return $resource('/metabase/api/setup/', {}, {
        create: {
            method: 'POST'
        },
        validate_db: {
            url: '/metabase/api/setup/validate',
            method: 'POST'
        }
    });
}]);

CoreServices.factory('User', ['$resource', '$cookies', function($resource, $cookies) {
    return $resource('/metabase/api/user/:userId', {}, {
        create: {
            url: '/metabase/api/user',
            method: 'POST'
        },
        list: {
            url: '/metabase/api/user/',
            method: 'GET',
            isArray: true
        },
        current: {
            url: '/metabase/api/user/current/',
            method: 'GET',
            ignoreAuthModule: true // this ensures a 401 response doesn't trigger another auth-required event
        },
        get: {
            url: '/metabase/api/user/:userId',
            method: 'GET',
            params: {
                'userId': '@userId'
            }
        },
        update: {
            url: '/metabase/api/user/:userId',
            method: 'PUT',
            params: {
                'userId': '@id'
            }
        },
        update_password: {
            url: '/metabase/api/user/:userId/password',
            method: 'PUT',
            params: {
                'userId': '@id'
            }
        },
        update_qbnewb: {
            url: '/metabase/api/user/:userId/qbnewb',
            method: 'PUT',
            params: {
                'userId': '@id'
            }
        },
        delete: {
            method: 'DELETE',
            params: {
                'userId': '@userId'
            }
        },
        send_invite: {
            url: '/metabase/api/user/:userId/send_invite',
            method: 'POST',
            params: {
                'userId': '@id'
            }
        }
    });
}]);

CoreServices.factory('Util', ['$resource', '$cookies', function($resource, $cookies) {
    return $resource('/metabase/api/util/', {}, {
        password_check: {
            url: '/metabase/api/util/password_check',
            method: 'POST'
        }
    });
}]);
