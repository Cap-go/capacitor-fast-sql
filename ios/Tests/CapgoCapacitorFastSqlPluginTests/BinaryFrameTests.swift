import XCTest
@testable import CapgoCapacitorFastSqlPlugin

final class BinaryFrameTests: XCTestCase {
    func testHTTPRejectsInfiniteResponsesWithoutCrashing() async throws {
        let database = try SQLDatabase(path: ":memory:")
        let server = try SQLHTTPServer(databases: ["test": database])
        try server.start()
        defer { server.stop(); database.close() }
        for binary in [false, true] {
            let url = try XCTUnwrap(URL(string: "http://127.0.0.1:\(server.port)/execute"))
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 10
            request.setValue("Bearer \(server.token)", forHTTPHeaderField: "Authorization")
            request.setValue("test", forHTTPHeaderField: "X-Database")
            request.setValue(binary ? BinaryFrame.contentType : "application/json", forHTTPHeaderField: "Content-Type")
            let payload: [String: Any] = ["statement": "SELECT 1e999 AS value", "params": []]
            request.httpBody = try binary ? BinaryFrame.encode(payload) : JSONSerialization.data(withJSONObject: payload)
            let (_, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 500)
        }
    }

    func testSharedJavaScriptGolden() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "binary-v1", withExtension: "bin", subdirectory: "Fixtures"))
        let request = try XCTUnwrap(try BinaryFrame.decode(Data(contentsOf: url)) as? [String: Any])
        let params = try XCTUnwrap(request["params"] as? [Any])
        XCTAssertEqual(params[0] as? Data, Data([0, 1, 255]))
        XCTAssertEqual(params[1] as? Data, Data())
        XCTAssertEqual(params[2] as? Double, 1.25)
        XCTAssertEqual(params[3] as? String, "😀")
    }

    func testRawDataSQLiteRoundTrip() throws {
        let database = try SQLDatabase(path: ":memory:")
        defer { database.close() }
        let result = try database.execute(statement: "SELECT ? AS bytes, ? AS empty, ? AS missing, ? AS fraction", params: [Data([0, 1, 255]), Data(), NSNull(), 1.25], binaryResults: true)
        let decoded = try XCTUnwrap(try BinaryFrame.decode(BinaryFrame.encode(result)) as? [String: Any])
        let rows = try XCTUnwrap(decoded["rows"] as? [[String: Any]])
        XCTAssertEqual(rows[0]["bytes"] as? Data, Data([0, 1, 255]))
        XCTAssertEqual(rows[0]["empty"] as? Data, Data())
        XCTAssertTrue(rows[0]["missing"] is NSNull)
        XCTAssertEqual(rows[0]["fraction"] as? Double, 1.25)
    }

    func testMalformedFrames() throws {
        for number in [Double.infinity, -Double.infinity, Double.nan] {
            XCTAssertThrowsError(try BinaryFrame.encode(["rows": [["value": number]]]))
        }
        let database = try SQLDatabase(path: ":memory:")
        defer { database.close() }
        let infinite = try database.execute(statement: "SELECT 1e999 AS value", params: [], binaryResults: true)
        XCTAssertThrowsError(try BinaryFrame.encode(infinite))
        XCTAssertFalse(JSONSerialization.isValidJSONObject(infinite))
        let valid = try BinaryFrame.encode(["value": Data([1, 2])])
        XCTAssertThrowsError(try BinaryFrame.decode(valid.dropLast()))
        var version = valid
        version[3] = 50
        XCTAssertThrowsError(try BinaryFrame.decode(version))
        for reference in [[-1.0, 1], [0, 999], [0.5, 0]] {
            XCTAssertThrowsError(try BinaryFrame.decode(BinaryFrame.encode(["$blob": reference])))
        }
    }
}
