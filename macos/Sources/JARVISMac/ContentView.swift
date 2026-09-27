import SwiftUI

struct ContentView: View {
    @Bindable var model: JarvisModel
    @State private var speech = SpeechController()
    @State private var selection: Section = .chat

    enum Section: String, CaseIterable, Identifiable {
        case chat = "Command deck"
        case activity = "Activity"
        case memory = "Memory"
        case services = "Systems"
        var id: Self { self }
        var symbol: String {
            switch self {
            case .chat: "circle.hexagongrid"
            case .activity: "waveform.path.ecg"
            case .memory: "brain.head.profile"
            case .services: "cpu"
            }
        }
    }

    var body: some View {
        NavigationSplitView {
            List(Section.allCases, selection: $selection) { section in
                Label(section.rawValue, systemImage: section.symbol).tag(section)
            }
            .navigationTitle("J.A.R.V.I.S.")
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.status).font(.caption).foregroundStyle(.cyan)
                    if let status = model.systemStatus { Text("\(status.cores) cores · \(ByteCountFormatter.string(fromByteCount: status.memoryFree, countStyle: .memory)) free").font(.caption2).foregroundStyle(.secondary) }
                }.padding()
            }
        } detail: {
            switch selection {
            case .chat: ChatView(model: model, speech: speech)
            case .activity: ActivityView(events: model.events)
            case .memory: MemoryView(memories: model.memories)
            case .services: ServicesView(model: model)
            }
        }
        .preferredColorScheme(.dark)
        .task { await model.connect() }
        .onChange(of: speech.transcript) { _, value in model.input = value }
        .alert("JARVIS", isPresented: Binding(get: { !model.error.isEmpty }, set: { if !$0 { model.error = "" } })) { Button("Dismiss", role: .cancel) {} } message: { Text(model.error) }
    }
}

private struct ChatView: View {
    @Bindable var model: JarvisModel
    @Bindable var speech: SpeechController

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Circle().fill(RadialGradient(colors: [.cyan.opacity(0.55), .blue.opacity(0.12), .clear], center: .center, startRadius: 5, endRadius: 100)).frame(width: 190, height: 190).blur(radius: model.isBusy ? 7 : 2)
                Circle().stroke(.cyan.opacity(0.7), lineWidth: 1).frame(width: 126, height: 126)
                Image(systemName: model.isBusy ? "waveform" : "circle.hexagongrid.fill").font(.system(size: 48, weight: .ultraLight)).foregroundStyle(.cyan)
            }.padding(.vertical, 18).animation(.easeInOut(duration: 0.4), value: model.isBusy)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if model.messages.isEmpty { Text("Welcome back, Mr Temuulen. Shall we pick up where we left off?").font(.title2).foregroundStyle(.secondary).padding() }
                        ForEach(model.messages) { message in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(message.role == "user" ? "YOU" : "JARVIS").font(.caption2.monospaced()).foregroundStyle(message.role == "user" ? .orange : .cyan)
                                Text(message.content).textSelection(.enabled)
                            }.padding(12).background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 12)).frame(maxWidth: .infinity, alignment: .leading).id(message.id)
                        }
                    }.padding()
                }.onChange(of: model.messages.count) { _, _ in if let id = model.messages.last?.id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } } }
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Ask, research, build, test, or deploy…", text: $model.input, axis: .vertical).textFieldStyle(.plain).lineLimit(1...5).padding(11).background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10)).onSubmit { Task { await model.send() } }
                Button { speech.toggle() } label: { Image(systemName: speech.isListening ? "mic.fill" : "mic").foregroundStyle(speech.isListening ? .orange : .cyan) }.buttonStyle(.bordered).help("Dictate with macOS Speech")
                Button { Task { await model.send() } } label: { model.isBusy ? AnyView(ProgressView().controlSize(.small)) : AnyView(Image(systemName: "arrow.up")) }.buttonStyle(.borderedProminent).tint(.cyan).disabled(model.isBusy || model.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }.padding()
        }
    }
}

private struct ActivityView: View {
    let events: [ActivityEvent]
    var body: some View { List(events.reversed()) { event in VStack(alignment: .leading, spacing: 4) { HStack { Text(event.kind.replacingOccurrences(of: "_", with: " ").uppercased()).font(.caption.monospaced()).foregroundStyle(.cyan); Spacer(); Text(event.status).font(.caption).foregroundStyle(.secondary) }; Text(event.summary); Text(event.createdAt).font(.caption2).foregroundStyle(.tertiary) }.padding(.vertical, 5) }.navigationTitle("Verified activity") }
}

private struct MemoryView: View {
    let memories: [MemoryItem]
    var body: some View { List(memories) { memory in VStack(alignment: .leading, spacing: 5) { Text(memory.text).textSelection(.enabled); Text(memory.createdAt).font(.caption2).foregroundStyle(.secondary) }.padding(.vertical, 4) }.navigationTitle("Local memory") }
}

private struct ServicesView: View {
    @Bindable var model: JarvisModel
    var body: some View {
        List(["osiris", "godEye"], id: \.self) { id in
            let service = model.integrations[id]
            HStack {
                VStack(alignment: .leading) { Text(service?.name ?? id); Text(service?.ready == true ? "Ready on loopback" : (service?.error.isEmpty == false ? service!.error : "Stopped")).font(.caption).foregroundStyle(service?.ready == true ? .green : .secondary) }
                Spacer()
                Button(service?.ready == true ? "Stop" : "Start") { Task { await model.setIntegration(id, action: service?.ready == true ? "stop" : "start") } }
            }.padding(.vertical, 5)
        }.navigationTitle("Local systems").toolbar { Button("Refresh") { Task { await model.connect() } } }
    }
}
