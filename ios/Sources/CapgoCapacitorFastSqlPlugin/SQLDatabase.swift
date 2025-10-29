import Foundation
import Capacitor
import SQLite3

// SQLite constants that aren't imported to Swift
private let SQLITE_STATIC = unsafeBitCast(0, to: sqlite3_destructor_type.self)
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/**
 * SQLite database wrapper for iOS
 */
class SQLDatabase {
    private var db: OpaquePointer?
    private let path: String
    private var inTransaction = false

    init(path: String) throws {
        self.path = path

        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        let result = sqlite3_open_v2(path, &db, flags, nil)

        guard result == SQLITE_OK else {
            throw SQLError.openFailed(message: String(cString: sqlite3_errmsg(db)))
        }

        // Enable foreign keys
        try execute(statement: "PRAGMA foreign_keys = ON", params: [])
    }

    func close() {
        if let db = db {
            sqlite3_close(db)
            self.db = nil
        }
    }

    func execute(statement: String, params: [Any]) throws -> [String: Any] {
        guard let db = db else {
            throw SQLError.notOpen
        }

        var stmt: OpaquePointer?
        let result = sqlite3_prepare_v2(db, statement, -1, &stmt, nil)

        guard result == SQLITE_OK else {
            let error = String(cString: sqlite3_errmsg(db))
            throw SQLError.prepareFailed(message: error)
        }

        defer {
            sqlite3_finalize(stmt)
        }

        // Bind parameters
        for (index, param) in params.enumerated() {
            let bindResult = try bindParameter(stmt: stmt, index: Int32(index + 1), value: param)
            if bindResult != SQLITE_OK {
                let error = String(cString: sqlite3_errmsg(db))
                throw SQLError.bindFailed(message: error)
            }
        }

        // Execute and collect rows
        var rows: [[String: Any]] = []
        var columnNames: [String] = []
        var columnCount: Int32 = 0

        while true {
            let stepResult = sqlite3_step(stmt)

            if stepResult == SQLITE_ROW {
                if columnNames.isEmpty {
                    columnCount = sqlite3_column_count(stmt)
                    for i in 0..<columnCount {
                        if let name = sqlite3_column_name(stmt, i) {
                            columnNames.append(String(cString: name))
                        }
                    }
                }

                var row: [String: Any] = [:]
                for i in 0..<columnCount {
                    let columnName = columnNames[Int(i)]
                    let value = getColumnValue(stmt: stmt, index: i)
                    row[columnName] = value
                }
                rows.append(row)
            } else if stepResult == SQLITE_DONE {
                break
            } else {
                let error = String(cString: sqlite3_errmsg(db))
                throw SQLError.executeFailed(message: error)
            }
        }

        let changes = sqlite3_changes(db)
        let lastInsertId = sqlite3_last_insert_rowid(db)

        return [
            "rows": rows,
            "rowsAffected": changes,
            "insertId": lastInsertId > 0 ? lastInsertId : NSNull()
        ]
    }

    func beginTransaction() throws {
        guard !inTransaction else {
            throw SQLError.transactionAlreadyActive
        }
        try execute(statement: "BEGIN TRANSACTION", params: [])
        inTransaction = true
    }

    func commitTransaction() throws {
        guard inTransaction else {
            throw SQLError.noTransactionActive
        }
        try execute(statement: "COMMIT", params: [])
        inTransaction = false
    }

    func rollbackTransaction() throws {
        guard inTransaction else {
            throw SQLError.noTransactionActive
        }
        try execute(statement: "ROLLBACK", params: [])
        inTransaction = false
    }

    private func bindParameter(stmt: OpaquePointer?, index: Int32, value: Any) throws -> Int32 {
        guard let stmt = stmt else {
            return SQLITE_ERROR
        }

        // Handle null
        if value is NSNull {
            return sqlite3_bind_null(stmt, index)
        }

        // Handle different types
        if let str = value as? String {
            return sqlite3_bind_text(stmt, index, str, -1, SQLITE_TRANSIENT)
        } else if let num = value as? NSNumber {
            // Check if it's a boolean
            if CFGetTypeID(num as CFTypeRef) == CFBooleanGetTypeID() {
                return sqlite3_bind_int(stmt, index, num.boolValue ? 1 : 0)
            }
            // Check if it's a double/float
            if num.doubleValue != Double(num.intValue) {
                return sqlite3_bind_double(stmt, index, num.doubleValue)
            }
            // It's an integer
            return sqlite3_bind_int64(stmt, index, num.int64Value)
        } else if let dict = value as? [String: Any],
                  let type = dict["_type"] as? String,
                  type == "binary",
                  let base64 = dict["_data"] as? String,
                  let data = Data(base64Encoded: base64) {
            // Handle binary data
            return data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
                sqlite3_bind_blob(stmt, index, bytes.baseAddress, Int32(data.count), SQLITE_TRANSIENT)
            }
        }

        return SQLITE_ERROR
    }

    private func getColumnValue(stmt: OpaquePointer?, index: Int32) -> Any {
        guard let stmt = stmt else {
            return NSNull()
        }

        let type = sqlite3_column_type(stmt, index)

        switch type {
        case SQLITE_INTEGER:
            return sqlite3_column_int64(stmt, index)
        case SQLITE_FLOAT:
            return sqlite3_column_double(stmt, index)
        case SQLITE_TEXT:
            if let text = sqlite3_column_text(stmt, index) {
                return String(cString: text)
            }
            return NSNull()
        case SQLITE_BLOB:
            if let blob = sqlite3_column_blob(stmt, index) {
                let size = sqlite3_column_bytes(stmt, index)
                let data = Data(bytes: blob, count: Int(size))
                return [
                    "_type": "binary",
                    "_data": data.base64EncodedString()
                ]
            }
            return NSNull()
        case SQLITE_NULL:
            return NSNull()
        default:
            return NSNull()
        }
    }
}

/**
 * SQL error types
 */
enum SQLError: Error {
    case notOpen
    case openFailed(message: String)
    case prepareFailed(message: String)
    case bindFailed(message: String)
    case executeFailed(message: String)
    case transactionAlreadyActive
    case noTransactionActive
}
