import Foundation
import Capacitor
import SQLite3

/**
 * Native SQL Plugin for iOS
 *
 * This plugin uses a custom HTTP server for efficient data transfer,
 * bypassing Capacitor's standard bridge for better performance.
 */
@objc(CapgoCapacitorFastSqlPlugin)
public class CapgoCapacitorFastSqlPlugin: CAPPlugin, CAPBridgedPlugin {
    private let pluginVersion: String = "8.0.12"
    public let identifier = "CapgoCapacitorFastSqlPlugin"
    public let jsName = "CapgoCapacitorFastSql"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getServerInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "execute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commitTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rollbackTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPluginVersion", returnType: CAPPluginReturnPromise)
    ]

    private var databases: [String: SQLDatabase] = [:]
    private var server: SQLHTTPServer?

    @objc func connect(_ call: CAPPluginCall) {
        guard let database = call.getString("database") else {
            call.reject("Database name is required")
            return
        }

        // Check if already connected
        if databases[database] != nil {
            if let server = server {
                call.resolve([
                    "port": server.port,
                    "token": server.token,
                    "database": database
                ])
                return
            }
        }

        do {
            // Get database path
            let dbPath = try getDatabasePath(database)

            // Open database
            let db = try SQLDatabase(path: dbPath)
            databases[database] = db

            // Start HTTP server if not already running
            if server == nil {
                server = try SQLHTTPServer(databases: databases)
                try server?.start()
            }

            guard let server = server else {
                call.reject("Failed to start HTTP server")
                return
            }

            call.resolve([
                "port": server.port,
                "token": server.token,
                "database": database
            ])
        } catch {
            call.reject("Failed to connect to database: \(error.localizedDescription)")
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        guard let database = call.getString("database") else {
            call.reject("Database name is required")
            return
        }

        guard let db = databases[database] else {
            call.reject("Database '\(database)' is not connected")
            return
        }

        db.close()
        databases.removeValue(forKey: database)

        // Stop server if no more databases
        if databases.isEmpty {
            server?.stop()
            server = nil
        }

        call.resolve()
    }

    @objc func getServerInfo(_ call: CAPPluginCall) {
        guard let database = call.getString("database") else {
            call.reject("Database name is required")
            return
        }

        guard databases[database] != nil else {
            call.reject("Database '\(database)' is not connected")
            return
        }

        guard let server = server else {
            call.reject("Server is not running")
            return
        }

        call.resolve([
            "port": server.port,
            "token": server.token
        ])
    }

    @objc func execute(_ call: CAPPluginCall) {
        guard let database = call.getString("database") else {
            call.reject("Database name is required")
            return
        }

        guard let statement = call.getString("statement") else {
            call.reject("Statement is required")
            return
        }

        guard let db = databases[database] else {
            call.reject("Database '\(database)' is not connected")
            return
        }

        let params = call.getArray("params", JSValue.self) ?? []

        do {
            let result = try db.execute(statement: statement, params: params)
            call.resolve(result)
        } catch {
            call.reject("Failed to execute statement: \(error.localizedDescription)")
        }
    }

    @objc func beginTransaction(_ call: CAPPluginCall) {
        guard let database = call.getString("database") else {
            call.reject("Database name is required")
            return
        }

        guard let db = databases[database] else {
            call.reject("Database '\(database)' is not connected")
            return
        }

        do {
            try db.beginTransaction()
            call.resolve()
        } catch {
            call.reject("Failed to begin transaction: \(error.localizedDescription)")
        }
    }

    @objc func commitTransaction(_ call: CAPPluginCall) {
        guard let database = call.getString("database") else {
            call.reject("Database name is required")
            return
        }

        guard let db = databases[database] else {
            call.reject("Database '\(database)' is not connected")
            return
        }

        do {
            try db.commitTransaction()
            call.resolve()
        } catch {
            call.reject("Failed to commit transaction: \(error.localizedDescription)")
        }
    }

    @objc func rollbackTransaction(_ call: CAPPluginCall) {
        guard let database = call.getString("database") else {
            call.reject("Database name is required")
            return
        }

        guard let db = databases[database] else {
            call.reject("Database '\(database)' is not connected")
            return
        }

        do {
            try db.rollbackTransaction()
            call.resolve()
        } catch {
            call.reject("Failed to rollback transaction: \(error.localizedDescription)")
        }
    }

    @objc func getPluginVersion(_ call: CAPPluginCall) {
        call.resolve([
            "version": pluginVersion
        ])
    }

    private func getDatabasePath(_ database: String) throws -> String {
        let paths = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)
        guard let documentsDirectory = paths.first else {
            throw NSError(domain: "CapgoCapacitorFastSQL", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Could not find documents directory"
            ])
        }

        let dbPath = (documentsDirectory as NSString).appendingPathComponent("\(database).db")
        return dbPath
    }
}
