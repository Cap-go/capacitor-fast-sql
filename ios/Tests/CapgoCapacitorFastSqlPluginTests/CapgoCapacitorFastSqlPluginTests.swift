import XCTest
@testable import CapgoCapacitorFastSqlPlugin

final class CapgoCapacitorFastSqlPluginTests: XCTestCase {
    func testEmptyBlobRemainsDistinctFromNull() throws {
        let database = try SQLDatabase(path: ":memory:")
        defer { database.close() }
        let result = try database.execute(
            statement: "SELECT typeof(?) AS kind, ? AS value, NULL AS missing",
            params: [["_type": "binary", "_data": ""], ["_type": "binary", "_data": ""]]
        )
        let rows = try XCTUnwrap(result["rows"] as? [[String: Any]])
        XCTAssertEqual(rows.first?["kind"] as? String, "blob")
        let value = try XCTUnwrap(rows.first?["value"] as? [String: String])
        XCTAssertEqual(value["_type"], "binary")
        XCTAssertEqual(value["_data"], "")
        XCTAssertTrue(rows.first?["missing"] is NSNull)
    }
}
