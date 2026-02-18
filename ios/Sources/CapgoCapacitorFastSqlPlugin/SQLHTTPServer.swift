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
    private var server: Server?
    private var isRunning = false

    init(databases: [String: SQLDatabase]) throws {
        self.databases = databases
        self.token = SQLHTTPServer.generateToken()
        self.port = try SQLHTTPServer.findAvailablePort()

        // Initialize Telegraph server
        self.server = Server()
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
        .accessControlAllowMethods: "GET, POST, OPTIONS",
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
        let preflightPaths = ["/execute", "/batch", "/transaction/begin", "/transaction/commit", "/transaction/rollback"]
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
        guard let db = databases[database] else {
            let bodyData = "Database not found".data(using: .utf8)!
            return HTTPResponse(.notFound, body: bodyData)
        }

        // Parse request body
        let bodyData = request.body
        guard let json = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any],
              let statement = json["statement"] as? String else {
            let errorData = "Invalid request body".data(using: .utf8)!
            return HTTPResponse(.badRequest, body: errorData)
        }

        let params = (json["params"] as? [Any] ?? [])

        do {
            let result = try db.execute(statement: statement, params: params)
            let resultData = try JSONSerialization.data(withJSONObject: result)
            return HTTPResponse(.ok, headers: [.contentType: "application/json"], body: resultData)
        } catch {
            let errorData = "Error: \(error.localizedDescription)".data(using: .utf8)!
            return HTTPResponse(.internalServerError, body: errorData)
        }
    }

    private func handleBatchRequest(request: HTTPRequest) -> HTTPResponse {
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
        guard let db = databases[database] else {
            let bodyData = "Database not found".data(using: .utf8)!
            return HTTPResponse(.notFound, body: bodyData)
        }

        // Parse request body
        let bodyData = request.body
        guard let json = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any],
              let operations = json["operations"] as? [[String: Any]] else {
            let errorData = "Invalid request body".data(using: .utf8)!
            return HTTPResponse(.badRequest, body: errorData)
        }

        var results: [[String: Any]] = []

        do {
            for operation in operations {
                guard let statement = operation["statement"] as? String else {
                    let errorData = "Invalid operation: missing statement".data(using: .utf8)!
                    return HTTPResponse(.badRequest, body: errorData)
                }
                let params = (operation["params"] as? [Any] ?? [])
                let result = try db.execute(statement: statement, params: params)
                results.append(result)
            }

            let resultData = try JSONSerialization.data(withJSONObject: results)
            return HTTPResponse(.ok, headers: [.contentType: "application/json"], body: resultData)
        } catch {
            let errorData = "Error: \(error.localizedDescription)".data(using: .utf8)!
            return HTTPResponse(.internalServerError, body: errorData)
        }
    }

    private func handleBeginTransactionRequest(request: HTTPRequest) -> HTTPResponse {
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
        guard let db = databases[database] else {
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
        guard let db = databases[database] else {
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
        guard let db = databases[database] else {
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
