import Foundation
import Capacitor
import Telegraph

/**
 * HTTP server for efficient SQL operations
 *
 * This server handles direct HTTP requests from JavaScript, bypassing Capacitor's
 * bridge for better performance with large datasets and sync operations.
 */
class SQLHTTPServer {
    let port: Int
    let token: String
    private var databases: [String: SQLDatabase]
    private let databasesLock = NSLock()
    private var server: Server?
    private var isRunning = false

    init(databases: [String: SQLDatabase]) throws {
        self.databases = databases
        self.token = SQLHTTPServer.generateToken()
        self.port = try SQLHTTPServer.findAvailablePort()

        // Initialize Telegraph server
        self.server = Server()
    }

    /// Registers a newly-connected database with the HTTP server.
    ///
    /// Must be called after every `connect()` that finds the server already running,
    /// because `SQLHTTPServer` holds a **value-type copy** of the databases dictionary
    /// and cannot observe subsequent mutations made to the plugin's own copy.
    func addDatabase(_ db: SQLDatabase, forKey key: String) {
        databasesLock.lock()
        defer { databasesLock.unlock() }
        databases[key] = db
    }

    /// Removes a disconnected database from the HTTP server's registry.
    ///
    /// Call whenever a database is disconnected so in-flight HTTP requests for it
    /// receive a timely "not found" response rather than accessing a closed handle.
    func removeDatabase(forKey key: String) {
        databasesLock.lock()
        defer { databasesLock.unlock() }
        databases.removeValue(forKey: key)
    }

    /// Returns the open database for `key`, or `nil` if not registered.
    private func registeredDatabase(forKey key: String) -> SQLDatabase? {
        databasesLock.lock()
        defer { databasesLock.unlock() }
        return databases[key]
    }

    func start() throws {
        guard !isRunning else { return }
        guard let server = server else {
            throw NSError(domain: "SQLHTTPServer", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Server not initialized"
            ])
        }

        // Configure routes
        setupRoutes()

        // Start server on localhost only
        try server.start(port: port, interface: "127.0.0.1")
        isRunning = true
    }

    func stop() {
        server?.stop()
        isRunning = false
    }

    // MARK: - CORS Headers

    private let corsHeaders: HTTPHeaders = [
        .accessControlAllowOrigin: "*",
        .accessControlAllowMethods: "POST, OPTIONS",
        .accessControlAllowHeaders: "Content-Type, Authorization, X-Database",
        .accessControlMaxAge: "86400"
    ]

    private func corsPreflightResponse() -> HTTPResponse {
        return HTTPResponse(.ok, headers: corsHeaders)
    }

    private func addCorsHeaders(_ response: HTTPResponse) -> HTTPResponse {
        for (key, value) in corsHeaders {
            response.headers[key] = value
        }
        return response
    }

    // MARK: - Route Setup

    private func setupRoutes() {
        guard let server = server else { return }

        // CORS preflight for all endpoints
        let preflightPaths = ["/execute", "/batch", "/echo", "/transaction/begin", "/transaction/commit", "/transaction/rollback"]
        for path in preflightPaths {
            server.route(.OPTIONS, path) { [weak self] _ in
                guard let self = self else {
                    return HTTPResponse(.internalServerError)
                }
                return self.corsPreflightResponse()
            }
        }

        // Execute endpoint
        server.route(.POST, "/execute") { [weak self] request in
            guard let self = self else {
                return HTTPResponse(.internalServerError)
            }
            return self.addCorsHeaders(self.handleExecuteRequest(request: request))
        }

        // Batch endpoint
        server.route(.POST, "/batch") { [weak self] request in
            guard let self = self else {
                return HTTPResponse(.internalServerError)
            }
            return self.addCorsHeaders(self.handleBatchRequest(request: request))
        }

        server.route(.POST, "/echo") { [weak self] request in
            guard let self = self else { return HTTPResponse(.internalServerError) }
            return self.addCorsHeaders(self.handleDataRequest(request: request, kind: "echo"))
        }

        // Transaction endpoints
        server.route(.POST, "/transaction/begin") { [weak self] request in
            guard let self = self else {
                return HTTPResponse(.internalServerError)
            }
            return self.addCorsHeaders(self.handleBeginTransactionRequest(request: request))
        }

        server.route(.POST, "/transaction/commit") { [weak self] request in
            guard let self = self else {
                return HTTPResponse(.internalServerError)
            }
            return self.addCorsHeaders(self.handleCommitTransactionRequest(request: request))
        }

        server.route(.POST, "/transaction/rollback") { [weak self] request in
            guard let self = self else {
                return HTTPResponse(.internalServerError)
            }
            return self.addCorsHeaders(self.handleRollbackTransactionRequest(request: request))
        }
    }

    // MARK: - Helper methods

    private static func generateToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let result = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard result == errSecSuccess else {
            return UUID().uuidString
        }
        return bytes.map { String(format: "%02hhx", $0) }.joined()
    }

    private static func findAvailablePort() throws -> Int {
        // Try ports in the range 9000-9100
        for port in 9000..<9100 {
            let socket = socket(AF_INET, SOCK_STREAM, 0)
            guard socket != -1 else {
                continue
            }

            defer {
                close(socket)
            }

            var addr = sockaddr_in()
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = UInt16(port).bigEndian
            addr.sin_addr.s_addr = inet_addr("127.0.0.1")

            var bindAddr = addr
            let bindResult = withUnsafePointer(to: &bindAddr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    bind(socket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }

            if bindResult == 0 {
                return port
            }
        }

        // Fallback to 9000 if no port found
        return 9000
    }

    // MARK: - Request Handlers

    private func handleExecuteRequest(request: HTTPRequest) -> HTTPResponse {
        return handleDataRequest(request: request, kind: "execute")
    }

    private func handleBatchRequest(request: HTTPRequest) -> HTTPResponse {
        return handleDataRequest(request: request, kind: "batch")
    }

    private func handleDataRequest(request: HTTPRequest, kind: String) -> HTTPResponse {
        guard request.headers["Authorization"] == "Bearer \(token)" else { return HTTPResponse(.unauthorized) }
        guard let database = request.headers["X-Database"] else { return HTTPResponse(.badRequest) }
        guard let db = registeredDatabase(forKey: database) else { return HTTPResponse(.notFound) }
        guard request.body.count <= BinaryFrame.maxBytes else { return HTTPResponse(.payloadTooLarge) }
        let binary = request.headers["Content-Type"] == BinaryFrame.contentType
        do {
            let decoded: Any
            if binary {
                decoded = try BinaryFrame.decode(request.body)
            } else {
                guard let json = try? JSONSerialization.jsonObject(with: request.body) else { throw BinaryFrameError.invalid }
                decoded = json
            }
            guard let json = decoded as? [String: Any] else { throw BinaryFrameError.invalid }
            let result: Any
            if kind == "batch" {
                guard let operations = json["operations"] as? [[String: Any]], operations.count <= 10000 else { throw BinaryFrameError.invalid }
                let parsed = try operations.map { try parseOperation($0) }
                result = try parsed.map { try db.execute(statement: $0.statement, params: $0.params, binaryResults: binary) }
            } else {
                let operation = try parseOperation(json)
                let params = operation.params
                if kind == "echo" {
                    guard params.count == 1 else { throw BinaryFrameError.invalid }
                    result = ["rows": [["value": params[0]]], "rowsAffected": 0]
                } else {
                    result = try db.execute(statement: operation.statement, params: params, binaryResults: binary)
                }
            }
            let data = try binary ? BinaryFrame.encode(result) : JSONSerialization.data(withJSONObject: result)
            return HTTPResponse(.ok, headers: [.contentType: binary ? BinaryFrame.contentType : "application/json"], body: data)
        } catch is BinaryFrameError {
            return HTTPResponse(.badRequest, body: Data("Invalid binary/SQL request".utf8))
        } catch {
            return HTTPResponse(.internalServerError, body: Data("Error: \(error.localizedDescription)".utf8))
        }
    }

    private func parseOperation(_ operation: [String: Any]) throws -> (statement: String, params: [Any]) {
        guard let statement = operation["statement"] as? String else { throw BinaryFrameError.invalid }
        if let raw = operation["params"], !(raw is [Any]) { throw BinaryFrameError.invalid }
        for value in operation["params"] as? [Any] ?? [] {
            if value is NSNull || value is String || value is Data { continue }
            if let number = value as? NSNumber, number.doubleValue.isFinite { continue }
            if let blob = value as? [String: Any], blob["_type"] as? String == "binary", blob["_data"] is String { continue }
            throw BinaryFrameError.invalid
        }
        return (statement, operation["params"] as? [Any] ?? [])
    }

    private func handleBeginTransactionRequest(request: HTTPRequest) -> HTTPResponse {
        if !request.body.isEmpty {
            guard let body = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any],
                  (body["isolationLevel"] as? String ?? "SERIALIZABLE") == "SERIALIZABLE" else {
                return HTTPResponse(.badRequest, body: Data("Only SERIALIZABLE transaction isolation is supported".utf8))
            }
        }
        // Authenticate
        guard let authHeader = request.headers["Authorization"],
              authHeader == "Bearer \(token)" else {
            return HTTPResponse(.unauthorized)
        }

        // Get database name
        guard let database = request.headers["X-Database"] else {
            let bodyData = "Database header required".data(using: .utf8)!
            return HTTPResponse(.badRequest, body: bodyData)
        }

        // Check if database exists
        guard let db = registeredDatabase(forKey: database) else {
            let bodyData = "Database not found".data(using: .utf8)!
            return HTTPResponse(.notFound, body: bodyData)
        }

        do {
            try db.beginTransaction()
            let resultData = "{}".data(using: .utf8)!
            return HTTPResponse(.ok, headers: [.contentType: "application/json"], body: resultData)
        } catch {
            let errorData = "Error: \(error.localizedDescription)".data(using: .utf8)!
            return HTTPResponse(.internalServerError, body: errorData)
        }
    }

    private func handleCommitTransactionRequest(request: HTTPRequest) -> HTTPResponse {
        // Authenticate
        guard let authHeader = request.headers["Authorization"],
              authHeader == "Bearer \(token)" else {
            return HTTPResponse(.unauthorized)
        }

        // Get database name
        guard let database = request.headers["X-Database"] else {
            let bodyData = "Database header required".data(using: .utf8)!
            return HTTPResponse(.badRequest, body: bodyData)
        }

        // Check if database exists
        guard let db = registeredDatabase(forKey: database) else {
            let bodyData = "Database not found".data(using: .utf8)!
            return HTTPResponse(.notFound, body: bodyData)
        }

        do {
            try db.commitTransaction()
            let resultData = "{}".data(using: .utf8)!
            return HTTPResponse(.ok, headers: [.contentType: "application/json"], body: resultData)
        } catch {
            let errorData = "Error: \(error.localizedDescription)".data(using: .utf8)!
            return HTTPResponse(.internalServerError, body: errorData)
        }
    }

    private func handleRollbackTransactionRequest(request: HTTPRequest) -> HTTPResponse {
        // Authenticate
        guard let authHeader = request.headers["Authorization"],
              authHeader == "Bearer \(token)" else {
            return HTTPResponse(.unauthorized)
        }

        // Get database name
        guard let database = request.headers["X-Database"] else {
            let bodyData = "Database header required".data(using: .utf8)!
            return HTTPResponse(.badRequest, body: bodyData)
        }

        // Check if database exists
        guard let db = registeredDatabase(forKey: database) else {
            let bodyData = "Database not found".data(using: .utf8)!
            return HTTPResponse(.notFound, body: bodyData)
        }

        do {
            try db.rollbackTransaction()
            let resultData = "{}".data(using: .utf8)!
            return HTTPResponse(.ok, headers: [.contentType: "application/json"], body: resultData)
        } catch {
            let errorData = "Error: \(error.localizedDescription)".data(using: .utf8)!
            return HTTPResponse(.internalServerError, body: errorData)
        }
    }
}
