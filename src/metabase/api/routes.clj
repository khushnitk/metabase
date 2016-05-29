(ns metabase.api.routes
  (:require [compojure.core :refer [context defroutes GET]]
            [compojure.route :as route]
            (metabase.api [activity :as activity]
                          [card :as card]
                          [dashboard :as dashboard]
                          [database :as database]
                          [dataset :as dataset]
                          [email :as email]
                          [field :as field]
                          [label :as label]
                          [metric :as metric]
                          [notify :as notify]
                          [pulse :as pulse]
                          [revision :as revision]
                          [segment :as segment]
                          [session :as session]
                          [setting :as setting]
                          [setup :as setup]
                          [slack :as slack]
                          [table :as table]
                          [tiles :as tiles]
                          [user :as user]
                          [util :as util])
            [metabase.middleware :as middleware]))

(def ^:private +apikey
  "Wrap API-ROUTES so they may only be accessed with proper apikey credentials."
  middleware/enforce-api-key)

(def ^:private +auth
  "Wrap API-ROUTES so they may only be accessed with proper authentiaction credentials."
  middleware/enforce-authentication)

(defroutes ^{:doc "Ring routes for API endpoints."} routes
  (context "/activity"     []  activity/routes)
  (context "/card"         []  card/routes)
  (context "/dashboard"    []  dashboard/routes)
  (context "/database"     []  database/routes)
  (context "/dataset"      []  dataset/routes)
  (context "/email"        []  email/routes)
  (context "/field"        []  field/routes)
  (GET     "/health"       [] (if ((resolve 'metabase.core/initialized?))
                                {:status 200 :body {:status "ok"}}
                                {:status 503 :body {:status "initializing" :progress ((resolve 'metabase.core/initialization-progress))}}))
  (context "/label"        []  label/routes)
  (context "/metric"       []  metric/routes)
  (context "/notify"       []  notify/routes)
  (context "/pulse"        []  pulse/routes)
  (context "/revision"     []  revision/routes)
  (context "/segment"      []  segment/routes)
  (context "/session"      [] session/routes)
  (context "/setting"      []  setting/routes)
  (context "/setup"        [] setup/routes)
  (context "/slack"        []  slack/routes)
  (context "/table"        []  table/routes)
  (context "/tiles"        []  tiles/routes)
  (context "/user"         []  user/routes)
  (context "/util"         [] util/routes)
  (route/not-found (fn [{:keys [request-method uri]}]
                     {:status 404
                      :body   (str (.toUpperCase (name request-method)) " " uri " is not yet implemented.")})))
