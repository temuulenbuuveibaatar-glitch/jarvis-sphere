import Foundation
import Observation
import UserNotifications

enum RequestRoute: Equatable {
    case chat(String)
    case task

    static func classify(_ input: String) -> RequestRoute {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if text.hasPrefix("research this deeply") || text.hasPrefix("deep research") { return .chat("research") }
        if text.hasPrefix("think deeply") || text.hasPrefix("deep think") { return .chat("think") }
        let taskPrefixes = ["build me an app", "build an app", "build a swift", "create an app", "create a swift", "code a", "make me an app", "fix this project", "update this project", "refactor this project", "deploy this", "monitor this", "run the tests", "test this project"]
        return taskPrefixes.contains(where: text.hasPrefix) ? .task : .chat("chat")
    }
}

@MainActor
@Observable
final class JarvisModel {
    var input = ""
    var messages: [ChatMessage] = []
    var events: [ActivityEvent] = []
    var memories: [MemoryItem] = []
    var integrations: [String: IntegrationState] = [:]
    var systemStatus: SystemStatus?
    var provider = "offline"
    var status = "Connecting to local JARVIS…"
    var error = ""
    var isBusy = false

    private let api: JarvisAPI
    private let notifications = UNUserNotificationCenter.current()
    private var token = ""

    init(api: JarvisAPI = JarvisAPI()) { self.api = api }

    func connect() async {
        do {
            let session = try await api.connect()
            token = session.token
            provider = session.provider
            status = session.configured ? "Online · \(session.provider.uppercased())" : "Provider needs configuration"
            let authToken = token
            async let memory = api.memory(token: authToken)
            async let services = api.integrations(token: authToken)
            async let machine = api.status()
            let (snapshot, integrationSnapshot, currentStatus) = try await (memory, services, machine)
            messages = snapshot.transcripts.map { ChatMessage(role: $0.role, content: $0.content) }
            events = snapshot.events
            memories = snapshot.memories
            integrations = integrationSnapshot.local
            systemStatus = currentStatus
            _ = try? await notifications.requestAuthorization(options: [.alert, .sound])
        } catch {
            status = "Local service offline"
            self.error = error.localizedDescription
        }
    }

    func send() async {
        let command = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty, !isBusy, !token.isEmpty else { return }
        input = ""
        error = ""
        isBusy = true
        messages.append(ChatMessage(role: "user", content: command))
        defer { isBusy = false }
        do {
            switch RequestRoute.classify(command) {
            case let .chat(mode):
                let reply = try await api.chat(messages: Array(messages.suffix(16)), mode: mode, token: token)
                messages.append(ChatMessage(role: "assistant", content: reply.reply))
            case .task:
                messages.append(ChatMessage(role: "assistant", content: "Task accepted. I’ll report verified activity here."))
                let task = try await api.startTask(command, token: token)
                try await follow(task)
            }
            await refreshMemory()
        } catch {
            self.error = error.localizedDescription
            messages.append(ChatMessage(role: "assistant", content: "I couldn’t complete that request: \(error.localizedDescription)"))
        }
    }

    func setIntegration(_ id: String, action: String) async {
        guard !token.isEmpty else { return }
        error = ""
        do {
            _ = try await api.setIntegration(id, action: action, token: token)
            integrations = try await api.integrations(token: token).local
        } catch { self.error = error.localizedDescription }
    }

    func refreshMemory() async {
        guard !token.isEmpty else { return }
        do {
            let snapshot = try await api.memory(token: token)
            events = snapshot.events
            memories = snapshot.memories
        } catch { self.error = error.localizedDescription }
    }

    private func follow(_ initial: AgentTask) async throws {
        var task = initial
        while task.status == "running" {
            try Task.checkCancellation()
            try await Task.sleep(for: .seconds(1))
            let authToken = token
            async let next = api.task(id: task.id, token: authToken)
            async let snapshot = api.memory(token: authToken)
            task = try await next
            let refreshed = try await snapshot
            events = refreshed.events
        }
        let succeeded = task.status == "succeeded"
        let result = succeeded ? task.result : task.error
        messages.append(ChatMessage(role: "assistant", content: result.isEmpty ? "Task \(task.status)." : result))
        await notify(title: succeeded ? "JARVIS task complete" : "JARVIS task failed", body: result)
    }

    private func notify(title: String, body: String) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = String(body.prefix(240))
        content.sound = .default
        try? await notifications.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}
