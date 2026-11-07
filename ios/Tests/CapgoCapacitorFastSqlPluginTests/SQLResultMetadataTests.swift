import XCTest
@testable import CapgoCapacitorFastSqlPlugin

final class SQLResultMetadataTests: XCTestCase {
    func testSelectDoesNotInheritPreviousInsertMetadata() throws {
        let database = try SQLDatabase(path: ":memory:")
        defer { database.close() }
        _ = try database.execute(statement: "CREATE TABLE sample (id INTEGER PRIMARY KEY)", params: [])
        let inserted = try database.execute(statement: "INSERT INTO sample DEFAULT VALUES", params: [])
        XCTAssertEqual(inserted["rowsAffected"] as? Int32, 1)
        let selected = try database.execute(statement: "SELECT id FROM sample", params: [])
        XCTAssertEqual(selected["rowsAffected"] as? Int32, 0)
        XCTAssertTrue(selected["insertId"] is NSNull)
    }
}
