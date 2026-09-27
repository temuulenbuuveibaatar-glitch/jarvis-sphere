import Foundation
import XCTest
@testable import JARVISMac

final class JarvisAPITests: XCTestCase {
    override func setUp() {
        super.setUp()
        URLProtocolStub.handler = nil
    }

    func testSessionDecodesAndUsesLoopbackRoute() async throws {
        let api = makeAPI { request in
            XCTAssertEqual(request.url?.path, "/api/session")
            return (200, #"{"token":"local","provider":"hermes","route":"omniroute","configured":true}"#)
        }
        let session = try await api.connect()
        XCTAssertEqual(session.token, "local")
        XCTAssertEqual(session.provider, "hermes")
    }

    func testAuthenticatedMemoryRequestKeepsTokenInHeader() async throws {
        let api = makeAPI { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Jarvis-Token"), "secret")
            return (200, #"{"memories":[],"transcripts":[],"events":[]}"#)
        }
        let snapshot = try await api.memory(token: "secret")
        XCTAssertTrue(snapshot.events.isEmpty)
    }

    func testNaturalCommandRoutingIsBounded() {
        XCTAssertEqual(RequestRoute.classify("Build me an app for notes"), .task)
        XCTAssertEqual(RequestRoute.classify("Create a SwiftUI app"), .task)
        XCTAssertEqual(RequestRoute.classify("Research this deeply: fusion"), .chat("research"))
        XCTAssertEqual(RequestRoute.classify("How are you?"), .chat("chat"))
    }

    private func makeAPI(handler: @escaping (URLRequest) throws -> (Int, String)) -> JarvisAPI {
        URLProtocolStub.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        return JarvisAPI(baseURL: URL(string: "http://127.0.0.1:4317")!, session: URLSession(configuration: configuration))
    }
}

private final class URLProtocolStub: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, String))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try Self.handler?(request) ?? (500, #"{"error":"Missing test handler"}"#)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
