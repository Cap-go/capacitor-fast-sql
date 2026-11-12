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
    private let pluginVersion: String = "8.3.3"
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
        CAPPluginMethod(name: "getPluginVersion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureWeb", returnType: CAPPluginReturnPromise)
    ]

    private var databases: [String: SQLDatabase] = [:]
    private var server: SQLHTTPServer?

    @objc func connect(_ call: CAPPluginCall) {
        guard let database = call.getString("database") else {
            call.reject("Database name is required")
            return
        }

        let encrypted = call.getBool("encrypted") ?? false
        let encryptionKey = call.getString("encryptionKey")
        let walMode = call.getBool("walMode") ?? false
        let performancePresets = call.getBool("performancePresets") ?? false
        if encrypted && (encryptionKey == nil || encryptionKey?.isEmpty == true) {
            call.reject("Encryption key is required when encryption is enabled")
            return
        }

        // Check if already connected
        if let existing = databases[database] {
            guard existing.isReadOnly == (call.getBool("readOnly") ?? false) else {
                call.reject("Database is already open with a different readOnly option")
                return
            }
            if let server = server {
                call.resolve([
                    "port": server.port,
                    "token": server.token,
                    "binaryProtocolVersion": 1,
                    "database": database
                ])
                return
            }
        }

        do {
            // Get database path
            let dbPath = try getDatabasePath(database)

            // Open database
            let db = try SQLDatabase(
                path: dbPath,
                encrypted: encrypted,
                readOnly: call.getBool("readOnly") ?? false,
                encryptionKey: encryptionKey,
                walMode: walMode,
                performancePresets: performancePresets
            )

            // Start HTTP server if not already running, otherwise register the
            // new database with it. SQLHTTPServer stores a VALUE COPY of the
            // databases dict (Swift Dict is a value type), so every connect()
            // after server creation must push the new entry in explicitly.
            if let server {
                databases[database] = db
                server.addDatabase(db, forKey: database)
            } else {
                var initialDatabases = databases
                initialDatabases[database] = db
                do {
                    let newServer = try SQLHTTPServer(databases: initialDatabases)
                    try newServer.start()
                    databases[database] = db
                    self.server = newServer
                } catch {
                    db.close()
                    throw error
                }
            }

            guard let server = server else {
                call.reject("Failed to start HTTP server")
                return
            }

            call.resolve([
                "port": server.port,
                "token": server.token,
                "binaryProtocolVersion": 1,
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

        server?.removeDatabase(forKey: database)
        databases.removeValue(forKey: database)
        db.close()

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
            "token": server.token,
            "binaryProtocolVersion": 1
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
        guard (call.getString("isolationLevel") ?? "SERIALIZABLE") == "SERIALIZABLE" else {
            call.reject("Only SERIALIZABLE transaction isolation is supported")
            return
        }
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
            "version": pluginVersion,
            "binaryProtocolVersion": 1
        ])
    }

    @objc func configureWeb(_ call: CAPPluginCall) {
        // No-op on iOS — web configuration is only relevant on the web platform.
        call.resolve()
    }

    private func getDatabasePath(_ database: String) throws -> String {
        guard !database.isEmpty, database != ".", database != "..",
              !database.contains("/"), !database.contains("\\"), !database.contains("\0") else {
            throw NSError(domain: "CapgoCapacitorFastSQL", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Database must be a non-empty file name without path separators"
            ])
        }
        let paths = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)
        guard let documentsDirectory = paths.first else {
            throw NSError(domain: "CapgoCapacitorFastSQL", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Could not find documents directory"
            ])
        }

        let dbPath = (documentsDirectory as NSString).appendingPathComponent("\(database).db")
        let root = URL(fileURLWithPath: documentsDirectory).resolvingSymlinksInPath().standardizedFileURL
        let resolved = URL(fileURLWithPath: dbPath).resolvingSymlinksInPath().standardizedFileURL
        guard resolved.deletingLastPathComponent().path == root.path else {
            throw NSError(domain: "CapgoCapacitorFastSQL", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Database path must remain inside app storage"
            ])
        }
        return resolved.path
    }
}
