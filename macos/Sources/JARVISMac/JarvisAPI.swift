import Foundation

struct SessionInfo: Decodable, Sendable {
    let token: String
    let provider: String
    let route: String
    let configured: Bool
    let localSpeechReady: Bool?
}

struct ChatMessage: Codable, Identifiable, Sendable {
    let id: UUID
    let role: String
    let content: String

    init(id: UUID = UUID(), role: String, content: String) {
        self.id = id
        self.role = role
        self.content = content
    }

    private enum CodingKeys: String, CodingKey { case role, content }
}

struct ChatReply: Decodable, Sendable { let reply: String }

struct Transcript: Decodable, Identifiable, Sendable {
    let id: Int
    let role: String
    let content: String
    let createdAt: String
}

struct MemoryItem: Decodable, Identifiable, Sendable {
    let id: Int
    let text: String
    let createdAt: String
}

struct ActivityEvent: Decodable, Identifiable, Sendable {
    let id: Int
    let kind: String
    let status: String
    let summary: String
    let createdAt: String
}

struct MemorySnapshot: Decodable, Sendable {
    let memories: [MemoryItem]
    let transcripts: [Transcript]
    let events: [ActivityEvent]
}

struct IntegrationState: Decodable, Sendable {
    let name: String
    let ready: Bool
    let managed: Bool
    let pid: Int?
    let error: String
}

struct IntegrationSnapshot: Decodable, Sendable {
    let local: [String: IntegrationState]
    let obsidian: Bool
}

struct IntegrationResult: Decodable, Sendable {
    let id: String
    let ready: Bool?
    let stopped: Bool?
    let url: String?
}

struct AgentTask: Decodable, Sendable {
    let id: String
    let status: String
    let result: String
    let error: String
}

struct SystemStatus: Decodable, Sendable {
    let platform: String
    let cores: Int
    let memoryTotal: Int64
    let memoryFree: Int64
    let uptime: Int
}

enum JarvisAPIError: LocalizedError, Sendable {
    case invalidResponse
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "JARVIS returned an invalid response."
        case let .server(_, message): message
        }
    }
}

struct JarvisAPI: Sendable {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL = JarvisAPI.defaultBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    static var defaultBaseURL: URL {
        if let value = ProcessInfo.processInfo.environment["JARVIS_BASE_URL"], let url = URL(string: value), url.scheme == "http", ["127.0.0.1", "localhost", "::1"].contains(url.host) { return url }
        return URL(string: "http://127.0.0.1:4317")!
    }

    func connect() async throws -> SessionInfo { try await request("api/session") }
    func status() async throws -> SystemStatus { try await request("api/status") }
    func memory(token: String) async throws -> MemorySnapshot { try await request("api/memory", token: token) }
    func integrations(token: String) async throws -> IntegrationSnapshot { try await request("api/integrations", token: token) }

    func chat(messages: [ChatMessage], mode: String, token: String) async throws -> ChatReply {
        try await post("api/chat", token: token, body: ChatRequest(messages: messages, mode: mode, backend: "configured"))
    }

    func startTask(_ instruction: String, token: String) async throws -> AgentTask {
        try await post("api/agent-task", token: token, body: AgentTaskRequest(instruction: instruction))
    }

    func task(id: String, token: String) async throws -> AgentTask {
        try await request("api/agent-task?id=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)", token: token)
    }

    func setIntegration(_ id: String, action: String, token: String) async throws -> IntegrationResult {
        try await post("api/integrations", token: token, body: IntegrationRequest(id: id, action: action))
    }

    private func post<Response: Decodable, Body: Encodable>(_ path: String, token: String, body: Body) async throws -> Response {
        try await request(path, method: "POST", token: token, body: try JSONEncoder().encode(body))
    }

    private func request<Response: Decodable>(_ path: String, method: String = "GET", token: String? = nil, body: Data? = nil) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else { throw JarvisAPIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue(token, forHTTPHeaderField: "X-Jarvis-Token") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw JarvisAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data).error) ?? "JARVIS request failed."
            throw JarvisAPIError.server(http.statusCode, message)
        }
        do { return try JSONDecoder().decode(Response.self, from: data) }
        catch { throw JarvisAPIError.invalidResponse }
    }
}

private struct ChatRequest: Encodable { let messages: [ChatMessage]; let mode: String; let backend: String }
private struct AgentTaskRequest: Encodable { let instruction: String }
private struct IntegrationRequest: Encodable { let id: String; let action: String }
private struct ServerError: Decodable { let error: String }
