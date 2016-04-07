(ns metabase.sync-database
  "The logic for doing DB and Table syncing itself."
  (:require [clojure.tools.logging :as log]
            [metabase.db :as db]
            [metabase.driver :as driver]
            [metabase.driver.query-processor :as qp]
            [metabase.driver :as driver]
            [metabase.events :as events]
            [metabase.models.raw-table :as raw-table]
            [metabase.models.table :as table]
            [metabase.sync-database.analyze :as analyze]
            [metabase.sync-database.introspect :as introspect]
            [metabase.sync-database.sync :as sync]
            [metabase.sync-database.sync-dynamic :as sync-dynamic]
            [metabase.util :as u]))


(declare sync-database-with-tracking!
         sync-table-with-tracking!)


(defn sync-database!
  "Sync DATABASE and all its Tables and Fields.

   Takes an optional kwarg `:full-sync?` which determines if we execute our table analysis work.  If this is not specified
   then we default to using the `:is_full_sync` attribute of the database."
  [database & {:keys [full-sync?]}]
  {:pre [(map? database)]}
  (binding [qp/*disable-qp-logging*  true
            db/*sel-disable-logging* true]
    (let [db-driver  (driver/engine->driver (:engine database))
          full-sync? (if-not (nil? full-sync?)
                       full-sync?
                       (:is_full_sync database))]
      (driver/sync-in-context db-driver database (partial sync-database-with-tracking! db-driver database full-sync?)))))

(defn sync-table!
  "Sync a *single* TABLE and all of its Fields.
   This is used *instead* of `sync-database!` when syncing just one Table is desirable.

   Takes an optional kwarg `:full-sync?` which determines if we execute our table analysis work.  If this is not specified
   then we default to using the `:is_full_sync` attribute of the tables parent database."
  [table & {:keys [full-sync?]}]
  {:pre [(map? table)]}
  (binding [qp/*disable-qp-logging* true]
    (let [database   (table/database table)
          db-driver  (driver/engine->driver (:engine database))
          full-sync? (if-not (nil? full-sync?)
                       full-sync?
                       (:is_full_sync database))]
      (driver/sync-in-context db-driver database (partial sync-table-with-tracking! db-driver database table full-sync?)))))


;;; ## ---------------------------------------- IMPLEMENTATION ----------------------------------------


(defn- sync-database-with-tracking! [driver database full-sync?]
  (let [start-time (System/nanoTime)
        tracking-hash (str (java.util.UUID/randomUUID))]
    (log/info (u/format-color 'magenta "Syncing %s database '%s'..." (name driver) (:name database)))
    (events/publish-event :database-sync-begin {:database_id (:id database) :custom_id tracking-hash})

    (binding [qp/*disable-qp-logging*  true
              db/*sel-disable-logging* true]
      ;; start with capturing a full introspection of the database
      (introspect/introspect-database-and-update-raw-tables! driver database)

      ;; use the introspected schema information and update our working data models
      (if (driver/driver-supports? driver :dynamic-schema)
        (sync-dynamic/scan-database-and-update-data-model! driver database)
        (sync/update-data-models-from-raw-tables! database))

      ;; now do any in-depth data analysis which requires querying the tables (if enabled)
      (when full-sync?
        (analyze/analyze-data-shape-for-tables! driver database)))

    (events/publish-event :database-sync-end {:database_id (:id database) :custom_id tracking-hash :running_time (int (/ (- (System/nanoTime) start-time) 1000000.0))}) ; convert to ms
    (log/info (u/format-color 'magenta "Finished syncing %s database '%s'. (%s)" (name driver) (:name database)
                              (u/format-nanoseconds (- (System/nanoTime) start-time))))))


(defn- sync-table-with-tracking! [driver database table full-sync?]
  (let [start-time (System/nanoTime)]
    (log/info (u/format-color 'magenta "Syncing table '%s' from %s database '%s'..." (:display_name table) (name driver) (:name database)))

    (binding [qp/*disable-qp-logging*  true
              db/*sel-disable-logging* true]
      (when-let [raw-tbl (db/sel :one raw-table/RawTable :id (:raw_table_id table))]
        ;; introspect
        (introspect/introspect-raw-table-and-update! driver database raw-tbl)

        ;; sync
        (if (driver/driver-supports? driver :dynamic-schema)
          (sync-dynamic/scan-table-and-update-data-model! driver database table)
          (sync/update-data-models-for-table! table))

        ;; analyze
        (when full-sync?
          (analyze/analyze-table-data-shape! driver table))))

    (events/publish-event :table-sync {:table_id (:id table)})
    (log/info (u/format-color 'magenta "Finished syncing table '%s' from %s database '%s'. (%s)" (:display_name table) (name driver) (:name database)
                              (u/format-nanoseconds (- (System/nanoTime) start-time))))))