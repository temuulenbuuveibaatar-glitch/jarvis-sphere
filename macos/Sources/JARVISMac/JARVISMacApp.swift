import SwiftUI

@main
struct JARVISMacApp: App {
    @State private var model = JarvisModel()

    var body: some Scene {
        WindowGroup { ContentView(model: model).frame(minWidth: 920, minHeight: 680) }
            .windowStyle(.hiddenTitleBar)
            .commands { CommandGroup(replacing: .newItem) {} }
    }
}
